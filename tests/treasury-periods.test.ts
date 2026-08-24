import { describe, expect, it } from "vitest";
import {
  addMonths, comparePeriods, currentPeriod, isLastCivilDayOfMonth, isPeriod, lastPeriodsOfYear,
  periodLabel, periodOf, periodRange,
} from "@/lib/treasury/periods";

describe("periods", () => {
  it("periodOf usa la zona de Argentina, no UTC", () => {
    // 01/09/2026 01:30 UTC es todavía 31/08 en Argentina (UTC-3).
    expect(periodOf(new Date("2026-09-01T01:30:00Z"))).toBe("2026-08");
    expect(periodOf(new Date("2026-09-01T03:30:00Z"))).toBe("2026-09");
  });

  it("currentPeriod acepta un reloj inyectado", () => {
    expect(currentPeriod(new Date("2026-08-21T15:00:00Z"))).toBe("2026-08");
  });

  it("addMonths cruza el año en los dos sentidos", () => {
    expect(addMonths("2025-11", 3)).toBe("2026-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-05", 0)).toBe("2026-05");
  });

  it("comparePeriods ordena cronológicamente", () => {
    expect(comparePeriods("2025-12", "2026-01")).toBeLessThan(0);
    expect(comparePeriods("2026-01", "2026-01")).toBe(0);
    expect(["2026-03", "2025-11", "2026-01"].sort(comparePeriods)).toEqual(["2025-11", "2026-01", "2026-03"]);
  });

  it("periodRange es inclusivo", () => {
    expect(periodRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(periodRange("2026-02", "2025-11")).toEqual([]);
  });

  it("periodLabel en castellano y minúsculas", () => {
    expect(periodLabel("2025-03")).toBe("marzo 2025");
    expect(periodLabel("2026-09")).toBe("septiembre 2026");
  });

  it("lastPeriodsOfYear devuelve los últimos n meses del año", () => {
    expect(lastPeriodsOfYear(2025, 8)).toEqual([
      "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    ]);
    expect(lastPeriodsOfYear(2024, 3)).toEqual(["2024-10", "2024-11", "2024-12"]);
    expect(lastPeriodsOfYear(2023, 0)).toEqual([]);
  });

  it("isPeriod valida forma y mes", () => {
    expect(isPeriod("2026-08")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("26-08")).toBe(false);
  });
});

describe("isLastCivilDayOfMonth", () => {
  it("el 30/09 a las 10:00 AR es el último día de septiembre", () => {
    expect(isLastCivilDayOfMonth(new Date("2026-09-30T13:00:00Z"))).toBe(true);
  });
  it("el 29/09 no", () => {
    expect(isLastCivilDayOfMonth(new Date("2026-09-29T13:00:00Z"))).toBe(false);
  });
  it("febrero avisa el 28 (y el 29 en bisiesto): el aviso no se salta un mes", () => {
    expect(isLastCivilDayOfMonth(new Date("2027-02-28T13:00:00Z"))).toBe(true);
    expect(isLastCivilDayOfMonth(new Date("2028-02-29T13:00:00Z"))).toBe(true);
    expect(isLastCivilDayOfMonth(new Date("2028-02-28T13:00:00Z"))).toBe(false);
  });
  it("el 31/12 a las 22:00 AR sigue siendo el último día de diciembre, aunque en UTC ya sea enero", () => {
    expect(isLastCivilDayOfMonth(new Date("2027-01-01T01:00:00Z"))).toBe(true);
  });
});
