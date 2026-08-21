import { describe, expect, it } from "vitest";
import { AUTO_DEBIT_WARNINGS, hasLiveAutoDebit } from "@/lib/members/auto-debit";

// El aviso de la baja y del cambio de categoría: hasta el M4/M5, esas dos
// pantallas NO tocan el débito automático del socio en Mercado Pago, así que
// tienen que decirlo. Lo que se fija acá es a quién le sale el aviso.

describe("hasLiveAutoDebit", () => {
  it("avisa por el flag del padrón aunque no haya ninguna fila local", () => {
    // La ficha vieja: el débito se gestionó en el panel de MP mucho antes de que
    // existiera este sistema, así que `mp_subscriptions` no sabe nada de él.
    expect(hasLiveAutoDebit({ autoDebit: true, subscriptionStatuses: [] })).toBe(true);
  });

  it("avisa por la suscripción local aunque el flag esté en false", () => {
    // La ficha nueva: la suscripción la creó el M3 al asociarse el vecino y
    // nadie edita `autoDebit` al completar el asiento.
    expect(hasLiveAutoDebit({ autoDebit: false, subscriptionStatuses: ["authorized"] })).toBe(true);
  });

  it("no avisa cuando no hay ninguna de las dos señales", () => {
    expect(hasLiveAutoDebit({ autoDebit: false, subscriptionStatuses: [] })).toBe(false);
  });

  it("`cancelled` es lo único que se puede afirmar como 'acá no hay débito'", () => {
    expect(hasLiveAutoDebit({ autoDebit: false, subscriptionStatuses: ["cancelled"] })).toBe(false);
    // Y si el débito se rehízo, la fila cancelada no tapa a la viva.
    expect(
      hasLiveAutoDebit({ autoDebit: false, subscriptionStatuses: ["cancelled", "authorized"] }),
    ).toBe(true);
  });

  it("cualquier estado desconocido de MP cuenta como débito posible", () => {
    // El catálogo es de MP y puede crecer sin avisarnos: no saber en qué estado
    // está es peor que avisar de más (mismo criterio que `lateEntryNotice`).
    for (const status of ["pending", "paused", "authorized", "algo_nuevo_de_mp"]) {
      expect(hasLiveAutoDebit({ autoDebit: false, subscriptionStatuses: [status] })).toBe(true);
    }
  });
});

describe("AUTO_DEBIT_WARNINGS", () => {
  it("cada acción dice qué hay que hacer en MP: cancelar la baja, ajustar la categoría", () => {
    // Un texto genérico ("gestionalo en MP") deja al operador adivinando.
    expect(AUTO_DEBIT_WARNINGS.baja).toMatch(/cancel/i);
    expect(AUTO_DEBIT_WARNINGS.categoria).toMatch(/actualices|ajust/i);
    expect(AUTO_DEBIT_WARNINGS.baja).not.toBe(AUTO_DEBIT_WARNINGS.categoria);
    // Y los dos nombran el panel de Mercado Pago, que es dónde se hace.
    for (const text of Object.values(AUTO_DEBIT_WARNINGS)) {
      expect(text).toContain("Mercado Pago");
    }
  });
});
