import { describe, expect, it } from "vitest";
import { searchStreets, streetMatchScore, streetSearchKey } from "@/lib/streets/search";

// Muestra real del catálogo catastral del barrio (datos/calles_inicial.csv).
const STREETS = [
  { id: 1, loadOrder: 1901, name: "Pizarro , Francisco" },
  { id: 2, loadOrder: 1902, name: "Constitucion" },
  { id: 6, loadOrder: 1906, name: "Hernandez , Jose" },
  { id: 14, loadOrder: 1914, name: "1º de Mayo" },
  { id: 16, loadOrder: 1916, name: "Los Alerces" },
  { id: 17, loadOrder: 1917, name: "Los Andes" },
  { id: 23, loadOrder: 1924, name: "Burgueño , Juan Carlos" },
  { id: 25, loadOrder: 1926, name: "El Payador" },
  { id: 29, loadOrder: 1958, name: "Calle 1958" },
];

const names = (q: string) => searchStreets(STREETS, q).map((s) => s.name);

describe("streetSearchKey", () => {
  it("strips the ordinal marker that normalizeStreetName keeps on purpose", () => {
    expect(streetSearchKey("1º de Mayo")).toBe("1 de mayo");
  });
  it("turns the comma of 'apellido, nombre' into a word separator", () => {
    expect(streetSearchKey("Hernandez , Jose")).toBe("hernandez jose");
  });
  it("still strips accents and case", () => {
    expect(streetSearchKey("Burgueño , Juan Carlos")).toBe("burgueno juan carlos");
  });
});

describe("searchStreets", () => {
  it("finds 'Hernandez , Jose' by surname", () => {
    expect(names("hernandez")).toContain("Hernandez , Jose");
  });

  it("finds 'Hernandez , Jose' by given name, not just by prefix", () => {
    // Cinco calles del catálogo están en formato "apellido, nombre": buscar por
    // prefijo del nombre completo las dejaría inalcanzables por el nombre de pila.
    expect(names("jose")).toContain("Hernandez , Jose");
  });

  it("finds a street by its catastral code", () => {
    expect(names("1906")).toEqual(["Hernandez , Jose"]);
  });

  it("finds '1º de Mayo' typed without the ordinal marker", () => {
    expect(names("1 de mayo")).toContain("1º de Mayo");
  });

  it("finds '1º de Mayo' typed with the ordinal marker", () => {
    expect(names("1º de mayo")).toContain("1º de Mayo");
  });

  it("matches surname and given name in either order", () => {
    expect(names("jose hernandez")).toContain("Hernandez , Jose");
    expect(names("hernandez jose")).toContain("Hernandez , Jose");
  });

  it("ignores accents typed by the operator", () => {
    expect(names("burgueño")).toContain("Burgueño , Juan Carlos");
    expect(names("burgueno")).toContain("Burgueño , Juan Carlos");
  });

  it("returns every street sharing a prefix", () => {
    expect(names("los")).toEqual(["Los Alerces", "Los Andes"]);
  });

  it("does not match a fragment in the middle of a word", () => {
    // "carlos" contiene "los": sin el corte por palabra, buscar "los" traería
    // "Burgueño , Juan Carlos" mezclada con las dos calles que sí se buscan.
    expect(names("los")).not.toContain("Burgueño , Juan Carlos");
  });

  it("ranks the exact code above the streets that merely contain it", () => {
    expect(searchStreets(STREETS, "1958")[0]?.name).toBe("Calle 1958");
  });

  it("returns nothing for a query that matches no street", () => {
    expect(names("avenida siempreviva")).toEqual([]);
  });

  it("returns the head of the catalog for an empty query", () => {
    expect(searchStreets(STREETS, "   ").length).toBe(8);
  });

  it("honours the limit", () => {
    expect(searchStreets(STREETS, "", 3)).toHaveLength(3);
  });
});

describe("streetMatchScore", () => {
  it("scores an exact name best", () => {
    const exact = streetMatchScore({ name: "Los Andes", loadOrder: 1917 }, "los andes");
    const partial = streetMatchScore({ name: "Los Andes", loadOrder: 1917 }, "andes");
    expect(exact).toBe(0);
    expect(partial).not.toBeNull();
    expect(exact!).toBeLessThan(partial!);
  });
  it("returns null for an empty query", () => {
    expect(streetMatchScore({ name: "Los Andes", loadOrder: 1917 }, "  ")).toBeNull();
  });
});
