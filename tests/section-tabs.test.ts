// Pestañas de sección "Carpeta" (spec 2026-09-02-pestanas-de-seccion-design):
// el módulo puro que es la ÚNICA fuente de las clases de las ocho barras.
//
// Tres partes, que las tareas 2 y 3 del plan extienden: (1) el módulo y la
// derivación de las variantes Radix; (2) de fuente: qué archivos importan del
// módulo y cuáles NO (la nav del shell conserva su subrayado); (3) de render,
// una barra por URL y una Radix.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
    expect(SECTION_TAB_RADIX_TRIGGER).toContain("rounded-b-none");
    expect(SECTION_TAB_RADIX_TRIGGER).toContain("after:hidden");
    expect(SECTION_TAB_RADIX_TRIGGER).toContain(SECTION_TAB);
  });

  it("la lista Radix pisa el h-8, el p-[3px] y el rounded-lg de la variante compartida", () => {
    for (const token of ["group-data-horizontal/tabs:h-auto", "p-0", "rounded-none", "border-b", "w-full", "items-end", "justify-start"]) {
      expect(SECTION_TABS_RADIX_LIST).toContain(token);
    }
    expect(SECTION_TABS_RADIX_LIST).toContain("p-0 px-0.5");
    expect(SECTION_TABS_RADIX_LIST).toContain("min-w-max");
    expect(SECTION_TABS_RADIX_LIST).not.toContain("overflow");
    expect(SECTION_TABS_RADIX_LIST).not.toContain("pb-2");
  });
});

// ---- (2) De fuente: quién usa el módulo y quién NO -------------------------
//
// La lista incluye las cuatro barras por URL y las cuatro Radix. `mi-tabs.tsx` es la
// nav del shell y CONSERVA su subrayado: si alguien la migra "por prolijidad",
// las sub-pestañas de /mi/solicitudes vuelven a confundirse con ella, que es
// exactamente el problema que este módulo resuelve.
const SECTION_TAB_FILES = [
  "src/components/admin/treasury-tabs.tsx",
  "src/components/admin/socios-tabs.tsx",
  "src/components/admin/solicitudes-tabs.tsx",
  "src/components/mi/solicitudes-tabs.tsx",
  "src/components/admin/member-tabs.tsx",
  "src/app/admin/configuracion/config-tabs.tsx",
  "src/app/admin/salud/salud-tabs.tsx",
  "src/app/admin/documentos/documentos-tabs.tsx",
];

// Las cuatro Radix visten el trigger derivado; las cuatro por URL, la solapa a
// secas. Importar del módulo no alcanza: un archivo puede importar sólo el
// envoltorio y seguir pintando la pestaña a mano.
const RADIX = /(member|config|salud|documentos)-tabs\.tsx$/;

describe("de fuente", () => {
  it.each(SECTION_TAB_FILES)("%s importa del módulo y no conserva el subrayado suelto", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain('from "@/lib/ui/section-tabs"');
    expect(src).toContain(RADIX.test(file) ? "SECTION_TAB_RADIX_TRIGGER" : "SECTION_TAB_ACTIVE");
    expect(src).not.toContain("border-b-2");
    expect(src).not.toContain("after:bg-primary");
    expect(src).not.toContain('variant="line"');
    expect(src).not.toContain("min-h-12");
  });

  it("la nav del shell de /mi NO usa el módulo y conserva su subrayado", () => {
    const src = readFileSync("src/components/mi/mi-tabs.tsx", "utf8");
    expect(src).not.toContain("@/lib/ui/section-tabs");
    expect(src).toContain("border-b-2");
  });
});

// ---- (3) Render: una barra por URL --------------------------------------------
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const nav = vi.hoisted(() => ({ pathname: "/admin/solicitudes/socios" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("SolicitudesTabs (por URL)", () => {
  const TABS = [
    { href: "/admin/solicitudes", label: "Altas", count: 3 },
    { href: "/admin/solicitudes/socios", label: "De socios", count: 1 },
    { href: "/admin/solicitudes/reportes", label: "Reportes", count: 0 },
  ];

  async function render() {
    const { SolicitudesTabs } = await import("@/components/admin/solicitudes-tabs");
    return renderToStaticMarkup(createElement(SolicitudesTabs, { tabs: TABS }));
  }

  function links(html: string): string[] {
    return html.match(/<a [^>]*>[\s\S]*?<\/a>/g) ?? [];
  }

  it("marca exactamente una pestaña con aria-current y la viste de solapa", async () => {
    const html = await render();
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const [altas, socios, reportes] = links(html);
    expect(socios).toContain('aria-current="page"');
    expect(socios).toContain(SECTION_TAB_ACTIVE);
    expect(altas).not.toContain(SECTION_TAB_ACTIVE);
    expect(reportes).not.toContain(SECTION_TAB_ACTIVE);
    expect(altas).toContain("hover:bg-muted");
  });

  it("el contador es celeste en la activa y gris en las otras; en cero no se muestra", async () => {
    const html = await render();
    const [altas, socios, reportes] = links(html);
    expect(socios).toContain("text-primary");
    expect(altas).toContain("text-muted-foreground");
    expect(altas).not.toContain("text-primary");
    expect(reportes).not.toMatch(/tabular-nums/);
  });

  it("riel y envoltorio: border-b, items-end, min-h-11 y el truco del foco", async () => {
    const html = await render();
    expect(html).toContain(SECTION_TABS_LIST);
    expect(html).toContain(SECTION_TABS_NAV_ADMIN);
    expect(html.match(/min-h-11/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Secciones de solicitudes"');
  });
});

// ---- (3b) Render: una barra Radix ---------------------------------------------
describe("SaludTabs (Radix)", () => {
  async function render(actCounts: Record<string, number> = {}) {
    nav.pathname = "/admin/salud";
    const { SaludTabs } = await import("@/app/admin/salud/salud-tabs");
    return renderToStaticMarkup(
      createElement(SaludTabs, {
        actCounts,
        tareas: "PANEL-TAREAS",
        infraestructura: "PANEL-INFRA",
        dinero: "PANEL-DINERO",
        correo: "PANEL-CORREO",
      }),
    );
  }

  it("la lista es variant=section, dentro del envoltorio, con el riel y sin el pb-2 del subrayado viejo", async () => {
    const html = await render();
    expect(html).toContain('data-variant="section"');
    expect(html).toContain('aria-label="Secciones de salud"');
    expect(html).not.toContain("pb-2");
    // El overflow va en el envoltorio, nunca en la lista: y la lista tiene que
    // ser su PRIMER hijo, o el scroll horizontal no es el de las pestañas.
    expect(html).toMatch(new RegExp(`<div class="${escapeRegExp(SECTION_TABS_NAV_ADMIN)}"><div [^>]*role="tablist"`));
    const list = html.match(/<div [^>]*role="tablist"[^>]*>/)?.[0] ?? "";
    expect(list).toContain("border-b");
    expect(list).toContain("items-end");
    expect(list).not.toContain("overflow");
  });

  it("los cuatro triggers llevan la solapa derivada, con targets de 44px", async () => {
    const html = await render();
    const triggers = html.match(/<button [^>]*role="tab"[^>]*>/g) ?? [];
    expect(triggers).toHaveLength(4);
    for (const t of triggers) {
      expect(t).toContain("min-h-11");
      expect(t).toContain("data-active:bg-card");
      expect(t).toContain("data-[state=inactive]:hover:bg-muted");
      expect(t).toContain("after:hidden");
      expect(t).not.toContain("after:bg-primary");
    }
    expect(html.match(/data-state="active"/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("la alerta roja de Salud sigue roja y con su sr-only, fuera del contador celeste", async () => {
    const html = await render({ dinero: 1 });
    expect(html).toContain("text-destructive");
    expect(html).toContain(", 1 para atender");
    expect(html).not.toContain("text-primary");
  });
});
