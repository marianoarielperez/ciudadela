import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { fetchDebtors, parseDebtorFilters, rankDebtors } from "@/lib/treasury/debtors";

describe("parseDebtorFilters", () => {
  it("acepta nivel 2 o 4 y texto", () => {
    expect(parseDebtorFilters({ nivel: "4", q: " sosa " })).toEqual({ level: 4, q: "sosa" });
    expect(parseDebtorFilters({ nivel: "7" })).toEqual({});
  });
});

describe("rankDebtors", () => {
  it("ordena por cuotas adeudadas desc y luego por número", () => {
    const rows = rankDebtors([
      { memberId: 1, memberNumber: 213, fullName: "Martinez", category: "active", status: "active", pendingCount: 4, debt: 24000, level: 4, lastPaidAt: null },
      { memberId: 2, memberNumber: 144, fullName: "Skardius", category: "active", status: "active", pendingCount: 23, debt: 138000, level: 4, lastPaidAt: null },
      { memberId: 3, memberNumber: 100, fullName: "X", category: "active", status: "active", pendingCount: 4, debt: 24000, level: 4, lastPaidAt: null },
    ]);
    expect(rows.map((r) => r.memberNumber)).toEqual([144, 100, 213]);
  });
});

describe("fetchDebtors", () => {
  it("agrupa pendientes por socio vigente/suspendido y calcula deuda y nivel", async () => {
    const db = {
      fee: {
        groupBy: vi.fn(async () => [{ memberId: 1, _count: { _all: 23 } }, { memberId: 2, _count: { _all: 1 } }]),
      },
      member: {
        findMany: vi.fn(async () => [
          { id: 1, fullName: "Skardius Ana", category: "active", status: "active", memberships: [{ memberNumber: 144, book: { status: "open" } }], payments: [{ paidAt: new Date("2024-05-01T12:00:00Z") }] },
          { id: 2, fullName: "Uno", category: "collaborator", status: "suspended", memberships: [{ memberNumber: 7, book: { status: "open" } }], payments: [] },
        ]),
      },
    } as never;
    const rows = await fetchDebtors(db, {}, { activeAmount: 6000, sharedAmount: 3000 });
    expect(rows[0]).toMatchObject({ memberId: 1, memberNumber: 144, pendingCount: 23, debt: 138000, level: 4 });
    expect(rows[1]).toMatchObject({ memberId: 2, pendingCount: 1, debt: 3000, level: 1 });
  });

  it("con nivel 4 solo devuelve candidatos a cesantía", async () => {
    const db = {
      fee: { groupBy: vi.fn(async () => [{ memberId: 1, _count: { _all: 5 } }, { memberId: 2, _count: { _all: 2 } }]) },
      member: { findMany: vi.fn(async () => [
        { id: 1, fullName: "A", category: "active", status: "active", memberships: [], payments: [] },
        { id: 2, fullName: "B", category: "active", status: "active", memberships: [], payments: [] },
      ]) },
    } as never;
    const rows = await fetchDebtors(db, { level: 4 }, null);
    expect(rows.map((r) => r.memberId)).toEqual([1]);
    expect(rows[0].debt).toBeNull();
  });
});
