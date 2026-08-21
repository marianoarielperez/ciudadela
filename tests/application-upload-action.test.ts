import { beforeEach, describe, expect, it, vi } from "vitest";

// Las actions de los pasos 4 y 5 son endpoints públicos y ANÓNIMOS igual que las
// del alta: lo único que las autentica es el token de retome, y lo único que
// decide qué se puede hacer es el ESTADO de la solicitud. Este archivo fija esas
// dos guardas —y que el tope de anexos y la completitud documental se apliquen
// en el server, no sólo en el botón—.
const mocks = vi.hoisted(() => ({
  prisma: {
    document: { count: vi.fn(), findMany: vi.fn() },
    application: { updateMany: vi.fn(), update: vi.fn() },
    mpSubscription: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  service: { findByResumeToken: vi.fn() },
  documentStore: { saveApplicationDocument: vi.fn() },
  mpGateway: { createPreapproval: vi.fn(), getPlan: vi.fn() },
  configReader: { getString: vi.fn() },
  mailer: { sendToApplication: vi.fn() },
  audit: vi.fn(),
  tokenLimiter: { check: vi.fn() },
  statusLimiter: { check: vi.fn() },
  noopLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn(), check: vi.fn(() => true) },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/applications/service", () => ({
  applicationService: mocks.service,
  DuplicateLiveApplicationError: class extends Error {},
}));
vi.mock("@/lib/documents/storage", () => ({
  documentStore: mocks.documentStore,
  MAX_DOCUMENT_BYTES: 10 * 1024 * 1024,
}));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: mocks.mpGateway }));
vi.mock("@/lib/config", () => ({
  configReader: mocks.configReader,
  CONFIG_KEYS: { mpPlanActiveId: "mp_plan_active_id", mpPlanSharedId: "mp_plan_shared_id" },
}));
vi.mock("@/lib/email", () => ({ mailer: mocks.mailer }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn(async () => true) }));
vi.mock("@/lib/tokens", () => ({ tokens: { issue: vi.fn() }, hashToken: (s: string) => s }));
vi.mock("@/lib/auth/rate-limiter", () => ({
  applicationCreateLimiter: mocks.noopLimiter,
  resumeResendLimiter: mocks.noopLimiter,
  resumeResendTargetLimiter: mocks.noopLimiter,
  publicTokenLimiter: mocks.tokenLimiter,
  applicationStatusLimiter: mocks.statusLimiter,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "1.2.3.4", "user-agent": "vitest" }),
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn }));

import {
  applicationStatusAction,
  startPaymentAction,
  submitNoDebitAction,
  uploadDocumentAction,
} from "@/app/(public)/asociate/actions";

const TOKEN = "RESUME-RAW";

function application(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    status: "started",
    requestedCategory: "adherent",
    wantsDebit: false,
    preapprovalId: null,
    email: "vecina@x.com",
    fullName: "Vecina Prueba",
    ...over,
  };
}

/** Un JPEG mínimo: el store real sniffea magic bytes, así que el test manda algo
 *  que ese contrato aceptaría aunque acá el store esté mockeado. */
function jpeg(bytes = 64): File {
  const buf = new Uint8Array(bytes);
  buf.set([0xff, 0xd8, 0xff]);
  return new File([buf], "dni.jpg", { type: "image/jpeg" });
}

function uploadForm(over: { docType?: string; file?: File | null; resumeToken?: string } = {}) {
  const fd = new FormData();
  fd.append("resumeToken", over.resumeToken ?? TOKEN);
  fd.append("docType", over.docType ?? "dni_front");
  if (over.file !== null) fd.append("file", over.file ?? jpeg());
  return fd;
}

function tokenForm(resumeToken = TOKEN) {
  const fd = new FormData();
  fd.append("resumeToken", resumeToken);
  return fd;
}

const BOTH_DNI = [{ type: "dni_front" }, { type: "dni_back" }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tokenLimiter.check.mockReturnValue(true);
  mocks.statusLimiter.check.mockReturnValue(true);
  mocks.service.findByResumeToken.mockResolvedValue(application());
  mocks.prisma.document.count.mockResolvedValue(1);
  mocks.prisma.document.findMany.mockResolvedValue(BOTH_DNI);
  mocks.prisma.application.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.prisma));
  mocks.documentStore.saveApplicationDocument.mockResolvedValue({ id: 1 });
  mocks.mailer.sendToApplication.mockResolvedValue({ messageId: "mid" });
  mocks.configReader.getString.mockResolvedValue("PLAN-123");
  mocks.mpGateway.getPlan.mockResolvedValue({ id: "PLAN-123", reason: "SOCIO ACTIVO", amount: 6000 });
  mocks.mpGateway.createPreapproval.mockResolvedValue({
    id: "PRE-1", initPoint: "https://mp/checkout/PRE-1", status: "pending",
  });
});

describe("uploadDocumentAction", () => {
  it("token inexistente: no se guarda nada", async () => {
    mocks.service.findByResumeToken.mockResolvedValue(null);
    const result = await uploadDocumentAction({}, uploadForm());

    expect(result.error).toBeTruthy();
    expect(mocks.documentStore.saveApplicationDocument).not.toHaveBeenCalled();
  });

  it("sin token: ni siquiera se consulta la base", async () => {
    const result = await uploadDocumentAction({}, uploadForm({ resumeToken: "" }));
    expect(result.error).toBeTruthy();
    expect(mocks.service.findByResumeToken).not.toHaveBeenCalled();
  });

  it("cupo agotado: el mensaje NO dice que la solicitud no existe", async () => {
    // Confundir "demasiados intentos" con "no encontramos tu solicitud" manda al
    // vecino a empezar de cero un trámite que está entero.
    mocks.tokenLimiter.check.mockReturnValue(false);
    const result = await uploadDocumentAction({}, uploadForm());

    expect(result.error).toMatch(/demasiados intentos/i);
    expect(mocks.service.findByResumeToken).not.toHaveBeenCalled();
  });

  it("solicitud ya enviada (pending_board): sólo `started` puede subir", async () => {
    mocks.service.findByResumeToken.mockResolvedValue(application({ status: "pending_board" }));
    const result = await uploadDocumentAction({}, uploadForm());

    expect(result.error).toMatch(/ya fue enviada/i);
    expect(mocks.documentStore.saveApplicationDocument).not.toHaveBeenCalled();
  });

  it("tipo de documento inventado: rechazado", async () => {
    const result = await uploadDocumentAction({}, uploadForm({ docType: "pasaporte" }));
    expect(result.error).toMatch(/tipo de documento/i);
    expect(mocks.documentStore.saveApplicationDocument).not.toHaveBeenCalled();
  });

  it("sin archivo: lo pide y no toca el store", async () => {
    const result = await uploadDocumentAction({}, uploadForm({ file: null }));
    expect(result.error).toMatch(/elegí un archivo/i);
    expect(mocks.documentStore.saveApplicationDocument).not.toHaveBeenCalled();
  });

  it("archivo de más de 10 MB: se corta acá y no llega al disco", async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "grande.jpg");
    const result = await uploadDocumentAction({}, uploadForm({ file: big }));

    expect(result.error).toMatch(/10 MB/);
    expect(mocks.documentStore.saveApplicationDocument).not.toHaveBeenCalled();
  });

  it("tercer anexo: rechazado nombrando el tope", async () => {
    mocks.prisma.document.count.mockResolvedValue(2);
    const result = await uploadDocumentAction({}, uploadForm({ docType: "annex" }));

    expect(result.error).toMatch(/2 anexos/);
    expect(mocks.documentStore.saveApplicationDocument).not.toHaveBeenCalled();
  });

  it("camino feliz: guarda contra la solicitud del token y devuelve el total", async () => {
    mocks.prisma.document.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);
    const result = await uploadDocumentAction({}, uploadForm({ docType: "annex" }));

    expect(result.error).toBeUndefined();
    expect(result.uploaded).toEqual({ type: "annex", count: 3 });
    const saved = mocks.documentStore.saveApplicationDocument.mock.calls[0][0];
    expect(saved.applicationId).toBe(7);
    expect(saved.type).toBe("annex");
    expect(Buffer.isBuffer(saved.data)).toBe(true);
  });

  it("un fallo del sistema de archivos no le muestra el error interno al vecino", async () => {
    mocks.documentStore.saveApplicationDocument.mockRejectedValue(
      Object.assign(new Error("EACCES: permission denied, open '/var/sigev/uploads/x'"), { code: "EACCES" }),
    );
    const result = await uploadDocumentAction({}, uploadForm());

    expect(result.error).toMatch(/no pudimos guardar/i);
    expect(result.error).not.toMatch(/EACCES|uploads/);
  });

  it("el rechazo por formato del store SÍ se muestra: es lo que el vecino puede arreglar", async () => {
    mocks.documentStore.saveApplicationDocument.mockRejectedValue(
      new Error("Formato no admitido: subí una foto JPG/PNG/WebP o un PDF."),
    );
    const result = await uploadDocumentAction({}, uploadForm());
    expect(result.error).toMatch(/formato no admitido/i);
  });
});

describe("submitNoDebitAction", () => {
  it("sólo la rama adherente-sin-débito puede enviarse sin pagar", async () => {
    mocks.service.findByResumeToken.mockResolvedValue(
      application({ requestedCategory: "active", wantsDebit: true }),
    );
    const result = await submitNoDebitAction({}, tokenForm());

    expect(result.error).toMatch(/débito automático/i);
    expect(mocks.prisma.application.updateMany).not.toHaveBeenCalled();
  });

  it("documentación incompleta: el server la revalida aunque el botón esté habilitado", async () => {
    mocks.prisma.document.findMany.mockResolvedValue([{ type: "dni_front" }]);
    const result = await submitNoDebitAction({}, tokenForm());

    expect(result.error).toMatch(/dorso/i);
    expect(mocks.prisma.application.updateMany).not.toHaveBeenCalled();
  });

  it("camino feliz: pasa a pending_board, avisa por email y audita sin datos personales", async () => {
    const result = await submitNoDebitAction({}, tokenForm());

    expect(result).toEqual({ done: true });
    // UPDATE condicional por estado: dos envíos simultáneos escriben uno solo.
    expect(mocks.prisma.application.updateMany).toHaveBeenCalledWith({
      where: { id: 7, status: "started" },
      data: { status: "pending_board" },
    });
    const sent = mocks.mailer.sendToApplication.mock.calls[0][0];
    expect(sent.applicationId).toBe(7);
    expect(sent.to).toBe("vecina@x.com");
    const entry = mocks.audit.mock.calls[0][0];
    expect(entry.action).toBe("application_submitted");
    expect(entry.entityId).toBe(7);
    expect(JSON.stringify(entry)).not.toMatch(/vecina@x/);
  });

  it("segundo envío simultáneo: no reenvía el email ni duplica el asiento", async () => {
    mocks.prisma.application.updateMany.mockResolvedValue({ count: 0 });
    const result = await submitNoDebitAction({}, tokenForm());

    expect(result).toEqual({ done: true });
    expect(mocks.mailer.sendToApplication).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("si el SMTP falla la solicitud igual queda enviada", async () => {
    mocks.mailer.sendToApplication.mockRejectedValue(
      Object.assign(new Error("smtp"), { code: "ECONNREFUSED" }),
    );
    const result = await submitNoDebitAction({}, tokenForm());
    expect(result).toEqual({ done: true });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});

describe("startPaymentAction", () => {
  const withDebit = () =>
    mocks.service.findByResumeToken.mockResolvedValue(
      application({ requestedCategory: "active", wantsDebit: true }),
    );

  it("el adherente que eligió NO adherir no puede iniciar un pago", async () => {
    const result = await startPaymentAction({}, tokenForm());
    expect(result.error).toMatch(/enviá la solicitud/i);
    expect(mocks.mpGateway.createPreapproval).not.toHaveBeenCalled();
  });

  it("documentación incompleta: no se crea la suscripción", async () => {
    withDebit();
    mocks.prisma.document.findMany.mockResolvedValue([]);
    const result = await startPaymentAction({}, tokenForm());

    expect(result.error).toMatch(/frente del DNI/i);
    expect(mocks.mpGateway.createPreapproval).not.toHaveBeenCalled();
  });

  it("sin plan configurado: mensaje en castellano y ninguna llamada a MP", async () => {
    withDebit();
    mocks.configReader.getString.mockResolvedValue(null);
    const result = await startPaymentAction({}, tokenForm());

    expect(result.error).toMatch(/sistema de pagos no está configurado/i);
    expect(mocks.mpGateway.createPreapproval).not.toHaveBeenCalled();
  });

  // Desde que la suscripción se crea SIN plan asociado, el monto que mandamos
  // es el que MP le debita al vecino todos los meses. Leerlo de la caché de 24 h
  // de `plans.ts` sería adherirlo a un importe que la Comisión ya cambió, así
  // que se lee fresco y, si no se puede leer, NO se crea nada.
  it("el monto sale de una lectura fresca del plan, no de la caché de montos", async () => {
    withDebit();
    mocks.mpGateway.getPlan.mockResolvedValue({ id: "PLAN-123", reason: "SOCIO ACTIVO", amount: 9500 });
    await startPaymentAction({}, tokenForm());

    expect(mocks.mpGateway.getPlan).toHaveBeenCalledWith("PLAN-123");
    expect(mocks.mpGateway.createPreapproval.mock.calls[0][0].amount).toBe(9500);
  });

  it("no se puede leer el monto: no se crea la suscripción y el mensaje es en castellano", async () => {
    withDebit();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.mpGateway.getPlan.mockRejectedValue(new Error("503 upstream"));
      const result = await startPaymentAction({}, tokenForm());

      expect(result.error).toMatch(/no pudimos confirmar el valor de la cuota/i);
      expect(result.error).toMatch(/probá de nuevo en unos minutos/i);
      expect(result.error).not.toMatch(/503|upstream/i);
      expect(result.redirectUrl).toBeUndefined();
      // Lo importante: mejor no cobrar que cobrar mal.
      expect(mocks.mpGateway.createPreapproval).not.toHaveBeenCalled();
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it("el plan existe pero no tiene monto en MP: tampoco se crea la suscripción", async () => {
    // `getPlan` tira cuando `auto_recurring.transaction_amount` no es un número:
    // un plan a medio cargar en el panel de MP no puede terminar en un débito.
    withDebit();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.mpGateway.getPlan.mockRejectedValue(new Error("El plan PLAN-123 no tiene monto en MP."));
      const result = await startPaymentAction({}, tokenForm());

      expect(result.error).toMatch(/no pudimos confirmar el valor de la cuota/i);
      expect(mocks.mpGateway.createPreapproval).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it("MP caído: no se persiste nada y el mensaje no filtra el error del SDK", async () => {
    withDebit();
    mocks.mpGateway.createPreapproval.mockRejectedValue(new Error("401 invalid access token"));
    const result = await startPaymentAction({}, tokenForm());

    expect(result.error).toMatch(/no pudimos iniciar el pago/i);
    expect(result.error).not.toMatch(/401|token/i);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("la suscripción se creó pero la base falla: mensaje en castellano y el preapproval al log", async () => {
    // El peor momento posible: hay una suscripción VIVA en MP y la escritura
    // local se cae. La action no puede tirar (el vecino vería el error genérico
    // de Next) ni invitar a reintentar (crearía una segunda suscripción), y el
    // id del preapproval tiene que quedar en el log: es lo único que permite
    // reconciliarla a mano.
    withDebit();
    mocks.prisma.$transaction.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed on preapproval_id"), { code: "P2002" }),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await startPaymentAction({}, tokenForm());

      expect(result.redirectUrl).toBeUndefined();
      expect(result.error).toMatch(/no pudimos registrar tu pago/i);
      expect(result.error).toMatch(/no lo intentes de nuevo/i);
      expect(result.error).not.toMatch(/preapproval_id|P2002/i);
      // Terminal: reintentar acá duplicaría la suscripción en MP. La pantalla
      // usa este flag para dejar el botón inerte, no sólo mientras `pending`.
      expect(result.blocked).toBe(true);
      // Sin asiento de auditoría: la solicitud no quedó enviada.
      expect(mocks.audit).not.toHaveBeenCalled();

      expect(JSON.stringify(errorLog.mock.calls[0])).toContain("PRE-1");
    } finally {
      // En un `finally`: si una aserción de arriba falla, `console.error` no
      // queda stubbeado para el resto del archivo.
      errorLog.mockRestore();
    }
  });

  it("camino feliz: crea la suscripción, la persiste y devuelve el checkout", async () => {
    withDebit();
    const result = await startPaymentAction({}, tokenForm());

    expect(result.redirectUrl).toBe("https://mp/checkout/PRE-1");
    const sent = mocks.mpGateway.createPreapproval.mock.calls[0][0];
    // Suscripción SIN plan asociado: el body lleva el monto, no el plan. Con
    // `preapproval_plan_id` MP exige `card_token_id` y no hay redirección
    // (medido contra la API real, docs/06 §2).
    expect(sent.planId).toBeUndefined();
    expect(sent.amount).toBe(6000);
    expect(sent.reason).toMatch(/SOCIO ACTIVO/);
    expect(sent.payerEmail).toBe("vecina@x.com");
    expect(sent.externalReference).toBe("solicitud:7");
    expect(sent.backUrl).toContain(`/asociate/retomar/${TOKEN}`);
    expect(mocks.prisma.application.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: "pending_payment", preapprovalId: "PRE-1" },
    });
    expect(mocks.prisma.mpSubscription.create.mock.calls[0][0].data).toMatchObject({
      preapprovalId: "PRE-1", planId: "PLAN-123", applicationId: 7,
    });
  });

  it("el activo y el colaborador usan planes distintos", async () => {
    withDebit();
    await startPaymentAction({}, tokenForm());
    expect(mocks.configReader.getString).toHaveBeenCalledWith("mp_plan_active_id");

    mocks.configReader.getString.mockClear();
    mocks.service.findByResumeToken.mockResolvedValue(
      application({ requestedCategory: "collaborator", wantsDebit: true }),
    );
    // El colaborador no llega al plan sin su anexo de vinculación (REG-03).
    mocks.prisma.document.findMany.mockResolvedValue([...BOTH_DNI, { type: "annex" }]);
    await startPaymentAction({}, tokenForm());
    expect(mocks.configReader.getString).toHaveBeenCalledWith("mp_plan_shared_id");
  });

  it("reintento con la suscripción ya creada: vuelve al MISMO checkout sin llamar a MP", async () => {
    mocks.service.findByResumeToken.mockResolvedValue(
      application({ requestedCategory: "active", wantsDebit: true, status: "pending_payment", preapprovalId: "PRE-9" }),
    );
    const result = await startPaymentAction({}, tokenForm());

    expect(result.redirectUrl).toContain("PRE-9");
    expect(mocks.mpGateway.createPreapproval).not.toHaveBeenCalled();
  });

  it("solicitud ya resuelta: no se puede pagar de nuevo", async () => {
    mocks.service.findByResumeToken.mockResolvedValue(
      application({ requestedCategory: "active", wantsDebit: true, status: "approved_pending_minute" }),
    );
    const result = await startPaymentAction({}, tokenForm());

    expect(result.error).toBeTruthy();
    expect(mocks.mpGateway.createPreapproval).not.toHaveBeenCalled();
  });
});

describe("applicationStatusAction", () => {
  it("devuelve el estado crudo para el sondeo", async () => {
    mocks.service.findByResumeToken.mockResolvedValue(application({ status: "approved_pending_minute" }));
    expect(await applicationStatusAction(TOKEN)).toEqual({ status: "approved_pending_minute" });
  });

  it("token desconocido: `not_found`, sin prosa", async () => {
    mocks.service.findByResumeToken.mockResolvedValue(null);
    expect(await applicationStatusAction(TOKEN)).toEqual({ error: "not_found" });
  });

  it("el sondeo NO gasta el cupo de los POST del trámite", async () => {
    // Son 24 lecturas por espera contra un techo de 30 POST: compartirlo dejaba
    // al vecino sin poder subir un documento después de volver del checkout.
    await applicationStatusAction(TOKEN);
    expect(mocks.statusLimiter.check).toHaveBeenCalledWith("1.2.3.4");
    expect(mocks.tokenLimiter.check).not.toHaveBeenCalled();
  });

  it("cupo del sondeo agotado: `rate_limited` y ninguna consulta", async () => {
    mocks.statusLimiter.check.mockReturnValue(false);
    expect(await applicationStatusAction(TOKEN)).toEqual({ error: "rate_limited" });
    expect(mocks.service.findByResumeToken).not.toHaveBeenCalled();
  });
});
