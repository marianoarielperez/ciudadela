import { beforeEach, describe, expect, it, vi } from "vitest";

// Todos los singletons que evalúa el módulo (prisma, mailer, tesorería, recibo
// por email, valores de cuota) explotan sin DATABASE_URL: se mockean SIEMPRE
// antes de importar el módulo bajo prueba.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ mailer: {} }));
vi.mock("@/lib/treasury/service", () => ({ treasuryService: {} }));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: vi.fn() }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: {} }));

import { makeWebhookProcessor } from "@/lib/mp/webhook-processor";

type PaymentOver = Partial<{ status: string; externalReference: string | null; transactionAmount: number; dateApproved: Date | null; payerEmail: string | null }>;

function deps(over: {
  payment?: PaymentOver;
  subscription?: { memberId: number | null; applicationId: number | null } | null;
  subscriptionByRef?: { memberId: number | null } | null;
  application?: { id: number; status: string; fullName: string; email: string; mpPaymentIdEntry: string | null; memberId: number | null } | null;
  member?: { id: number; category: string } | null;
  existingPayment?: { id: number } | null;
} = {}) {
  const paidAt = new Date("2026-09-10T11:15:30Z");
  const payment = {
    id: "777", status: "approved", statusDetail: "accredited", transactionAmount: 6000,
    externalReference: null as string | null, dateApproved: paidAt as Date | null, payerEmail: "v@x.com", description: "Cuota", ...over.payment,
  };
  const application = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue(over.application ?? null),
  };
  const mpSubscription = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue(over.subscription === undefined ? null : over.subscription),
    findFirst: vi.fn().mockResolvedValue(over.subscriptionByRef ?? null),
  };
  const db = {
    application, mpSubscription,
    payment: { findUnique: vi.fn().mockResolvedValue(over.existingPayment ?? null) },
    member: { findUnique: vi.fn().mockResolvedValue(over.member === undefined ? { id: 14, category: "active" } : over.member) },
    // La bandeja se cierra por acá cuando un cobro ya asentado vuelve a llegar
    // (contrato de la revisión de la Task 5), así que el fake la implementa.
    mpUnmatchedPayment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  const gateway = {
    getPayment: vi.fn().mockResolvedValue(payment),
    getPreapproval: vi.fn().mockResolvedValue({ id: "pre-1", status: "authorized", payerEmail: "a@b.com", externalReference: "solicitud:55", amount: 6000, reason: "Cuota", nextPaymentDate: null, dateCreated: null }),
    getAuthorizedPayment: vi.fn().mockResolvedValue({ id: "9", preapprovalId: "pre-1", status: "processed", paymentId: "777", amount: 6000, dateCreated: paidAt, externalReference: null }),
  };
  const treasury = {
    registerPayment: vi.fn().mockResolvedValue({ kind: "registered", paymentId: 1, receiptId: 2, number: "2026-00002", periods: ["2026-09"], amount: 6000, pdfWritten: true }),
    refundPayment: vi.fn().mockResolvedValue({ kind: "refunded", paymentId: 1, number: "2026-00002", periodsReverted: 1 }),
  };
  const unmatched = { record: vi.fn().mockResolvedValue("recorded") };
  const feeValues = { current: vi.fn().mockResolvedValue({ activeAmount: 6000, sharedAmount: 3000 }) };
  const mailerMock = { sendToApplication: vi.fn().mockResolvedValue({ messageId: "m" }) };
  const sendReceiptEmail = vi.fn().mockResolvedValue({ sent: true });
  // Tipadas con su parámetro (como en el resto de la suite): sin eso
  // `mock.calls` es una tupla vacía y no se puede inspeccionar el asiento.
  const auditMock = vi.fn<(entry: unknown) => Promise<void>>(async () => {});
  const auditStrictMock = vi.fn<(entry: unknown) => Promise<void>>(async () => {});
  const p = makeWebhookProcessor({
    db: db as never, gateway: gateway as never, treasury: treasury as never, unmatched: unmatched as never,
    feeValues: feeValues as never, mailer: mailerMock as never, sendReceiptEmail, audit: auditMock as never, auditStrict: auditStrictMock as never,
    now: () => new Date("2026-09-10T12:00:00Z"),
  });
  return { p, db, gateway, treasury, unmatched, mailerMock, sendReceiptEmail, auditMock, auditStrictMock, paidAt, payment };
}

beforeEach(() => vi.clearAllMocks());

describe("subscription_authorized_payment", () => {
  it("cobro procesado de una suscripción vinculada → Payment.debit + recibo + email + asiento", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("debit_applied");
    expect(d.gateway.getPayment).toHaveBeenCalledWith("777");
    expect(d.treasury.registerPayment).toHaveBeenCalledWith({
      memberId: 14, type: "debit", n: 1, amount: 6000, paidAt: d.paidAt, mpPaymentId: "777", preapprovalId: "pre-1", actorId: null,
    });
    expect(d.sendReceiptEmail).toHaveBeenCalledWith(2);
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_applied", entity: "payment", entityId: 1,
      detail: expect.objectContaining({ memberId: 14, type: "debit", amount: 6000, mpPaymentId: "777", emailed: "sent" }) }));
    // Nunca el email del pagador en el asiento.
    expect(JSON.stringify(d.auditMock.mock.calls)).not.toContain("v@x.com");
  });
  it("sin paymentId todavía → authorized_payment_traced, sin tocar nada", async () => {
    const d = deps();
    d.gateway.getAuthorizedPayment.mockResolvedValue({ id: "9", preapprovalId: "pre-1", status: "scheduled", paymentId: null, amount: null, dateCreated: null, externalReference: null });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("authorized_payment_traced");
    expect(d.gateway.getPayment).not.toHaveBeenCalled();
  });
  it("suscripción no vinculada → bandeja no_subscription con el preapproval, asiento sin email", async () => {
    const d = deps({ subscription: null });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("unmatched_no_subscription");
    expect(d.unmatched.record).toHaveBeenCalledWith(expect.objectContaining({ mpPaymentId: "777", preapprovalId: "pre-1", reason: "no_subscription", payerEmail: "v@x.com", amount: 6000 }));
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_unmatched", detail: { mpPaymentId: "777", reason: "no_subscription", amount: 6000 } }));
  });
  it("cesante sin pendientes → bandeja withdrawn_no_pending (nunca error)", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.treasury.registerPayment.mockResolvedValue({ kind: "no_pending_withdrawn" });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("unmatched_withdrawn_no_pending");
    expect(d.unmatched.record).toHaveBeenCalledWith(expect.objectContaining({ reason: "withdrawn_no_pending" }));
  });
  it("ya asentado (consulta previa) → already_processed sin registrar", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null }, existingPayment: { id: 3 } });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("already_processed");
    expect(d.treasury.registerPayment).not.toHaveBeenCalled();
  });
  it("el servicio devuelve already_processed (carrera) → already_processed, sin email", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.treasury.registerPayment.mockResolvedValue({ kind: "already_processed", paymentId: 1 });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("already_processed");
    expect(d.sendReceiptEmail).not.toHaveBeenCalled();
  });
  it("el email falla → el pago queda y el asiento dice emailed:error", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.sendReceiptEmail.mockRejectedValue(Object.assign(new Error("smtp"), { code: "ECONN" }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("debit_applied");
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ emailed: "error" }) }));
    errorLog.mockRestore();
  });
  it("MP caído en getPayment → lanza (500, reintento)", async () => {
    const d = deps();
    d.gateway.getPayment.mockRejectedValue({ message: "timeout", status: 500 });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).rejects.toBeTruthy();
  });
});

describe("payment", () => {
  it("caso 306: solicitud:9 borrada + suscripción con esa referencia → débito del socio", async () => {
    const d = deps({ payment: { externalReference: "solicitud:9" }, application: null, subscriptionByRef: { memberId: 306 } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("debit_applied");
    expect(d.db.mpSubscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { externalReference: "solicitud:9" } }));
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ memberId: 306, type: "debit", n: 1, preapprovalId: null }));
  });
  it("solicitud:9 borrada y sin suscripción → bandeja application_missing", async () => {
    const d = deps({ payment: { externalReference: "solicitud:9" }, application: null });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("unmatched_application_missing");
  });
  it("pago:14:2 → link de 2 cuotas; monto distinto al esperado → se aplica y se audita link_amount_mismatch", async () => {
    const d = deps({ payment: { externalReference: "pago:14:2", transactionAmount: 11000 } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("link_applied");
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ memberId: 14, type: "link", n: 2, amount: 11000 }));
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "link_amount_mismatch", detail: { paymentId: 1, memberId: 14, n: 2, expected: 12000, amount: 11000 } }));
  });
  it("pago:14:2 con el monto justo → sin asiento de divergencia", async () => {
    const d = deps({ payment: { externalReference: "pago:14:2", transactionAmount: 12000 } });
    await d.p.process({ topic: "payment", dataId: "777" });
    expect(d.auditMock.mock.calls.map((c) => (c[0] as { action: string }).action)).not.toContain("link_amount_mismatch");
  });
  it("ingreso: solicitud pendiente sin pago → transición + Payment.entry + recibo a la solicitud + bienvenida", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "pending_payment", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: null, memberId: null } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");
    const upd = d.db.application.updateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: 55, status: "pending_payment" });
    expect(upd.data).toMatchObject({ status: "approved_pending_minute", mpPaymentIdEntry: "777" });
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ memberId: null, applicationId: 55, type: "entry", n: 0, amount: 6000, mpPaymentId: "777" }));
    expect(d.sendReceiptEmail).toHaveBeenCalledWith(2);
    expect(d.mailerMock.sendToApplication).toHaveBeenCalledTimes(1);
  });
  it("ingreso sobre solicitud VENCIDA → revive, asiento estricto, result distinguible", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "expired", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: null, memberId: null } });
    d.db.application.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved_after_expiry");
    expect(d.auditStrictMock).toHaveBeenCalledWith(expect.objectContaining({ entity: "application", entityId: 55 }));
  });
  it("reintento del ingreso (mpPaymentIdEntry igual a este id) → entry_already_recorded sin email", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "approved_pending_minute", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: "777", memberId: null } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("entry_already_recorded");
    expect(d.mailerMock.sendToApplication).not.toHaveBeenCalled();
    expect(d.treasury.registerPayment).not.toHaveBeenCalled();
  });
  it("segundo cobro de una solicitud sin acta → bandeja duplicate_entry", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "approved_pending_minute", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: "111", memberId: null } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("unmatched_duplicate_entry");
  });
  it("refunded con pago local → refundPayment + asiento payment_refunded", async () => {
    const d = deps({ payment: { status: "refunded" } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("payment_refunded");
    expect(d.treasury.refundPayment).toHaveBeenCalledWith({ mpPaymentId: "777", reason: "Reembolso en Mercado Pago" });
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_refunded", entity: "payment", entityId: 1 }));
  });
  it("charged_back sin pago local → refund_ignored", async () => {
    const d = deps({ payment: { status: "charged_back" } });
    d.treasury.refundPayment.mockResolvedValue({ kind: "not_found" });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("refund_ignored");
  });
  it("rejected → payment_rejected_traced; in_process → payment_ignored", async () => {
    expect(await deps({ payment: { status: "rejected" } }).p.process({ topic: "payment", dataId: "777" })).toBe("payment_rejected_traced");
    expect(await deps({ payment: { status: "in_process" } }).p.process({ topic: "payment", dataId: "777" })).toBe("payment_ignored");
  });
  it("sin referencia ni suscripción → bandeja no_reference", async () => {
    const d = deps();
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("unmatched_no_reference");
  });
  it("approved sin dateApproved → paidAt = now()", async () => {
    const d = deps({ payment: { externalReference: "pago:14:1", dateApproved: null } });
    await d.p.process({ topic: "payment", dataId: "777" });
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ paidAt: new Date("2026-09-10T12:00:00Z") }));
  });
  it("plural `payments` también", async () => {
    const d = deps({ payment: { externalReference: "pago:14:1" } });
    await expect(d.p.process({ topic: "payments", dataId: "777" })).resolves.toBe("link_applied");
  });
});

describe("subscription_preapproval", () => {
  it("sincroniza status, amount, payerEmail, externalReference y lastSyncAt", async () => {
    const d = deps();
    await expect(d.p.process({ topic: "subscription_preapproval", dataId: "pre-1" })).resolves.toBe("subscription_synced");
    expect(d.db.mpSubscription.updateMany).toHaveBeenCalledWith({
      where: { preapprovalId: "pre-1" },
      data: { status: "authorized", amount: "6000.00", payerEmail: "a@b.com", externalReference: "solicitud:55", lastSyncAt: expect.any(Date) },
    });
  });
  it("sin fila local → no_match", async () => {
    const d = deps();
    d.db.mpSubscription.updateMany.mockResolvedValue({ count: 0 });
    await expect(d.p.process({ topic: "subscription_preapproval", dataId: "pre-1" })).resolves.toBe("no_match");
  });
});

it("tópico desconocido → unknown_topic", async () => {
  await expect(deps().p.process({ topic: "merchant_order", dataId: "1" })).resolves.toBe("unknown_topic");
});

// ── Los tres contratos que dejaron las revisiones de las Tasks 3, 4 y 5 ───────
// No son casos "extra": son las tres formas conocidas en que este procesador
// podía cobrarle dos veces a un vecino o pedirle a MP que reintente para
// siempre. Cada uno tiene su test para que no se pierdan en una refactorización.
describe("contratos de las revisiones anteriores", () => {
  // 1. `resolve.ts` devuelve `debit` en cuanto la suscripción tiene socio, SIN
  // comparar contra `application.mpPaymentIdEntry`. Lo único que frena el
  // reenvío del aviso del pago de ingreso es la regla 1 (`existingPayment`), que
  // busca por `Payment.mpPaymentId`. Si el ingreso no dejara un `Payment` con
  // ese id, ese mismo cobro se aplicaría después como CUOTA.
  it("el pago de ingreso deja un Payment con su mpPaymentId, así el reenvío lo frena", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "pending_payment", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: null, memberId: null } });
    await d.p.process({ topic: "payment", dataId: "777" });
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ type: "entry", mpPaymentId: "777" }));

    // Y el aviso que vuelve cuando el socio ya está asentado no cobra de nuevo.
    const again = deps({ subscription: { memberId: 14, applicationId: null }, existingPayment: { id: 1 } });
    await expect(again.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("already_processed");
    expect(again.treasury.registerPayment).not.toHaveBeenCalled();
  });

  // 2. Con dos reembolsos verdaderamente simultáneos, el chequeo de estado de
  // `refundPayment` vive afuera del mutex y el segundo LANZA `TreasuryError` en
  // vez de devolver `already_reverted`. Desde acá eso sería un 500 y MP
  // reintentaría un reembolso ya hecho.
  it("un TreasuryError de refundPayment NO se propaga: devuelve refund_ignored", async () => {
    const d = deps({ payment: { status: "refunded" } });
    d.treasury.refundPayment.mockRejectedValue(
      Object.assign(new Error("El recibo ya está anulado."), { name: "TreasuryError" }),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("refund_ignored");
    errorLog.mockRestore();
  });

  it("un fallo TÉCNICO en refundPayment sí se propaga (500, MP reintenta)", async () => {
    const d = deps({ payment: { status: "refunded" } });
    d.treasury.refundPayment.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "P1001" }));
    await expect(d.p.process({ topic: "payment", dataId: "777" })).rejects.toBeTruthy();
  });

  it("already_reverted tampoco tira: refund_ignored", async () => {
    const d = deps({ payment: { status: "refunded" } });
    d.treasury.refundPayment.mockResolvedValue({ kind: "already_reverted", status: "voided" });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("refund_ignored");
  });

  // 2 bis. El mismo razonamiento vale para `registerPayment`: también rechaza
  // por reglas de negocio (monto fuera de rango, ficha inexistente, cuotas que
  // cambiaron). MP ya cobró: un 500 acá es un reintento eterno del mismo cobro.
  it("un TreasuryError de registerPayment NO se propaga: payment_not_applied con asiento", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.treasury.registerPayment.mockRejectedValue(
      Object.assign(new Error("El socio no existe."), { name: "TreasuryError" }),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("payment_not_applied");
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "payment_not_applied",
      detail: expect.objectContaining({ mpPaymentId: "777", memberId: 14, amount: 6000 }),
    }));
    expect(d.sendReceiptEmail).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("un fallo TÉCNICO de registerPayment sí se propaga (500, MP reintenta)", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.treasury.registerPayment.mockRejectedValue(Object.assign(new Error("deadlock"), { code: "P2034" }));
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).rejects.toBeTruthy();
  });

  // En el ingreso, la transición YA ocurrió: que el recibo no se pueda emitir no
  // puede dejar al vecino aceptado y sin la bienvenida.
  it("si el ingreso no se puede asentar, la solicitud queda aceptada y la bienvenida sale igual", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "pending_payment", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: null, memberId: null } });
    d.treasury.registerPayment.mockRejectedValue(
      Object.assign(new Error("El monto del pago tiene que ser mayor a cero."), { name: "TreasuryError" }),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");
    expect(d.mailerMock.sendToApplication).toHaveBeenCalledTimes(1);
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_not_applied" }));
    errorLog.mockRestore();
  });

  // 3. Si quedó una fila `open` en la bandeja para un cobro que YA está asentado,
  // el reintento de MP sale por la consulta previa y la fila quedaba abierta
  // para siempre. Ventana angosta, costo mínimo: se cierra al pasar.
  it("already_processed cierra la fila abierta de la bandeja de ese cobro", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null }, existingPayment: { id: 3 } });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("already_processed");
    expect(d.db.mpUnmatchedPayment.updateMany).toHaveBeenCalledWith({
      where: { mpPaymentId: "777", status: "open" },
      data: { status: "matched", paymentId: 3, resolvedAt: expect.any(Date) },
    });
  });

  it("el already_processed de la carrera también cierra la fila", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.treasury.registerPayment.mockResolvedValue({ kind: "already_processed", paymentId: 8 });
    await d.p.process({ topic: "subscription_authorized_payment", dataId: "9" });
    expect(d.db.mpUnmatchedPayment.updateMany).toHaveBeenCalledWith({
      where: { mpPaymentId: "777", status: "open" },
      data: { status: "matched", paymentId: 8, resolvedAt: expect.any(Date) },
    });
  });

  it("si el cierre de la bandeja falla, el result no cambia (el cobro ya está asentado)", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null }, existingPayment: { id: 3 } });
    d.db.mpUnmatchedPayment.updateMany.mockRejectedValue(Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("already_processed");
    errorLog.mockRestore();
  });
});

// El `result` se persiste en `WebhookEvent.result`, que es VarChar(64).
describe("todos los results entran en la columna", () => {
  const RESULTS = [
    "already_processed", "entry_already_recorded", "debit_applied", "link_applied",
    "application_approved", "application_approved_after_expiry", "payment_refunded",
    "refund_ignored", "payment_rejected_traced", "payment_ignored",
    "unmatched_no_reference", "unmatched_no_subscription", "unmatched_application_missing",
    "unmatched_duplicate_entry", "unmatched_withdrawn_no_pending", "payment_not_applied",
    "authorized_payment_traced", "subscription_synced", "no_match", "unknown_topic",
  ];
  it("ninguno supera los 64 caracteres", () => {
    expect(RESULTS.filter((r) => r.length > 64)).toEqual([]);
  });
});
