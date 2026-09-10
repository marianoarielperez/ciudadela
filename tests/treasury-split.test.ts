import { beforeEach, describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeTreasuryService, TreasuryError } from "@/lib/treasury/service";
import { SPLIT_GUARD_MESSAGES as M } from "@/lib/treasury/split-messages";
import { splitFakeDb, type FakeFee, type FakeRow } from "./helpers/split-fake-db";

// El reparto de un cobro de MP entre socios (spec 2026-09-10 §5.2): un pago por
// socio en UNA transacción, el portador primero, los números al final, la fila
// derivada del grupo. Las guardas se verificaron por MUTACIÓN al escribirlos:
// borrar cada una en el servicio pone en rojo el `it` que la nombra.

const feeValue = { id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: civilDateUtc(2026, 9, 1), minuteId: null };
const feeValues = { current: vi.fn(async () => feeValue), history: vi.fn(async () => [feeValue]) };
const NOW = new Date("2026-09-10T15:00:00Z");
const PAID_AT = new Date("2026-09-08T14:00:00Z");
const JOINED = civilDateUtc(2015, 3, 1);
const hugo = { id: 192, fullName: "Araoz Hugo", category: "active", status: "active", joinedAt: JOINED };
const monica = { id: 193, fullName: "Maza Monica", category: "active", status: "active", joinedAt: JOINED };
const carlos = { id: 200, fullName: "Perez Carlos", category: "active", status: "active", joinedAt: JOINED };

function row(over: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 5, mpPaymentId: "mp-18k", amount: "18000.00", paidAt: PAID_AT, preapprovalId: null,
    status: "open", paymentId: null, ...over,
  };
}
function pending(memberId: number, periods: string[], from = 1): FakeFee[] {
  return periods.map((period, i) => ({ id: from + i, memberId, period, status: "pending", origin: "import", paymentId: null }));
}
// Hugo debe julio y agosto; Mónica, agosto.
const FEES = [...pending(192, ["2026-07", "2026-08"], 1), ...pending(193, ["2026-08"], 3)];
const renderPdf = vi.fn(async () => new Uint8Array([1]));
function svcOn(fake: ReturnType<typeof splitFakeDb>) {
  return makeTreasuryService({ db: fake.db, feeValues, now: () => NOW, renderPdf, writePdf: async () => {} });
}
const twoPlusOne = [
  { memberId: 192, concept: "fees" as const, n: 2, amount: 12000 },
  { memberId: 193, concept: "fees" as const, n: 1, amount: 6000 },
];

beforeEach(() => vi.clearAllMocks());

describe("registerSplitPayment — forma", () => {
  it("cero partes, más de cinco, socio repetido, cuotas o importe inválidos: rechaza sin leer la fila", async () => {
    const fake = splitFakeDb({ members: [hugo], fees: [], rows: [row()] });
    const svc = svcOn(fake);
    const base = { rowId: 5, actorId: 9 };
    await expect(svc.registerSplitPayment({ ...base, parts: [] })).rejects.toThrow(M.noParts);
    await expect(svc.registerSplitPayment({ ...base, parts: [1, 2, 3, 4, 5, 6].map((id) => ({ memberId: id, concept: "fees" as const, n: 1, amount: 3000 })) }))
      .rejects.toThrow(M.tooManyParts);
    await expect(svc.registerSplitPayment({ ...base, parts: [{ memberId: 192, concept: "fees", n: 1, amount: 9000 }, { memberId: 192, concept: "fees", n: 1, amount: 9000 }] }))
      .rejects.toThrow(M.duplicateMember);
    await expect(svc.registerSplitPayment({ ...base, parts: [{ memberId: 192, concept: "fees", n: 0, amount: 18000 }] })).rejects.toThrow(M.count);
    await expect(svc.registerSplitPayment({ ...base, parts: [{ memberId: 192, concept: "fees", n: 61, amount: 18000 }] })).rejects.toThrow(M.count);
    await expect(svc.registerSplitPayment({ ...base, parts: [{ memberId: 192, concept: "voluntary", n: 1, amount: 18000 }] })).rejects.toThrow(M.count);
    await expect(svc.registerSplitPayment({ ...base, parts: [{ memberId: 192, concept: "fees", n: 1, amount: 0 }] })).rejects.toThrow(M.amountZero);
    expect(fake.mocks.mpUnmatchedPayment.findUnique).not.toHaveBeenCalled();
    expect(fake.mocks.$transaction).not.toHaveBeenCalled();
  });

  it("fila inexistente o ya resuelta", async () => {
    const svc = svcOn(splitFakeDb({ members: [hugo], fees: [], rows: [row({ status: "matched" })] }));
    await expect(svc.registerSplitPayment({ rowId: 99, actorId: 9, parts: [{ memberId: 192, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.rowGone);
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 192, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.rowResolved);
  });

  it("la suma inexacta se rechaza ANTES de la transacción, con los dos importes", async () => {
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    const svc = svcOn(fake);
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 192, concept: "fees", n: 2, amount: 12000 }, { memberId: 193, concept: "fees", n: 1, amount: 5000 }] }))
      .rejects.toThrow("Las partes suman $ 17.000,00 y hay $ 18.000,00 sin asignar.");
    expect(fake.mocks.$transaction).not.toHaveBeenCalled();
    expect(fake.state.seq).toBe(0);
  });
});

describe("registerSplitPayment — el reparto", () => {
  it("2 + 1: dos pagos, el portador con el id de MP, la parte apuntando a él, cuotas por socio, números al final y en orden, fila matched con quién resolvió", async () => {
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    const svc = svcOn(fake);
    const r = await svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne, note: "matrimonio" });
    if (r.kind !== "registered") throw new Error(r.kind);
    expect(r.rowStatus).toBe("matched");
    expect(r.parts).toEqual([
      { memberId: 192, paymentId: 1, receiptId: 1, number: "2026-00001", periods: ["2026-07", "2026-08"], amount: 12000, pdfWritten: true },
      { memberId: 193, paymentId: 2, receiptId: 2, number: "2026-00002", periods: ["2026-08"], amount: 6000, pdfWritten: true },
    ]);
    // El portador lleva el id de MP y la parte apunta a él; nunca las dos cosas.
    expect(fake.state.payments[0]).toMatchObject({ id: 1, memberId: 192, type: "link", amount: "12000.00", mpPaymentId: "mp-18k", preapprovalId: null, registeredById: 9, note: "matrimonio", paidAt: PAID_AT, status: "applied" });
    expect(fake.state.payments[0].splitOfPaymentId).toBeUndefined();
    expect(fake.state.payments[1]).toMatchObject({ id: 2, memberId: 193, type: "link", amount: "6000.00", mpPaymentId: null, preapprovalId: null, splitOfPaymentId: 1 });
    // Cada socio con SUS cuotas: las más viejas primero.
    expect(fake.state.fees.filter((f) => f.memberId === 192).map((f) => [f.period, f.status, f.paymentId])).toEqual([["2026-07", "paid", 1], ["2026-08", "paid", 1]]);
    expect(fake.state.fees.filter((f) => f.memberId === 193).map((f) => [f.period, f.status, f.paymentId])).toEqual([["2026-08", "paid", 2]]);
    expect(fake.state.receipts.map((x) => [x.number, x.paymentId, x.concept, x.issuedAt])).toEqual([
      ["2026-00001", 1, "Cuota social · julio a agosto 2026 (2 cuotas)", PAID_AT],
      ["2026-00002", 2, "Cuota social · agosto 2026", PAID_AT],
    ]);
    // La fila: cerrada por el grupo entero, con el portador y con quién resolvió, ADENTRO.
    expect(fake.state.rows[0]).toMatchObject({ status: "matched", paymentId: 1, resolvedById: 9, resolvedAt: NOW });
    // Orden: lock → escrituras → fila → números → recibos, todo dentro de la transacción.
    const log = fake.state.log;
    expect(log[0]).toBe("start");
    expect(log.at(-1)).toBe("end");
    expect(log.indexOf("lock")).toBe(1);
    expect(log.indexOf("row-update")).toBeLessThan(log.indexOf("seq"));
    expect(log.filter((e) => e === "seq" || e === "receipt")).toEqual(["seq", "receipt", "seq", "receipt"]);
    // El PDF, DESPUÉS del commit y uno por parte.
    expect(renderPdf).toHaveBeenCalledTimes(2);
  });

  it("una parte sola en una fila fresca escribe exactamente lo que escribe registerPayment", async () => {
    const one = { memberId: 192, concept: "fees" as const, n: 3, amount: 18000 };
    const a = splitFakeDb({ members: [hugo], fees: FEES.filter((f) => f.memberId === 192), rows: [row()] });
    const b = splitFakeDb({ members: [hugo], fees: FEES.filter((f) => f.memberId === 192), rows: [row()] });
    await svcOn(a).registerSplitPayment({ rowId: 5, actorId: 9, parts: [one] });
    await svcOn(b).registerPayment({ memberId: 192, type: "link", n: 3, amount: 18000, paidAt: PAID_AT, mpPaymentId: "mp-18k", preapprovalId: null, actorId: 9, note: null });
    expect(a.state.payments).toEqual(b.state.payments);
    expect(a.state.fees).toEqual(b.state.fees);
    expect(a.state.receipts).toEqual(b.state.receipts);
    expect(a.state.rows[0]).toMatchObject({ status: "matched", paymentId: 1 });
    expect(b.state.rows[0]).toMatchObject({ status: "matched", paymentId: 1 });
  });

  it("fila parcial: la parte nueva cuelga del portador aplicado y la fila pasa a matched", async () => {
    const fake = splitFakeDb({
      members: [hugo, monica, carlos],
      fees: pending(200, ["2026-08"], 10),
      rows: [row({ status: "partial", paymentId: 1 })],
      payments: [
        { id: 1, memberId: 192, type: "link", amount: "12000.00", status: "applied", mpPaymentId: "mp-18k", preapprovalId: null, splitOfPaymentId: null, paidAt: PAID_AT },
        { id: 2, memberId: 193, type: "link", amount: "6000.00", status: "voided", mpPaymentId: null, preapprovalId: null, splitOfPaymentId: 1, paidAt: PAID_AT },
      ],
    });
    const svc = svcOn(fake);
    const r = await svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 200, concept: "fees", n: 1, amount: 6000 }] });
    if (r.kind !== "registered") throw new Error(r.kind);
    expect(r.rowStatus).toBe("matched");
    expect(fake.state.payments[2]).toMatchObject({ id: 3, memberId: 200, mpPaymentId: null, splitOfPaymentId: 1, status: "applied" });
    expect(fake.state.rows[0]).toMatchObject({ status: "matched", paymentId: 1 });
  });

  it("fila reabierta (todo anulado): las partes nuevas cuelgan del portador ANULADO, que conserva el id de MP", async () => {
    const fake = splitFakeDb({
      members: [hugo, monica],
      fees: FEES,
      rows: [row({ status: "open", paymentId: null })],
      payments: [
        { id: 1, memberId: 192, type: "link", amount: "18000.00", status: "voided", mpPaymentId: "mp-18k", preapprovalId: null, splitOfPaymentId: null, paidAt: PAID_AT },
      ],
    });
    const svc = svcOn(fake);
    const r = await svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne });
    if (r.kind !== "registered") throw new Error(r.kind);
    expect(fake.state.payments.slice(1).map((p) => [p.mpPaymentId, p.splitOfPaymentId, p.status])).toEqual([[null, 1, "applied"], [null, 1, "applied"]]);
    expect(fake.state.payments[0]).toMatchObject({ mpPaymentId: "mp-18k", status: "voided" });
    expect(fake.state.rows[0]).toMatchObject({ status: "matched", paymentId: 1 });
  });

  it("la suma de una fila parcial se compara contra lo SIN ASIGNAR, no contra el total", async () => {
    const fake = splitFakeDb({
      members: [carlos], fees: pending(200, ["2026-08"], 10),
      rows: [row({ status: "partial", paymentId: 1 })],
      payments: [{ id: 1, memberId: 192, type: "link", amount: "12000.00", status: "applied", mpPaymentId: "mp-18k", preapprovalId: null, splitOfPaymentId: null, paidAt: PAID_AT }],
    });
    await expect(svcOn(fake).registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 200, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow("Las partes suman $ 18.000,00 y hay $ 6.000,00 sin asignar.");
  });
});

describe("registerSplitPayment — guardas por socio (las mismas que Efectivo)", () => {
  const adherent = { ...carlos, id: 300, category: "adherent" };
  const withdrawn = { ...carlos, id: 301, status: "withdrawn" };
  it("adherente: sin cuotas sociales", async () => {
    const svc = svcOn(splitFakeDb({ members: [adherent], fees: [], rows: [row()] }));
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 300, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.conceptCategory);
  });
  it("cesante: sólo deuda, y no más cuotas que las pendientes", async () => {
    const svc = svcOn(splitFakeDb({ members: [withdrawn], fees: pending(301, ["2026-05"], 20), rows: [row()] }));
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 301, concept: "voluntary", n: 0, amount: 18000 }] }))
      .rejects.toThrow(M.withdrawnConcept);
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 301, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.withdrawnCount(1));
  });
  it("exento: sin cuotas, sí aporte", async () => {
    // `as const` en el tipo del acta: `M.exempt` pide `MinuteType`, y el literal
    // suelto se ensancha a `string`. El doble lo declara `string` a propósito
    // (no importa el enum de Prisma), así que la anotación va acá.
    const exemption = { id: 1, memberId: 192, fromPeriod: "2026-09", toPeriod: "2026-12", months: 4, minuteId: 3, minute: { type: "board" as const, number: 124 }, note: null, revokedAt: null };
    const fake = splitFakeDb({ members: [hugo], fees: [], rows: [row()], exemptions: [exemption] });
    const svc = svcOn(fake);
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 192, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.exempt(exemption));
    const r = await svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 192, concept: "voluntary", n: 0, amount: 18000 }] });
    expect(r.kind).toBe("registered");
    expect(fake.state.payments[0]).toMatchObject({ type: "voluntary" });
    expect(fake.state.receipts[0].concept).toBe("Aporte voluntario");
  });
  it("socio inexistente", async () => {
    const svc = svcOn(splitFakeDb({ members: [], fees: [], rows: [row()] }));
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 1, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.memberGone);
  });
});

describe("registerSplitPayment — carreras", () => {
  it("otro escritor creó el portador entre la foto y el INSERT: already_processed, sin número consumido", async () => {
    // El gancho va en el primer `payment.create` y NO al abrir la transacción:
    // la ventana del unique del portador (spec §5.2 paso 5) es la que hay entre
    // la RELECTURA de adentro y el INSERT. Inyectado antes, la relectura del
    // grupo lo ve y corta con `M.changed`, que es la carrera del `it` de abajo.
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    fake.state.beforeFirstPaymentCreate = () => {
      fake.state.payments.push({ id: 41, memberId: 192, type: "debit", amount: "18000.00", status: "applied", mpPaymentId: "mp-18k", preapprovalId: null, splitOfPaymentId: null, paidAt: PAID_AT });
    };
    const r = await svcOn(fake).registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne });
    expect(r).toEqual({ kind: "already_processed", paymentId: 41 });
    expect(fake.state.receipts).toHaveLength(0);
    expect(fake.state.seq).toBe(0);
  });

  it("carrera con el devengo: el unique (socio, período) recalcula y reintenta UNA vez, sin huecos", async () => {
    // Hugo está al día: sus dos cuotas se CREAN; el cron materializa una en el medio.
    const fake = splitFakeDb({ members: [hugo, monica], fees: pending(193, ["2026-08"], 3), rows: [row()] });
    fake.state.beforeTransaction = () => {
      fake.state.fees.push({ id: 50, memberId: 192, period: "2026-09", status: "pending", origin: "accrual", paymentId: null });
    };
    const r = await svcOn(fake).registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne });
    if (r.kind !== "registered") throw new Error(r.kind);
    expect(r.parts[0].periods).toEqual(["2026-09", "2026-10"]);
    expect(fake.state.receipts.map((x) => x.number)).toEqual(["2026-00001", "2026-00002"]);
    expect(fake.state.log.filter((e) => e === "rollback")).toHaveLength(1);
  });

  it("la fila se resolvió entre la foto y el lock: nada escrito", async () => {
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    fake.state.beforeTransaction = () => { fake.state.rows[0].status = "dismissed"; };
    await expect(svcOn(fake).registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne })).rejects.toThrow(M.rowResolved);
    expect(fake.state.payments).toHaveLength(0);
    expect(fake.state.seq).toBe(0);
  });

  it("el grupo cambió entre la foto y el lock (otro reparto): 'cambió mientras' y rollback", async () => {
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    fake.state.beforeTransaction = () => {
      fake.state.payments.push({ id: 41, memberId: 192, type: "link", amount: "6000.00", status: "applied", mpPaymentId: "mp-18k", preapprovalId: null, splitOfPaymentId: null, paidAt: PAID_AT });
      fake.state.rows[0].status = "partial";
      fake.state.rows[0].paymentId = 41;
    };
    await expect(svcOn(fake).registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne })).rejects.toThrow(M.changed);
    expect(fake.state.payments).toHaveLength(1);
    expect(fake.state.seq).toBe(0);
    expect(fake.state.fees.every((f) => f.status === "pending")).toBe(true);
  });

  // El `where` de la fila y el control del `count` son la red de ÚLTIMA
  // instancia: en producción el `FOR UPDATE` hace imposible que la fila cambie
  // entre la relectura y el UPDATE, así que sin este `it` las dos guardas se
  // podían borrar con la suite entera en verde (se verificó por mutación: sin
  // él, quitar el filtro de status o el chequeo de `count` no pone nada en
  // rojo). Lo que se fija es que fallen CERRADAS si el lock no alcanzara.
  it("la fila cambió entre la relectura y el UPDATE: cuenta cero, 'cambió mientras' y ni un número", async () => {
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    fake.state.beforeFirstPaymentCreate = () => { fake.state.rows[0].status = "dismissed"; };
    await expect(svcOn(fake).registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne })).rejects.toThrow(M.changed);
    expect(fake.state.payments).toHaveLength(0);
    expect(fake.state.receipts).toHaveLength(0);
    expect(fake.state.seq).toBe(0);
    expect(fake.state.fees.every((f) => f.status === "pending")).toBe(true);
  });

  it("un TreasuryError del reparto es TreasuryError (la action lo muestra tal cual)", async () => {
    const svc = svcOn(splitFakeDb({ members: [], fees: [], rows: [] }));
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne })).rejects.toBeInstanceOf(TreasuryError);
  });
});
