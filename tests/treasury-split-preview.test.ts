import { describe, expect, it, vi } from "vitest";
// `split-messages` importa `exemptions.ts`, que evalúa el singleton de Prisma:
// sin este mock un test PURO se cae por falta de `DATABASE_URL`.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { civilDateUtc } from "@/lib/dates";
import { previewSplit, splitConfirmToken, splitPartGuards } from "@/lib/treasury/split-preview";
import { SPLIT_GUARD_MESSAGES as M } from "@/lib/treasury/split-messages";

describe("splitConfirmToken", () => {
  it("es la huella del reparto: fila, socio, concepto, cuotas e importe en centavos, ordenado por socio", () => {
    const t = splitConfirmToken(5, [
      { memberId: 193, concept: "fees", n: 1, amount: 6000 },
      { memberId: 192, concept: "fees", n: 2, amount: 12000.5 },
    ]);
    expect(t).toBe("5|192:fees:2:1200050,193:fees:1:600000");
  });
  it("cambia si cambia cualquier parte", () => {
    const a = splitConfirmToken(5, [{ memberId: 192, concept: "fees", n: 2, amount: 12000 }]);
    expect(splitConfirmToken(5, [{ memberId: 192, concept: "fees", n: 1, amount: 12000 }])).not.toBe(a);
    expect(splitConfirmToken(5, [{ memberId: 192, concept: "voluntary", n: 0, amount: 12000 }])).not.toBe(a);
    expect(splitConfirmToken(6, [{ memberId: 192, concept: "fees", n: 2, amount: 12000 }])).not.toBe(a);
  });
});

function fakeDb(opts: {
  members: Array<{ id: number; fullName: string; category: string; status: string; joinedAt: Date; memberNumber: number | null }>;
  fees: Array<{ memberId: number; period: string; status: string }>;
  exemptions?: Array<{ memberId: number; toPeriod: string; minute: { type: string; number: number } }>;
  readmittedAt?: Record<number, Date>;
}) {
  return {
    member: {
      findUnique: vi.fn(async (a: { where: { id: number } }) => {
        const m = opts.members.find((x) => x.id === a.where.id);
        if (!m) return null;
        const { memberNumber, ...rest } = m;
        return { ...rest, memberships: memberNumber === null ? [] : [{ memberNumber, book: { status: "open" } }] };
      }),
    },
    fee: {
      findMany: vi.fn(async (a: { where: { memberId: number } }) => opts.fees.filter((f) => f.memberId === a.where.memberId)),
      count: vi.fn(async (a: { where: { memberId: number; status: string } }) =>
        opts.fees.filter((f) => f.memberId === a.where.memberId && f.status === a.where.status).length),
    },
    movement: {
      findFirst: vi.fn(async (a: { where: { memberId: number } }) => {
        const d = opts.readmittedAt?.[a.where.memberId];
        return d ? { date: d } : null;
      }),
    },
    feeExemption: {
      findFirst: vi.fn(async (a: { where: { memberId: number } }) => {
        const e = (opts.exemptions ?? []).find((x) => x.memberId === a.where.memberId);
        return e ? { id: 1, fromPeriod: "2026-09", months: 4, minuteId: 3, note: null, ...e } : null;
      }),
    },
  };
}
const JOINED = civilDateUtc(2015, 3, 1);

describe("previewSplit", () => {
  it("resuelve nombre, número y el MISMO concepto que va a decir el recibo (las más viejas primero)", async () => {
    const db = fakeDb({
      members: [
        { id: 192, fullName: "Araoz Hugo", category: "active", status: "active", joinedAt: JOINED, memberNumber: 192 },
        { id: 193, fullName: "Maza Monica", category: "active", status: "active", joinedAt: JOINED, memberNumber: null },
      ],
      fees: [
        { memberId: 192, period: "2026-07", status: "pending" }, { memberId: 192, period: "2026-08", status: "pending" },
        { memberId: 192, period: "2026-06", status: "paid" },
      ],
    });
    const p = await previewSplit(db as never, [
      { memberId: 192, concept: "fees", n: 2, amount: 12000 },
      { memberId: 193, concept: "voluntary", n: 0, amount: 6000 },
    ]);
    expect(p).toEqual([
      { memberId: 192, name: "Araoz Hugo", memberNumber: 192, concept: "Cuota social · julio a agosto 2026 (2 cuotas)", amount: 12000 },
      { memberId: 193, name: "Maza Monica", memberNumber: null, concept: "Aporte voluntario", amount: 6000 },
    ]);
  });
  it("un socio al día: los períodos que se CREAN salen del piso de cobertura, con el reingreso", async () => {
    const db = fakeDb({
      members: [{ id: 7, fullName: "Vuelve Juan", category: "active", status: "active", joinedAt: civilDateUtc(2019, 1, 1), memberNumber: 7 }],
      fees: [],
      readmittedAt: { 7: civilDateUtc(2026, 10, 5) },
    });
    const p = await previewSplit(db as never, [{ memberId: 7, concept: "fees", n: 2, amount: 12000 }]);
    // `coverageFloor`: el piso es el MÁS NUEVO entre la foto del padrón (sep 2026),
    // el mes siguiente al alta y el mes siguiente al reingreso (el mes del reingreso
    // lo cubre la cuota de reingreso, REG-14). Con reingreso en octubre, noviembre.
    expect(p[0].concept).toBe("Cuota social · noviembre a diciembre 2026 (2 cuotas)");
  });
  it("un socio inexistente tira: la action ya lo filtró con splitPartGuards", async () => {
    await expect(previewSplit(fakeDb({ members: [], fees: [] }) as never, [{ memberId: 1, concept: "fees", n: 1, amount: 1 }]))
      .rejects.toThrow(M.memberGone);
  });
});

describe("splitPartGuards", () => {
  const base = { fullName: "X", joinedAt: JOINED, memberNumber: 1 };
  it("pasa con activos y conceptos de su categoría", async () => {
    const db = fakeDb({ members: [{ id: 1, category: "active", status: "active", ...base }], fees: [] });
    expect(await splitPartGuards(db as never, [{ memberId: 1, concept: "fees", n: 1, amount: 6000 }])).toBeNull();
  });
  it("adherente con cuotas, cesante con aporte, cesante con más cuotas que pendientes, exento con cuotas", async () => {
    const db = fakeDb({
      members: [
        { id: 1, category: "adherent", status: "active", ...base },
        { id: 2, category: "active", status: "withdrawn", ...base },
        { id: 3, category: "active", status: "active", ...base },
      ],
      fees: [{ memberId: 2, period: "2026-05", status: "pending" }],
      exemptions: [{ memberId: 3, toPeriod: "2026-12", minute: { type: "board", number: 124 } }],
    });
    expect(await splitPartGuards(db as never, [{ memberId: 1, concept: "fees", n: 1, amount: 1 }])).toBe(M.conceptCategory);
    expect(await splitPartGuards(db as never, [{ memberId: 2, concept: "voluntary", n: 0, amount: 1 }])).toBe(M.withdrawnConcept);
    expect(await splitPartGuards(db as never, [{ memberId: 2, concept: "fees", n: 2, amount: 1 }])).toBe(M.withdrawnCount(1));
    expect(await splitPartGuards(db as never, [{ memberId: 3, concept: "fees", n: 1, amount: 1 }])).toContain("eximido");
    expect(await splitPartGuards(db as never, [{ memberId: 3, concept: "voluntary", n: 0, amount: 1 }])).toBeNull();
    expect(await splitPartGuards(db as never, [{ memberId: 9, concept: "fees", n: 1, amount: 1 }])).toBe(M.memberGone);
  });
});
