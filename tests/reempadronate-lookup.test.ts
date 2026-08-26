import { beforeEach, describe, expect, it, vi } from "vitest";

// `lookupAction` es un endpoint público y ANÓNIMO: no hay `requireAdmin` ni
// token que lo abra, así que lo único que lo protege es el orden
// proceso abierto → cupo (`allows`, sin gastar) → Turnstile → zod → `record` →
// padrón. Este archivo fija ese orden —calcado de `createApplicationAction`,
// donde el proyecto lo razonó— y fija las dos garantías de privacidad de la
// pantalla:
//
//   1. el `fullName` del padrón NUNCA sale en la respuesta, sólo el enmascarado;
//   2. todos los caminos negativos contestan EXACTAMENTE lo mismo (`not_found`,
//      sin motivo), así que la pantalla no sirve para averiguar quién es socio.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo: un `const` común
// todavía no existe cuando corre la factory.
const mocks = vi.hoisted(() => ({
  prisma: {
    member: { findUnique: vi.fn() },
    configuration: { findUnique: vi.fn() },
    reregistrationProcess: { findUnique: vi.fn() },
    // El `claim` de la llave: es lo único que la action escribe, y sólo en el
    // camino positivo.
    presentation: { updateMany: vi.fn() },
  },
  verifyTurnstile: vi.fn(),
  limiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn() },
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: mocks.verifyTurnstile }));
// `audit` se mockea para poder AFIRMAR que no se llama: una búsqueda anónima no
// se audita (enumeración y ruido; además dejaría escrito qué DNI consultó cada
// IP). Si algún día alguien le agrega el asiento, este archivo se pone rojo.
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/rate-limiter", () => ({ reregistrationLookupLimiter: mocks.limiter }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "1.2.3.4", "user-agent": "vitest" }),
}));

import { lookupAction } from "@/app/(public)/reempadronate/actions";
import { maskedName } from "@/lib/reregistration/rules";

const PROCESS_ID = 7;
const IDLE = { kind: "idle" } as const;

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

/** Una ficha del padrón tal como la devuelve la consulta de la action. */
function memberRow(over: {
  category?: string;
  status?: string;
  email?: string | null;
  presentation?: { status: string; email: string | null } | null;
}) {
  const p = over.presentation === undefined ? { status: "pending", email: null } : over.presentation;
  return {
    id: 42,
    fullName: "Castillo Nestor",
    email: over.email === undefined ? null : over.email,
    category: over.category ?? "adherent",
    status: over.status ?? "active",
    presentations: p === null ? [] : [{ id: 5, ...p }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limiter.allows.mockReturnValue(true);
  mocks.verifyTurnstile.mockResolvedValue(true);
  // Clave de configuración apuntando al proceso, y el proceso en 1ª instancia:
  // el wizard sólo abre en `first_instance` / `second_instance` (`wizardOpen`).
  mocks.prisma.configuration.findUnique.mockResolvedValue({
    key: "reempadronamiento_proceso_id",
    value: String(PROCESS_ID),
  });
  mocks.prisma.reregistrationProcess.findUnique.mockResolvedValue({
    id: PROCESS_ID,
    status: "first_instance",
  });
  mocks.prisma.member.findUnique.mockResolvedValue(null);
  mocks.prisma.presentation.updateMany.mockResolvedValue({ count: 1 });
});

describe("lookupAction — guardas", () => {
  it("sin proceso abierto no consulta el padrón ni gasta cupo", async () => {
    mocks.prisma.reregistrationProcess.findUnique.mockResolvedValue({
      id: PROCESS_ID,
      status: "closing", // ya no admite presentaciones
    });

    const res = await lookupAction(IDLE, form({ dni: "28456757" }));

    expect(res.kind).toBe("error");
    expect(mocks.limiter.record).not.toHaveBeenCalled();
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("una clave de configuración rota es lo mismo que no tener proceso", async () => {
    mocks.prisma.configuration.findUnique.mockResolvedValue({ key: "k", value: "" });

    const res = await lookupAction(IDLE, form({ dni: "28456757" }));

    expect(res.kind).toBe("error");
    // Y no se pregunta por un proceso con id inventado.
    expect(mocks.prisma.reregistrationProcess.findUnique).not.toHaveBeenCalled();
  });

  it("con el cupo agotado corta ANTES de Turnstile y sin tocar el padrón", async () => {
    mocks.limiter.allows.mockReturnValue(false);

    const res = await lookupAction(IDLE, form({ dni: "28456757" }));

    expect(res).toEqual({ kind: "error", error: expect.stringContaining("Demasiados intentos") });
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.limiter.record).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("el captcha se verifica antes del formato, y un captcha malo NO cobra el intento", async () => {
    mocks.verifyTurnstile.mockResolvedValue(false);

    // DNI inválido a propósito: si el orden fuera zod → Turnstile, el error
    // sería el del formato y esta aserción fallaría.
    const res = await lookupAction(IDLE, form({ dni: "abc" }));

    expect(res).toEqual({ kind: "error", error: expect.stringContaining("sos una persona") });
    expect(mocks.limiter.record).not.toHaveBeenCalled();
  });

  it("un DNI mal tipeado tampoco cobra el intento", async () => {
    const res = await lookupAction(IDLE, form({ dni: "123" }));

    expect(res.kind).toBe("error");
    expect(mocks.limiter.record).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("el intento se cobra recién cuando se va a tocar el padrón", async () => {
    await lookupAction(IDLE, form({ dni: "28456757" }));

    expect(mocks.limiter.record).toHaveBeenCalledWith("1.2.3.4");
    expect(mocks.prisma.member.findUnique).toHaveBeenCalledTimes(1);
  });

  it("la presentación se busca acotada al proceso vivo", async () => {
    await lookupAction(IDLE, form({ dni: "28456757" }));

    const arg = mocks.prisma.member.findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ dni: "28456757" });
    expect(arg.select.presentations.where).toEqual({ processId: PROCESS_ID });
    // Sin fila de cohorte no hay nada que escribir: el camino negativo no toca
    // la base más allá de la lectura.
    expect(mocks.prisma.presentation.updateMany).not.toHaveBeenCalled();
  });
});

describe("lookupAction — veredictos", () => {
  it("un adherente cohortado y pendiente pasa, con el nombre ENMASCARADO", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow({}));

    const res = await lookupAction(IDLE, form({ dni: "28456757" }));

    expect(res).toEqual({
      kind: "eligible",
      maskedName: maskedName("Castillo Nestor"),
      // La LLAVE de la presentación: 256 bits en base64url. Es lo único que
      // dirige los pasos 2 a 4, y por eso ninguna action recibe jamás un id.
      presentationToken: expect.stringMatching(/^[\w-]{40,}$/),
      // La ficha no tenía email, así que no hay nada que precargar.
      email: "",
    });
    // La garantía que importa: el nombre completo del padrón no viaja al
    // navegador de quien tipeó el DNI, ni siquiera adentro de otro campo.
    expect(JSON.stringify(res)).not.toContain("Castillo Nestor");
    expect(JSON.stringify(res)).not.toContain("Nestor");

    // La llave se escribe SÓLO sobre una presentación editable: si la Comisión
    // la validó entre el veredicto y el claim, no se entrega ninguna.
    const claim = mocks.prisma.presentation.updateMany.mock.calls[0][0];
    expect(claim.where.id).toBe(5);
    expect(claim.where.status).toEqual({ in: ["pending", "observed"] });
    // Se persiste el HASH y jamás el crudo: 64 hex de sha256.
    expect(claim.data.resumeTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(claim.data.resumeTokenHash).not.toBe(
      (res as { presentationToken: string }).presentationToken,
    );
  });

  // La ÚNICA precarga del camino del DNI (decisión 8). Todo lo demás se tipea
  // de cero: precargar la fecha de nacimiento o el domicilio se los mostraría a
  // quien tipeó un documento ajeno.
  it("precarga el email, y NADA más del padrón", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(
      memberRow({ email: "vecino@ejemplo.com", presentation: { status: "pending", email: null } }),
    );

    const res = await lookupAction(IDLE, form({ dni: "28456757" }));

    expect(res).toEqual({
      kind: "eligible",
      maskedName: maskedName("Castillo Nestor"),
      presentationToken: expect.any(String),
      email: "vecino@ejemplo.com",
    });
  });

  it("si la Comisión resolvió la presentación en el medio, no se entrega llave", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow({}));
    // El `updateMany` del claim no encuentra fila editable.
    mocks.prisma.presentation.updateMany.mockResolvedValue({ count: 0 });

    // Sin llave no hay trámite posible, así que contesta el cartel genérico
    // —el mismo que ve todo el mundo— y no uno propio.
    expect(await lookupAction(IDLE, form({ dni: "28456757" }))).toStrictEqual({
      kind: "not_found",
    });
  });

  it("una presentación observada también pasa: se subsana por el wizard", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(
      memberRow({ presentation: { status: "observed", email: "x@y.com" } }),
    );

    const res = await lookupAction(IDLE, form({ dni: "28456757" }));

    expect(res.kind).toBe("eligible");
    // Se prefiere el email de la PRESENTACIÓN —el que el propio vecino declaró
    // y viene a corregir— antes que el de la ficha.
    expect(res).toMatchObject({ email: "x@y.com" });
  });

  it("una presentación ya enviada no es un rechazo: va a la pantalla de estado", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(
      memberRow({ presentation: { status: "submitted", email: "x@y.com" } }),
    );

    expect(await lookupAction(IDLE, form({ dni: "28456757" }))).toEqual({
      kind: "already_submitted",
      canResend: true,
    });
  });

  it("sin email cargado no se ofrece reenviar el enlace", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(
      memberRow({ presentation: { status: "validated", email: null } }),
    );

    expect(await lookupAction(IDLE, form({ dni: "28456757" }))).toEqual({
      kind: "already_submitted",
      canResend: false,
    });
  });

  // El corazón de la pantalla: cinco situaciones distintas, UNA sola respuesta.
  // Si alguna se separara, el formulario pasaría a ser un oráculo para
  // averiguar quién es socio de la vecinal y quién dejó de serlo.
  const NEGATIVES: Array<[string, unknown]> = [
    ["un DNI que no existe", null],
    ["un socio activo (no es la cohorte del Art. 9° bis)", memberRow({ category: "active" })],
    ["un adherente dado de baja", memberRow({ status: "withdrawn" })],
    ["un adherente que no fue convocado", memberRow({ presentation: null })],
    [
      "una presentación rechazada",
      memberRow({ presentation: { status: "rejected", email: "x@y.com" } }),
    ],
  ];

  it.each(NEGATIVES)("%s recibe el MISMO cartel genérico", async (_label, row) => {
    mocks.prisma.member.findUnique.mockResolvedValue(row);

    const res = await lookupAction(IDLE, form({ dni: "28456757" }));

    // Igualdad estructural EXACTA, no `res.kind`: la respuesta no puede llevar
    // ningún campo extra —motivo, id, bandera— que permita distinguir un caso
    // de otro leyendo el POST.
    expect(res).toStrictEqual({ kind: "not_found" });
  });

  it("ninguna búsqueda deja asiento de auditoría", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow({}));
    await lookupAction(IDLE, form({ dni: "28456757" }));
    mocks.prisma.member.findUnique.mockResolvedValue(null);
    await lookupAction(IDLE, form({ dni: "11111111" }));

    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
