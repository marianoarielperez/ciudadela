import { describe, expect, it, vi } from "vitest";

// Acá no hay base. `split-messages` toma `adminExemptionNotice` de `exemptions`
// —una sola definición del texto, la lección de `activeExemption`— y ese módulo
// exporta también su singleton de Prisma, que tira al evaluarse sin
// `DATABASE_URL`. Se mockea igual que en `treasury-exemptions.test.ts`: los dos
// módulos de esta tarea reciben `db` por parámetro y no importan `@/lib/prisma`.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  cents, groupTotals, isRefundedGroup, loadGroup, MAX_SPLIT_PARTS, parseSociosParam, sharedPaymentOf,
} from "@/lib/treasury/split-group";
import { SPLIT_GUARD_MESSAGES } from "@/lib/treasury/split-messages";

// El grupo de un cobro de MP —portador + partes— es UNA aritmética compartida
// por el núcleo, la pantalla y la lista (spec 2026-09-10 §4.3). Se prueba pura.
describe("groupTotals", () => {
  it("sin pagos: nada asignado, todo sin asignar, fila abierta", () => {
    expect(groupTotals([], 18000)).toEqual({ assigned: 0, unassigned: 18000, status: "open" });
  });
  it("las partes aplicadas suman lo cobrado: matched", () => {
    const t = groupTotals([{ amount: 12000, status: "applied" }, { amount: 6000, status: "applied" }], 18000);
    expect(t).toEqual({ assigned: 18000, unassigned: 0, status: "matched" });
  });
  it("una parte anulada deja el resto sin asignar: partial", () => {
    const t = groupTotals([{ amount: 12000, status: "applied" }, { amount: 6000, status: "voided" }], 18000);
    expect(t).toEqual({ assigned: 12000, unassigned: 6000, status: "partial" });
  });
  it("todo anulado o reembolsado: open", () => {
    const t = groupTotals([{ amount: 12000, status: "refunded" }, { amount: 6000, status: "voided" }], 18000);
    expect(t.status).toBe("open");
    expect(t.unassigned).toBe(18000);
  });
  it("suma en centavos, sin deriva de coma flotante", () => {
    const t = groupTotals([{ amount: 0.1, status: "applied" }, { amount: 0.2, status: "applied" }], 0.3);
    expect(t).toEqual({ assigned: 0.3, unassigned: 0, status: "matched" });
    expect(cents(0.3)).toBe(30);
  });
  it("un grupo que supera lo cobrado no da 'sin asignar' negativo", () => {
    expect(groupTotals([{ amount: 20000, status: "applied" }], 18000)).toEqual({ assigned: 20000, unassigned: 0, status: "matched" });
  });
});

function fakeDb(payments: Array<Record<string, unknown> & { id: number }>, rows: Array<Record<string, unknown>> = []) {
  return {
    payment: {
      findUnique: vi.fn(async (a: { where: { mpPaymentId?: string; id?: number } }) =>
        payments.find((p) => (a.where.mpPaymentId !== undefined ? p.mpPaymentId === a.where.mpPaymentId : p.id === a.where.id)) ?? null),
      findMany: vi.fn(async (a: { where: { splitOfPaymentId: number } }) =>
        payments.filter((p) => p.splitOfPaymentId === a.where.splitOfPaymentId)),
    },
    mpUnmatchedPayment: {
      findUnique: vi.fn(async (a: { where: { mpPaymentId: string } }) =>
        rows.find((r) => r.mpPaymentId === a.where.mpPaymentId) ?? null),
    },
  };
}

// Un reembolso es un hecho sobre el dinero de MERCADO PAGO: volvió al pagador.
// Una anulación de mostrador no dice nada sobre ese dinero. La distinción es toda
// la guarda, así que se prueba pura y en los dos sentidos.
describe("isRefundedGroup", () => {
  it("una parte reembolsada marca el grupo entero", () => {
    expect(isRefundedGroup([{ status: "applied" }, { status: "refunded" }])).toBe(true);
    expect(isRefundedGroup([{ status: "refunded" }])).toBe(true);
  });
  it("una ANULACIÓN de mostrador no lo marca: la plata de MP sigue en la cuenta", () => {
    expect(isRefundedGroup([{ status: "voided" }, { status: "applied" }])).toBe(false);
    expect(isRefundedGroup([{ status: "voided" }])).toBe(false);
  });
  it("un grupo vacío no está reembolsado", () => {
    expect(isRefundedGroup([])).toBe(false);
  });
});

describe("loadGroup", () => {
  it("sin portador: grupo vacío y fila abierta", async () => {
    const db = fakeDb([]);
    const g = await loadGroup(db as never, { mpPaymentId: "mp-1", amount: 18000 });
    expect(g.holder).toBeNull();
    expect(g.all).toEqual([]);
    expect(g.totals.status).toBe("open");
    // Sin portador no hay partes que buscar.
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });
  it("portador + partes, ordenadas por id, con Decimal convertido a número", async () => {
    const db = fakeDb([
      { id: 7, mpPaymentId: "mp-1", splitOfPaymentId: null, amount: "12000.00", status: "applied" },
      { id: 9, mpPaymentId: null, splitOfPaymentId: 7, amount: "6000.00", status: "voided" },
      { id: 8, mpPaymentId: null, splitOfPaymentId: 7, amount: "0.01", status: "applied" },
      { id: 3, mpPaymentId: "otro", splitOfPaymentId: null, amount: "1.00", status: "applied" },
    ]);
    const g = await loadGroup(db as never, { mpPaymentId: "mp-1", amount: 18000 });
    expect(g.holder?.id).toBe(7);
    expect(g.parts.map((p) => p.id)).toEqual([8, 9]);
    expect(g.all.map((p) => p.amount)).toEqual([12000, 0.01, 6000]);
    expect(g.totals).toEqual({ assigned: 12000.01, unassigned: 5999.99, status: "partial" });
  });
  it("`refunded` viaja con el grupo: lo mira una sola función y no cada lector", async () => {
    const anulado = fakeDb([
      { id: 7, mpPaymentId: "mp-1", splitOfPaymentId: null, amount: "12000.00", status: "voided" },
    ]);
    expect((await loadGroup(anulado as never, { mpPaymentId: "mp-1", amount: 18000 })).refunded).toBe(false);
    const devuelto = fakeDb([
      { id: 7, mpPaymentId: "mp-1", splitOfPaymentId: null, amount: "12000.00", status: "applied" },
      { id: 8, mpPaymentId: null, splitOfPaymentId: 7, amount: "6000.00", status: "refunded" },
    ]);
    expect((await loadGroup(devuelto as never, { mpPaymentId: "mp-1", amount: 18000 })).refunded).toBe(true);
    // Sin portador tampoco hay reembolso: no hay nada de MP asentado todavía.
    expect((await loadGroup(fakeDb([]) as never, { mpPaymentId: "mp-1", amount: 18000 })).refunded).toBe(false);
  });
});

describe("sharedPaymentOf", () => {
  const row = { id: 5, mpPaymentId: "mp-1", amount: "18000.00", paidAt: new Date("2026-09-08T15:00:00Z") };
  it("un pago suelto (sin partes ni portador) no consulta nada y no lleva leyenda", async () => {
    const db = fakeDb([], [row]);
    expect(await sharedPaymentOf(db as never, { amount: 18000, mpPaymentId: "mp-1", splitOfPaymentId: null, hasParts: false })).toBeNull();
    expect(db.mpUnmatchedPayment.findUnique).not.toHaveBeenCalled();
    expect(db.payment.findUnique).not.toHaveBeenCalled();
  });
  it("el portador de un reparto lleva la leyenda con el total y la fecha de la fila", async () => {
    const db = fakeDb([], [row]);
    expect(await sharedPaymentOf(db as never, { amount: 12000, mpPaymentId: "mp-1", splitOfPaymentId: null, hasParts: true }))
      .toEqual({ rowId: 5, mpPaymentId: "mp-1", total: 18000, paidAt: row.paidAt });
  });
  it("una parte resuelve el mpPaymentId a través del portador", async () => {
    const db = fakeDb([{ id: 7, mpPaymentId: "mp-1", splitOfPaymentId: null }], [row]);
    expect(await sharedPaymentOf(db as never, { amount: 6000, mpPaymentId: null, splitOfPaymentId: 7, hasParts: false }))
      .toMatchObject({ total: 18000 });
    expect(db.payment.findUnique).toHaveBeenCalledWith({ where: { id: 7 }, select: { mpPaymentId: true } });
  });
  it("una parte que cubre el cobro entero (fila reabierta y vuelta a aplicar) no lleva leyenda", async () => {
    const db = fakeDb([{ id: 7, mpPaymentId: "mp-1", splitOfPaymentId: null }], [row]);
    expect(await sharedPaymentOf(db as never, { amount: 18000, mpPaymentId: null, splitOfPaymentId: 7, hasParts: false })).toBeNull();
  });
  it("sin fila de bandeja (un grupo que no vino de ahí) no lleva leyenda", async () => {
    const db = fakeDb([{ id: 7, mpPaymentId: "mp-1", splitOfPaymentId: null }], []);
    expect(await sharedPaymentOf(db as never, { amount: 6000, mpPaymentId: null, splitOfPaymentId: 7, hasParts: false })).toBeNull();
  });
});

describe("parseSociosParam", () => {
  it("lee enteros positivos, sin repetidos, hasta el tope", () => {
    expect(parseSociosParam("192,193")).toEqual([192, 193]);
    expect(parseSociosParam("192,192,193")).toEqual([192, 193]);
    expect(parseSociosParam("1,2,3,4,5,6,7")).toHaveLength(MAX_SPLIT_PARTS);
  });
  it("ignora basura y devuelve vacío sin parámetro", () => {
    expect(parseSociosParam(undefined)).toEqual([]);
    expect(parseSociosParam("")).toEqual([]);
    expect(parseSociosParam("abc,-1,0,7.5,9")).toEqual([9]);
  });
});

describe("SPLIT_GUARD_MESSAGES", () => {
  it("la suma se redacta con los dos importes en es-AR", () => {
    expect(SPLIT_GUARD_MESSAGES.sum(17000, 18000)).toBe("Las partes suman $ 17.000,00 y hay $ 18.000,00 sin asignar.");
  });
  it("el cesante lee cuántas pendientes tiene, o que no tiene ninguna", () => {
    expect(SPLIT_GUARD_MESSAGES.withdrawnCount(0)).toBe("El socio está dado de baja y no tiene cuotas pendientes: no hay nada que cobrarle.");
    expect(SPLIT_GUARD_MESSAGES.withdrawnCount(1)).toBe("El socio está dado de baja: tiene 1 cuota pendiente y no devenga nuevas.");
    expect(SPLIT_GUARD_MESSAGES.withdrawnCount(3)).toBe("El socio está dado de baja: tiene 3 cuotas pendientes y no devenga nuevas.");
  });
  it("el exento lee el acta y que sólo va un aporte", () => {
    const m = SPLIT_GUARD_MESSAGES.exempt({ toPeriod: "2026-12", minute: { type: "board", number: 124 } });
    expect(m).toContain("eximido de la cuota hasta diciembre 2026");
    expect(m).toContain("Sólo se le puede registrar un aporte.");
  });
  it("el tope nombra el número", () => {
    expect(SPLIT_GUARD_MESSAGES.tooManyParts).toBe("Como máximo 5 socios por pago.");
  });
});
