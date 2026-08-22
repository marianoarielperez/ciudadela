import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_IN_WORDS, amountInWords } from "@/lib/treasury/amount-words";

describe("amountInWords", () => {
  it.each([
    [0, "cero pesos"],
    [1, "un peso"],
    [21, "veintiún pesos"],
    [100, "cien pesos"],
    [101, "ciento un pesos"],
    [3000, "tres mil pesos"],
    [6000, "seis mil pesos"],
    [18000, "dieciocho mil pesos"],
    [138000, "ciento treinta y ocho mil pesos"],
    [1000000, "un millón de pesos"],
    [2500000, "dos millones quinientos mil pesos"],
    [6000.5, "seis mil pesos con cincuenta centavos"],
    // Un centavo va en singular.
    [1000.01, "mil pesos con un centavo"],
    [0.01, "cero pesos con un centavo"],
    [0.02, "cero pesos con dos centavos"],
    [999999999, "novecientos noventa y nueve millones novecientos noventa y nueve mil novecientos noventa y nueve pesos"],
  ])("%s → %s", (n, words) => {
    expect(amountInWords(n)).toBe(words);
  });

  // Fuera de rango devolvía "undefined millones de pesos" y eso se imprimía en
  // el recibo. Mejor que reviente antes de generar el PDF.
  it.each([1_000_000_000, 1_234_567_890, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "lanza con %s en vez de escribir un disparate en el recibo",
    (n) => {
      expect(() => amountInWords(n)).toThrow(/inválido|fuera de rango/i);
    },
  );

  it("expone el tope de la tabla y lo respeta", () => {
    expect(MAX_AMOUNT_IN_WORDS).toBe(999_999_999);
    expect(amountInWords(MAX_AMOUNT_IN_WORDS)).not.toContain("undefined");
    expect(() => amountInWords(MAX_AMOUNT_IN_WORDS + 1)).toThrow();
  });
});
