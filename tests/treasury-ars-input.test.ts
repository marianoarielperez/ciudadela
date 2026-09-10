import { describe, expect, it } from "vitest";
import { arsInputClean, formatArsInput, parseArsInput } from "@/lib/treasury/ars-input";

// Los importes de las partes vienen de Mercado Pago y PUEDEN traer centavos
// (`Decimal(10,2)`), así que este campo es el único del panel que acepta coma:
// coma = decimales, siempre; el punto no entra, para no tener que adivinar si
// "2.500" son dos mil quinientos o dos con cinco.
describe("parseArsInput", () => {
  it("enteros y hasta dos decimales con coma", () => {
    expect(parseArsInput("18000")).toBe(18000);
    expect(parseArsInput(" 18000,5 ")).toBe(18000.5);
    expect(parseArsInput("0,01")).toBe(0.01);
  });
  it("rechaza puntos, tres decimales, vacío y letras", () => {
    expect(parseArsInput("18.000")).toBeNull();
    expect(parseArsInput("1,234")).toBeNull();
    expect(parseArsInput("")).toBeNull();
    expect(parseArsInput("abc")).toBeNull();
    expect(parseArsInput("123456789")).toBeNull(); // más de 8 enteros: supera el tipo
  });
});
describe("arsInputClean", () => {
  it("deja dígitos y UNA coma con dos decimales como mucho", () => {
    expect(arsInputClean("18.000,505")).toBe("18000,50");
    expect(arsInputClean("1,2,3")).toBe("1,23");
    expect(arsInputClean("abc12")).toBe("12");
  });
});
describe("formatArsInput", () => {
  it("es la inversa de parseArsInput", () => {
    expect(formatArsInput(18000)).toBe("18000");
    expect(formatArsInput(18000.5)).toBe("18000,50");
    expect(parseArsInput(formatArsInput(6000.07))).toBe(6000.07);
  });
});
