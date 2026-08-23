import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActor } from "@/lib/auth/require-admin";

// La bandeja sin conciliar mueve plata que YA entró: aplicar una fila emite un
// recibo a nombre de un vecino. La guarda tiene que cortar ANTES de tocar el
// servicio, la base, la auditoría y el redirect. Y el asiento no puede llevar
// el email del pagador ni el texto libre del descarte (Ley 25.326).
const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  findUnique: vi.fn(),
  // El pago que ganó el `mpPaymentId`: es lo que distingue "ya está bien
  // asentado" de "se había asentado y ese recibo se anuló".
  paymentFindUnique: vi.fn(),
  updateMany: vi.fn(async () => ({ count: 1 })),
  sendEmail: vi.fn(async () => ({ sent: true })),
  audit: vi.fn(async () => {}),
  // Tipado explícito: sin él TS infiere la forma del rechazo y el
  // `mockResolvedValueOnce` del caso autorizado no compila.
  admin: vi.fn(async (): Promise<AdminActor> => (
    { ok: false, reason: "not_admin", error: "No tenés permiso para editar el padrón." }
  )),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mpUnmatchedPayment: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
    payment: { findUnique: mocks.paymentFindUnique },
  },
}));
vi.mock("@/lib/treasury/service", () => ({
  treasuryService: { registerPayment: mocks.register },
  TreasuryError: class extends Error {},
}));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: mocks.sendEmail }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { TreasuryError } from "@/lib/treasury/service";
import {
  dismissUnmatchedAction,
  resolveUnmatchedAction,
} from "@/app/admin/tesoreria/sin-conciliar/[id]/actions";

const PAID_AT = new Date("2026-08-10T14:00:00.000Z");

// `audit` se mockea sin parámetros (como en el test de efectivo), así que
// `mock.calls[0]` es una tupla vacía para TS: el ensanchado deja inspeccionar el
// asiento sin tener que tipar un argumento que el mock no usa.
function auditedEntry(): unknown {
  return (mocks.audit.mock.calls[0] as unknown[] | undefined)?.[0];
}

// La fila tal como la deja el webhook: con el email del pagador cargado, que es
// justamente lo que no puede escaparse a la auditoría.
function openRow() {
  return {
    id: 5,
    mpPaymentId: "mp-123",
    amount: "12000.00",
    paidAt: PAID_AT,
    payerEmail: "vecino@example.com",
    externalReference: null,
    description: "Cuota mensual",
    preapprovalId: "pre-9",
    reason: "no_reference",
    status: "open" as const,
  };
}

// El formulario mínimo para imputar: una cuota al socio 1 sobre la fila 5.
function applyForm(): FormData {
  const form = new FormData();
  form.append("rowId", "5");
  form.append("memberId", "1");
  form.append("concept", "fees");
  form.append("count", "1");
  return form;
}

describe("resolveUnmatchedAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.sendEmail.mockResolvedValue({ sent: true });
  });

  it("sin admin no lee la fila, no registra, no audita y no redirige", async () => {
    const form = new FormData();
    form.append("rowId", "5");
    form.append("memberId", "1");
    form.append("concept", "fees");
    form.append("count", "1");
    const r = await resolveUnmatchedAction({}, form);
    expect(r.error).toBe("No tenés permiso para editar el padrón.");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("con admin: registra con el mpPaymentId y la fecha de la fila, sella quién resolvió, audita sin el email del pagador y redirige al recibo", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.register.mockResolvedValueOnce({
      kind: "registered", paymentId: 3, receiptId: 7, number: "2026-00007",
      periods: ["2026-08"], amount: 12000, pdfWritten: true,
    });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("memberId", "1");
    form.append("concept", "fees");
    form.append("count", "2");
    await resolveUnmatchedAction({}, form);

    // La plata se asienta con la identidad y la fecha REALES del cobro de MP,
    // no con las de esta corrida: si `paidAt` fuera hoy, el recibo mentiría y
    // la cuota caería en el período equivocado.
    expect(mocks.register).toHaveBeenCalledWith({
      memberId: 1, type: "link", n: 2, amount: 12000, paidAt: PAID_AT,
      mpPaymentId: "mp-123", preapprovalId: "pre-9", actorId: 9, note: null,
    });
    // El servicio ya cerró la fila; acá sólo se sella el responsable, y sólo si
    // quedó `matched`.
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: "matched" }, data: { resolvedById: 9 },
    });
    // `userId` e `ip` explícitos: un objectContaining que no los mira deja
    // pasar un asiento firmado por el actor equivocado, o por null.
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, ip: "unknown",
      action: "unmatched_resolve", entity: "mp_unmatched_payment", entityId: 5,
      detail: {
        action: "apply", memberId: 1, paymentId: 3, receiptId: 7,
        concept: "fees", count: 2, amount: 12000, emailed: "sent",
      },
    }));
    // Ni el email del pagador ni la descripción de MP pueden aparecer en el
    // asiento, esté donde esté dentro del objeto.
    const entry = JSON.stringify(auditedEntry());
    expect(entry).not.toContain("vecino@example.com");
    expect(entry).not.toContain("Cuota mensual");
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/recibos/7?emitido=1&email=sent");
  });

  it("aporte voluntario: va con type voluntary y sin cuotas", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.register.mockResolvedValueOnce({
      kind: "registered", paymentId: 4, receiptId: 8, number: "2026-00008",
      periods: [], amount: 12000, pdfWritten: true,
    });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("memberId", "1");
    form.append("concept", "voluntary");
    await resolveUnmatchedAction({}, form);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ type: "voluntary", n: 0 }));
  });

  it("una fila ya resuelta no se vuelve a cobrar", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ ...openRow(), status: "matched" });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("memberId", "1");
    form.append("concept", "fees");
    form.append("count", "1");
    const r = await resolveUnmatchedAction({}, form);
    expect(r.error).toBe("Esta fila ya fue resuelta.");
    expect(mocks.register).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("already_processed con el pago aplicado: dice el número de recibo, lo linkea y no lo pinta de error", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.register.mockResolvedValueOnce({ kind: "already_processed", paymentId: 3 });
    mocks.paymentFindUnique.mockResolvedValueOnce({
      status: "applied", receipt: { id: 7, number: "2026-00007" },
    });
    const r = await resolveUnmatchedAction({}, applyForm());
    expect(r.error).toBe(
      "Este cobro de Mercado Pago ya está asentado: se registró con el recibo N° 2026-00007. No hace falta volver a aplicarlo.",
    );
    // El cobro está bien asentado: no se perdió plata y no corresponde el rojo.
    expect(r.kind).toBe("warning");
    expect(r.receipt).toEqual({ id: 7, number: "2026-00007" });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  // La fila que reabre una anulación vuelve a "Resolver" y choca contra el
  // mismo `mpPaymentId`. Decirle "ya está registrado" a secas la dejaba muda:
  // el operador tiene que leer que ese recibo se anuló y poder ir a verlo.
  it("already_processed con el recibo anulado: lo dice, linkea el recibo y avisa que desde acá no se reimputa", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.register.mockResolvedValueOnce({ kind: "already_processed", paymentId: 3 });
    mocks.paymentFindUnique.mockResolvedValueOnce({
      status: "voided", receipt: { id: 7, number: "2026-00007" },
    });
    const r = await resolveUnmatchedAction({}, applyForm());
    expect(r.error).toBe(
      "Este cobro de Mercado Pago ya se había asentado con el recibo N° 2026-00007 y ese recibo se anuló."
      + " Por ahora esta plata no se puede volver a imputar desde acá: la fila queda pendiente.",
    );
    expect(r.kind).toBeUndefined();
    expect(r.receipt).toEqual({ id: 7, number: "2026-00007" });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("una regla de negocio del servicio se le muestra al operador tal como la redactó", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.register.mockRejectedValueOnce(new TreasuryError("El monto no puede ser cero."));
    const r = await resolveUnmatchedAction({}, applyForm());
    expect(r.error).toBe("El monto no puede ser cero.");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("la nota del operador llega al pago y NO entra al asiento", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.register.mockResolvedValueOnce({
      kind: "registered", paymentId: 3, receiptId: 7, number: "2026-00007",
      periods: ["2026-08"], amount: 12000, pdfWritten: true,
    });
    const form = applyForm();
    form.append("note", "Lo pagó la hija por transferencia");
    await resolveUnmatchedAction({}, form);
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ note: "Lo pagó la hija por transferencia" }),
    );
    // Texto libre del operador: puede nombrar a un vecino y no va a la auditoría.
    expect(JSON.stringify(auditedEntry())).not.toContain("transferencia");
  });

  it("más de 60 cuotas se rechaza en castellano antes de tocar la base", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("memberId", "1");
    form.append("concept", "fees");
    form.append("count", "72");
    const r = await resolveUnmatchedAction({}, form);
    expect(r.error).toBe("Como máximo 60 cuotas.");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("no_pending_withdrawn: se explica por qué no hay a qué imputarlo", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.register.mockResolvedValueOnce({ kind: "no_pending_withdrawn" });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("memberId", "1");
    form.append("concept", "fees");
    form.append("count", "1");
    const r = await resolveUnmatchedAction({}, form);
    expect(r.error).toBe(
      "El socio está dado de baja y no tiene cuotas pendientes: no hay a qué imputarlo.",
    );
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("si el email del recibo explota, la plata ya cobrada igual queda auditada y redirige", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.register.mockResolvedValueOnce({
      kind: "registered", paymentId: 3, receiptId: 7, number: "2026-00007",
      periods: ["2026-08"], amount: 12000, pdfWritten: true,
    });
    mocks.sendEmail.mockRejectedValueOnce(Object.assign(new Error("pool timeout"), { code: "ETIMEDOUT" }));
    const form = new FormData();
    form.append("rowId", "5");
    form.append("memberId", "1");
    form.append("concept", "fees");
    form.append("count", "1");
    await resolveUnmatchedAction({}, form);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ emailed: "error" }),
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/recibos/7?emitido=1&email=error");
  });

  it("sin socio elegido se rechaza en castellano antes de tocar la base", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("concept", "fees");
    form.append("count", "1");
    const r = await resolveUnmatchedAction({}, form);
    expect(r.error).toBe("Elegí a qué socio se le aplica.");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
});

describe("dismissUnmatchedAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("sin admin no escribe, no audita y no redirige", async () => {
    const form = new FormData();
    form.append("rowId", "5");
    form.append("reason", "Cobro duplicado de MP");
    const r = await dismissUnmatchedAction({}, form);
    expect(r.error).toBe("No tenés permiso para editar el padrón.");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("un motivo demasiado corto se rechaza en castellano y no escribe nada", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("reason", "no");
    const r = await dismissUnmatchedAction({}, form);
    expect(r.error).toBe("Indicá el motivo del descarte.");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("con admin: descarta acotando a las filas abiertas y audita SIN el texto del motivo", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("reason", "Es un cobro de prueba del piloto");
    await dismissUnmatchedAction({}, form);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: "open" },
      data: expect.objectContaining({
        status: "dismissed", resolvedById: 9, description: "Es un cobro de prueba del piloto",
      }),
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, action: "unmatched_resolve", entity: "mp_unmatched_payment", entityId: 5,
      detail: { action: "dismiss" },
    }));
    // El motivo es texto libre: puede nombrar a un vecino y no entra al asiento.
    expect(JSON.stringify(auditedEntry())).not.toContain("piloto");
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/sin-conciliar?estado=resueltos");
  });

  it("una fila que ya estaba resuelta no dice que se descartó", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("reason", "Cobro duplicado de MP");
    const r = await dismissUnmatchedAction({}, form);
    expect(r.error).toBe("Esta fila ya fue resuelta.");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
