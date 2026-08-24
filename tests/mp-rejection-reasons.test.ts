import { describe, expect, it } from "vitest";
import { REJECTION_REASONS, rejectionReason } from "@/lib/mp/rejection-reasons";

describe("rejectionReason", () => {
  it("traduce los motivos frecuentes a algo que un vecino entiende", () => {
    expect(rejectionReason("cc_rejected_insufficient_amount")).toContain("fondos");
    expect(rejectionReason("cc_rejected_card_disabled")).toContain("tarjeta");
    expect(rejectionReason("cc_rejected_call_for_authorize")).toContain("banco");
  });
  it("lo no mapeado cae en un genérico y NUNCA muestra el código crudo de MP", () => {
    const r = rejectionReason("cc_rejected_something_new_2027");
    expect(r).not.toContain("cc_rejected");
    expect(r).not.toContain("_");
    expect(r.length).toBeGreaterThan(10);
  });
  it("sin detalle, también el genérico", () => {
    expect(rejectionReason(null)).toBe(rejectionReason(undefined));
    expect(rejectionReason("")).toBe(rejectionReason(null));
  });
  it("todos los textos están en castellano rioplatense y no terminan en punto doble", () => {
    for (const text of Object.values(REJECTION_REASONS)) {
      expect(text).not.toMatch(/\.\.$/);
      expect(text[0]).toBe(text[0].toLowerCase()); // se interpolan a mitad de frase
    }
  });
  it("ningún motivo filtra el código crudo de MP ni termina en punto", () => {
    for (const [code, text] of Object.entries(REJECTION_REASONS)) {
      expect(text).not.toContain(code);
      expect(text).not.toContain("_");
      expect(text.endsWith(".")).toBe(false);
    }
  });
});
