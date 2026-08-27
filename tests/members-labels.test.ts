import { describe, expect, it } from "vitest";
import { MovementType } from "@/generated/prisma/enums";
import { MOVEMENT_LABELS } from "@/lib/members/labels";

// Los movimientos son lo que se lee en la pestaña Historial de la ficha y en la
// pantalla del acta: un valor sin etiqueta sale crudo en inglés
// ("fee_exemption_revoked"). El `Record<MovementType, string>` ya obliga a tsc a
// exigir la clave; lo que se fija acá es lo que tsc NO ve: que ninguna etiqueta
// quede vacía y que dos movimientos distintos no se llamen igual — en un
// historial, dos asientos con el mismo rótulo son indistinguibles de un bug.
// Mismo patrón que `tests/reregistration-labels.test.ts`.
describe("MOVEMENT_LABELS", () => {
  it("covers every MovementType with a distinct es-AR label", () => {
    const values = Object.values(MovementType);
    for (const value of values) {
      expect(MOVEMENT_LABELS[value], `falta la etiqueta de "${value}"`).toBeTypeOf("string");
      expect(MOVEMENT_LABELS[value].trim().length).toBeGreaterThan(0);
    }
    expect(new Set(values.map((v) => MOVEMENT_LABELS[v])).size).toBe(values.length);
  });

  // El par de la exención (Art. 7 inc. a.4). Se fijan textualmente porque es lo
  // que el socio ve en su historial y lo que la Comisión coteja contra el acta.
  it("names the fee exemption pair as the board does", () => {
    expect(MOVEMENT_LABELS.fee_exemption).toBe("Exención de cuota");
    expect(MOVEMENT_LABELS.fee_exemption_revoked).toBe("Exención anulada");
  });
});
