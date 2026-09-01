import { beforeEach, describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeTreasuryService, TreasuryError } from "@/lib/treasury/service";

type Fee = { id: number; memberId: number; period: string; status: string; origin: string; paymentId: number | null };
type Row = Record<string, unknown> & { id: number };
type FeeWhere = { memberId: number; period: { in: string[] }; paymentId?: number; status?: string };

// Un P2002 con la forma que produce DE VERDAD el adapter de MariaDB de Prisma 7
// (medido contra la base local, ver `tests/integration/unique-violation.test.ts`):
// NO trae `meta.target` —eso es del motor clásico— sino el nombre del índice
// adentro de `driverAdapterError`. El fake tiene que emitirlo así o los tests
// prueban una forma que en producción no existe.
function p2002(index: string): Error {
  return Object.assign(new Error(`Duplicate entry for key '${index}'`), {
    code: "P2002",
    meta: {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: { kind: "UniqueConstraintViolation", constraint: { index } },
      },
    },
  });
}

function fakeDb(opts: {
  member: Record<string, unknown>;
  fees: Fee[];
  application?: Record<string, unknown>;
  /** Fecha del acta del reingreso más nuevo, o `null` si nunca reingresó. Entra
   *  en el piso de cobertura y NO se puede derivar de `joinedAt`, que el
   *  reingreso deliberadamente no toca (REG-11). */
  readmittedAt?: Date | null;
}) {
  const state = {
    fees: opts.fees.map((f) => ({ ...f })),
    payments: [] as Row[],
    receipts: [] as Row[],
    seq: 0,
    // Los `where` de cada updateMany sobre cuotas, para poder afirmar CON QUÉ se
    // acotó el UPDATE y no solo qué quedó en la tabla.
    feeUpdateWheres: [] as FeeWhere[],
    // Bitácora de orden para poder probar que el cierre de la bandeja de sin
    // conciliar ocurre DENTRO de `$transaction` y no después: "start"/"end" los
    // empuja el `$transaction` del fake al entrar/salir del callback, "update" lo
    // empuja `mpUnmatchedPayment.updateMany` cuando corre. Si el update quedara
    // fuera de la transacción (antes del "start" o después del "end"), el test
    // que lee esta bitácora lo detecta; con `db`/`tx` compartiendo el mismo
    // espía, sólo el orden distingue adentro de afuera.
    unmatchedUpdates: [] as string[],
    // Gancho para simular que otra operación tocó la tabla entre la foto que lee
    // el servicio y las escrituras de su transacción.
    beforeTransaction: null as null | (() => void),
  };
  // Un recibo con su pago expandido, como el `include`/`select` de Prisma: sin
  // `memberId` el pago no trae socio, `application` sólo viene si cuelga de una
  // solicitud, y las cuotas y el `status` del pago se leen VIVOS de `state` (una
  // anulación anterior tiene que verse acá, como la vería la base).
  const receiptWithPayment = (r: Row) => {
    const payment = state.payments.find((p) => p.id === r.paymentId)!;
    return {
      ...r,
      payment: {
        ...payment,
        fees: state.fees.filter((f) => f.paymentId === payment.id),
        member: payment.memberId != null ? opts.member : null,
        application: payment.applicationId != null ? (opts.application ?? null) : null,
      },
    };
  };
  const tx = {
    member: { findUnique: vi.fn(async () => opts.member) },
    movement: {
      findFirst: vi.fn(async () => (opts.readmittedAt ? { date: opts.readmittedAt } : null)),
    },
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
        // Unique de (member_id, period), como la base: si el cron de devengo
        // materializó el período entre la foto que leyó el servicio y este
        // INSERT, choca. Sin esto la carrera de la 4C sólo se podía simular
        // pisando el `$transaction`, y el primer intento nunca entraba a correr.
        for (const d of args.data) {
          if (state.fees.some((f) => f.memberId === d.memberId && f.period === d.period)) {
            throw p2002("fees_member_id_period_key");
          }
        }
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
          throw p2002("payments_mp_payment_id_key");
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
      updateMany: vi.fn(async () => {
        state.unmatchedUpdates.push("update");
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
        return r ? receiptWithPayment(r) : null;
      }),
      // `refundPayment` no conoce el id local: llega desde el webhook con el id
      // del cobro de Mercado Pago y busca el recibo por el pago. El fake resuelve
      // el `where` anidado como Prisma —del pago hacia el recibo— y devuelve la
      // misma forma que `findUnique`, así que trae `payment.status` vivo: sin eso
      // la idempotencia (un pago ya revertido) no sería asertable.
      findFirst: vi.fn(async (args: { where: { payment: { mpPaymentId: string } } }) => {
        const p = state.payments.find((x) => x.mpPaymentId === args.where.payment.mpPaymentId);
        if (!p) return null;
        const r = state.receipts.find((x) => x.paymentId === p.id);
        return r ? receiptWithPayment(r) : null;
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
      // Foto para revertir: una transacción que falla no deja NADA escrito. Sin
      // esto el fake conservaba el pago del intento perdido, y la rama de
      // idempotencia por `mpPaymentId` lo encontraba después como si fuera un
      // ganador que nunca existió. Se toma DESPUÉS de `beforeTransaction`: esa
      // escritura es de OTRO actor (el cron de devengo, otra transacción) y
      // sobrevive al rollback, igual que en la base.
      const snapshot = {
        fees: state.fees.map((f) => ({ ...f })),
        payments: state.payments.map((p) => ({ ...p })),
        receipts: state.receipts.map((r) => ({ ...r })),
        seq: state.seq,
      };
      state.unmatchedUpdates.push("start");
      try {
        const result = await fn(tx);
        state.unmatchedUpdates.push("end");
        return result;
      } catch (e) {
        state.fees = snapshot.fees;
        state.payments = snapshot.payments;
        state.receipts = snapshot.receipts;
        state.seq = snapshot.seq;
        throw e;
      }
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
// Socio del padrón: `joinedAt` muy anterior a la foto de deuda, así que su piso
// de cobertura es el de la foto (2026-09). Las altas posteriores al padrón se
// arman pisando `joinedAt` en el test que las necesita.
const active = (id: number) => ({
  id, fullName: "Socio", category: "active", status: "active",
  joinedAt: civilDateUtc(1998, 3, 12),
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

  it("un socio al día crea la cuota del PISO de cobertura, no la del mes calendario", async () => {
    const { db, state } = fakeDb({ member: { ...active(2), category: "collaborator" }, fees: [] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 2, actorId: 1, concept: "fees", count: 1 });
    expect(r.periods).toEqual(["2026-09"]);
    expect(r.amount).toBe(3000);
    expect(state.fees[0]).toMatchObject({ period: "2026-09", status: "paid", origin: "accrual", paymentId: 1 });
  });

  // El bug del 23/08/2026 en producción: un socio del padrón SIN filas está
  // cubierto hasta agosto (la foto de deuda contó los impagos hasta ahí), y el
  // sistema le cobró agosto de nuevo porque `allocate` arrancaba en el mes
  // calendario. Cobrando el 23/08 la primera cuota que puede crear es septiembre.
  it("Rodrigo: cobro del 23/08 a un socio al día → septiembre, no agosto", async () => {
    const { db, state } = fakeDb({ member: active(15), fees: [] });
    const svc = makeTreasuryService({
      db, feeValues, renderPdf, writePdf, now: () => new Date("2026-08-23T18:00:00Z"),
    });
    const r = await svc.registerCashPayment({ memberId: 15, actorId: 1, concept: "fees", count: 1 });
    expect(r.periods).toEqual(["2026-09"]);
    expect(state.receipts[0]).toMatchObject({ concept: "Cuota social · septiembre 2026" });
  });

  // El piso puede quedar ANTERIOR al mes en curso, y tiene que quedar: en
  // octubre, septiembre ya venció y es lo primero que hay que cubrir.
  it("Roberto en octubre: sin filas y sin haber pagado septiembre → septiembre primero", async () => {
    const { db } = fakeDb({ member: active(274), fees: [] });
    const svc = makeTreasuryService({
      db, feeValues, renderPdf, writePdf, now: () => new Date("2026-10-05T18:00:00Z"),
    });
    const r = await svc.registerCashPayment({ memberId: 274, actorId: 1, concept: "fees", count: 2 });
    expect(r.periods).toEqual(["2026-09", "2026-10"]);
  });

  // Un alta posterior al padrón: la cuota de ingreso cubre el mes de alta
  // (REG-14), así que su primera cuota mensual es la del mes siguiente.
  it("alta de noviembre: el primer pago cubre diciembre, no septiembre", async () => {
    const { db } = fakeDb({
      member: { ...active(307), joinedAt: civilDateUtc(2026, 11, 4) },
      fees: [],
    });
    const svc = makeTreasuryService({
      db, feeValues, renderPdf, writePdf, now: () => new Date("2026-11-20T18:00:00Z"),
    });
    const r = await svc.registerCashPayment({ memberId: 307, actorId: 1, concept: "fees", count: 1 });
    expect(r.periods).toEqual(["2026-12"]);
  });

  // Reingreso: `joinedAt` no se toca (REG-11), así que el piso sale del
  // `Movement` de reingreso. Sin él se le crearían septiembre y octubre, meses
  // en los que no fue socio.
  it("reingreso de noviembre: salda la deuda congelada y la cuota nueva es diciembre", async () => {
    const { db } = fakeDb({
      member: active(88),
      readmittedAt: civilDateUtc(2026, 11, 18),
      fees: [
        { id: 1, memberId: 88, period: "2025-04", status: "pending", origin: "import", paymentId: null },
        { id: 2, memberId: 88, period: "2025-05", status: "pending", origin: "import", paymentId: null },
      ],
    });
    const svc = makeTreasuryService({
      db, feeValues, renderPdf, writePdf, now: () => new Date("2026-11-20T18:00:00Z"),
    });
    const r = await svc.registerCashPayment({ memberId: 88, actorId: 1, concept: "fees", count: 3 });
    expect(r.periods).toEqual(["2025-04", "2025-05", "2026-12"]);
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
    // Camino del socio: la clave ni siquiera existe, el flag es aditivo (spec 2026-09-01 §6.4).
    expect((await svc.receiptPdfData(r.receiptId)).admissionPending).toBeUndefined();
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
    const svc = makeTreasuryService({ db: db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 6000, paidAt, mpPaymentId: "778", actorId: null });
    expect(r.kind === "registered" && r.periods).toEqual(["2025-11"]);
    expect(state.fees.find((f) => f.period === "2025-11")?.status).toBe("paid");
  });

  it("mismo mpPaymentId dos veces → already_processed sin segundo recibo (consulta previa)", async () => {
    const { db, state } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
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
    const svc = makeTreasuryService({ db: db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
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
    const svc = makeTreasuryService({ db: a.db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: 1, type: "link", n: 3, amount: 9000, paidAt, mpPaymentId: "1", actorId: null });
    expect(r.kind === "registered" && r.periods).toEqual(["2025-07", "2025-08"]);
    expect(a.state.fees).toHaveLength(2);
    const b = fakeDb({ member: withdrawn, fees: [] });
    const svc2 = makeTreasuryService({ db: b.db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    expect(await svc2.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "2", actorId: null }))
      .toEqual({ kind: "no_pending_withdrawn" });
    expect(b.state.payments).toHaveLength(0);
  });

  it("la serie sale del día civil AR de paidAt: cobro del 31/12 23:30 AR es del año viejo", async () => {
    const { db, mocks, state } = fakeDb({ member, fees: [] });
    mocks.receiptSequence.findUniqueOrThrow.mockImplementation(
      async (args: { where: { year: number } }) => ({ year: args.where.year, last: 1 }));
    const svc = makeTreasuryService({ db: db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({
      memberId: 1, type: "debit", n: 1, amount: 3000, paidAt: new Date("2027-01-01T02:30:00Z"), mpPaymentId: "3", actorId: null,
    });
    expect(r.kind === "registered" && r.number.startsWith("2026-")).toBe(true);
    expect(state.receipts[0].year).toBe(2026);
  });

  it("entry: n=0, sin socio, cuelga de la solicitud; concepto de cuota de ingreso", async () => {
    const { db, state } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
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
    const { db, mocks, state } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "777", actorId: null });
    expect(mocks.mpUnmatchedPayment.updateMany).toHaveBeenCalledWith({
      where: { mpPaymentId: "777", status: "open" },
      data: { status: "matched", paymentId: 1, resolvedAt: expect.any(Date) },
    });
    // No alcanza con que se haya llamado: si el update corriera FUERA del
    // `$transaction` (por ejemplo, después del commit), un fallo posterior
    // dejaría la bandeja cerrada contra un pago que nunca se asentó. `db` y `tx`
    // comparten el mismo espía de `mpUnmatchedPayment`, así que sólo el ORDEN de
    // esta bitácora distingue adentro de afuera.
    expect(state.unmatchedUpdates).toEqual(["start", "update", "end"]);
  });

  it("monto menor o igual a cero, o por encima del techo, es TreasuryError", async () => {
    const { db } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues });
    await expect(svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 0, paidAt, actorId: null }))
      .rejects.toThrow(TreasuryError);
    await expect(svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 100_000_000, paidAt, actorId: null }))
      .rejects.toThrow(TreasuryError);
  });

  // Antes de este chequeo, un llamador que mandara `n` para un tipo que no
  // imputa cuotas (entry/voluntary/extraordinary) se asentaba con CERO cuotas
  // imputadas y sin error: un bug del llamador, silencioso, en un camino de
  // plata. Ahora es ruidoso.
  it("un tipo que no imputa cuotas con n distinto de 0 es TreasuryError, no un recorte silencioso", async () => {
    const { db: dbEntry, state: stateEntry } = fakeDb({ member, fees: [] });
    const svcEntry = makeTreasuryService({ db: dbEntry as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    await expect(svcEntry.registerPayment({
      memberId: null, applicationId: 9, type: "entry", n: 3, amount: 6000, paidAt, actorId: null,
    })).rejects.toThrow(/no imputa cuotas/);
    expect(stateEntry.payments).toHaveLength(0);

    const { db: dbVol } = fakeDb({ member, fees: [] });
    const svcVol = makeTreasuryService({ db: dbVol as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    await expect(svcVol.registerPayment({
      memberId: 1, type: "voluntary", n: 2, amount: 2500, paidAt, actorId: null,
    })).rejects.toThrow(TreasuryError);
  });

  // Invariante 2 (REG-33) del lado de `registerPayment`, no sólo de Efectivo:
  // el chequeo de `imputed.count` va ANTES de pedir el número, así un rollback
  // no consume serie. Simula, con el mismo gancho que usa `voidReceipt`, que
  // otra operación ya cobró la cuota entre la foto que arma `allocate` y las
  // escrituras de la transacción.
  it("invariante 2 en el registro: si la cuota cambió justo antes de la transacción, no se pierde el número", async () => {
    const { db, state } = fakeDb({
      member, fees: [{ id: 1, memberId: 1, period: "2025-11", status: "pending", origin: "import", paymentId: null }],
    });
    const svc = makeTreasuryService({ db: db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    state.beforeTransaction = () => {
      state.fees[0].status = "paid";
      state.fees[0].paymentId = 99;
    };
    await expect(svc.registerPayment({
      memberId: 1, type: "debit", n: 1, amount: 6000, paidAt, mpPaymentId: "999", actorId: null,
    })).rejects.toThrow(TreasuryError);
    // El número NO se consumió (el rollback no gasta serie) y no quedó recibo.
    expect(state.seq).toBe(0);
    expect(state.receipts).toHaveLength(0);
  });

  // El recibo de una cuota de ingreso cuelga de la solicitud, no de un socio
  // (`memberId: null`): en Prisma real el `include` de `member` da `null` ahí,
  // y `pdfDataFor` cae a `payment.application.fullName`. El fake anterior
  // devolvía `opts.member` sin condición, así que este camino era inasertable.
  it("recibo de una cuota de ingreso (memberId null) saca el nombre de la solicitud", async () => {
    const { db } = fakeDb({ member, fees: [], application: { fullName: "Juana Pérez" } });
    const svc = makeTreasuryService({ db: db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({
      memberId: null, applicationId: 9, type: "entry", n: 0, amount: 6000, paidAt, mpPaymentId: "5", actorId: null,
    });
    expect(r.kind).toBe("registered");
    if (r.kind !== "registered") return;
    const data = await svc.receiptPdfData(r.receiptId);
    expect(data.memberName).toBe("Juana Pérez");
    expect(data.memberNumber).toBeNull();
    // Sin ficha y colgado de la solicitud: el PDF lleva la leyenda de admisión pendiente (spec 2026-09-01 §6.4).
    expect(data.admissionPending).toBe(true);
  });

  // Carrera con el cron de devengo (4C): el cron corre a las 00:30 del día 1 y
  // un débito de MP puede caer en el mismo minuto. Si el cron escribe el mismo
  // período entre el `findMany` del pago y su INSERT, el unique
  // (member_id, period) mata la transacción entera con un P2002 que no es de
  // `mpPaymentId`: antes se re-lanzaba y el webhook devolvía 500 sobre un cobro
  // que MP ya había hecho.
  it("tolera el P2002 de (memberId, period): recalcula la imputación y reintenta UNA vez", async () => {
    const { db, mocks, state } = fakeDb({ member, fees: [] });
    // El devengo escribe 2026-09 DESPUÉS de que el pago leyó las cuotas (ese
    // `findMany` corre fuera de la transacción) y ANTES de su INSERT. No se pisa
    // el `$transaction`: el primer intento entra de verdad y muere en el
    // `createMany`, que es de donde sale el P2002 real.
    state.beforeTransaction = () => {
      state.fees.push({ id: 1, memberId: 1, period: "2026-09", status: "pending", origin: "accrual", paymentId: null });
    };
    const svc = makeTreasuryService({
      db: db as never, feeValues, now: () => new Date("2026-10-01T03:30:00Z"),
      renderPdf: async () => new Uint8Array(), writePdf: async () => {},
    });
    const r = await svc.registerPayment({
      memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "801", actorId: null,
    });
    expect(r.kind).toBe("registered");
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
    // La prueba de que RECALCULÓ y no repitió el plan viejo: el primer intento
    // llamó a `createMany` (y chocó); la segunda vuelta imputa la fila que ahora
    // existe con un UPDATE, así que no vuelve a llamarlo.
    expect(mocks.fee.createMany).toHaveBeenCalledTimes(1);
    expect(state.fees).toEqual([
      expect.objectContaining({ period: "2026-09", status: "paid", paymentId: 1 }),
    ]);
    // El primer intento corrió el callback de la transacción hasta el
    // `createMany` y murió ANTES de `nextReceiptSeq`, y el fake ahora revierte
    // lo que esa transacción había escrito: quedan un solo número, un solo
    // recibo y un solo pago, no dos. Que el rollback de VERDAD no gaste número
    // es lo que prueba `tests/integration/receipt-sequence.test.ts` contra
    // MariaDB; acá se afirma que el reintento no duplica escrituras.
    expect(state.seq).toBe(1);
    expect(state.receipts).toHaveLength(1);
    expect(state.payments).toHaveLength(1);
  });

  it("no reintenta dos veces: el segundo P2002 de período se propaga tal cual", async () => {
    const { db, mocks } = fakeDb({ member, fees: [] });
    mocks.$transaction.mockImplementation(async () => {
      throw p2002("fees_member_id_period_key");
    });
    const svc = makeTreasuryService({
      db: db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {},
    });
    // Lo que se propaga es el P2002, no un TreasuryError de validación: sin
    // afirmar el error concreto, cualquier throw daba verde.
    await expect(svc.registerPayment({
      memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, actorId: null,
    })).rejects.toMatchObject({ code: "P2002" });
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
  });

  // El reintento es la ÚNICA modificación al núcleo de plata de la fase 4C, y
  // tiene que estar acotado al unique de período. `mp_payment_id` es la barrera
  // de idempotencia del dinero de Mercado Pago: si su P2002 disparara el
  // reintento, el segundo intento volvería a recorrer el camino de escritura de
  // un cobro que ya está asentado.
  it("un P2002 de mp_payment_id NO dispara el reintento: se propaga en el primer intento", async () => {
    const { db, mocks } = fakeDb({ member, fees: [] });
    mocks.$transaction.mockImplementation(async () => {
      throw p2002("payments_mp_payment_id_key");
    });
    // Sin ganador en la tabla, así que la rama de idempotencia por `mpPaymentId`
    // no lo atrapa y el error llega a la guarda del reintento.
    const svc = makeTreasuryService({
      db: db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {},
    });
    await expect(svc.registerPayment({
      memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "802", actorId: null,
    })).rejects.toMatchObject({ code: "P2002" });
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });

  // Un P2002 sin metadatos reconocibles tampoco reintenta: la guarda no puede
  // asumir que "unique + socio" es la carrera del devengo.
  it("un P2002 sin metadatos no dispara el reintento", async () => {
    const { db, mocks } = fakeDb({ member, fees: [] });
    mocks.$transaction.mockImplementation(async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    });
    const svc = makeTreasuryService({
      db: db as never, feeValues, now, renderPdf: async () => new Uint8Array(), writePdf: async () => {},
    });
    await expect(svc.registerPayment({
      memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, actorId: null,
    })).rejects.toMatchObject({ code: "P2002" });
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });
});

// Reembolso o contracargo en Mercado Pago: el MISMO movimiento que la anulación
// de mostrador (mutex por socio, relectura adentro, cuotas a pendiente, futuras
// borradas, PDF con la marca ANULADO), pero sin operador detrás —`voidedById`
// null—, con el pago en `refunded` y buscando el recibo por el id del cobro de
// MP. Y la regla que 4A dejó anotada: una fila de la bandeja de sin conciliar
// nunca puede quedar apuntando a un pago anulado, así que revertir la reabre.
describe("refundPayment / reapertura de bandeja", () => {
  const member = { id: 1, category: "active", status: "active", joinedAt: civilDateUtc(2020, 1, 1), memberships: [] };
  const paidAt = new Date("2026-09-10T11:15:30Z");

  it("reembolso: Payment.refunded, recibo anulado sin actor con el motivo, cuotas a pendiente, bandeja reabierta", async () => {
    const { db, mocks, state } = fakeDb({ member, fees: [
      { id: 1, memberId: 1, period: "2025-11", status: "pending", origin: "import", paymentId: null },
    ] });
    const svc = makeTreasuryService({
      db: db as never, feeValues, now: () => new Date("2026-09-12T12:00:00Z"),
      renderPdf: async () => new Uint8Array(), writePdf: async () => {},
    });
    await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 6000, paidAt, mpPaymentId: "777", actorId: null });
    const r = await svc.refundPayment({ mpPaymentId: "777", reason: "Reembolso en Mercado Pago" });
    expect(r).toMatchObject({ kind: "refunded", paymentId: 1, periodsReverted: 1 });
    expect(state.payments[0].status).toBe("refunded");
    expect(state.receipts[0]).toMatchObject({
      voidReason: "Reembolso en Mercado Pago", voidedById: null, voidedAt: expect.any(Date),
    });
    expect(state.fees[0]).toMatchObject({ status: "pending", paymentId: null });
    expect(mocks.mpUnmatchedPayment.updateMany).toHaveBeenLastCalledWith({
      where: { paymentId: 1 }, data: { status: "open", paymentId: null, resolvedAt: null, resolvedById: null },
    });
    // La reapertura va DENTRO de la transacción que revierte, igual que el cierre
    // va dentro de la que registra: si quedara afuera y la reversión fallara, la
    // bandeja mostraría como pendiente un cobro que sigue asentado. Primera
    // terna: el registro; segunda: la reversión.
    expect(state.unmatchedUpdates).toEqual(["start", "update", "end", "start", "update", "end"]);
  });

  it("reembolso de un pago desconocido → not_found; dos veces → already_reverted", async () => {
    const { db } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({
      db: db as never, feeValues, renderPdf: async () => new Uint8Array(), writePdf: async () => {},
    });
    expect(await svc.refundPayment({ mpPaymentId: "nope", reason: "x" })).toEqual({ kind: "not_found" });
    await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 6000, paidAt, mpPaymentId: "1", actorId: null });
    await svc.refundPayment({ mpPaymentId: "1", reason: "x" });
    expect(await svc.refundPayment({ mpPaymentId: "1", reason: "x" })).toEqual({ kind: "already_reverted", status: "refunded" });
  });

  it("voidReceipt también reabre la bandeja", async () => {
    const { db, mocks } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({
      db: db as never, feeValues, renderPdf: async () => new Uint8Array(), writePdf: async () => {},
    });
    const r = await svc.registerPayment({ memberId: 1, type: "link", n: 1, amount: 6000, paidAt, mpPaymentId: "2", actorId: 5 });
    if (r.kind !== "registered") throw new Error();
    await svc.voidReceipt({ receiptId: r.receiptId, actorId: 5, reason: "error de carga" });
    expect(mocks.mpUnmatchedPayment.updateMany).toHaveBeenLastCalledWith({
      where: { paymentId: r.paymentId }, data: { status: "open", paymentId: null, resolvedAt: null, resolvedById: null },
    });
  });

  // Un recibo anulado desde el mostrador y después reembolsado en MP no puede
  // revertirse dos veces: la plata volvería a contarse como deuda una vez, pero
  // el pago ya está en `voided` y ese estado es el que ve el webhook.
  it("un pago anulado desde el mostrador devuelve already_reverted con status voided", async () => {
    const { db } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({
      db: db as never, feeValues, renderPdf: async () => new Uint8Array(), writePdf: async () => {},
    });
    const r = await svc.registerPayment({ memberId: 1, type: "link", n: 1, amount: 6000, paidAt, mpPaymentId: "3", actorId: 5 });
    if (r.kind !== "registered") throw new Error();
    await svc.voidReceipt({ receiptId: r.receiptId, actorId: 5, reason: "error de carga" });
    expect(await svc.refundPayment({ mpPaymentId: "3", reason: "Reembolso en Mercado Pago" }))
      .toEqual({ kind: "already_reverted", status: "voided" });
  });
});
