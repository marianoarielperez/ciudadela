import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: {} }));
vi.mock("@/lib/treasury/service", () => ({ treasuryService: {} }));
import { makeSubscriptionLinker } from "@/lib/mp/link-subscription";

const NOW = new Date("2026-09-01T12:00:00Z");
function deps(over: {
  existing?: boolean;
  member?: { id: number; status: string } | null;
  rows?: Array<{ id: number; mpPaymentId: string; amount: number; paidAt: Date }>;
} = {}) {
  const tx = {
    mpSubscription: { create: vi.fn(async (a: { data: unknown }) => ({ id: 1, ...(a.data as object) })) },
    member: { update: vi.fn(async () => ({})) },
  };
  const db = {
    mpSubscription: { findUnique: vi.fn(async () => (over.existing ? { id: 9 } : null)) },
    member: { findUnique: vi.fn(async () => (over.member === undefined ? { id: 14, status: "active" } : over.member)) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const gateway = {
    getPreapproval: vi.fn(async () => ({
      id: "pre-1", status: "authorized", payerEmail: "v@x.com", externalReference: null,
      amount: 6000, reason: "Cuota", nextPaymentDate: null, dateCreated: null,
    })),
  };
  const inbox = { openRowsForSubscription: vi.fn(async () => over.rows ?? []) };
  const treasury = {
    registerPayment: vi.fn(async () => ({
      kind: "registered", paymentId: 1, receiptId: 2, number: "2026-00002",
      periods: ["2026-09"], amount: 6000, pdfWritten: true,
    })),
  };
  const linker = makeSubscriptionLinker({
    db: db as never, gateway: gateway as never, inbox: inbox as never, treasury: treasury as never, now: () => NOW,
  });
  return { linker, db, tx, gateway, inbox, treasury };
}
beforeEach(() => vi.clearAllMocks());

describe("subscriptionLinker.link", () => {
  it("crea la fila vinculada a mano con los datos frescos de MP, marca autoDebit y aplica las filas de la bandeja", async () => {
    const d = deps({ rows: [{ id: 3, mpPaymentId: "777", amount: 6000, paidAt: new Date("2026-08-10T11:00:00Z") }] });
    const r = await d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 });
    expect(r).toEqual({
      ok: true, applied: [{ paymentId: 1, receiptId: 2 }], unapplied: 0, amount: 6000, status: "authorized",
      autoDebit: true,
    });
    expect(d.tx.mpSubscription.create).toHaveBeenCalledWith({ data: {
      preapprovalId: "pre-1", memberId: 14, linkedManually: true, status: "authorized", amount: "6000.00",
      payerEmail: "v@x.com", externalReference: null, planId: null, lastSyncAt: NOW,
    } });
    expect(d.tx.member.update).toHaveBeenCalledWith({ where: { id: 14 }, data: { autoDebit: true } });
    expect(d.treasury.registerPayment).toHaveBeenCalledWith({
      memberId: 14, type: "debit", n: 1, amount: 6000, paidAt: new Date("2026-08-10T11:00:00Z"),
      mpPaymentId: "777", preapprovalId: "pre-1", actorId: 5,
    });
  });
  it("ya vinculada → error claro, sin escribir", async () => {
    const d = deps({ existing: true });
    expect(await d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 })).toEqual({
      ok: false, error: "Esa suscripción ya está vinculada.",
    });
    expect(d.db.$transaction).not.toHaveBeenCalled();
  });
  it("socio inexistente → error", async () => {
    const d = deps({ member: null });
    expect(await d.linker.link({ preapprovalId: "pre-1", memberId: 99, actorId: 5 })).toMatchObject({ ok: false });
  });
  it("una fila de bandeja que no se puede aplicar no deshace la vinculación", async () => {
    const d = deps({ rows: [
      { id: 3, mpPaymentId: "777", amount: 6000, paidAt: NOW },
      { id: 4, mpPaymentId: "778", amount: 6000, paidAt: NOW },
    ] });
    d.treasury.registerPayment.mockResolvedValueOnce({ kind: "no_pending_withdrawn" } as never);
    const r = await d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 });
    expect(r).toMatchObject({ ok: true, applied: [{ paymentId: 1, receiptId: 2 }], unapplied: 1 });
  });
  it("una fila que TIRA tampoco deshace la vinculación ni corta las siguientes", async () => {
    const d = deps({ rows: [
      { id: 3, mpPaymentId: "777", amount: 6000, paidAt: NOW },
      { id: 4, mpPaymentId: "778", amount: 6000, paidAt: NOW },
    ] });
    d.treasury.registerPayment.mockRejectedValueOnce(new Error("las cuotas cambiaron"));
    const r = await d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 });
    expect(r).toMatchObject({ ok: true, applied: [{ paymentId: 1, receiptId: 2 }], unapplied: 1 });
    expect(d.treasury.registerPayment).toHaveBeenCalledTimes(2);
  });
  it("si MP no contesta, no se escribe nada: la suscripción se crea con datos frescos o no se crea", async () => {
    const d = deps();
    d.gateway.getPreapproval.mockRejectedValueOnce({ status: 404, message: "not found" });
    await expect(d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 })).rejects.toBeTruthy();
    expect(d.db.$transaction).not.toHaveBeenCalled();
  });
  it("un preapproval sin monto en MP se guarda como null, nunca como cero", async () => {
    const d = deps();
    d.gateway.getPreapproval.mockResolvedValueOnce({
      id: "pre-1", status: "paused", payerEmail: null, externalReference: "solicitud:9",
      amount: null, reason: null, nextPaymentDate: null, dateCreated: null,
    } as never);
    const r = await d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 });
    expect(r).toMatchObject({ ok: true, amount: null, status: "paused" });
    expect(d.tx.mpSubscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      amount: null, payerEmail: null, externalReference: "solicitud:9", planId: null,
    }) });
  });
  // El paso 2 no filtra por estado a propósito (hay que poder vincular una
  // `paused`), así que por URL directa se llega a una `cancelled`. Marcar al
  // socio con débito automático por una suscripción muerta es prometer un cobro
  // que MP no va a hacer nunca.
  it("una suscripción cancelada se vincula pero NO marca débito automático", async () => {
    const d = deps();
    d.gateway.getPreapproval.mockResolvedValueOnce({
      id: "pre-1", status: "cancelled", payerEmail: "v@x.com", externalReference: null,
      amount: 6000, reason: "Cuota", nextPaymentDate: null, dateCreated: null,
    } as never);
    const r = await d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 });
    expect(r).toMatchObject({ ok: true, status: "cancelled", autoDebit: false });
    expect(d.tx.mpSubscription.create).toHaveBeenCalled();
    expect(d.tx.member.update).not.toHaveBeenCalled();
  });
  it("una pausada sí marca débito automático: puede volver a cobrar", async () => {
    const d = deps();
    d.gateway.getPreapproval.mockResolvedValueOnce({
      id: "pre-1", status: "paused", payerEmail: null, externalReference: null,
      amount: 6000, reason: null, nextPaymentDate: null, dateCreated: null,
    } as never);
    expect(await d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 })).toMatchObject({ autoDebit: true });
    expect(d.tx.member.update).toHaveBeenCalled();
  });

  // Dos operadores a la vez: la guarda de arriba pasa en los dos y el UNIQUE
  // frena al segundo dentro de la transacción. Sin traducir el P2002, ese
  // operador leía "reintentá en un momento" y se enteraba en el segundo intento.
  it("la carrera entre dos operadores devuelve 'ya está vinculada', no un error genérico", async () => {
    const d = deps();
    d.db.$transaction.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    expect(await d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 })).toEqual({
      ok: false, error: "Esa suscripción ya está vinculada.",
    });
  });
  it("cualquier otro fallo de la transacción se propaga", async () => {
    const d = deps();
    d.db.$transaction.mockRejectedValueOnce(Object.assign(new Error("deadlock"), { code: "P2034" }));
    await expect(d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 })).rejects.toThrow("deadlock");
  });

  it("busca las filas de la bandeja por el preapproval que devolvió MP y por su referencia", async () => {
    const d = deps();
    d.gateway.getPreapproval.mockResolvedValueOnce({
      id: "pre-1", status: "authorized", payerEmail: null, externalReference: "solicitud:9",
      amount: 3000, reason: null, nextPaymentDate: null, dateCreated: null,
    } as never);
    await d.linker.link({ preapprovalId: "pre-1", memberId: 306, actorId: 5 });
    expect(d.inbox.openRowsForSubscription).toHaveBeenCalledWith({
      preapprovalId: "pre-1", externalReference: "solicitud:9",
    });
  });
});
