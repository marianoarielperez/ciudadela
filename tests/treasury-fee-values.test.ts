import { describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeFeeValueReader } from "@/lib/treasury/fee-values";

const rows = [
  { id: 1, activeAmount: "6000.00", sharedAmount: "3000.00", validFrom: civilDateUtc(2026, 9, 1), minuteId: null },
  { id: 2, activeAmount: "8000.00", sharedAmount: "4000.00", validFrom: civilDateUtc(2027, 1, 1), minuteId: 7 },
];

function db() {
  return {
    feeValue: {
      findFirst: vi.fn(async (args: { where: { validFrom: { lte: Date } } }) => {
        const at = args.where.validFrom.lte;
        const eligible = rows
          .filter((r) => r.validFrom <= at)
          .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());
        return eligible[0] ?? null;
      }),
      findMany: vi.fn(async () => [...rows].reverse()),
    },
  } as never;
}

describe("makeFeeValueReader", () => {
  it("current devuelve el de mayor validFrom <= la fecha, con montos numéricos", async () => {
    const reader = makeFeeValueReader(db());
    const v = await reader.current(civilDateUtc(2026, 10, 15));
    expect(v).toEqual({ id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: rows[0].validFrom, minuteId: null });
    const later = await reader.current(civilDateUtc(2027, 3, 1));
    expect(later?.id).toBe(2);
    expect(later?.activeAmount).toBe(8000);
  });

  it("current devuelve null si todavía no rige ninguno", async () => {
    expect(await makeFeeValueReader(db()).current(civilDateUtc(2026, 8, 1))).toBeNull();
  });

  it("history viene ordenada del más nuevo al más viejo", async () => {
    const h = await makeFeeValueReader(db()).history();
    expect(h.map((r) => r.id)).toEqual([2, 1]);
    expect(h[0].activeAmount).toBe(8000);
  });
});
