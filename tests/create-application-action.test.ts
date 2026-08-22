import { beforeEach, describe, expect, it, vi } from "vitest";

// Las actions del wizard son endpoints públicos y ANÓNIMOS: no hay `requireAdmin`
// que las abra, así que lo único que las protege es el orden interruptor de
// ASOCIATE → cupo → Turnstile → zod → elegibilidad. Este archivo fija ese orden
// (incluida la separación en dos fases del cupo) y fija que el asiento
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
    prisma: { member: { findUnique: vi.fn() }, configuration: { findUnique: vi.fn() } },
    service: {
      create: vi.fn(),
      findLiveByDni: vi.fn(),
      lastRejectionAt: vi.fn(),
      mintResumeToken: vi.fn(),
      commitResumeToken: vi.fn(),
    },
    verifyTurnstile: vi.fn(),
    tokens: { issue: vi.fn() },
    mailer: { sendToApplication: vi.fn() },
    audit: vi.fn(),
    createLimiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn() },
    resendLimiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn() },
    resendTargetLimiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn() },
    afterCallbacks: [] as Array<() => unknown>,
    // Filas de `configuration` que ve la action. Es un mapa y no un valor fijo
    // porque la creación lee TRES claves (el interruptor y los dos textos
    // legales) y cada test necesita apagar una sin tocar las otras.
    configRows: {} as Record<string, unknown>,
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
  resumeResendTargetLimiter: mocks.resendTargetLimiter,
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
  mocks.resendTargetLimiter.allows.mockReturnValue(true);
  mocks.verifyTurnstile.mockResolvedValue(true);
  // `asociate_activo` prendido (guarda 0, docs/05 §2) y los dos textos legales
  // publicados (guarda 0 bis): sin ellos no hay nada que aceptar.
  mocks.configRows = {
    asociate_activo: true,
    terms_text: "Términos de prueba",
    privacy_consent_text: "Consentimiento de prueba",
  };
  mocks.prisma.configuration.findUnique.mockImplementation(
    async ({ where: { key } }: { where: { key: string } }) =>
      key in mocks.configRows ? { key, value: mocks.configRows[key] } : null,
  );
  mocks.prisma.member.findUnique.mockResolvedValue(null);
  mocks.service.findLiveByDni.mockResolvedValue(null);
  mocks.service.lastRejectionAt.mockResolvedValue(null);
  mocks.service.create.mockResolvedValue({ id: 7, resumeToken: "RESUME-RAW" });
  mocks.service.mintResumeToken.mockReturnValue({ raw: "MINTED-RAW", hash: "MINTED-HASH" });
  mocks.service.commitResumeToken.mockResolvedValue(undefined);
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

  it("interruptor de ASOCIATE apagado: no crea nada, no gasta cupo y no llama a Turnstile", async () => {
    // El chequeo de `page.tsx` es de RENDER: no cubre la pestaña que ya estaba
    // abierta cuando la CD apagó el interruptor ni un POST armado a mano. La
    // action tiene que decidir sola, y antes que nada (docs/05 §2).
    mocks.configRows.asociate_activo = false;
    const result = await createApplicationAction({}, form(VALID));

    expect(result.error).toMatch(/asociaciones en línea están cerradas/i);
    expect(result.created).toBeUndefined();
    expect(mocks.service.create).not.toHaveBeenCalled();
    // Va antes del rate limit: cerrado no hay nada que racionar.
    expect(mocks.createLimiter.allows).not.toHaveBeenCalled();
    expect(mocks.createLimiter.record).not.toHaveBeenCalled();
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("interruptor ausente en `configuration`: se trata como apagado", async () => {
    // `getBool` compara estricto contra `true`: fila faltante, `null` o el
    // string "true" son false. Sin fila el wizard no puede quedar abierto.
    delete mocks.configRows.asociate_activo;
    const result = await createApplicationAction({}, form(VALID));

    expect(result.error).toMatch(/asociaciones en línea están cerradas/i);
    expect(mocks.service.create).not.toHaveBeenCalled();
  });

  // El paso 3 del wizard muestra "El texto todavía no está publicado" ARRIBA de
  // un checkbox obligatorio que igual se puede tildar. Sin esta guarda el POST
  // se grababa con `acceptedTermsAt` contra unos términos que no existen: una
  // aceptación sin objeto asentada en la solicitud (docs/08, Ley 25.326).
  it.each([["terms_text"], ["privacy_consent_text"]])(
    "falta %s: no se recibe la solicitud",
    async (missing) => {
      delete mocks.configRows[missing];
      const result = await createApplicationAction({}, form(VALID));

      expect(result.error).toMatch(/todavía no están publicados los textos/i);
      expect(result.created).toBeUndefined();
      expect(mocks.service.create).not.toHaveBeenCalled();
      // Corta antes de gastar cupo, de pedir el captcha y de tocar el padrón.
      expect(mocks.createLimiter.allows).not.toHaveBeenCalled();
      expect(mocks.createLimiter.record).not.toHaveBeenCalled();
      expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
      expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
    },
  );

  it("texto legal en blanco: cuenta como no publicado", async () => {
    // `getString` normaliza "   " a null, y un pliego vacío no es un pliego.
    mocks.configRows.terms_text = "   ";
    const result = await createApplicationAction({}, form(VALID));
    expect(result.error).toMatch(/todavía no están publicados los textos/i);
    expect(mocks.service.create).not.toHaveBeenCalled();
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
      id: 12, status: "active", withdrawalReason: null,
      reentryBlocked: false, rejectedUntil: null, _count: { fees: 0 },
    });
    const result = await createApplicationAction({}, form(VALID));

    expect(result.blocked?.code).toBe("already_member");
    expect(result.blocked?.message).toMatch(/ya estás asociado/i);
    expect(result.created).toBeUndefined();
    expect(mocks.service.create).not.toHaveBeenCalled();
    expect(mocks.mailer.sendToApplication).not.toHaveBeenCalled();
  });

  // El `_count` es el ÚNICO cable entre la deuda viva de la cuenta corriente y
  // el bloqueo del wizard: la action traduce `_count.fees` a `pendingFees` y
  // recién ahí `checkEligibility` decide (REG-16). Si ese renombre se rompe, la
  // regla pura sigue verde y el ex socio deudor se reasocia por la web.
  it("ex socio con deuda viva: bloqueo debt y ninguna solicitud creada", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue({
      id: 12, status: "withdrawn", withdrawalReason: "resignation",
      reentryBlocked: false, rejectedUntil: null, _count: { fees: 2 },
    });
    const result = await createApplicationAction({}, form(VALID));

    expect(result.blocked?.code).toBe("debt");
    expect(result.blocked?.message).toMatch(/deuda pendiente con tesorería/i);
    expect(result.created).toBeUndefined();
    expect(mocks.service.create).not.toHaveBeenCalled();
    // Y se pidió contando SOLO las pendientes: contar todas dejaría afuera a
    // cualquiera que alguna vez pagó una cuota.
    const select = mocks.prisma.member.findUnique.mock.calls[0][0].select;
    expect(select._count).toEqual({ select: { fees: { where: { status: "pending" } } } });
  });

  it("ex socio sin deuda: pasa y la solicitud queda atada a su ficha (reingreso)", async () => {
    // La otra mitad del mismo cable: con el contador en 0 el bloqueo NO se
    // dispara. El que saldó en la sede se rehabilita solo (REG-16, decisión del
    // 22/08/2026), sin que nadie le baje un flag.
    mocks.prisma.member.findUnique.mockResolvedValue({
      id: 12, status: "withdrawn", withdrawalReason: "resignation",
      reentryBlocked: false, rejectedUntil: null, _count: { fees: 0 },
    });
    const result = await createApplicationAction({}, form(VALID));

    expect(result.blocked).toBeUndefined();
    expect(result.created).toEqual({ resumeToken: "RESUME-RAW" });
    expect(mocks.service.create.mock.calls[0][0].memberId).toBe(12);
    expect(mocks.audit.mock.calls[0][0].detail).toMatchObject({ reentry: true });
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

  it("un POST con formato inválido NO consume cupo", async () => {
    // Son ~16 campos y el formulario reporta un error por vez: sin esto,
    // corregir tres tipeos se comía los cinco intentos de la hora sin haber
    // llegado nunca a la base.
    const result = await createApplicationAction({}, form({ ...VALID, email: "no-es-un-email" }));

    expect(result.error).toMatch(/email válido/i);
    expect(mocks.createLimiter.record).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("las validaciones puras tampoco consumen cupo, pero el formato válido sí lo consume antes del padrón", async () => {
    // Menor de edad: formato correcto, regla pura que falla. Tampoco cobra.
    await createApplicationAction({}, form({ ...VALID, birthDate: "2015-05-05" }));
    expect(mocks.createLimiter.record).not.toHaveBeenCalled();

    // Y en el camino que sí toca el padrón, el cupo se cobra ANTES de tocarlo:
    // el cupo (con el captcha) es lo único que impide barrerlo.
    await createApplicationAction({}, form(VALID));
    expect(mocks.createLimiter.record).toHaveBeenCalledWith("1.2.3.4");
    expect(mocks.createLimiter.record.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.prisma.member.findUnique.mock.invocationCallOrder[0]);
  });

  it("el bloqueo in_progress no le filtra al cliente el id de la solicitud", async () => {
    // `checkEligibility` devuelve `applicationId` en esa regla; el estado que
    // vuelve al navegador no puede llevarlo: es un identificador de un trámite
    // ajeno para cualquiera que tipee un DNI que no es el suyo.
    mocks.service.findLiveByDni.mockResolvedValue({ id: 4242, email: EMAIL });
    const result = await createApplicationAction({}, form(VALID));

    expect(result.blocked?.code).toBe("in_progress");
    expect(result.blocked).toEqual({ code: "in_progress", message: expect.any(String), retryAtIso: undefined });
    expect(JSON.stringify(result)).not.toContain("4242");
  });

  it("el colaborador va con débito aunque el formulario diga que no", async () => {
    // Sólo el adherente elige: activo y colaborador tienen cuota obligatoria.
    await createApplicationAction({}, form({
      ...VALID, livesInBarrio: "no", streetId: "", streetText: "Rivadavia",
      neighborhood: "Centro", requestedCategory: "collaborator", wantsDebit: "no",
    }));
    const created = mocks.service.create.mock.calls[0][0];
    expect(created.requestedCategory).toBe("collaborator");
    expect(created.wantsDebit).toBe(true);
  });

  it("si el SMTP falla la solicitud sobrevive igual", async () => {
    mocks.mailer.sendToApplication.mockRejectedValue(Object.assign(new Error("smtp"), { code: "ECONNREFUSED" }));
    const result = await createApplicationAction({}, form(VALID));
    expect(result.created).toEqual({ resumeToken: "RESUME-RAW" });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});

describe("resendResumeLinkAction", () => {
  it("sigue reenviando con el interruptor de ASOCIATE apagado", async () => {
    // Decisión deliberada: el interruptor suspende el ALTA de solicitudes
    // nuevas, no los trámites en curso. Retomar uno que la vecinal ya aceptó
    // —y que puede tener una suscripción viva en MP— tiene que seguir siendo
    // posible, igual que los pasos 4 y 5.
    mocks.prisma.configuration.findUnique.mockResolvedValue({
      key: "asociate_activo",
      value: false,
    });
    mocks.service.findLiveByDni.mockResolvedValue({ id: 7, email: EMAIL });

    const result = await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));
    await flushAfter();

    expect(result).toEqual({ done: true });
    expect(mocks.mailer.sendToApplication).toHaveBeenCalledTimes(1);
  });

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

  it("con solicitud viva manda el enlace nuevo, recién después lo persiste y audita", async () => {
    mocks.service.findLiveByDni.mockResolvedValue({ id: 7, email: EMAIL });
    await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));
    await flushAfter();

    const sent = mocks.mailer.sendToApplication.mock.calls[0][0];
    expect(sent.applicationId).toBe(7);
    expect(sent.message.text).toContain("/asociate/retomar/MINTED-RAW");
    // Se persiste el hash del MISMO crudo que se mandó, y no antes de mandarlo.
    expect(mocks.service.commitResumeToken).toHaveBeenCalledWith(7, "MINTED-HASH");
    expect(mocks.mailer.sendToApplication.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.service.commitResumeToken.mock.invocationCallOrder[0]);
    const entry = mocks.audit.mock.calls[0][0];
    expect(entry.action).toBe("application_resume_link_sent");
    expect(JSON.stringify(entry)).not.toMatch(/30111222|test@x/);
  });

  it("sin solicitud viva no acuña, no manda, no persiste y no audita", async () => {
    await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));
    await flushAfter();
    expect(mocks.service.mintResumeToken).not.toHaveBeenCalled();
    expect(mocks.service.commitResumeToken).not.toHaveBeenCalled();
    expect(mocks.mailer.sendToApplication).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("si el envío falla NO se persiste el hash nuevo: el enlace viejo sigue vivo", async () => {
    mocks.service.findLiveByDni.mockResolvedValue({ id: 7, email: EMAIL });
    mocks.mailer.sendToApplication.mockRejectedValue(Object.assign(new Error("smtp"), { code: "EAUTH" }));
    await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));
    await flushAfter();

    expect(mocks.service.commitResumeToken).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    // Y el cupo NO se devuelve: no hay estado destructivo que compensar, y
    // martillar contra un email mal tipeado no puede salir gratis.
    expect(mocks.resendLimiter.refund).not.toHaveBeenCalled();
    expect(mocks.resendTargetLimiter.refund).not.toHaveBeenCalled();
  });

  it("DNI mal tipeado: error de formato, ningún cupo gastado y ninguna tarea diferida", async () => {
    const result = await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: "12.345.678" }));
    expect(result.error).toMatch(/dni inválido/i);
    expect(mocks.resendLimiter.record).not.toHaveBeenCalled();
    expect(mocks.resendTargetLimiter.record).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
  });

  it("Turnstile inválido: ni cupo gastado ni tarea diferida", async () => {
    mocks.verifyTurnstile.mockResolvedValue(false);
    const result = await resendResumeLinkAction({}, form({ "cf-turnstile-response": "x", dni: DNI }));
    expect(result.error).toMatch(/no pudimos verificar/i);
    expect(mocks.resendLimiter.record).not.toHaveBeenCalled();
    expect(mocks.resendTargetLimiter.record).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
  });

  it("reserva cupo en los DOS limitadores, con el DNI parseado como clave", async () => {
    await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: ` ${DNI} ` }));
    expect(mocks.resendLimiter.record).toHaveBeenCalledWith("1.2.3.4");
    expect(mocks.resendTargetLimiter.record).toHaveBeenCalledWith(DNI);
  });

  it("el techo por DNI corta aunque el de la IP tenga cupo (atacante que rota de origen)", async () => {
    mocks.resendTargetLimiter.allows.mockReturnValue(false);
    const result = await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));

    expect(result.error).toMatch(/demasiados intentos/i);
    expect(mocks.afterCallbacks).toHaveLength(0);
    // Patrón `allows` en los dos y recién después `record`: el rechazo del
    // segundo no puede haberle cobrado el intento al primero.
    expect(mocks.resendLimiter.record).not.toHaveBeenCalled();
    expect(mocks.resendTargetLimiter.record).not.toHaveBeenCalled();
  });
});
