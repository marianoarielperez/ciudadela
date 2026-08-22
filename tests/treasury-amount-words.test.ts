import { describe, expect, it } from "vitest";
import { amountInWords } from "@/lib/treasury/amount-words";

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
  ])("%s → %s", (n, words) => {
    expect(amountInWords(n)).toBe(words);
  });
});
