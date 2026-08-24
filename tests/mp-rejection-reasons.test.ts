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
  // El caso MÁS frecuente del genérico es que MP sí mandó un `status_detail` y
  // nosotros no lo mapeamos: decir "no nos informó el motivo" era falso.
  it("el genérico no afirma que MP no informó nada", () => {
    expect(rejectionReason(null)).toContain("no pudimos identificar");
    expect(rejectionReason(null)).not.toContain("no nos informó");
  });
  // Los códigos que MP devuelve seguido en el débito recurrente. Los que se
  // pueden accionar (3DS, función crédito, tarjeta inactiva) son los que duelen
  // si caen en el genérico: ahí había algo concreto que decirle al vecino.
  it("los códigos frecuentes y accionables no caen en el genérico", () => {
    for (const code of [
      "cc_rejected_insufficient_amount", "cc_rejected_card_disabled", "cc_rejected_3ds_mandatory",
      "cc_rejected_3ds_challenge", "cc_rejected_card_type_not_allowed", "cc_rejected_call_for_authorize",
      "bank_error", "cc_rejected_time_out", "rejected_by_regulations", "cc_amount_rate_limit_exceeded",
    ]) {
      expect(rejectionReason(code), code).not.toBe(rejectionReason(null));
    }
  });
  // La tarjeta inactiva se arregla con una llamada al emisor, y es la segunda
  // causa más frecuente del débito recurrente fallido. Sin nombrar la salida, el
  // vecino se queda mirando el rechazo.
  it("la tarjeta inhabilitada nombra la salida: llamar al banco", () => {
    expect(rejectionReason("cc_rejected_card_disabled")).toContain("banco");
  });
  // El tope es del medio de pago DENTRO de Mercado Pago: decir "el límite de la
  // tarjeta" manda al vecino a llamar a un banco que no tiene nada que arreglar.
  it("el límite excedido no culpa a la tarjeta", () => {
    const r = rejectionReason("cc_amount_rate_limit_exceeded");
    expect(r).toContain("Mercado Pago");
    expect(r).not.toContain("tarjeta");
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
