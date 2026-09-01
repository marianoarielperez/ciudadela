import { beforeEach, describe, expect, it, vi } from "vitest";

// Todos los singletons que evalúa el módulo (prisma, mailer, tesorería, recibo
// por email, valores de cuota) explotan sin DATABASE_URL: se mockean SIEMPRE
// antes de importar el módulo bajo prueba.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ mailer: {} }));
vi.mock("@/lib/treasury/service", () => ({ treasuryService: {} }));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: vi.fn() }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: {} }));

import { makeMailBudget } from "@/lib/email/batch-cap";
import { UNMATCHED_REASONS } from "@/lib/mp/unmatched";
import { makeWebhookProcessor, rejectionSummaryPrefix, WEBHOOK_RESULTS } from "@/lib/mp/webhook-processor";

type PaymentOver = Partial<{ status: string; statusDetail: string | null; externalReference: string | null; transactionAmount: number; dateApproved: Date | null; payerEmail: string | null; subscriptionId: string | null }>;

function deps(over: {
  payment?: PaymentOver;
  subscription?: { memberId: number | null; applicationId: number | null } | null;
  subscriptionByRef?: { memberId: number | null } | null;
  application?: { id: number; status: string; fullName: string; email: string; mpPaymentIdEntry: string | null; memberId: number | null } | null;
  // El mismo `member.findUnique` sirve a dos consultas con `select` distintos:
  // la del socio del link (id + categoría) y la del aviso de rechazo (nombre,
  // casilla, estado de la casilla y estado del socio).
  member?: { id: number; category?: string; fullName?: string; email?: string | null; emailStatus?: string; status?: string } | null;
  existingPayment?: { id: number } | null;
  /** Aviso de rechazo ya mandado por ESTE pago (la dedupe del webhook). */
  priorNotice?: { id: number } | null;
} = {}) {
  const paidAt = new Date("2026-09-10T11:15:30Z");
  const payment = {
    id: "777", status: "approved", statusDetail: "accredited", transactionAmount: 6000,
    externalReference: null as string | null, dateApproved: paidAt as Date | null, payerEmail: "v@x.com", description: "Cuota", subscriptionId: null as string | null, ...over.payment,
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
    // La dedupe del aviso de rechazo: MP manda dos eventos del mismo pago.
    notification: { findFirst: vi.fn().mockResolvedValue(over.priorNotice ?? null) },
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
  const mailerMock = {
    sendToApplication: vi.fn().mockResolvedValue({ messageId: "m" }),
    sendToMember: vi.fn().mockResolvedValue({ messageId: "m" }),
  };
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
  // Hallazgo de la batería de la T14 contra la API real: MP manda DOS
  // notificaciones por cada débito de suscripción, y la de tipo `payment` trae
  // el preapproval enterrado en `point_of_interaction.transaction_data`. Sin
  // leerlo, este cobro no resolvía —ni con la suscripción ya vinculada— y caía
  // en la bandeja como "sin referencia" a esperar la otra notificación.
  it("payment de una suscripción: el preapproval sale del propio pago", async () => {
    const d = deps({
      payment: { externalReference: "t14b:debito", subscriptionId: "pre-1" },
      subscription: { memberId: 306, applicationId: null },
    });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("debit_applied");
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 306, type: "debit", n: 1, preapprovalId: "pre-1" }),
    );
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
  // La marca `mpPaymentIdEntry` se escribe y COMMITEA en la solicitud ANTES de
  // crear el `Payment`: entre las dos escrituras el proceso puede morir
  // (deadlock, restart, base caída), MP reintenta y este camino tiene que
  // reponer la mitad que faltó. Antes devolvía "ya registrado" y el cobro
  // quedaba sin `Payment` para siempre.
  const retryAfterCrash = () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "approved_pending_minute", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: "777", memberId: null } });
    // La transición ya había ocurrido en el intento anterior: los dos updates
    // condicionales no encuentran nada.
    d.db.application.updateMany.mockResolvedValue({ count: 0 });
    return d;
  };

  it("reintento tras un fallo técnico (marca escrita, Payment ausente) → repone el Payment con su recibo", async () => {
    const d = retryAfterCrash();
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("entry_payment_recovered");
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({
      memberId: null, applicationId: 55, type: "entry", n: 0, amount: 6000, mpPaymentId: "777",
    }));
    expect(d.sendReceiptEmail).toHaveBeenCalledWith(2);
  });

  it("ese reintento NO le manda de nuevo la bienvenida al vecino ni reescribe el asiento del pago tardío", async () => {
    const d = retryAfterCrash();
    await d.p.process({ topic: "payment", dataId: "777" });
    expect(d.mailerMock.sendToApplication).not.toHaveBeenCalled();
    expect(d.auditStrictMock).not.toHaveBeenCalled();
  });

  it("reintento del ingreso con el Payment YA asentado → already_processed sin registrar nada (regla 1)", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, existingPayment: { id: 3 }, application: { id: 55, status: "approved_pending_minute", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: "777", memberId: null } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("already_processed");
    expect(d.treasury.registerPayment).not.toHaveBeenCalled();
    expect(d.mailerMock.sendToApplication).not.toHaveBeenCalled();
    expect(d.db.application.updateMany).not.toHaveBeenCalled();
  });
  // El `Payment` del ingreso repuesto DESPUÉS del acta: `record.ts` ya corrió su
  // `updateMany` (`applicationId: 55, memberId: null`) y no vuelve a correr, así
  // que si el pago naciera con `memberId: null` quedaría invisible para siempre
  // en la cuenta corriente (`fetchMemberAccount` filtra por `memberId`).
  it("ingreso repuesto con el acta ya asentada → el Payment nace con el memberId del socio", async () => {
    const d = deps({
      payment: { externalReference: "solicitud:55" },
      subscription: { memberId: 306, applicationId: 55 },
      application: { id: 55, status: "completed", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: "777", memberId: 306 },
    });
    d.db.application.updateMany.mockResolvedValue({ count: 0 });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("entry_payment_recovered");
    // `n: 0` sigue firme: el ingreso cubre el mes del alta y NO imputa cuota (REG-14).
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 306, applicationId: 55, type: "entry", n: 0, amount: 6000, mpPaymentId: "777",
    }));
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "payment_applied", detail: expect.objectContaining({ memberId: 306, applicationId: 55, type: "entry" }),
    }));
  });

  it("sin acta todavía, el ingreso sigue naciendo sin socio (lo cuelga record.ts)", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "pending_payment", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: null, memberId: null } });
    await d.p.process({ topic: "payment", dataId: "777" });
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ memberId: null, applicationId: 55 }));
  });

  // Rama propia y no `already_processed`: colapsarlas decía que el cobro estaba
  // asentado cuando no lo estaba. Hoy el servicio no puede devolver esto para un
  // ingreso (`n: 0`), pero desde que el pago lleva `memberId` dejó de ser
  // imposible por construcción, y una rama que miente en silencio sobre plata
  // cobrada es justo lo que no queremos.
  it("ingreso con no_pending_withdrawn del servicio → bandeja, no already_processed", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "pending_payment", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: null, memberId: null } });
    d.treasury.registerPayment.mockResolvedValue({ kind: "no_pending_withdrawn" });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");
    expect(d.unmatched.record).toHaveBeenCalledWith(expect.objectContaining({ mpPaymentId: "777", reason: "withdrawn_no_pending" }));
    expect(d.db.mpUnmatchedPayment.updateMany).not.toHaveBeenCalled();
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
  it("un TreasuryError de registerPayment NO se propaga: va a la bandeja (treasury_rejected) con su asiento", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.treasury.registerPayment.mockRejectedValue(
      Object.assign(new Error("El socio no existe."), { name: "TreasuryError" }),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("unmatched_treasury_rejected");
    // El asiento conserva el mensaje de la regla que lo rechazó...
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "payment_not_applied",
      detail: expect.objectContaining({ mpPaymentId: "777", memberId: 14, amount: 6000, message: "El socio no existe." }),
    }));
    // ...y la fila de la bandeja es lo único que un operador va a ver de verdad:
    // `audit_log` no tiene pantalla y `audit()` es best-effort.
    expect(d.unmatched.record).toHaveBeenCalledWith(expect.objectContaining({
      mpPaymentId: "777", reason: "treasury_rejected", preapprovalId: "pre-1", amount: 6000,
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
  it("si el ingreso no se puede asentar, la solicitud avanza igual y el acuse sale igual", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "pending_payment", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: null, memberId: null } });
    d.treasury.registerPayment.mockRejectedValue(
      Object.assign(new Error("El monto del pago tiene que ser mayor a cero."), { name: "TreasuryError" }),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");
    expect(d.mailerMock.sendToApplication).toHaveBeenCalledTimes(1);
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_not_applied" }));
    // El result describe la transición (es el único que distingue el pago
    // tardío), así que la plata sin asentar tiene que quedar en la bandeja: si
    // no, no aparece en ninguna pantalla y un re-apply posterior la aplicaría
    // como CUOTA.
    expect(d.unmatched.record).toHaveBeenCalledWith(expect.objectContaining({ mpPaymentId: "777", reason: "treasury_rejected" }));
    errorLog.mockRestore();
  });

  // 3 bis. El camino del ingreso también puede toparse con la fila abierta: los
  // dos eventos del mismo cobro llegan casi juntos y el otro puede haber
  // asentado el `Payment` (y dejado su fila) mientras este hacía la transición.
  it("el ingreso también cierra la fila abierta de la bandeja cuando el servicio dice already_processed", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "pending_payment", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: null, memberId: null } });
    d.treasury.registerPayment.mockResolvedValue({ kind: "already_processed", paymentId: 8 });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");
    expect(d.db.mpUnmatchedPayment.updateMany).toHaveBeenCalledWith({
      where: { mpPaymentId: "777", status: "open" },
      data: { status: "matched", paymentId: 8, resolvedAt: expect.any(Date) },
    });
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

// Tope de envíos por corrida (spec 4C §7.3). El presupuesto se INYECTA por
// llamada: el procesador es un singleton de proceso y un contador propio dejaría
// mudo al webhook después de los primeros 50 correos desde el restart de PM2.
describe("presupuesto de correos", () => {
  it("sin presupuesto, el webhook manda el recibo como siempre", async () => {
    // El camino de un solo cobro no puede quedar limitado por un tope pensado
    // para lotes: `applyPayment` sin `opts` usa el presupuesto ilimitado.
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    await expect(d.p.applyPayment(d.payment, "pre-1")).resolves.toBe("debit_applied");
    expect(d.sendReceiptEmail).toHaveBeenCalledWith(2);
  });

  it("con el presupuesto agotado, el recibo se difiere y el cobro se asienta igual", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    const spent = { take: () => false, refund: () => {}, deferred: 1 };
    await expect(d.p.applyPayment(d.payment, "pre-1", { mailBudget: spent })).resolves.toBe("debit_applied");
    // Lo que el tope frena es el AVISO, nunca la imputación.
    expect(d.treasury.registerPayment).toHaveBeenCalled();
    expect(d.sendReceiptEmail).not.toHaveBeenCalled();
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ emailed: "deferred" }),
    }));
  });

  it("el ingreso también respeta el tope, y la solicitud se acepta igual", async () => {
    // El otro camino que emite recibo: si el tope frenara la transición, un
    // vecino quedaría pagado y sin alta.
    const d = deps({
      payment: { externalReference: "solicitud:9" },
      application: { id: 9, status: "pending_payment", fullName: "Juan", email: "j@x.com", mpPaymentIdEntry: null, memberId: null },
    });
    const spent = { take: () => false, refund: () => {}, deferred: 0 };
    await expect(d.p.applyPayment(d.payment, null, { mailBudget: spent })).resolves.toBe("application_approved");
    expect(d.treasury.registerPayment).toHaveBeenCalled();
    expect(d.sendReceiptEmail).not.toHaveBeenCalled();
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ emailed: "deferred" }),
    }));
  });

  // El tope es de correos ENVIADOS, no de intentos: con 37 emails cargados
  // sobre 278 socios, un lote de socios sin casilla lo agotaría sin haber
  // mandado uno solo y diferiría justo a los que sí tienen dirección.
  it("un socio sin casilla no gasta cupo: el lugar vuelve al pote", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.sendReceiptEmail.mockResolvedValue({ sent: false, reason: "no_email" });
    const budget = makeMailBudget(1);
    await expect(d.p.applyPayment(d.payment, "pre-1", { mailBudget: budget })).resolves.toBe("debit_applied");
    await expect(d.p.applyPayment(d.payment, "pre-1", { mailBudget: budget })).resolves.toBe("debit_applied");
    // Dos intentos con un tope de 1, y ninguno se difirió: no salió ningún correo.
    expect(d.sendReceiptEmail).toHaveBeenCalledTimes(2);
    expect(budget.deferred).toBe(0);
  });

  it("un envío que falla SÍ gasta cupo: hubo intento", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.sendReceiptEmail.mockResolvedValue({ sent: false, reason: "error", code: "ECONN" });
    const budget = makeMailBudget(1);
    await d.p.applyPayment(d.payment, "pre-1", { mailBudget: budget });
    await d.p.applyPayment(d.payment, "pre-1", { mailBudget: budget });
    expect(d.sendReceiptEmail).toHaveBeenCalledTimes(1);
    expect(budget.deferred).toBe(1);
  });
});

// El `result` se persiste en `WebhookEvent.result`, que es VarChar(64). La
// lista NO se copia acá: `WEBHOOK_RESULTS` es un `Record<WebhookResult, true>`,
// así que el compilador obliga a declarar cada result nuevo ahí y este test lo
// mide solo.
describe("todos los results entran en la columna", () => {
  it("ninguno supera los 64 caracteres", () => {
    expect(Object.keys(WEBHOOK_RESULTS).filter((r) => r.length > 64)).toEqual([]);
  });
  it("cada motivo de la bandeja tiene su result", () => {
    for (const reason of UNMATCHED_REASONS) {
      expect(WEBHOOK_RESULTS).toHaveProperty("unmatched_" + reason);
    }
  });
});

// Hasta la 4C el rechazo moría en `webhook_events.result`, una tabla que ninguna
// pantalla muestra: MP intentaba cobrar, no podía, y el vecino se enteraba
// cuando alguien le reclamaba la cuota meses después (spec 4C §7.4).
describe("pago rechazado", () => {
  const rejected = { status: "rejected", statusDetail: "cc_rejected_insufficient_amount", dateApproved: null } as const;
  const socio = { id: 5, fullName: "Ana", email: "ana@b.com", emailStatus: "verified", status: "active" };
  const auditOf = (d: ReturnType<typeof deps>) =>
    d.auditMock.mock.calls.find((c) => (c[0] as { action: string }).action === "payment_rejected")?.[0] as { detail: Record<string, unknown> } | undefined;

  it("le avisa al socio de la suscripción y devuelve el mismo result de siempre", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: socio });
    expect(await d.p.applyPayment(d.payment, "pre-1")).toBe("payment_rejected_traced");
    expect(d.mailerMock.sendToMember).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 5, to: "ana@b.com", type: "payment_rejected",
    }));
    const msg = d.mailerMock.sendToMember.mock.calls[0][0].message;
    expect(msg.text).toContain("fondos");
    // Nunca el código crudo de MP en el cuerpo.
    expect(msg.text).not.toContain("cc_rejected");
  });

  it("el socio del link de pago también se entera", async () => {
    const d = deps({ payment: { ...rejected, externalReference: "pago:5:2" }, subscription: null, member: socio });
    expect(await d.p.applyPayment(d.payment, null)).toBe("payment_rejected_traced");
    expect(d.mailerMock.sendToMember).toHaveBeenCalledWith(expect.objectContaining({ memberId: 5 }));
    // Con referencia de link no hace falta preguntar por la suscripción.
    expect(d.db.mpSubscription.findUnique).not.toHaveBeenCalled();
  });

  it("sin socio atribuible no manda nada, no rompe, y el asiento queda igual", async () => {
    const d = deps({ payment: { ...rejected, externalReference: null }, subscription: null });
    expect(await d.p.applyPayment(d.payment, null)).toBe("payment_rejected_traced");
    expect(d.mailerMock.sendToMember).not.toHaveBeenCalled();
    expect(d.db.member.findUnique).not.toHaveBeenCalled();
    // El operador tiene que poder ver que hubo un rechazo que no se pudo
    // atribuir: sin este asiento el hecho sólo vive en `webhook_events.result`.
    expect(auditOf(d)?.detail).toMatchObject({ memberId: null, notified: false, outcome: "no_member" });
  });

  it("una casilla que rebota no recibe el aviso", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: { ...socio, emailStatus: "bounced" } });
    await d.p.applyPayment(d.payment, "pre-1");
    expect(d.mailerMock.sendToMember).not.toHaveBeenCalled();
    // Y el asiento deja constancia de que no se avisó.
    expect(auditOf(d)?.detail).toMatchObject({ memberId: 5, notified: false, outcome: "bounced" });
  });

  it("un socio sin casilla cargada tampoco, y el asiento lo dice", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: { ...socio, email: null } });
    expect(await d.p.applyPayment(d.payment, "pre-1")).toBe("payment_rejected_traced");
    expect(d.mailerMock.sendToMember).not.toHaveBeenCalled();
    expect(auditOf(d)?.detail).toMatchObject({ notified: false, outcome: "no_email" });
  });

  // Para un ex socio el rechazo es el resultado DESEADO: el correo lo invitaría
  // a restaurar un débito que la asociación debería haber cancelado al darlo de
  // baja. Mismo filtro que devengo, recordatorio y deudores.
  it("un socio dado de baja NO recibe el aviso, pero el asiento queda igual", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: { ...socio, status: "withdrawn" } });
    expect(await d.p.applyPayment(d.payment, "pre-1")).toBe("payment_rejected_traced");
    expect(d.mailerMock.sendToMember).not.toHaveBeenCalled();
    // Una suscripción viva de alguien que ya no es socio es justo lo que el
    // operador tiene que ver.
    expect(auditOf(d)?.detail).toMatchObject({ memberId: 5, notified: false, outcome: "not_current" });
  });

  // El filtro está en POSITIVO (`active` o `suspended`), no `!== "withdrawn"`:
  // un cuarto valor de `MemberStatus` tiene que quedar EXCLUIDO por omisión,
  // como en devengo, recordatorio y deudores. Este caso no existe hoy en el
  // enum; el test fija la dirección en la que falla.
  it("un estado que todavía no existe NO recibe el aviso: el filtro falla cerrado", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: { ...socio, status: "expelled" } });
    expect(await d.p.applyPayment(d.payment, "pre-1")).toBe("payment_rejected_traced");
    expect(d.mailerMock.sendToMember).not.toHaveBeenCalled();
    expect(auditOf(d)?.detail).toMatchObject({ memberId: 5, notified: false, outcome: "not_current" });
  });

  it("un socio suspendido SÍ recibe el aviso (sigue siendo socio y sigue debiendo)", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: { ...socio, status: "suspended" } });
    await d.p.applyPayment(d.payment, "pre-1");
    expect(d.mailerMock.sendToMember).toHaveBeenCalledWith(expect.objectContaining({ memberId: 5 }));
  });

  // MP manda `payment.created` y `payment.updated` del MISMO pago con ids de
  // notificación distintos: la dedupe de la ruta (por `body.id`) no los junta, y
  // para un rechazo no se escribe ningún `Payment` que sirva de segunda capa.
  it("el segundo evento del MISMO pago no manda un segundo correo", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: socio, priorNotice: { id: 1 } });
    expect(await d.p.applyPayment(d.payment, "pre-1")).toBe("payment_rejected_traced");
    expect(d.mailerMock.sendToMember).not.toHaveBeenCalled();
    expect(auditOf(d)?.detail).toMatchObject({ notified: false, outcome: "duplicate" });
    // Se pregunta por ESTE pago, no por el socio: MP reintenta el débito con un
    // id nuevo por intento, y ahí el segundo correo es legítimo.
    expect(d.db.notification.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ memberId: 5, type: "payment_rejected", status: "sent", payloadSummary: { startsWith: rejectionSummaryPrefix("777") } }),
    }));
  });

  // La dedupe sola NO alcanza: consulta antes del envío y la fila `sent` se
  // escribe DESPUÉS del SMTP. `payment.created` y `payment.updated` traen
  // `externalEventId` distinto, así que la ruta no los serializa y los dos POST
  // pueden solaparse dentro de esa ventana. Lo que la cierra es el mutex por id
  // de pago. Este test simula la ventana: la fila `sent` aparece recién cuando
  // el "SMTP" (dos ticks) terminó.
  it("dos eventos del MISMO pago en paralelo mandan UN solo correo", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: socio });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const sentRows: string[] = [];
    d.db.notification.findFirst.mockImplementation(async (args: { where: { payloadSummary: { startsWith: string } } }) => {
      await tick();
      const prefix = args.where.payloadSummary.startsWith;
      return sentRows.some((s) => s.startsWith(prefix)) ? { id: 1 } : null;
    });
    d.mailerMock.sendToMember.mockImplementation(async (input: { summary: string }) => {
      await tick();
      await tick();
      sentRows.push(input.summary);
      return { messageId: "m" };
    });

    const results = await Promise.all([
      d.p.applyPayment(d.payment, "pre-1"),
      d.p.applyPayment(d.payment, "pre-1"),
    ]);

    expect(results).toEqual(["payment_rejected_traced", "payment_rejected_traced"]);
    expect(d.mailerMock.sendToMember).toHaveBeenCalledTimes(1);
    // Y el segundo evento deja constancia de por qué no salió.
    const outcomes = d.auditMock.mock.calls
      .map((c) => (c[0] as { action: string; detail: { outcome: string } }))
      .filter((e) => e.action === "payment_rejected")
      .map((e) => e.detail.outcome);
    expect(outcomes.sort()).toEqual(["duplicate", "sent"]);
  });

  it("el aviso lleva el id del pago en el resumen: sin eso no hay dedupe posible", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: socio });
    await d.p.applyPayment(d.payment, "pre-1");
    const summary = d.mailerMock.sendToMember.mock.calls[0][0].summary as string;
    expect(summary.startsWith(rejectionSummaryPrefix("777"))).toBe(true);
    expect(summary).toContain("cc_rejected_insufficient_amount");
  });

  it("si la dedupe se cae, el aviso SALE igual: perder el rechazo es peor que repetirlo", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: socio });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    d.db.notification.findFirst.mockRejectedValue(Object.assign(new Error("db"), { code: "P1001" }));
    expect(await d.p.applyPayment(d.payment, "pre-1")).toBe("payment_rejected_traced");
    expect(d.mailerMock.sendToMember).toHaveBeenCalled();
    expect(auditOf(d)?.detail).toMatchObject({ outcome: "sent" });
    err.mockRestore();
  });

  it("si el aviso explota, el rechazo NO se vuelve un 500: MP reintentaría el cobro para siempre", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: socio });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    d.mailerMock.sendToMember.mockRejectedValue(Object.assign(new Error("smtp"), { code: "EAUTH" }));
    expect(await d.p.applyPayment(d.payment, "pre-1")).toBe("payment_rejected_traced");
    // Al log va el CÓDIGO, nunca la casilla (docs/08, Ley 25.326).
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("EAUTH");
    expect(logged).not.toContain("@");
    err.mockRestore();
  });

  // El caso de HOY en producción: `EMAIL_ALLOWLIST` está definida y el transporte
  // LANZA, y para ese código el mailer no escribe ni siquiera `Notification.failed`.
  // Si el asiento viviera dentro del try, el rechazo del socio 306 o del 14 no
  // dejaría ningún rastro consultable.
  it("el asiento se escribe AUNQUE el envío explote", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: socio });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    d.mailerMock.sendToMember.mockRejectedValue(Object.assign(new Error("bloqueado"), { code: "EALLOWLIST" }));
    await d.p.applyPayment(d.payment, "pre-1");
    expect(auditOf(d)?.detail).toMatchObject({
      mpPaymentId: "777", memberId: 5, statusDetail: "cc_rejected_insufficient_amount", notified: false, outcome: "error",
    });
    err.mockRestore();
  });

  it("si la BASE se cae buscando al socio, tampoco se vuelve un 500 y el asiento igual queda", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: socio });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    d.db.member.findUnique.mockRejectedValue(Object.assign(new Error("db"), { code: "P1001" }));
    expect(await d.p.applyPayment(d.payment, "pre-1")).toBe("payment_rejected_traced");
    expect(auditOf(d)?.detail).toMatchObject({ memberId: 5, outcome: "error" });
    err.mockRestore();
  });

  it("un asiento que falla tampoco puede volverse un 500", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: socio });
    d.auditMock.mockRejectedValue(new Error("audit"));
    expect(await d.p.applyPayment(d.payment, "pre-1")).toBe("payment_rejected_traced");
  });

  it("el asiento lleva el status_detail y NUNCA el payerEmail", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: socio });
    await d.p.applyPayment(d.payment, "pre-1");
    const entry = auditOf(d)!;
    expect(entry.detail).toMatchObject({ statusDetail: "cc_rejected_insufficient_amount", memberId: 5, notified: true, outcome: "sent" });
    expect(JSON.stringify(entry.detail)).not.toContain("@");
  });

  it("nada de esto aplica un cobro: un rechazo no es plata", async () => {
    const d = deps({ payment: rejected, subscription: { memberId: 5, applicationId: null }, member: socio });
    await d.p.applyPayment(d.payment, "pre-1");
    expect(d.treasury.registerPayment).not.toHaveBeenCalled();
    expect(d.unmatched.record).not.toHaveBeenCalled();
    expect(d.sendReceiptEmail).not.toHaveBeenCalled();
  });
});
