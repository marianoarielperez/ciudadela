// El listado de /admin/documentos: qué panel recibe el filtro de año y qué dice
// cada estado vacío.
//
// Los cuatro paneles se arman en el SERVIDOR y viajan como props al componente
// cliente de pestañas; Radix sólo decide cuál se ve. Por eso acá se dobla
// `DocumentosTabs` por un componente que dibuja los cuatro rotulados: lo que hay
// que poder mirar es el panel OCULTO, que es donde vivía el vacío falso —Radix
// cambia de panel al instante y el `router.replace` que borra `?anio=` llega
// después, así que ese markup es exactamente lo que el operador ve en el
// intervalo—. El comportamiento de las pestañas en sí se prueba aparte, contra
// el componente real, en `documentos-tabs.test.ts`.
//
// Prisma se mockea: importarlo de verdad arrastra `@/lib/prisma`, que tira al
// evaluarse sin DATABASE_URL (regla del repo).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  institutionalDocument: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// El doble rotula cada panel para poder mirarlos por separado. La página lo
// importa relativo (`./documentos-tabs`); el alias resuelve al mismo archivo.
vi.mock("@/app/admin/documentos/documentos-tabs", async () => {
  const { createElement } = await import("react");
  return {
    DocumentosTabs: (props: {
      initial: string;
      normas: unknown; memorias: unknown; balances: unknown; otros: unknown;
    }) =>
      createElement(
        "div",
        { "data-initial": props.initial },
        (["normas", "memorias", "balances", "otros"] as const).map((tab) =>
          createElement(
            "section",
            { key: tab, "data-panel": tab },
            props[tab] as never,
          ),
        ),
      ),
  };
});

import AdminDocumentsPage from "@/app/admin/documentos/page";

const BASE = {
  description: null as string | null,
  yearKey: null as string | null,
  fileName: "x.pdf",
  size: 120_000,
  featured: false,
  uploadedById: 1,
  uploadedBy: { name: "Mariano" },
  createdAt: new Date(Date.UTC(2026, 7, 15, 12)),
  updatedAt: new Date(Date.UTC(2026, 7, 15, 12)),
};

// Dos memorias y dos balances de años DISTINTOS: 2025 sólo tiene memoria y 2024
// sólo balance, que es lo que hace visible el cruce de filtros entre paneles.
const ROWS = [
  { ...BASE, id: 1, type: "norm" as const, title: "Estatuto social", year: null, featured: true },
  { ...BASE, id: 2, type: "annual_report" as const, title: "Memoria 2025", year: 2025 },
  { ...BASE, id: 3, type: "annual_report" as const, title: "Memoria 2023", year: 2023 },
  { ...BASE, id: 4, type: "balance" as const, title: "Balance 2024", year: 2024 },
  { ...BASE, id: 5, type: "balance" as const, title: "Balance 2022", year: 2022 },
  { ...BASE, id: 6, type: "other" as const, title: "Convenio con el municipio", year: null },
];

// Devuelve el markup de un panel suelto, que es la unidad que se afirma.
function panelOf(html: string, tab: string): string {
  const open = html.indexOf(`data-panel="${tab}"`);
  expect(open).toBeGreaterThan(-1);
  const rest = html.slice(open);
  const next = rest.indexOf("data-panel=", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

// ¿El chip rotulado `label` lleva `aria-current="page"`? El orden de los
// atributos que emite React no es contrato: se busca el ancla por su rótulo.
function chipCurrent(html: string, label: string): boolean {
  const anchor = [...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].find((m) => m[2] === label);
  expect(anchor, `no hay chip «${label}»`).toBeDefined();
  return anchor![1].includes('aria-current="page"');
}

const render = async (sp: { tab?: string; anio?: string }) =>
  renderToStaticMarkup(await AdminDocumentsPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.institutionalDocument.findMany.mockResolvedValue(ROWS);
});

describe("el filtro de año es de la pestaña activa y de ninguna otra", () => {
  it("con ?tab=memorias&anio=2025 el panel de balances NO queda filtrado", async () => {
    const html = await render({ tab: "memorias", anio: "2025" });
    const balances = panelOf(html, "balances");
    // No hay balance de 2025: filtrado, el panel diría que no hay balances
    // cargados, que es falso — y es lo que el operador ve al clickear Balances,
    // antes de que el router borre el parámetro.
    expect(balances).toContain("Balance 2024");
    expect(balances).toContain("Balance 2022");
    expect(balances).not.toContain("Todavía no hay balances cargados.");
  });

  it("y el panel de memorias sí queda filtrado a 2025", async () => {
    const memorias = panelOf(await render({ tab: "memorias", anio: "2025" }), "memorias");
    expect(memorias).toContain("Memoria 2025");
    expect(memorias).not.toContain("Memoria 2023");
  });

  it("simétrico: con ?tab=balances&anio=2024 el filtrado es balances y no memorias", async () => {
    const html = await render({ tab: "balances", anio: "2024" });
    expect(panelOf(html, "balances")).not.toContain("Balance 2022");
    const memorias = panelOf(html, "memorias");
    expect(memorias).toContain("Memoria 2025");
    expect(memorias).toContain("Memoria 2023");
  });

  it("un ?tab= inventado no es ninguna pestaña: no filtra ningún panel", async () => {
    const html = await render({ tab: "inventado", anio: "2025" });
    expect(html).toContain('data-initial="normas"');
    expect(panelOf(html, "memorias")).toContain("Memoria 2023");
    expect(panelOf(html, "balances")).toContain("Balance 2022");
  });
});

describe("un ?anio= que no matchea no es un callejón sin salida", () => {
  it("el vacío habla del AÑO filtrado, no de la pestaña entera", async () => {
    const balances = panelOf(await render({ tab: "balances", anio: "2030" }), "balances");
    expect(balances).toContain("No hay balances de 2030.");
    expect(balances).not.toContain("Todavía no hay balances cargados.");
  });

  it("los chips se siguen dibujando, con «Todos» para salir del filtro", async () => {
    const balances = panelOf(await render({ tab: "balances", anio: "2030" }), "balances");
    expect(balances).toContain('href="?tab=balances"');
    expect(balances).toContain("Todos");
  });

  it("aun con un solo año en la pestaña —cuando los chips no se dibujarían—", async () => {
    prismaMock.institutionalDocument.findMany.mockResolvedValue([
      { ...BASE, id: 4, type: "balance" as const, title: "Balance 2024", year: 2024 },
    ]);
    const balances = panelOf(await render({ tab: "balances", anio: "2030" }), "balances");
    expect(balances).toContain('href="?tab=balances"');
  });

  it("sin filtro y con un solo año, los chips no aportan nada y no se dibujan", async () => {
    prismaMock.institutionalDocument.findMany.mockResolvedValue([
      { ...BASE, id: 4, type: "balance" as const, title: "Balance 2024", year: 2024 },
    ]);
    expect(panelOf(await render({ tab: "balances" }), "balances")).not.toContain("Todos");
  });
});

describe("chips de año", () => {
  it("van en orden descendente y marcan el activo con aria-current", async () => {
    const memorias = panelOf(await render({ tab: "memorias", anio: "2025" }), "memorias");
    expect(memorias.indexOf(">2025<")).toBeLessThan(memorias.indexOf(">2023<"));
    expect(chipCurrent(memorias, "2025")).toBe(true);
    // Y "Todos" deja de ser el activo cuando hay filtro.
    expect(chipCurrent(memorias, "Todos")).toBe(false);
    expect(chipCurrent(memorias, "2023")).toBe(false);
  });

  it("sin filtro, el activo es «Todos»", async () => {
    const memorias = panelOf(await render({ tab: "memorias" }), "memorias");
    expect(chipCurrent(memorias, "Todos")).toBe(true);
    expect(chipCurrent(memorias, "2025")).toBe(false);
  });

  it("≥44px, como el resto de los controles del panel", async () => {
    expect(await render({ tab: "memorias" })).toContain("min-h-11");
  });
});

describe("hand-off al alta: el «Subir documento» lleva la pestaña", () => {
  it("el del encabezado lleva la ACTIVA", async () => {
    expect(await render({ tab: "balances" })).toContain('href="/admin/documentos/nuevo?tab=balances"');
  });

  it("el de cada estado vacío lleva la SUYA, no la activa", async () => {
    prismaMock.institutionalDocument.findMany.mockResolvedValue([]);
    const html = await render({ tab: "memorias" });
    expect(panelOf(html, "normas")).toContain('href="/admin/documentos/nuevo?tab=normas"');
    expect(panelOf(html, "otros")).toContain('href="/admin/documentos/nuevo?tab=otros"');
    expect(panelOf(html, "balances")).toContain('href="/admin/documentos/nuevo?tab=balances"');
  });
});

describe("tira de estado y filas", () => {
  it("la cuarta tarjeta es el TOTAL y no linkea a un subconjunto", async () => {
    const html = await render({});
    expect(html).toContain("Total de documentos");
    expect(html).not.toContain("Documentos publicados");
    expect(html).not.toContain('href="?tab=otros"');
  });

  it("el año va como Badge y «Vigente» sale de status-badges (success)", async () => {
    const html = await render({});
    expect(html).toContain('data-slot="badge" data-variant="outline"');
    expect(html).toContain("Vigente");
    expect(html).toContain('data-slot="badge" data-variant="success"');
  });
});
