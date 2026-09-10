import { beforeEach, describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { allocateFor, readFeeContext } from "@/lib/treasury/fee-allocation";
import { allocate, coverageFloor } from "@/lib/treasury/rules";
import { makeTreasuryService } from "@/lib/treasury/service";
import { previewSplit } from "@/lib/treasury/split-preview";
import { splitFakeDb } from "./helpers/split-fake-db";

// La imputación de cuotas la comparten el núcleo que ASIENTA (`preparePart`) y
// la vista previa que el operador LEE antes de confirmar (`previewSplit`). Este
// archivo prueba la función compartida —las dos consultas y el piso de
// cobertura— y, al final, PIN de que las dos superficies dicen lo mismo: la
// vista previa y el concepto congelado en el recibo, sobre el mismo socio.

const JOINED = civilDateUtc(2015, 3, 1);

function feeDb(opts: {
  fees: Array<{ memberId: number; period: string; status: string }>;
  readmittedAt?: Record<number, Date>;
}) {
  const findMany = vi.fn(async (a: { where: { memberId: number } }) =>
    opts.fees.filter((f) => f.memberId === a.where.memberId).map((f) => ({ period: f.period, status: f.status })));
  const findFirst = vi.fn(async (a: { where: { memberId: number } }) => {
    const d = opts.readmittedAt?.[a.where.memberId];
    return d ? { date: d } : null;
  });
  return { db: { fee: { findMany }, movement: { findFirst } } as never, findMany, findFirst };
}

describe("readFeeContext", () => {
  it("son exactamente DOS consultas, y el reingreso es el más nuevo por fecha y por id", async () => {
    const f = feeDb({
      fees: [
        { memberId: 192, period: "2026-08", status: "pending" },
        { memberId: 192, period: "2026-07", status: "pending" },
        { memberId: 192, period: "2026-06", status: "paid" },
        { memberId: 999, period: "2026-06", status: "pending" },
      ],
      readmittedAt: { 192: civilDateUtc(2026, 10, 5) },
    });
    const ctx = await readFeeContext(f.db, 192);
    expect(ctx).toEqual({
      pending: ["2026-08", "2026-07"],
      existing: ["2026-08", "2026-07", "2026-06"],
      readmittedAt: civilDateUtc(2026, 10, 5),
    });
    expect(f.findMany).toHaveBeenCalledTimes(1);
    expect(f.findMany).toHaveBeenCalledWith({ where: { memberId: 192 }, select: { period: true, status: true } });
    // El `where`, el `orderBy` y el `select` del reingreso, textuales: son la
    // regla (REG-11, el reingreso más NUEVO y desde el acta), no un detalle.
    expect(f.findFirst).toHaveBeenCalledTimes(1);
    expect(f.findFirst).toHaveBeenCalledWith({
      where: { memberId: 192, type: "readmission" },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { date: true },
    });
  });

  it("sin reingreso el contexto lo dice con null, no con undefined", async () => {
    const f = feeDb({ fees: [] });
    expect(await readFeeContext(f.db, 7)).toEqual({ pending: [], existing: [], readmittedAt: null });
  });
});

describe("allocateFor", () => {
  it("es `allocate` con el PISO de cobertura: las pendientes más viejas primero", async () => {
    const f = feeDb({
      fees: [
        { memberId: 192, period: "2026-08", status: "pending" },
        { memberId: 192, period: "2026-07", status: "pending" },
        { memberId: 192, period: "2026-06", status: "paid" },
      ],
    });
    const ctx = await readFeeContext(f.db, 192);
    const got = allocateFor(ctx, { joinedAt: JOINED }, 2);
    expect(got).toEqual({ toPay: ["2026-07", "2026-08"], toCreate: [] });
    expect(got).toEqual(allocate({
      pending: ctx.pending,
      existing: ctx.existing,
      n: 2,
      startAt: coverageFloor({ joinedAt: JOINED, readmittedAt: null }),
    }));
  });

  it("con reingreso, los períodos que se CREAN arrancan el mes siguiente al acta", async () => {
    const f = feeDb({ fees: [], readmittedAt: { 7: civilDateUtc(2026, 10, 5) } });
    const ctx = await readFeeContext(f.db, 7);
    const joinedAt = civilDateUtc(2019, 1, 1);
    const got = allocateFor(ctx, { joinedAt }, 2);
    // El mes del reingreso lo cubre la cuota de reingreso (REG-14): noviembre.
    expect(got).toEqual({ toPay: ["2026-11", "2026-12"], toCreate: ["2026-11", "2026-12"] });
    expect(got).toEqual(allocate({
      pending: [],
      existing: [],
      n: 2,
      startAt: coverageFloor({ joinedAt, readmittedAt: civilDateUtc(2026, 10, 5) }),
    }));
  });
});

// ── El PIN: una sola fuente, medida en las dos puntas ────────────────────────
//
// La vista previa que el operador lee y el concepto que se congela en el recibo
// salen de la misma función. Se mide sobre el MISMO doble de base y el mismo
// socio: si alguien vuelve a copiar el bloque en una de las dos, esto se cae.

const feeValue = { id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: civilDateUtc(2026, 9, 1), minuteId: null };
const feeValues = { current: vi.fn(async () => feeValue), history: vi.fn(async () => [feeValue]) };
const NOW = new Date("2026-09-10T15:00:00Z");
const PAID_AT = new Date("2026-09-08T14:00:00Z");
// `memberships: []` porque `previewSplit` también resuelve el número del libro
// abierto y el doble devuelve el socio tal cual.
const hugo = {
  id: 192, fullName: "Araoz Hugo", category: "active", status: "active", joinedAt: JOINED, memberships: [],
};

beforeEach(() => vi.clearAllMocks());

describe("la vista previa y el recibo dicen lo MISMO", () => {
  it("mismo socio, mismas cuotas: `previewSplit` anticipa el concepto que congela el recibo", async () => {
    const fake = splitFakeDb({
      members: [hugo],
      // Debe julio y agosto; la tercera cuota se crea desde el piso, que con el
      // reingreso de octubre es noviembre.
      fees: [
        { id: 1, memberId: 192, period: "2026-07", status: "pending", origin: "import", paymentId: null },
        { id: 2, memberId: 192, period: "2026-08", status: "pending", origin: "import", paymentId: null },
      ],
      rows: [{
        id: 5, mpPaymentId: "mp-pin", amount: "18000.00", paidAt: PAID_AT, preapprovalId: null,
        status: "open", paymentId: null,
      }],
      readmittedAt: { 192: civilDateUtc(2026, 10, 5) },
    });
    const parts = [{ memberId: 192, concept: "fees" as const, n: 3, amount: 18000 }];

    // Primero la vista previa, con la base todavía intacta: es lo que el
    // operador ve antes de confirmar.
    const preview = await previewSplit(fake.db, parts);
    // El piso de cobertura con el reingreso está EJERCITADO: sin él la tercera
    // cuota sería septiembre.
    expect(preview[0].concept).toContain("noviembre");

    const svc = makeTreasuryService({
      db: fake.db, feeValues, now: () => NOW,
      renderPdf: async () => new Uint8Array([1]), writePdf: async () => {},
    });
    const r = await svc.registerSplitPayment({ rowId: 5, actorId: 9, parts });
    if (r.kind !== "registered") throw new Error(r.kind);
    expect(fake.state.receipts[0].concept).toBe(preview[0].concept);
  });
});
