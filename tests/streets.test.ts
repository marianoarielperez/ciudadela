import { describe, expect, it } from "vitest";
import { normalizeStreetName } from "@/lib/streets/normalize";
import { parseCsv } from "@/lib/streets/parse-csv";

describe("normalizeStreetName", () => {
  it("lowercases and strips accents", () => {
    expect(normalizeStreetName("Hernández")).toBe("hernandez");
  });
  it("normalizes spaced commas and double spaces", () => {
    expect(normalizeStreetName("Pizarro , Francisco")).toBe("pizarro, francisco");
  });
  it("keeps ordinal markers", () => {
    expect(normalizeStreetName("1º de Mayo")).toBe("1º de mayo");
  });
  it("trims", () => {
    expect(normalizeStreetName("  Los  Andes ")).toBe("los andes");
  });
});

describe("parseCsv", () => {
  it("strips BOM and parses quoted fields with commas", () => {
    const content = '\uFEFFid_calle,orden_carga,nombre_calle\r\n1,1901,"Pizarro , Francisco"\r\n14,1914,1º de Mayo\r\n';
    expect(parseCsv(content)).toEqual([
      ["id_calle", "orden_carga", "nombre_calle"],
      ["1", "1901", "Pizarro , Francisco"],
      ["14", "1914", "1º de Mayo"],
    ]);
  });
  it("ignores trailing empty lines", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
