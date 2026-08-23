import { describe, expect, it, vi } from "vitest";
import { makeUnmatchedInbox, UNMATCHED_REASONS } from "@/lib/mp/unmatched";

function db() {
  return {
    mpUnmatchedPayment: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 1, ...args.data })),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        void args; // el fake ignora el filtro; el test afirma sobre `mock.calls`
        return { count: 1 };
      }),
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        void args; // el fake ignora el filtro; el test afirma sobre `mock.calls`
        return [{ id: 1, mpPaymentId: "777", amount: "3000.00", paidAt: new Date("2026-09-10T11:00:00Z") }];
      }),
    },
  };
}

describe("unmatched inbox", () => {
  it("record escribe la fila con motivo y preapproval; el monto va con dos decimales", async () => {
    const d = db();
    const inbox = makeUnmatchedInbox(d as never);
    const r = await inbox.record({ mpPaymentId: "777", amount: 3000, paidAt: new Date("2026-09-10T11:00:00Z"), payerEmail: "v@x.com", externalReference: null, description: "Cuota", preapprovalId: "pre-1", reason: "no_subscription" });
    expect(r).toBe("recorded");
    expect(d.mpUnmatchedPayment.create.mock.calls[0][0].data).toMatchObject({ mpPaymentId: "777", amount: "3000.00", preapprovalId: "pre-1", reason: "no_subscription", payerEmail: "v@x.com" });
  });
  it("una fila que ya existe (P2002) no es error: exists", async () => {
    const d = db();
    d.mpUnmatchedPayment.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    const inbox = makeUnmatchedInbox(d as never);
    expect(await inbox.record({ mpPaymentId: "777", amount: 1, paidAt: new Date(), payerEmail: null, externalReference: null, description: null, preapprovalId: null, reason: "no_reference" })).toBe("exists");
  });
  // El caso real: el tópico `payment` de una suscripción creada a mano llegó sin
  // referencia y dejó la fila sin preapproval; el segundo evento sí lo sabe.
  it("una fila abierta sin preapproval se completa con el que trae el segundo evento", async () => {
    const d = db();
    d.mpUnmatchedPayment.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    const inbox = makeUnmatchedInbox(d as never);
    expect(await inbox.record({ mpPaymentId: "777", amount: 3000, paidAt: new Date(), payerEmail: null, externalReference: null, description: null, preapprovalId: "pre-1", reason: "no_subscription" })).toBe("exists");
    expect(d.mpUnmatchedPayment.updateMany).toHaveBeenCalledTimes(1);
    expect(d.mpUnmatchedPayment.updateMany.mock.calls[0][0]).toEqual({
      where: { mpPaymentId: "777", status: "open", preapprovalId: null },
      data: { preapprovalId: "pre-1" },
    });
  });
  it("si el segundo evento no trae preapproval, no se toca la fila", async () => {
    const d = db();
    d.mpUnmatchedPayment.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    const inbox = makeUnmatchedInbox(d as never);
    expect(await inbox.record({ mpPaymentId: "777", amount: 3000, paidAt: new Date(), payerEmail: null, externalReference: null, description: null, preapprovalId: null, reason: "no_reference" })).toBe("exists");
    expect(d.mpUnmatchedPayment.updateMany).not.toHaveBeenCalled();
  });
  // El `where` es la garantía de las otras dos: una fila resuelta o descartada
  // no matchea, y un preapproval ya escrito no se pisa. Eso lo decide la base,
  // así que lo que se fija acá es exactamente ese `where`.
  it("el update sólo alcanza filas abiertas y sin preapproval", async () => {
    const d = db();
    d.mpUnmatchedPayment.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    d.mpUnmatchedPayment.updateMany.mockResolvedValueOnce({ count: 0 });
    const inbox = makeUnmatchedInbox(d as never);
    expect(await inbox.record({ mpPaymentId: "777", amount: 3000, paidAt: new Date(), payerEmail: null, externalReference: null, description: null, preapprovalId: "pre-2", reason: "no_subscription" })).toBe("exists");
    expect(d.mpUnmatchedPayment.updateMany.mock.calls[0][0].where).toMatchObject({ status: "open", preapprovalId: null });
    expect(Object.keys(d.mpUnmatchedPayment.updateMany.mock.calls[0][0].data)).toEqual(["preapprovalId"]);
  });
  it("otro error sí se propaga (fallo técnico)", async () => {
    const d = db();
    d.mpUnmatchedPayment.create.mockRejectedValueOnce(new Error("db down"));
    await expect(makeUnmatchedInbox(d as never).record({ mpPaymentId: "1", amount: 1, paidAt: new Date(), payerEmail: null, externalReference: null, description: null, preapprovalId: null, reason: "no_reference" })).rejects.toThrow("db down");
  });
  it("openRowsForSubscription busca abiertas por preapproval O por referencia", async () => {
    const d = db();
    const rows = await makeUnmatchedInbox(d as never).openRowsForSubscription({ preapprovalId: "pre-1", externalReference: "solicitud:9" });
    expect(rows[0]).toMatchObject({ mpPaymentId: "777", amount: 3000 });
    expect(d.mpUnmatchedPayment.findMany.mock.calls[0][0].where).toEqual({
      status: "open", OR: [{ preapprovalId: "pre-1" }, { externalReference: "solicitud:9" }],
    });
  });
  it("sin referencia, sólo por preapproval", async () => {
    const d = db();
    await makeUnmatchedInbox(d as never).openRowsForSubscription({ preapprovalId: "pre-1", externalReference: null });
    expect(d.mpUnmatchedPayment.findMany.mock.calls[0][0].where).toEqual({ status: "open", OR: [{ preapprovalId: "pre-1" }] });
  });
  it("los motivos son exactamente los de la spec", () => {
    expect([...UNMATCHED_REASONS]).toEqual(["no_reference", "no_subscription", "application_missing", "duplicate_entry", "withdrawn_no_pending", "treasury_rejected"]);
  });
});
