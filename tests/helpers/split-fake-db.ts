import { vi } from "vitest";

export type FakeMember = {
  id: number; fullName: string; category: string; status: string; joinedAt: Date; email?: string | null;
};
export type FakeFee = {
  id: number; memberId: number; period: string; status: string; origin: string; paymentId: number | null;
};
export type FakeRow = Record<string, unknown> & {
  id: number; mpPaymentId: string; amount: string; paidAt: Date; preapprovalId: string | null;
  status: string; paymentId: number | null;
};
export type FakeExemption = {
  id: number; memberId: number; fromPeriod: string; toPeriod: string; months: number; minuteId: number;
  minute: { type: string; number: number }; note: string | null; revokedAt: Date | null;
};
type Row = Record<string, unknown> & { id: number };
type StatusCond = string | { in: string[] } | undefined;
type FeeWhere = { memberId: number; period: { in: string[] }; paymentId?: number; status?: string };

// La forma REAL del P2002 con el adapter de MariaDB (medida en
// `tests/integration/unique-violation.test.ts`): el índice viaja en
// `driverAdapterError`, no en `meta.target`.
export function p2002(index: string): Error {
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

function statusMatches(value: unknown, cond: StatusCond): boolean {
  if (cond === undefined) return true;
  if (typeof cond === "string") return value === cond;
  return cond.in.includes(value as string);
}

export function splitFakeDb(opts: {
  members: FakeMember[];
  fees: FakeFee[];
  rows: FakeRow[];
  payments?: Row[];
  exemptions?: FakeExemption[];
  readmittedAt?: Record<number, Date>;
}) {
  const state = {
    fees: opts.fees.map((f) => ({ ...f })),
    payments: (opts.payments ?? []).map((p) => ({ ...p })),
    receipts: [] as Row[],
    rows: opts.rows.map((r) => ({ ...r })),
    seq: 0,
    /** Bitácora de orden: "start"/"end" del $transaction, "lock" (FOR UPDATE),
     *  "row-update", "seq" (número pedido), "receipt". */
    log: [] as string[],
    /** Gancho para simular OTRO escritor entre la foto y la transacción. */
    beforeTransaction: null as null | (() => void),
    /** Gancho para simular otro escritor entre la RELECTURA de adentro y el
     *  primer INSERT: la única ventana en la que el unique del portador puede
     *  chocar (spec 2026-09-10 §5.2 paso 5). Con `beforeTransaction` no se llega
     *  nunca, porque la relectura del grupo ve al portador y corta antes con
     *  "cambió mientras lo repartías". */
    beforeFirstPaymentCreate: null as null | (() => void),
    /** Lo que escribió ESE otro escritor. Su transacción commiteó aparte, así
     *  que el rollback de la NUESTRA no se lo lleva: sin esto, el catch busca al
     *  ganador por `mpPaymentId` y no lo encuentra. */
    committedElsewhere: [] as Row[],
  };
  const memberOf = (id: unknown) => opts.members.find((m) => m.id === id) ?? null;
  const receiptWithPayment = (r: Row) => {
    const payment = state.payments.find((p) => p.id === r.paymentId)!;
    const m = memberOf(payment.memberId);
    return {
      ...r,
      payment: {
        ...payment,
        fees: state.fees.filter((f) => f.paymentId === payment.id),
        member: m ? { ...m, memberships: [] } : null,
        application: null,
        splitParts: state.payments.filter((p) => p.splitOfPaymentId === payment.id).map((p) => ({ id: p.id })),
      },
    };
  };
  const tx = {
    member: {
      findUnique: vi.fn(async (a: { where: { id: number } }) => memberOf(a.where.id)),
    },
    movement: {
      findFirst: vi.fn(async (a: { where: { memberId: number } }) => {
        const d = opts.readmittedAt?.[a.where.memberId];
        return d ? { date: d } : null;
      }),
    },
    feeExemption: {
      findFirst: vi.fn(async (a: { where: { memberId: number; revokedAt: null; toPeriod: { gte: string } } }) =>
        (opts.exemptions ?? []).find((e) =>
          e.memberId === a.where.memberId && e.revokedAt === null && e.toPeriod >= a.where.toPeriod.gte) ?? null),
    },
    fee: {
      findMany: vi.fn(async (a: { where: { memberId: number } }) =>
        state.fees.filter((f) => f.memberId === a.where.memberId)),
      count: vi.fn(async (a: { where: { memberId: number; status?: string } }) =>
        state.fees.filter((f) => f.memberId === a.where.memberId && statusMatches(f.status, a.where.status)).length),
      updateMany: vi.fn(async (a: { where: FeeWhere; data: Record<string, unknown> }) => {
        let count = 0;
        for (const f of state.fees) {
          if (f.memberId !== a.where.memberId) continue;
          if (!a.where.period.in.includes(f.period)) continue;
          if (a.where.paymentId !== undefined && f.paymentId !== a.where.paymentId) continue;
          if (a.where.status !== undefined && f.status !== a.where.status) continue;
          Object.assign(f, a.data);
          count++;
        }
        return { count };
      }),
      createMany: vi.fn(async (a: { data: Array<Omit<FakeFee, "id">> }) => {
        for (const d of a.data) {
          if (state.fees.some((f) => f.memberId === d.memberId && f.period === d.period)) {
            throw p2002("fees_member_id_period_key");
          }
        }
        for (const d of a.data) state.fees.push({ id: state.fees.length + 1, ...d });
        return { count: a.data.length };
      }),
      deleteMany: vi.fn(async (a: { where: { id: { in: number[] } } }) => {
        const before = state.fees.length;
        state.fees = state.fees.filter((f) => !a.where.id.in.includes(f.id));
        return { count: before - state.fees.length };
      }),
    },
    payment: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        if (state.beforeFirstPaymentCreate) {
          const before = state.payments.length;
          state.beforeFirstPaymentCreate();
          state.beforeFirstPaymentCreate = null;
          for (const p of state.payments.slice(before)) state.committedElsewhere.push(p);
        }
        const mpId = a.data.mpPaymentId;
        if (mpId && state.payments.some((p) => p.mpPaymentId === mpId)) throw p2002("payments_mp_payment_id_key");
        const p = { id: state.payments.length + 1, ...a.data };
        state.payments.push(p);
        return p;
      }),
      findUnique: vi.fn(async (a: { where: { mpPaymentId?: string; id?: number } }) =>
        state.payments.find((p) => (
          a.where.mpPaymentId !== undefined ? p.mpPaymentId === a.where.mpPaymentId : p.id === a.where.id
        )) ?? null),
      findMany: vi.fn(async (a: {
        where: { splitOfPaymentId?: number; status?: string; OR?: Array<{ id?: number; splitOfPaymentId?: number }> };
      }) =>
        state.payments.filter((p) => {
          if (a.where.OR && !a.where.OR.some((c) =>
            (c.id !== undefined && p.id === c.id)
            || (c.splitOfPaymentId !== undefined && p.splitOfPaymentId === c.splitOfPaymentId))) return false;
          if (a.where.splitOfPaymentId !== undefined && p.splitOfPaymentId !== a.where.splitOfPaymentId) return false;
          if (a.where.status !== undefined && p.status !== a.where.status) return false;
          return true;
        }).sort((x, y) => x.id - y.id)),
      update: vi.fn(async (a: { where: { id: number }; data: Record<string, unknown> }) => {
        const p = state.payments.find((x) => x.id === a.where.id)!;
        Object.assign(p, a.data);
        return p;
      }),
    },
    mpUnmatchedPayment: {
      findUnique: vi.fn(async (a: { where: { id?: number; mpPaymentId?: string } }) =>
        state.rows.find((r) => (a.where.id !== undefined ? r.id === a.where.id : r.mpPaymentId === a.where.mpPaymentId)) ?? null),
      updateMany: vi.fn(async (a: {
        where: { id?: number; paymentId?: number | null; mpPaymentId?: string; status?: StatusCond };
        data: Record<string, unknown>;
      }) => {
        state.log.push("row-update");
        let count = 0;
        for (const r of state.rows) {
          if (a.where.id !== undefined && r.id !== a.where.id) continue;
          if (a.where.paymentId !== undefined && r.paymentId !== a.where.paymentId) continue;
          if (a.where.mpPaymentId !== undefined && r.mpPaymentId !== a.where.mpPaymentId) continue;
          if (!statusMatches(r.status, a.where.status)) continue;
          Object.assign(r, a.data);
          count++;
        }
        return { count };
      }),
    },
    receipt: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        state.log.push("receipt");
        const r = { id: state.receipts.length + 1, ...a.data };
        state.receipts.push(r);
        return r;
      }),
      findUnique: vi.fn(async (a: { where: { id: number } }) => {
        const r = state.receipts.find((x) => x.id === a.where.id);
        return r ? receiptWithPayment(r) : null;
      }),
      findFirst: vi.fn(async (a: { where: { payment?: { mpPaymentId: string }; paymentId?: number } }) => {
        const pid = a.where.paymentId
          ?? state.payments.find((x) => x.mpPaymentId === a.where.payment?.mpPaymentId)?.id;
        const r = pid === undefined ? undefined : state.receipts.find((x) => x.paymentId === pid);
        return r ? receiptWithPayment(r) : null;
      }),
      update: vi.fn(async (a: { where: { id: number }; data: Record<string, unknown> }) => {
        const r = state.receipts.find((x) => x.id === a.where.id)!;
        Object.assign(r, a.data);
        return r;
      }),
    },
    $executeRaw: vi.fn(async () => { state.seq++; state.log.push("seq"); return 1; }),
    $queryRaw: vi.fn(async () => { state.log.push("lock"); return []; }),
    receiptSequence: {
      findUniqueOrThrow: vi.fn(async (a: { where: { year: number } }) => ({ year: a.where.year, last: state.seq })),
    },
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      state.beforeTransaction?.();
      state.beforeTransaction = null;
      // Foto para el rollback: una transacción que falla no deja NADA escrito,
      // incluida la fila de la bandeja y el número de la serie.
      const snapshot = {
        fees: state.fees.map((f) => ({ ...f })),
        payments: state.payments.map((p) => ({ ...p })),
        receipts: state.receipts.map((r) => ({ ...r })),
        rows: state.rows.map((r) => ({ ...r })),
        seq: state.seq,
      };
      state.log.push("start");
      try {
        const result = await fn(tx);
        state.log.push("end");
        return result;
      } catch (e) {
        state.fees = snapshot.fees;
        // Lo de OTRO escritor sobrevive: commiteó en su propia transacción.
        state.payments = [...snapshot.payments, ...state.committedElsewhere];
        state.receipts = snapshot.receipts;
        state.rows = snapshot.rows;
        state.seq = snapshot.seq;
        state.log.push("rollback");
        throw e;
      }
    }),
  };
  return { db: db as never, mocks: db, state };
}
