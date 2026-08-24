import { describe, expect, it } from "vitest";
import { MAX_LINK_FEES } from "@/lib/mp/references";
import { upcomingPeriods } from "@/lib/treasury/upcoming";

const PADRON = new Date("2019-03-10T12:00:00Z"); // piso = IMPORT_COVERAGE_FLOOR = 2026-09

describe("upcomingPeriods", () => {
  it("arranca en el PISO de cobertura, no en el mes calendario", () => {
    expect(upcomingPeriods([], PADRON, null)[0]).toBe("2026-09");
  });
  it("devuelve tantos como cuotas admite un link", () => {
    expect(upcomingPeriods([], PADRON, null)).toHaveLength(MAX_LINK_FEES);
  });
  it("saltea los que ya tienen fila: lo que se anuncia es lo que va a decir el recibo", () => {
    expect(upcomingPeriods(["2026-09", "2026-10"], PADRON, null)[0]).toBe("2026-11");
  });
  it("REG-11: el reingreso mueve el piso sin tocar joinedAt", () => {
    expect(upcomingPeriods([], PADRON, new Date("2026-11-08T12:00:00Z"))[0]).toBe("2026-12");
  });
});
