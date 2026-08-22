import { describe, expect, it } from "vitest";
import { formatReceiptNumber, parseReceiptNumber } from "@/lib/treasury/receipt-number";

describe("receipt number", () => {
  it("formatea AAAA-NNNNN con ceros a la izquierda", () => {
    expect(formatReceiptNumber(2026, 1)).toBe("2026-00001");
    expect(formatReceiptNumber(2026, 12345)).toBe("2026-12345");
  });
  it("parsea y rechaza basura", () => {
    expect(parseReceiptNumber("2026-00042")).toEqual({ year: 2026, seq: 42 });
    expect(parseReceiptNumber("2026-42")).toBeNull();
    expect(parseReceiptNumber("../x")).toBeNull();
  });
});
