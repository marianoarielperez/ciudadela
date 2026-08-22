import { beforeEach, describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeTreasuryService, TreasuryError } from "@/lib/treasury/service";

type Fee = { id: number; memberId: number; period: string; status: string; origin: string; paymentId: number | null };
type Row = Record<string, unknown> & { id: number };
type FeeWhere = { memberId: number; period: { in: string[] }; paymentId?: number; status?: string };

function fakeDb(opts: { member: Record<string, unknown>; fees: Fee[] }) {
  const state = {
    fees: opts.fees.map((f) => ({ ...f })),
    payments: [] as Row[],
    receipts: [] as Row[],
    seq: 0,
    // Los `where` de cada updateMany sobre cuotas, para poder afirmar CON QUÉ se
    // acotó el UPDATE y no solo qué quedó en la tabla.
    feeUpdateWheres: [] as FeeWhere[],
    // Con qué se cerraron las filas de la bandeja de sin conciliar.
    unmatchedUpdates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
    // Gancho para simular que otra operación tocó la tabla entre la foto que lee
    // el servicio y las escrituras de su transacción.
    beforeTransaction: null as null | (() => void),
  };
  const tx = {
    member: { findUnique: vi.fn(async () => opts.member) },
    fee: {
      findMany: vi.fn(async (args: { where: { memberId: number } }) =>
        state.fees.filter((f) => f.memberId === args.where.memberId)),
      updateMany: vi.fn(async (args: { where: FeeWhere; data: Record<string, unknown> }) => {
        state.feeUpdateWheres.push(args.where);
        let count = 0;
        for (const f of state.fees) {
          if (f.memberId !== args.where.memberId) continue;
          if (!args.where.period.in.includes(f.period)) continue;
          // El fake honra los filtros opcionales: si no lo hiciera, afirmar que el
          // servicio los manda no probaría nada sobre lo que hace la base.
          if (args.where.paymentId !== undefined && f.paymentId !== args.where.paymentId) continue;
          if (args.where.status !== undefined && f.status !== args.where.status) continue;
          Object.assign(f, args.data);
          count++;
        }
        return { count };
      }),
      createMany: vi.fn(async (args: { data: Array<Omit<Fee, "id">> }) => {
        for (const d of args.data) state.fees.push({ id: state.fees.length + 1, ...d });
        return { count: args.data.length };
      }),
      deleteMany: vi.fn(async (args: { where: { id: { in: number[] } } }) => {
        const before = state.fees.length;
        state.fees = state.fees.filter((f) => !args.where.id.in.includes(f.id));
        return { count: before - state.fees.length };
      }),
    },
    payment: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        // Unique de `mpPaymentId`, como la base: el segundo create del mismo
        // cobro tiene que chocar con P2002 y no crear una segunda fila.
        const mpId = args.data.mpPaymentId;
        if (mpId && state.payments.some((p) => p.mpPaymentId === mpId)) {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002", meta: { target: ["mp_payment_id"] },
          });
        }
        const p = { id: state.payments.length + 1, ...args.data };
        state.payments.push(p);
        return p;
      }),
      findUnique: vi.fn(async (args: { where: { mpPaymentId?: string; id?: number } }) =>
        state.payments.find((p) => (
          args.where.mpPaymentId ? p.mpPaymentId === args.where.mpPaymentId : p.id === args.where.id
        )) ?? null),
      update: vi.fn(async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        const p = state.payments.find((x) => x.id === args.where.id)!;
        Object.assign(p, args.data);
        return p;
      }),
    },
    mpUnmatchedPayment: {
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.unmatchedUpdates.push(args);
        return { count: 0 };
      }),
    },
    receipt: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const r = { id: state.receipts.length + 1, ...args.data };
        state.receipts.push(r);
        return r;
      }),
      findUnique: vi.fn(async (args: { where: { id: number } }) => {
        const r = state.receipts.find((x) => x.id === args.where.id);
        if (!r) return null;
        const payment = state.payments.find((p) => p.id === r.paymentId)!;
        return {
          ...r,
          payment: { ...payment, fees: state.fees.filter((f) => f.paymentId === payment.id), member: opts.member },
        };
      }),
      update: vi.fn(async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        const r = state.receipts.find((x) => x.id === args.where.id)!;
        Object.assign(r, args.data);
        return r;
      }),
    },
    $executeRaw: vi.fn(async () => { state.seq++; return 1; }),
    receiptSequence: {
      findUniqueOrThrow: vi.fn(async (args: { where: { year: number } }) => ({ year: args.where.year, last: state.seq })),
    },
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      state.beforeTransaction?.();
      state.beforeTransaction = null;
      return fn(tx);
    }),
  };
  // `db` va casteado para entrar donde se espera un PrismaClient; `mocks` es el
  // MISMO objeto sin castear, para poder afirmar sobre los espías (sobre `never`
  // no hay acceso a propiedades).
  return { db: db as never, mocks: db, state };
}

const feeValue = { id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: civilDateUtc(2026, 9, 1), minuteId: null };
const feeValues = { current: vi.fn(async () => feeValue), history: vi.fn(async () => [feeValue]) };
const renderPdf = vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]));
const writePdf = vi.fn(async () => {});
const now = () => new Date("2026-09-03T15:00:00Z");
const active = (id: number) => ({
  id, fullName: "Socio", category: "active", status: "active",
  memberships: [{ memberNumber: id, book: { status: "open" } }],
});

describe("registerCashPayment", () => {
  beforeEach(() => { renderPdf.mockClear(); writePdf.mockClear(); });

  it("imputa N cuotas a las más viejas, numera y escribe el PDF", async () => {
    const { db, state } = fakeDb({
      member: active(144),
      fees: [
        { id: 1, memberId: 144, period: "2024-10", status: "pending", origin: "import", paymentId: null },
        { id: 2, memberId: 144, period: "2024-11", status: "pending", origin: "import", paymentId: null },
        { id: 3, memberId: 144, period: "2024-12", status: "pending", origin: "import", paymentId: null },
        { id: 4, memberId: 144, period: "2025-01", status: "pending", origin: "import", paymentId: null },
      ],
    });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 144, actorId: 1, concept: "fees", count: 3 });
    expect(r.number).toBe("2026-00001");
    expect(r.periods).toEqual(["2024-10", "2024-11", "2024-12"]);
    expect(r.amount).toBe(18000);
    expect(r.pdfWritten).toBe(true);
    expect(state.fees.filter((f) => f.status === "paid").map((f) => f.period)).toEqual(["2024-10", "2024-11", "2024-12"]);
    expect(state.payments[0]).toMatchObject({ type: "cash", amount: "18000.00", registeredById: 1 });
    expect(state.receipts[0]).toMatchObject({
      number: "2026-00001", year: 2026, seq: 1, pdfPath: "2026/2026-00001.pdf", concept: "Cuota social · octubre a diciembre 2024 (3 cuotas)",
    });
    expect(writePdf).toHaveBeenCalledWith("2026/2026-00001.pdf", expect.any(Uint8Array));
    // Qué se le pasó al renderizador, no solo que se lo llamó: acá vive el
    // concepto, y sin esta afirmación el PDF puede salir vacío sin que nada falle.
    expect(renderPdf).toHaveBeenCalledWith({
      number: "2026-00001",
      issuedAt: now(),
      memberName: "Socio",
      memberNumber: 144,
      concept: "Cuota social · octubre a diciembre 2024 (3 cuotas)",
      methodLabel: "Efectivo",
      amount: 18000,
      voided: null,
    });
  });

  it("rechaza un monto que no entra en la columna", async () => {
    const { db } = fakeDb({ member: { ...active(3), category: "adherent" }, fees: [] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    await expect(svc.registerCashPayment({ memberId: 3, actorId: 1, concept: "voluntary", amount: 100_000_000 }))
      .rejects.toThrow(/máximo que admite el sistema/);
  });

  it("recorta el concepto al largo de la columna", async () => {
    // 60 cuotas no contiguas describen una lista muchísimo más larga que los 200
    // caracteres de `Receipt.concept`: el recibo se emite igual, recortado.
    const periods = Array.from({ length: 60 }, (_, i) => {
      const months = i * 2;
      return `${2010 + Math.floor(months / 12)}-${String((months % 12) + 1).padStart(2, "0")}`;
    });
    const { db, state } = fakeDb({
      member: active(9),
      fees: periods.map((period, i) => (
        { id: i + 1, memberId: 9, period, status: "pending", origin: "import", paymentId: null })),
    });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    await svc.registerCashPayment({ memberId: 9, actorId: 1, concept: "fees", count: 60 });
    const concept = state.receipts[0].concept as string;
    expect(concept).toHaveLength(200);
    expect(concept.endsWith("...")).toBe(true);
    expect(renderPdf).toHaveBeenCalledWith(expect.objectContaining({ concept }));
  });

  it("un socio al día crea la cuota del período corriente", async () => {
    const { db, state } = fakeDb({ member: { ...active(2), category: "collaborator" }, fees: [] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 2, actorId: 1, concept: "fees", count: 1 });
    expect(r.periods).toEqual(["2026-09"]);
    expect(r.amount).toBe(3000);
    expect(state.fees[0]).toMatchObject({ period: "2026-09", status: "paid", origin: "accrual", paymentId: 1 });
  });

  it("voluntaria de monto libre no toca cuotas", async () => {
    const { db, state } = fakeDb({ member: { ...active(3), category: "adherent" }, fees: [] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 3, actorId: 1, concept: "voluntary", amount: 2500 });
    expect(r.amount).toBe(2500);
    expect(r.periods).toEqual([]);
    expect(state.fees).toHaveLength(0);
    expect(state.payments[0]).toMatchObject({ type: "voluntary" });
  });

  it("rechaza cuotas para un adherente y count 0", async () => {
    const adh = fakeDb({ member: { ...active(3), category: "adherent" }, fees: [] });
    await expect(makeTreasuryService({ db: adh.db, feeValues, now, renderPdf, writePdf })
      .registerCashPayment({ memberId: 3, actorId: 1, concept: "fees", count: 1 })).rejects.toThrow(TreasuryError);
    const act = fakeDb({ member: active(4), fees: [] });
    await expect(makeTreasuryService({ db: act.db, feeValues, now, renderPdf, writePdf })
      .registerCashPayment({ memberId: 4, actorId: 1, concept: "fees", count: 0 })).rejects.toThrow(/cuotas/);
  });

  // REG-16 (Art. 9 inc. c): el cesante salda la deuda ANTES del reingreso, así
  // que Efectivo tiene que poder cobrarle sin que nadie lo readmita primero.
  it("le cobra al cesante las cuotas congeladas a valor vigente y le emite recibo", async () => {
    const { db, state } = fakeDb({
      member: { ...active(5), status: "withdrawn" },
      fees: [
        { id: 1, memberId: 5, period: "2025-03", status: "pending", origin: "import", paymentId: null },
        { id: 2, memberId: 5, period: "2025-04", status: "pending", origin: "import", paymentId: null },
        { id: 3, memberId: 5, period: "2025-05", status: "pending", origin: "import", paymentId: null },
      ],
    });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 5, actorId: 1, concept: "fees", count: 3 });
    expect(r.periods).toEqual(["2025-03", "2025-04", "2025-05"]);
    // 3 × 6000: la categoría que tenía a la baja, valuada al valor de HOY.
    expect(r.amount).toBe(18000);
    expect(r.number).toBe("2026-00001");
    expect(state.fees.every((f) => f.status === "paid")).toBe(true);
    expect(state.receipts[0]).toMatchObject({ number: "2026-00001", concept: "Cuota social · marzo a mayo 2025 (3 cuotas)" });
  });

  it("al cesante no le cobra aportes ni cuotas futuras", async () => {
    const { db } = fakeDb({
      member: { ...active(5), status: "withdrawn" },
      fees: [{ id: 1, memberId: 5, period: "2025-03", status: "pending", origin: "import", paymentId: null }],
    });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    // El aporte voluntario y el extraordinario son del que HOY es socio: se
    // rechazan, y el mensaje dice qué sí se puede cobrar.
    await expect(svc.registerCashPayment({ memberId: 5, actorId: 1, concept: "voluntary", amount: 100 }))
      .rejects.toThrow(/dado de baja: sólo se le puede cobrar la deuda de cuotas/);
    await expect(svc.registerCashPayment({ memberId: 5, actorId: 1, concept: "extraordinary", amount: 100 }))
      .rejects.toThrow(TreasuryError);
    // Y no devenga: pagar más cuotas de las pendientes crearía períodos nuevos
    // a nombre de alguien que ya no es socio.
    await expect(svc.registerCashPayment({ memberId: 5, actorId: 1, concept: "fees", count: 2 }))
      .rejects.toThrow(/1 cuota pendiente/);
  });

  it("sin valor vigente no cobra cuotas", async () => {
    const { db } = fakeDb({ member: active(4), fees: [] });
    const noValue = { current: vi.fn(async () => null), history: vi.fn(async () => []) };
    await expect(makeTreasuryService({ db, feeValues: noValue, now, renderPdf, writePdf })
      .registerCashPayment({ memberId: 4, actorId: 1, concept: "fees", count: 1 })).rejects.toThrow(/valor de cuota/);
  });

  it("si el PDF falla el recibo existe igual y se informa", async () => {
    const { db, state } = fakeDb({ member: active(4), fees: [] });
    const failingWrite = vi.fn(async () => { throw new Error("disk"); });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf: failingWrite });
    const r = await svc.registerCashPayment({ memberId: 4, actorId: 1, concept: "fees", count: 1 });
    expect(r.pdfWritten).toBe(false);
    expect(state.receipts[0]).toMatchObject({ number: "2026-00001" });
    errorLog.mockRestore();
  });
});

describe("voidReceipt", () => {
  beforeEach(() => { renderPdf.mockClear(); writePdf.mockClear(); });

  it("anula el recibo, marca el pago voided; las cuotas vuelven a pendiente y las futuras se borran", async () => {
    const { db, state } = fakeDb({ member: active(4), fees: [
      { id: 1, memberId: 4, period: "2026-08", status: "pending", origin: "accrual", paymentId: null },
    ] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 4, actorId: 1, concept: "fees", count: 3 }); // ago, sep, oct
    expect(r.periods).toEqual(["2026-08", "2026-09", "2026-10"]);
    const v = await svc.voidReceipt({ receiptId: r.receiptId, actorId: 2, reason: "Cargado por error" });
    expect(v.number).toBe("2026-00001");
    expect(v.periodsReverted).toBe(3);
    expect(state.receipts[0]).toMatchObject({ voidReason: "Cargado por error", voidedById: 2 });
    expect(state.payments[0]).toMatchObject({ status: "voided" });
    expect(state.fees.map((f) => [f.period, f.status, f.paymentId]))
      .toEqual([["2026-08", "pending", null], ["2026-09", "pending", null]]);
    // El revert se acota al pago del recibo, no solo a (socio, período).
    expect(state.feeUpdateWheres.at(-1)).toMatchObject({ memberId: 4, paymentId: r.paymentId });
  });

  it("el recibo anulado conserva el concepto que decía al emitirse", async () => {
    const { db, state } = fakeDb({ member: active(4), fees: [
      { id: 1, memberId: 4, period: "2026-08", status: "pending", origin: "accrual", paymentId: null },
    ] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 4, actorId: 1, concept: "fees", count: 3 });
    const concept = "Cuota social · agosto a octubre 2026 (3 cuotas)";
    expect(state.receipts[0]).toMatchObject({ concept });

    renderPdf.mockClear();
    await svc.voidReceipt({ receiptId: r.receiptId, actorId: 2, reason: "Cargado por error" });
    // Anular despega las cuotas del pago; el detalle tiene que sobrevivir igual.
    expect(renderPdf).toHaveBeenCalledWith(expect.objectContaining({
      number: "2026-00001", concept, voided: { reason: "Cargado por error" },
    }));
    expect(await svc.receiptPdfData(r.receiptId)).toMatchObject({ concept });
  });

  it("dos anulaciones simultáneas: solo una prospera", async () => {
    const { db, state } = fakeDb({ member: active(4), fees: [
      { id: 1, memberId: 4, period: "2026-08", status: "pending", origin: "accrual", paymentId: null },
    ] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 4, actorId: 1, concept: "fees", count: 1 });
    const outcomes = await Promise.allSettled([
      svc.voidReceipt({ receiptId: r.receiptId, actorId: 2, reason: "uno" }),
      svc.voidReceipt({ receiptId: r.receiptId, actorId: 3, reason: "dos" }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TreasuryError);
    expect(state.fees).toEqual([
      { id: 1, memberId: 4, period: "2026-08", status: "pending", origin: "accrual", paymentId: null },
    ]);
  });

  it("no devuelve a pendiente una cuota que ya se reimputó a otro pago", async () => {
    const { db, state } = fakeDb({ member: active(4), fees: [
      { id: 1, memberId: 4, period: "2026-08", status: "pending", origin: "accrual", paymentId: null },
    ] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 4, actorId: 1, concept: "fees", count: 1 });
    // Entre la foto que lee la anulación y sus escrituras, la cuota pasa a otro
    // pago (con su propio recibo válido). Pisarla dejaría plata cobrada como deuda.
    state.beforeTransaction = () => { state.fees[0].paymentId = 99; };
    const v = await svc.voidReceipt({ receiptId: r.receiptId, actorId: 2, reason: "x" });
    expect(v.periodsReverted).toBe(0);
    expect(state.fees[0]).toMatchObject({ period: "2026-08", status: "paid", paymentId: 99 });
  });

  it("receiptPdfData arma los datos y regenerateReceiptPdf reescribe el archivo", async () => {
    const { db } = fakeDb({ member: { ...active(3), category: "adherent" }, fees: [] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 3, actorId: 1, concept: "voluntary", amount: 2500 });
    expect(await svc.receiptPdfData(r.receiptId)).toEqual({
      number: "2026-00001",
      issuedAt: now(),
      memberName: "Socio",
      memberNumber: 3,
      concept: "Aporte voluntario",
      methodLabel: "Aporte voluntario",
      amount: 2500,
      voided: null,
    });
    renderPdf.mockClear();
    writePdf.mockClear();
    const bytes = await svc.regenerateReceiptPdf(r.receiptId);
    expect(renderPdf).toHaveBeenCalledWith(expect.objectContaining({ concept: "Aporte voluntario" }));
    expect(writePdf).toHaveBeenCalledWith("2026/2026-00001.pdf", bytes);
    await expect(svc.receiptPdfData(999)).rejects.toThrow(/no existe/);
  });

  it("no anula dos veces", async () => {
    const { db } = fakeDb({ member: active(4), fees: [] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 4, actorId: 1, concept: "extraordinary", amount: 500 });
    await svc.voidReceipt({ receiptId: r.receiptId, actorId: 1, reason: "x" });
    await expect(svc.voidReceipt({ receiptId: r.receiptId, actorId: 1, reason: "y" })).rejects.toThrow(/ya está anulado/);
  });
});

// El núcleo agnóstico del origen que estrena la fase 4B: lo mismo que asienta
// Efectivo, pero con el cobro que llega de Mercado Pago (su `paidAt`, su id, sin
// operador humano). Efectivo pasa a llamarlo, así que las invariantes de plata
// —número tardío y adentro de la transacción, imputación controlada, PDF después
// del commit, concepto congelado— viven en un solo lugar.
describe("registerPayment (núcleo 4B)", () => {
  const member = { id: 1, category: "adherent", status: "active", joinedAt: civilDateUtc(2020, 1, 1), memberships: [] };
  const paidAt = new Date("2026-09-10T11:15:30Z");

  it("débito de un adherente: crea y paga la cuota del período, recibo con concepto de cuota, paidAt de MP", async () => {
    const { db, state } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({
      db: db as never, feeValues, now: () => new Date("2026-09-10T12:00:00Z"),
      renderPdf: async () => new Uint8Array(), writePdf: async () => {},
    });
    const r = await svc.registerPayment({
      memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "777", preapprovalId: "pre-1", actorId: null,
    });
    expect(r.kind).toBe("registered");
    if (r.kind !== "registered") return;
    expect(r.periods).toEqual(["2026-09"]);
    expect(state.fees).toEqual([
      expect.objectContaining({ period: "2026-09", status: "paid", origin: "accrual", paymentId: 1 }),
    ]);
    expect(state.payments[0]).toMatchObject({
      type: "debit", amount: "3000.00", paidAt, mpPaymentId: "777", preapprovalId: "pre-1",
      registeredById: null, status: "applied",
    });
    expect(state.receipts[0]).toMatchObject({ concept: "Cuota social · septiembre 2026", issuedAt: paidAt, year: 2026 });
  });

  it("imputa la pendiente más vieja antes que el período corriente", async () => {
    const { db, state } = fakeDb({ member: { ...member, category: "active" }, fees: [
      { id: 1, memberId: 1, period: "2025-11", status: "pending", origin: "import", paymentId: null },
    ] });
    const svc = makeTreasuryService({ db: db as never, feeValues, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 6000, paidAt, mpPaymentId: "778", actorId: null });
    expect(r.kind === "registered" && r.periods).toEqual(["2025-11"]);
    expect(state.fees.find((f) => f.period === "2025-11")?.status).toBe("paid");
  });

  it("mismo mpPaymentId dos veces → already_processed sin segundo recibo (consulta previa)", async () => {
    const { db, state } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const input = { memberId: 1, type: "debit" as const, n: 1, amount: 3000, paidAt, mpPaymentId: "777", actorId: null };
    await svc.registerPayment(input);
    const r = await svc.registerPayment(input);
    expect(r).toEqual({ kind: "already_processed", paymentId: 1 });
    expect(state.receipts).toHaveLength(1);
    expect(state.seq).toBe(1);
  });

  it("carrera: el create choca con P2002 → already_processed y el número NO se consumió", async () => {
    const { db, mocks, state } = fakeDb({ member, fees: [] });
    // La consulta previa no ve nada (simula dos eventos en paralelo) y el
    // create choca contra la unique.
    mocks.payment.findUnique.mockResolvedValueOnce(null);
    state.payments.push({ id: 9, mpPaymentId: "777" });
    const svc = makeTreasuryService({ db: db as never, feeValues, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "777", actorId: null });
    expect(r).toEqual({ kind: "already_processed", paymentId: 9 });
    expect(state.seq).toBe(0);
    expect(state.receipts).toHaveLength(0);
  });

  it("cesante con 2 pendientes y n=3 → se acota a 2; sin pendientes → no_pending_withdrawn", async () => {
    const withdrawn = { ...member, status: "withdrawn" };
    const a = fakeDb({ member: withdrawn, fees: [
      { id: 1, memberId: 1, period: "2025-07", status: "pending", origin: "import", paymentId: null },
      { id: 2, memberId: 1, period: "2025-08", status: "pending", origin: "import", paymentId: null },
    ] });
    const svc = makeTreasuryService({ db: a.db as never, feeValues, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: 1, type: "link", n: 3, amount: 9000, paidAt, mpPaymentId: "1", actorId: null });
    expect(r.kind === "registered" && r.periods).toEqual(["2025-07", "2025-08"]);
    expect(a.state.fees).toHaveLength(2);
    const b = fakeDb({ member: withdrawn, fees: [] });
    const svc2 = makeTreasuryService({ db: b.db as never, feeValues, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    expect(await svc2.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "2", actorId: null }))
      .toEqual({ kind: "no_pending_withdrawn" });
    expect(b.state.payments).toHaveLength(0);
  });

  it("la serie sale del día civil AR de paidAt: cobro del 31/12 23:30 AR es del año viejo", async () => {
    const { db, mocks, state } = fakeDb({ member, fees: [] });
    mocks.receiptSequence.findUniqueOrThrow.mockImplementation(
      async (args: { where: { year: number } }) => ({ year: args.where.year, last: 1 }));
    const svc = makeTreasuryService({ db: db as never, feeValues, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({
      memberId: 1, type: "debit", n: 1, amount: 3000, paidAt: new Date("2027-01-01T02:30:00Z"), mpPaymentId: "3", actorId: null,
    });
    expect(r.kind === "registered" && r.number.startsWith("2026-")).toBe(true);
    expect(state.receipts[0].year).toBe(2026);
  });

  it("entry: n=0, sin socio, cuelga de la solicitud; concepto de cuota de ingreso", async () => {
    const { db, state } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({
      memberId: null, applicationId: 9, type: "entry", n: 0, amount: 6000, paidAt,
      mpPaymentId: "4", preapprovalId: "pre-9", actorId: null,
    });
    expect(r.kind).toBe("registered");
    expect(state.payments[0]).toMatchObject({ memberId: null, applicationId: 9, type: "entry" });
    expect(state.receipts[0].concept).toBe("Cuota de ingreso");
    expect(state.fees).toHaveLength(0);
  });

  it("cierra las filas de la bandeja con ese mpPaymentId dentro de la transacción", async () => {
    const { db, mocks } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "777", actorId: null });
    expect(mocks.mpUnmatchedPayment.updateMany).toHaveBeenCalledWith({
      where: { mpPaymentId: "777", status: "open" },
      data: { status: "matched", paymentId: 1, resolvedAt: expect.any(Date) },
    });
  });

  it("monto menor o igual a cero, o por encima del techo, es TreasuryError", async () => {
    const { db } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues });
    await expect(svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 0, paidAt, actorId: null }))
      .rejects.toThrow(TreasuryError);
    await expect(svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 100_000_000, paidAt, actorId: null }))
      .rejects.toThrow(TreasuryError);
  });
});
