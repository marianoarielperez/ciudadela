import { describe, expect, it } from "vitest";
import { FOREIGN_PAYMENT_ACTION, isOwnCollection } from "@/lib/mp/own-collection";

// La regla es "propio o nada": un cobro nuestro trae `collector_id` presente e
// igual al id de la cuenta; todo lo demás —incluida la AUSENCIA, que es cómo
// llega la factura mensual de MP (medido el 11/09/2026)— es ajeno.
describe("isOwnCollection", () => {
  it.each([
    ["mismo id", "1978062823", true],
    ["otro id", "202123439", false],
    ["sin collector_id (la factura mensual de MP)", null, false],
    ["cadena vacía", "", false],
    ["texto con espacios no se normaliza", " 1978062823 ", false],
  ])("%s → %s", (_label: string, collectorId: string | null, expected: boolean) => {
    expect(isOwnCollection({ collectorId }, "1978062823")).toBe(expected);
  });

  it("la acción del asiento es payment_foreign", () => {
    expect(FOREIGN_PAYMENT_ACTION).toBe("payment_foreign");
  });
});
