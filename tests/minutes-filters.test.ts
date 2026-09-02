import { describe, expect, it } from "vitest";
import {
  actasFilterParams, actasWhere, activeChip, groupByYear, parseActasFilters, yearOf,
} from "@/lib/minutes/filters";
import { referenceCount, referenceCountLabel } from "@/lib/minutes/references";

describe("parseActasFilters", () => {
  it("ignores garbage and trims the query", () => {
    expect(parseActasFilters({})).toEqual({ tipo: null, anio: null, q: null });
    expect(parseActasFilters({ tipo: "x", anio: "abc", q: "  " }))
      .toEqual({ tipo: null, anio: null, q: null });
    expect(parseActasFilters({ tipo: "board", anio: "2026", q: " 124 " }))
      .toEqual({ tipo: "board", anio: 2026, q: "124" });
  });

  it("takes the first value of repeated params", () => {
    expect(parseActasFilters({ tipo: ["assembly", "board"] }).tipo).toBe("assembly");
  });
});

describe("actasWhere", () => {
  it("filters the civil year via UTC bounds (dates are stored at noon UTC)", () => {
    const w = actasWhere({ tipo: null, anio: 2026, q: null }) as {
      date: { gte: Date; lt: Date };
    };
    expect(w.date.gte.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(w.date.lt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("a numeric query matches the number OR the description", () => {
    const w = actasWhere({ tipo: null, anio: null, q: "124" }) as { OR: unknown[] };
    expect(w.OR).toEqual([{ number: 124 }, { description: { contains: "124" } }]);
  });

  it("a text query only searches the description", () => {
    const w = actasWhere({ tipo: null, anio: null, q: "exención" }) as { OR: unknown[] };
    expect(w.OR).toEqual([{ description: { contains: "exención" } }]);
  });

  it("a long numeric query (a pasted DNI) never reaches the Int column", () => {
    // Minute.number es INT4: "20345678901" en la rama numérica desbordaba la
    // query entera con un 500 en vez de caer a "ninguna acta coincide".
    const w = actasWhere({ tipo: null, anio: null, q: "20345678901" }) as { OR: unknown[] };
    expect(w.OR).toEqual([{ description: { contains: "20345678901" } }]);
    const boundary = actasWhere({ tipo: null, anio: null, q: "999999999" }) as { OR: unknown[] };
    expect(boundary.OR).toEqual([
      { number: 999999999 },
      { description: { contains: "999999999" } },
    ]);
  });

  it("combines type with the rest", () => {
    expect(actasWhere({ tipo: "board", anio: null, q: null })).toEqual({ type: "board" });
  });
});

describe("activeChip", () => {
  it("chips only light up when they filter exactly what they count", () => {
    expect(activeChip({ tipo: null, anio: null, q: null })).toBe("todas");
    expect(activeChip({ tipo: "board", anio: null, q: null })).toBe("board");
    expect(activeChip({ tipo: "board", anio: 2026, q: null })).toBeNull();
    expect(activeChip({ tipo: null, anio: null, q: "algo" })).toBeNull();
  });
});

describe("groupByYear", () => {
  it("keeps the incoming order and cuts on UTC year", () => {
    const rows = [
      { date: new Date(Date.UTC(2026, 11, 31, 12)) },
      { date: new Date(Date.UTC(2026, 0, 1, 12)) },
      { date: new Date(Date.UTC(2025, 5, 1, 12)) },
    ];
    const groups = groupByYear(rows);
    expect(groups.map((g) => g.year)).toEqual([2026, 2025]);
    expect(groups[0].rows).toHaveLength(2);
    expect(yearOf(rows[2].date)).toBe(2025);
  });
});

describe("references", () => {
  it("counts the eight non-overlapping relations", () => {
    expect(referenceCount({
      movements: 2, applications: 1, feeValues: 1, booksOpened: 0, booksClosed: 1,
      processesCalled: 0, processesClosed: 1, reportsFiled: 2,
    })).toBe(8);
  });

  // Una iniciativa TRATADA por la Comisión no escribe ningún movimiento, así
  // que el acta que la respalda no tiene sombra en ninguna otra relación: sin
  // `reportsFiled` la tarjeta del acta decía "Sin asientos" teniendo uno.
  it("a minute that only backs a report is not 'Sin asientos'", () => {
    const only = {
      movements: 0, applications: 0, feeValues: 0, booksOpened: 0, booksClosed: 0,
      processesCalled: 0, processesClosed: 0, reportsFiled: 1,
    };
    expect(referenceCount(only)).toBe(1);
    expect(referenceCountLabel(referenceCount(only))).toBe("1 asiento");
  });

  it("labels in es-AR", () => {
    expect(referenceCountLabel(0)).toBe("Sin asientos");
    expect(referenceCountLabel(1)).toBe("1 asiento");
    expect(referenceCountLabel(5)).toBe("5 asientos");
  });
});

describe("actasFilterParams", () => {
  it("serializes only the active filters", () => {
    expect(actasFilterParams({ tipo: "board", anio: 2026, q: null }))
      .toEqual({ tipo: "board", anio: "2026", q: undefined });
  });
});
