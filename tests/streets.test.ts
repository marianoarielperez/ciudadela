import { describe, expect, it } from "vitest";
import { normalizeStreetName } from "@/lib/streets/normalize";
import { parseCsv, parseStreetRow } from "@/lib/streets/parse-csv";

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

describe("parseStreetRow", () => {
  it("parses a well-formed row", () => {
    expect(parseStreetRow(["14", "1914", "1º de Mayo"])).toEqual({
      id: 14,
      loadOrder: 1914,
      name: "1º de Mayo",
    });
  });

  it("rejects a row with an empty numeric cell", () => {
    // Regression: Number("") === 0 and Number.isInteger(0) === true, so a blank
    // id_calle/orden_carga used to import silently as id 0 / loadOrder 0.
    expect(parseStreetRow(["", "1914", "1º de Mayo"])).toBeNull();
    expect(parseStreetRow(["14", "", "1º de Mayo"])).toBeNull();
    expect(parseStreetRow(["  ", "1914", "1º de Mayo"])).toBeNull();
  });

  it("rejects numeric cells that are not plain non-negative integers", () => {
    expect(parseStreetRow(["1.5", "1901", "Constitucion"])).toBeNull();
    expect(parseStreetRow(["-1", "1901", "Constitucion"])).toBeNull();
    expect(parseStreetRow(["1e3", "1901", "Constitucion"])).toBeNull();
    expect(parseStreetRow(["x", "1901", "Constitucion"])).toBeNull();
    expect(parseStreetRow(["1", "19o1", "Constitucion"])).toBeNull();
  });

  it("rejects id 0 (the value a blank cell used to produce)", () => {
    expect(parseStreetRow(["0", "1901", "Constitucion"])).toBeNull();
  });

  it("rejects a blank or missing street name", () => {
    expect(parseStreetRow(["1", "1901", "   "])).toBeNull();
    expect(parseStreetRow(["1", "1901"])).toBeNull();
  });

  it("rejects short rows", () => {
    expect(parseStreetRow([])).toBeNull();
    expect(parseStreetRow(["1"])).toBeNull();
  });
});
