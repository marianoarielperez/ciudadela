import { beforeEach, describe, expect, it, vi } from "vitest";

// Las actions del wizard son endpoints públicos y ANÓNIMOS: no hay `requireAdmin`
// que las abra, así que lo único que las protege es el orden Turnstile → rate
// limit → zod → elegibilidad. Este archivo fija ese orden y fija que el asiento
// de auditoría no se lleve el DNI ni el email (docs/08, Ley 25.326).
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo: un `const` común
// todavía no existe cuando corre la factory.
const mocks = vi.hoisted(() => {
  class DuplicateLiveApplicationError extends Error {
    constructor() {
      super("Ya tenés una solicitud en trámite.");
      this.name = "DuplicateLiveApplicationError";
    }
  }
  return {
    DuplicateLiveApplicationError,
    prisma: { member: { findUnique: vi.fn() } },
    service: {
      create: vi.fn(),
      findLiveByDni: vi.fn(),
      lastRejectionAt: vi.fn(),
      rotateResumeToken: vi.fn(),
    },
    verifyTurnstile: vi.fn(),
    tokens: { issue: vi.fn() },
    mailer: { sendToApplication: vi.fn() },
    audit: vi.fn(),
    createLimiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn() },
    resendLimiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn() },
    afterCallbacks: [] as Array<() => unknown>,
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/applications/service", () => ({
  applicationService: mocks.service,
  DuplicateLiveApplicationError: mocks.DuplicateLiveApplicationError,
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: mocks.verifyTurnstile }));
vi.mock("@/lib/tokens", () => ({ tokens: mocks.tokens }));
vi.mock("@/lib/email", () => ({ mailer: mocks.mailer }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/rate-limiter", () => ({
  applicationCreateLimiter: mocks.createLimiter,
  resumeResendLimiter: mocks.resendLimiter,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "1.2.3.4", "user-agent": "vitest" }),
}));
// `after()` no corre solo en un test: se capturan las tareas y se disparan a
// mano, así el test puede además comprobar que la respuesta salió ANTES.
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    mocks.afterCallbacks.push(fn);
  },
}));

import { createApplicationAction, resendResumeLinkAction } from "@/app/(public)/asociate/actions";

const DNI = "30111222";
const EMAIL = "test@x.com";

const VALID = {
  "cf-turnstile-response": "captcha-ok",
  livesInBarrio: "si",
  streetId: "3",
  streetNumber: "123",
  requestedCategory: "active",
  fullName: "Vecina Prueba",
  dni: DNI,
  birthDate: "1990-05-05",
  civilStatus: "soltera",
  nationality: "argentina",
  occupation: "docente",
  phone: "2974000000",
  email: EMAIL,
  emailConfirm: EMAIL,
  acceptTerms: "on",
};

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

async function flushAfter() {
  const pending = mocks.afterCallbacks.splice(0);
  for (const fn of pending) await fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.createLimiter.allows.mockReturnValue(true);
  mocks.resendLimiter.allows.mockReturnValue(true);
  mocks.verifyTurnstile.mockResolvedValue(true);
  mocks.prisma.member.findUnique.mockResolvedValue(null);
  mocks.service.findLiveByDni.mockResolvedValue(null);
  mocks.service.lastRejectionAt.mockResolvedValue(null);
  mocks.service.create.mockResolvedValue({ id: 7, resumeToken: "RESUME-RAW" });
  mocks.service.rotateResumeToken.mockResolvedValue("ROTATED-RAW");
  mocks.tokens.issue.mockResolvedValue("VERIFY-RAW");
  mocks.mailer.sendToApplication.mockResolvedValue({ messageId: "mid" });
});

describe("createApplicationAction", () => {
  it("Turnstile inválido: no se crea nada y no se consulta el padrón", async () => {
    mocks.verifyTurnstile.mockResolvedValue(false);
    const result = await createApplicationAction({}, form(VALID));

    expect(result.error).toMatch(/no pudimos verificar/i);
    expect(mocks.service.create).not.toHaveBeenCalled();
    // El captcha corre ANTES de la elegibilidad: sin esto el formulario sería un
    // verificador de DNI contra el padrón (spec M3 §4).
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
    expect(mocks.service.findLiveByDni).not.toHaveBeenCalled();
    // Y un captcha vencido no gasta cupo.
    expect(mocks.createLimiter.record).not.toHaveBeenCalled();
  });

  it("limitador agotado: corta antes del captcha y de la base", async () => {
    mocks.createLimiter.allows.mockReturnValue(false);
    const result = await createApplicationAction({}, form(VALID));

    expect(result.error).toMatch(/demasiados intentos/i);
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
    expect(mocks.service.create).not.toHaveBeenCalled();
  });

  it("DNI de socio vigente: bloqueo already_member y ninguna solicitud creada", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue({
      id: 12, status: "active", withdrawalReason: null, debtAtWithdrawal: false,
      reentryBlocked: false, rejectedUntil: null,
    });
    const result = await createApplicationAction({}, form(VALID));

    expect(result.blocked?.code).toBe("already_member");
    expect(result.blocked?.message).toMatch(/ya estás asociado/i);
    expect(result.created).toBeUndefined();
    expect(mocks.service.create).not.toHaveBeenCalled();
    expect(mocks.mailer.sendToApplication).not.toHaveBeenCalled();
  });

  it("camino feliz: devuelve el token de retome, manda la verificación y audita sin datos personales", async () => {
    const result = await createApplicationAction({}, form(VALID));

    expect(result.error).toBeUndefined();
    expect(result.blocked).toBeUndefined();
    expect(result.created).toEqual({ resumeToken: "RESUME-RAW" });

    // El activo va SIEMPRE con débito, sin importar qué mandó el formulario.
    const created = mocks.service.create.mock.calls[0][0];
    expect(created.wantsDebit).toBe(true);
    expect(created.memberId).toBeNull();
    expect(created.streetId).toBe(3);
    expect(created.streetText).toBeNull();
    expect(created.email).toBe(EMAIL);

    // Verificación de email inmediata (REG-08), colgada de la solicitud.
    expect(mocks.tokens.issue).toHaveBeenCalledWith({
      purpose: "email_verification", applicationId: 7,
    });
    const sent = mocks.mailer.sendToApplication.mock.calls[0][0];
    expect(sent.applicationId).toBe(7);
    expect(sent.type).toBe("email_verification");
    expect(sent.to).toBe(EMAIL);
    expect(sent.message.text).toContain("VERIFY-RAW");

    // El asiento identifica por id: ni DNI ni email en el detalle.
    const entry = mocks.audit.mock.calls[0][0];
    expect(entry.action).toBe("application_created");
    expect(entry.entityId).toBe(7);
    expect(entry.detail).toEqual({ category: "active", wantsDebit: true, reentry: false });
    expect(JSON.stringify(entry)).not.toMatch(/30111222|test@x/);
  });

  it("el adherente es el único que elige el débito", async () => {
    await createApplicationAction({}, form({ ...VALID, requestedCategory: "adherent", wantsDebit: "no" }));
    expect(mocks.service.create.mock.calls[0][0].wantsDebit).toBe(false);

    mocks.service.create.mockClear();
    await createApplicationAction({}, form({ ...VALID, requestedCategory: "adherent", wantsDebit: "si" }));
    expect(mocks.service.create.mock.calls[0][0].wantsDebit).toBe(true);
  });

  it("la categoría se revalida contra la residencia (POST armado a mano)", async () => {
    const result = await createApplicationAction({}, form({ ...VALID, requestedCategory: "collaborator" }));
    expect(result.error).toMatch(/no corresponde a tu lugar de residencia/i);
    expect(mocks.service.create).not.toHaveBeenCalled();
  });

  it("menor de 18: se lo manda a la sede y no se toca la base", async () => {
    const result = await createApplicationAction({}, form({ ...VALID, birthDate: "2015-05-05" }));
    expect(result.error).toMatch(/mayor de 18/i);
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("carrera de dos POST del mismo DNI: el segundo ve in_progress", async () => {
    mocks.service.create.mockRejectedValue(new mocks.DuplicateLiveApplicationError());
    const result = await createApplicationAction({}, form(VALID));
    expect(result.blocked?.code).toBe("in_progress");
    expect(result.error).toBeUndefined();
  });

  it("un fallo de infraestructura NO se disfraza de in_progress", async () => {
    // Si lo hiciera, el vecino iría a pedir el reenvío de un enlace que no existe.
    mocks.service.create.mockRejectedValue(new Error("connection lost"));
    const result = await createApplicationAction({}, form(VALID));
    expect(result.blocked).toBeUndefined();
    expect(result.error).toMatch(/no pudimos registrar tu solicitud/i);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("si el SMTP falla la solicitud sobrevive igual", async () => {
    mocks.mailer.sendToApplication.mockRejectedValue(Object.assign(new Error("smtp"), { code: "ECONNREFUSED" }));
    const result = await createApplicationAction({}, form(VALID));
    expect(result.created).toEqual({ resumeToken: "RESUME-RAW" });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});

describe("resendResumeLinkAction", () => {
  it("contesta lo mismo (y sin tocar la base) exista o no la solicitud", async () => {
    const withApp = await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));
    // La respuesta sale ANTES de buscar: sin esto, el tiempo delataría al DNI
    // que sí tiene solicitud (mismo criterio que /ingresar/recuperar).
    expect(mocks.service.findLiveByDni).not.toHaveBeenCalled();

    mocks.service.findLiveByDni.mockResolvedValue({ id: 7, email: EMAIL });
    await flushAfter();

    mocks.service.findLiveByDni.mockResolvedValue(null);
    const without = await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: "27999888" }));
    await flushAfter();

    expect(withApp).toEqual({ done: true });
    expect(without).toEqual(withApp);
  });

  it("con solicitud viva rota el token, manda el enlace nuevo y audita", async () => {
    mocks.service.findLiveByDni.mockResolvedValue({ id: 7, email: EMAIL });
    await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));
    await flushAfter();

    expect(mocks.service.rotateResumeToken).toHaveBeenCalledWith(7);
    const sent = mocks.mailer.sendToApplication.mock.calls[0][0];
    expect(sent.applicationId).toBe(7);
    expect(sent.message.text).toContain("/asociate/retomar/ROTATED-RAW");
    const entry = mocks.audit.mock.calls[0][0];
    expect(entry.action).toBe("application_resume_link_sent");
    expect(JSON.stringify(entry)).not.toMatch(/30111222|test@x/);
  });

  it("sin solicitud viva no rota, no manda y no audita", async () => {
    await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));
    await flushAfter();
    expect(mocks.service.rotateResumeToken).not.toHaveBeenCalled();
    expect(mocks.mailer.sendToApplication).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("si el envío falla se devuelve el cupo (el enlace viejo ya quedó muerto)", async () => {
    mocks.service.findLiveByDni.mockResolvedValue({ id: 7, email: EMAIL });
    mocks.mailer.sendToApplication.mockRejectedValue(Object.assign(new Error("smtp"), { code: "EAUTH" }));
    await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));
    await flushAfter();

    expect(mocks.resendLimiter.refund).toHaveBeenCalledWith("1.2.3.4");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("DNI mal tipeado: error de formato y ninguna tarea diferida", async () => {
    const result = await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: "12.345.678" }));
    expect(result.error).toMatch(/dni inválido/i);
    expect(mocks.afterCallbacks).toHaveLength(0);
  });

  it("Turnstile inválido: ni cupo gastado ni tarea diferida", async () => {
    mocks.verifyTurnstile.mockResolvedValue(false);
    const result = await resendResumeLinkAction({}, form({ "cf-turnstile-response": "x", dni: DNI }));
    expect(result.error).toMatch(/no pudimos verificar/i);
    expect(mocks.resendLimiter.record).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
  });
});
