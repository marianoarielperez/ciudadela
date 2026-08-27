import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// `checkDniAction` es un endpoint público y ANÓNIMO: lo único que lo protege es
// el orden interruptor → proceso → `allows` (sin gastar) → Turnstile → zod →
// `record` → padrón, calcado de `createApplicationAction` y del lookup de
// REEMPADRONATE. Este archivo fija ese orden y las garantías de privacidad:
//
//   1. el `fullName` del padrón NUNCA sale en la respuesta, sólo el enmascarado;
//   2. el reingreso habilitado contesta EXACTAMENTE lo mismo que el DNI
//      desconocido (`{ kind: "ok" }` pelado, sin memberId);
//   3. ninguna búsqueda audita (dejaría registrado qué DNI consultó cada IP);
//   4. el cupo es PROPIO: no toca el de creación.
const mocks = vi.hoisted(() => ({
  prisma: {
    member: { findUnique: vi.fn() },
    configuration: { findUnique: vi.fn() },
    reregistrationProcess: { findUnique: vi.fn() },
  },
  service: {
    findLiveByDni: vi.fn(),
    lastRejectionAt: vi.fn(),
  },
  verifyTurnstile: vi.fn(),
  audit: vi.fn(),
  dniCheckLimiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn() },
  // Los demás limitadores que importa `actions.ts`; acá nadie los llama.
  otherLimiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn(), check: vi.fn() },
  configRows: {} as Record<string, unknown>,
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/applications/service", () => ({
  applicationService: mocks.service,
  DuplicateLiveApplicationError: class DuplicateLiveApplicationError extends Error {},
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: mocks.verifyTurnstile }));
// `audit` se mockea para poder AFIRMAR que no se llama (doctrina del lookup de
// REEMPADRONATE): si alguien le agrega el asiento, este archivo se pone rojo.
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/email", () => ({ mailer: { sendToApplication: vi.fn() } }));
vi.mock("@/lib/tokens", () => ({ tokens: { issue: vi.fn() } }));
vi.mock("@/lib/auth/rate-limiter", () => ({
  asociateDniCheckLimiter: mocks.dniCheckLimiter,
  applicationCreateLimiter: mocks.otherLimiter,
  applicationStatusLimiter: mocks.otherLimiter,
  publicTokenLimiter: mocks.otherLimiter,
  resumeResendLimiter: mocks.otherLimiter,
  resumeResendTargetLimiter: mocks.otherLimiter,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "1.2.3.4", "user-agent": "vitest" }),
}));
vi.mock("next/server", () => ({ after: () => {} }));

import { checkDniAction } from "@/app/(public)/asociate/actions";
import { maskedName } from "@/lib/members/masked-name";

const IDLE = { kind: "idle" } as const;
const DNI = "28456757";

// El reloj se congela como en tests/create-application-action.test.ts: la
// guarda del re-empadronamiento cita el plazo y `currentDeadline` calla los
// vencidos, así que sin fijar "hoy" el caso pasaría o fallaría según el día.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-01T15:00:00Z")); // 12:00 en Argentina
afterAll(() => { vi.useRealTimers(); });

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

const VALID = { "cf-turnstile-response": "captcha-ok", dni: DNI };

/** Una ficha del padrón tal como la devuelve `loadEligibilityInputs`. */
function memberRow(over: Partial<{
  status: string;
  withdrawalReason: string | null;
  reentryBlocked: boolean;
  rejectedUntil: Date | null;
  pending: number;
}> = {}) {
  return {
    id: 42,
    fullName: "Castillo Nestor",
    status: over.status ?? "withdrawn",
    withdrawalReason: over.withdrawalReason === undefined ? "resignation" : over.withdrawalReason,
    reentryBlocked: over.reentryBlocked ?? false,
    rejectedUntil: over.rejectedUntil ?? null,
    _count: { fees: over.pending ?? 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dniCheckLimiter.allows.mockReturnValue(true);
  mocks.verifyTurnstile.mockResolvedValue(true);
  mocks.configRows = { asociate_activo: true };
  mocks.prisma.configuration.findUnique.mockImplementation(
    async ({ where: { key } }: { where: { key: string } }) =>
      key in mocks.configRows ? { key, value: mocks.configRows[key] } : null,
  );
  mocks.prisma.reregistrationProcess.findUnique.mockResolvedValue(null);
  mocks.prisma.member.findUnique.mockResolvedValue(null);
  mocks.service.findLiveByDni.mockResolvedValue(null);
  mocks.service.lastRejectionAt.mockResolvedValue(null);
});

describe("checkDniAction — guardas", () => {
  it("interruptor de ASOCIATE apagado: no consulta nada ni gasta cupo", async () => {
    mocks.configRows.asociate_activo = false;

    const res = await checkDniAction(IDLE, form(VALID));

    expect(res).toEqual({ kind: "error", error: expect.stringMatching(/asociaciones en línea están cerradas/i) });
    expect(mocks.dniCheckLimiter.allows).not.toHaveBeenCalled();
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("re-empadronamiento en curso: suspendido aunque el interruptor esté prendido", async () => {
    mocks.configRows.reempadronamiento_proceso_id = "7";
    mocks.prisma.reregistrationProcess.findUnique.mockResolvedValue({
      id: 7,
      status: "first_instance",
      firstEndsAt: new Date("2026-09-25T12:00:00.000Z"),
      secondEndsAt: null,
    });

    const res = await checkDniAction(IDLE, form(VALID));

    expect(res).toEqual({
      kind: "error",
      error: expect.stringMatching(/suspendidas temporalmente durante el proceso de re-empadronamiento/i),
    });
    expect(mocks.dniCheckLimiter.record).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("con el cupo agotado corta ANTES de Turnstile y sin tocar el padrón", async () => {
    mocks.dniCheckLimiter.allows.mockReturnValue(false);

    const res = await checkDniAction(IDLE, form(VALID));

    expect(res).toEqual({ kind: "error", error: expect.stringContaining("Demasiados intentos") });
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.dniCheckLimiter.record).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("el captcha se verifica antes del formato, y un captcha malo NO cobra el intento", async () => {
    mocks.verifyTurnstile.mockResolvedValue(false);

    // DNI inválido a propósito: si el orden fuera zod → Turnstile, el error
    // sería el del formato y esta aserción fallaría.
    const res = await checkDniAction(IDLE, form({ "cf-turnstile-response": "x", dni: "abc" }));

    expect(res).toEqual({ kind: "error", error: expect.stringContaining("sos una persona") });
    expect(mocks.dniCheckLimiter.record).not.toHaveBeenCalled();
  });

  it("un DNI mal tipeado tampoco cobra el intento", async () => {
    const res = await checkDniAction(IDLE, form({ "cf-turnstile-response": "ok", dni: "123" }));

    expect(res.kind).toBe("error");
    expect(mocks.dniCheckLimiter.record).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("el intento se cobra recién cuando se va a tocar el padrón, en el cupo PROPIO", async () => {
    await checkDniAction(IDLE, form(VALID));

    expect(mocks.dniCheckLimiter.record).toHaveBeenCalledWith("1.2.3.4");
    expect(mocks.prisma.member.findUnique).toHaveBeenCalledTimes(1);
    // El cupo de creación no se toca: son presupuestos separados.
    expect(mocks.otherLimiter.allows).not.toHaveBeenCalled();
    expect(mocks.otherLimiter.record).not.toHaveBeenCalled();
  });
});

describe("checkDniAction — veredictos", () => {
  it("un DNI desconocido continúa: { kind: 'ok' } pelado", async () => {
    expect(await checkDniAction(IDLE, form(VALID))).toStrictEqual({ kind: "ok" });
  });

  it("un ex-socio habilitado contesta EXACTAMENTE lo mismo que el desconocido", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow());

    const res = await checkDniAction(IDLE, form(VALID));

    // Igualdad estructural estricta: ni memberId, ni bandera, ni nombre. Que
    // exista una ficha no se le dice a un visitante anónimo (decisión #10).
    expect(res).toStrictEqual({ kind: "ok" });
    expect(JSON.stringify(res)).not.toContain("42");
  });

  it("socio vigente: already_member con el nombre ENMASCARADO, nunca el completo", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow({ status: "active", withdrawalReason: null }));

    const res = await checkDniAction(IDLE, form(VALID));

    expect(res).toStrictEqual({
      kind: "blocked",
      code: "already_member",
      maskedName: maskedName("Castillo Nestor"),
    });
    expect(JSON.stringify(res)).not.toContain("Castillo");
    expect(JSON.stringify(res)).not.toContain("Nestor");
  });

  it("solicitud viva: in_progress sin nombre y sin applicationId", async () => {
    mocks.service.findLiveByDni.mockResolvedValue({ id: 99, email: "x@y.com" });

    const res = await checkDniAction(IDLE, form(VALID));

    expect(res).toStrictEqual({ kind: "blocked", code: "in_progress", maskedName: null });
    expect(JSON.stringify(res)).not.toContain("99");
    expect(JSON.stringify(res)).not.toContain("x@y.com");
  });

  it("deuda viva: debt con la cantidad de cuotas", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow({ pending: 7 }));

    expect(await checkDniAction(IDLE, form(VALID))).toStrictEqual({
      kind: "blocked",
      code: "debt",
      maskedName: maskedName("Castillo Nestor"),
      pendingCount: 7,
    });
  });

  it("expulsado: expelled, y la deuda no lo cambia (precedencia)", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(
      memberRow({ withdrawalReason: "expulsion", pending: 5 }),
    );

    expect(await checkDniAction(IDLE, form(VALID))).toStrictEqual({
      kind: "blocked",
      code: "expelled",
      maskedName: maskedName("Castillo Nestor"),
    });
  });

  it("rechazo reciente: rejected_wait con la fecha en ISO", async () => {
    const until = new Date("2026-11-01T12:00:00Z");
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow({ rejectedUntil: until }));

    expect(await checkDniAction(IDLE, form(VALID))).toStrictEqual({
      kind: "blocked",
      code: "rejected_wait",
      maskedName: maskedName("Castillo Nestor"),
      retryAtIso: until.toISOString(),
    });
  });

  it("ninguna búsqueda deja asiento de auditoría", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow({ status: "active" }));
    await checkDniAction(IDLE, form(VALID));
    mocks.prisma.member.findUnique.mockResolvedValue(null);
    await checkDniAction(IDLE, form({ ...VALID, dni: "11111111" }));

    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
