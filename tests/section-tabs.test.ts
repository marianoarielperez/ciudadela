// Pestañas de sección "Carpeta" (spec 2026-09-02-pestanas-de-seccion-design):
// el módulo puro que es la ÚNICA fuente de las clases de las nueve barras.
//
// Tres partes, que las tareas 2 y 3 del plan extienden: (1) el módulo y la
// derivación de las variantes Radix; (2) de fuente: qué archivos importan del
// módulo y cuáles NO (la nav del shell conserva su subrayado); (3) de render,
// una barra por URL y una Radix.
import { describe, expect, it } from "vitest";

import {
  SECTION_TAB,
  SECTION_TAB_ACTIVE,
  SECTION_TAB_INACTIVE,
  SECTION_TAB_RADIX_TRIGGER,
  SECTION_TABS_LIST,
  SECTION_TABS_NAV,
  SECTION_TABS_NAV_ADMIN,
  SECTION_TABS_RADIX_LIST,
  withPrefix,
} from "@/lib/ui/section-tabs";

describe("withPrefix", () => {
  it("antepone el prefijo a cada token, incluidos los que llevan / o corchetes", () => {
    expect(withPrefix("data-active:", "bg-card  inset-shadow-[0_3px_0_0_var(--color-primary)] bg-input/30")).toBe(
      "data-active:bg-card data-active:inset-shadow-[0_3px_0_0_var(--color-primary)] data-active:bg-input/30",
    );
  });

  it("con una cadena vacía devuelve vacío", () => {
    expect(withPrefix("data-active:", "")).toBe("");
  });
});

describe("las clases de la solapa", () => {
  it("conservan el canon de accesibilidad del shell", () => {
    for (const token of ["min-h-11", "outline-hidden", "focus-visible:ring-2", "focus-visible:ring-ring"]) {
      expect(SECTION_TAB).toContain(token);
    }
  });

  it("dibujan la solapa con tokens, no con color crudo de Tailwind", () => {
    expect(SECTION_TAB_ACTIVE).toContain("bg-card");
    expect(SECTION_TAB_ACTIVE).toContain("border-border");
    expect(SECTION_TAB_ACTIVE).toContain("inset-shadow-[0_3px_0_0_var(--color-primary)]");
    expect(SECTION_TAB_INACTIVE).toContain("hover:bg-muted");
    const all = [SECTION_TAB, SECTION_TAB_ACTIVE, SECTION_TAB_INACTIVE, SECTION_TABS_LIST].join(" ");
    expect(all).not.toMatch(/\b(?:bg|text|border)-(?:gray|slate|zinc|neutral|sky|blue|green|amber|red)-\d{2,3}\b/);
  });

  it("la solapa activa pisa el riel: -mb-px y border-b-0 en la base, border-b en la lista", () => {
    expect(SECTION_TAB).toContain("-mb-px");
    expect(SECTION_TAB).toContain("border-b-0");
    expect(SECTION_TABS_LIST).toContain("border-b");
    expect(SECTION_TABS_LIST).toContain("items-end");
  });

  it("el envoltorio conserva el truco del anillo de foco, y el admin deja de sangrar en lg", () => {
    expect(SECTION_TABS_NAV).toBe("-mx-4 -my-1 overflow-x-auto px-4 py-1");
    expect(SECTION_TABS_NAV_ADMIN).toBe("-mx-4 -my-1 overflow-x-auto px-4 py-1 lg:mx-0 lg:px-0");
  });
});

describe("las variantes Radix se DERIVAN de las mismas constantes", () => {
  it("el trigger lleva la solapa bajo data-active: y el hover bajo data-[state=inactive]:", () => {
    expect(SECTION_TAB_RADIX_TRIGGER).toContain(withPrefix("data-active:", SECTION_TAB_ACTIVE));
    expect(SECTION_TAB_RADIX_TRIGGER).toContain(withPrefix("data-[state=inactive]:", SECTION_TAB_INACTIVE));
    // La base de shadcn pinta la activa en oscuro con dark:data-active:bg-input/30
    // (más específica que data-active:), así que el override tiene que repetirse
    // con ese mismo prefijo para que tailwind-merge lo reemplace.
    expect(SECTION_TAB_RADIX_TRIGGER).toContain("dark:data-active:bg-card");
    expect(SECTION_TAB_RADIX_TRIGGER).toContain("dark:data-active:border-border");
    expect(SECTION_TAB_RADIX_TRIGGER).toContain("flex-none");
    expect(SECTION_TAB_RADIX_TRIGGER).toContain(SECTION_TAB);
  });

  it("la lista Radix pisa el h-8, el p-[3px] y el rounded-lg de la variante compartida", () => {
    for (const token of ["group-data-horizontal/tabs:h-auto", "p-0", "rounded-none", "border-b", "w-full", "items-end", "justify-start"]) {
      expect(SECTION_TABS_RADIX_LIST).toContain(token);
    }
    expect(SECTION_TABS_RADIX_LIST).not.toContain("pb-2");
  });
});
