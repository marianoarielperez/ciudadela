import { describe, expect, it } from "vitest";

import { CONFIG_TABS, initialConfigTab } from "@/lib/admin/config-tabs";

describe("CONFIG_TABS", () => {
  it("define las cinco pestañas en orden, sin valores repetidos", () => {
    expect(CONFIG_TABS.map((t) => t.value)).toEqual([
      "sitio", "asociate", "avisos", "tesoreria", "feriados",
    ]);
    expect(new Set(CONFIG_TABS.map((t) => t.value)).size).toBe(5);
  });

  // NO_FEE_VALUE_MESSAGE (src/lib/treasury/fee-values.ts) dice "Configuración →
  // Tesorería" y no se toca: la pestaña tiene que llamarse así. No se importa el
  // módulo de treasury acá porque arrastra @/lib/prisma, que tira sin .env.
  it('la pestaña del valor de cuota se llama "Tesorería"', () => {
    expect(CONFIG_TABS.find((t) => t.value === "tesoreria")?.label).toBe("Tesorería");
  });
});

describe("initialConfigTab", () => {
  it("sin params de éxito abre en Sitio público", () => {
    expect(initialConfigTab({})).toBe("sitio");
  });
  it("?cuota=1 (redirect de createFeeValueAction) aterriza en Tesorería", () => {
    expect(initialConfigTab({ cuota: "1" })).toBe("tesoreria");
  });
  it("?feriado=1 y ?feriado=2 (ABM de feriados) aterrizan en Feriados", () => {
    expect(initialConfigTab({ feriado: "1" })).toBe("feriados");
    expect(initialConfigTab({ feriado: "2" })).toBe("feriados");
  });
  it("valores raros o repetidos caen en Sitio público", () => {
    expect(initialConfigTab({ cuota: "2", feriado: "x" })).toBe("sitio");
    expect(initialConfigTab({ cuota: ["1", "1"] })).toBe("sitio");
  });
});
