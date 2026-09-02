// La pantalla /mi/documentos: qué se muestra arriba, qué encabezados se emiten
// y a dónde apunta cada fila.
//
// Las cuatro reglas que esta pantalla sostiene no se ven en ningún otro test:
// la norma destacada NO se repite dentro de "Normas" (aparecería dos veces en
// la misma vista), una sección sin filas no emite su encabezado (la regla del
// shell: nunca un encabezado sin filas debajo), con cero documentos se ve el
// estado vacío y ninguna sección, y la fila-link abre la ruta autenticada
// `/api/mi/documentos/{id}` y no el archivo. La quinta es la guarda: sin sesión
// de socio la página no renderiza nada NI consulta la base.
//
// Prisma y `requireMember` se mockean: importarlos de verdad arrastra
// `@/lib/prisma`, que tira al evaluarse sin DATABASE_URL (regla del repo), y
// NextAuth. La base sembrada no participa.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstitutionalDocument } from "@/generated/prisma/client";

const h = vi.hoisted(() => ({
  requireMember: vi.fn(),
  prisma: { institutionalDocument: { findMany: vi.fn() } },
}));
vi.mock("@/lib/auth/require-member", () => ({ requireMember: h.requireMember }));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import MiDocumentosPage from "@/app/mi/documentos/page";

const BASE = {
  description: null,
  year: null,
  yearKey: null,
  fileName: "x.pdf",
  size: 120_000,
  featured: false,
  uploadedById: 1,
  createdAt: new Date(Date.UTC(2026, 7, 15, 12)),
  updatedAt: new Date(Date.UTC(2026, 7, 15, 12)),
} satisfies Omit<InstitutionalDocument, "id" | "type" | "title">;

// Dos normas (una destacada), una memoria y un "otro": SIN balances, que es lo
// que hace visible la sección que no se emite.
const ROWS: InstitutionalDocument[] = [
  { ...BASE, id: 1, type: "norm", title: "Estatuto social", featured: true },
  { ...BASE, id: 2, type: "norm", title: "Reglamento interno", year: 2018 },
  { ...BASE, id: 3, type: "annual_report", title: "Memoria 2025", year: 2025 },
  { ...BASE, id: 4, type: "other", title: "Convenio con el municipio" },
];

const OK_ACTOR = {
  ok: true as const,
  userId: 7,
  memberId: 14,
  fullName: "Mariano Pérez",
  suspension: null,
};

/** Los `<section>` de primer nivel, uno por chunk. No hay secciones anidadas en
 *  esta pantalla, así que cortar en el primer `</section>` es exacto. */
function sectionsOf(html: string): string[] {
  return html
    .split("<section")
    .slice(1)
    .map((s) => `<section${s.split("</section>")[0]}`);
}

/** La sección cuyo encabezado dice `title` (`undefined` si no se emitió). */
function sectionTitled(html: string, title: string): string | undefined {
  return sectionsOf(html).find((s) => s.includes(`>${title}</h2>`));
}

const render = async () => {
  const el = await MiDocumentosPage();
  expect(el).not.toBeNull();
  return renderToStaticMarkup(el);
};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireMember.mockResolvedValue(OK_ACTOR);
  h.prisma.institutionalDocument.findMany.mockResolvedValue(ROWS);
});

describe("la norma destacada", () => {
  it("va arriba y NO se repite dentro de Normas", async () => {
    const html = await render();

    const featured = sectionsOf(html).find((s) => s.includes('aria-label="Estatuto"'));
    expect(featured, "no está la sección del estatuto destacado").toBeDefined();
    expect(featured).toContain("Estatuto social");

    const normas = sectionTitled(html, "Normas");
    expect(normas, "no está la sección Normas").toBeDefined();
    expect(normas).toContain("Reglamento interno");
    // El corazón del caso: la destacada no puede volver a aparecer en su
    // sección. Se afirma por el enlace, que es lo que el socio pulsaría dos
    // veces, y además contra el markup entero: un solo enlace al documento 1.
    expect(normas).not.toContain("Estatuto social");
    expect(normas).not.toContain('href="/api/mi/documentos/1"');
    expect(html.split('href="/api/mi/documentos/1"')).toHaveLength(2);
  });
});

describe("una sección sin filas no existe", () => {
  it("sin balances no se emite el encabezado «Balances»", async () => {
    const html = await render();
    expect(html).not.toContain(">Balances</h2>");
    expect(sectionTitled(html, "Balances")).toBeUndefined();
    // Las que sí tienen filas siguen ahí: el silencio es de la vacía, no de todas.
    expect(sectionTitled(html, "Normas")).toBeDefined();
    expect(sectionTitled(html, "Memorias")).toBeDefined();
    expect(sectionTitled(html, "Otros documentos")).toBeDefined();
  });
});

describe("el padrón documental vacío", () => {
  it("con cero documentos muestra el estado vacío y ninguna sección", async () => {
    h.prisma.institutionalDocument.findMany.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("Los documentos van a aparecer acá cuando la Comisión los publique.");
    expect(sectionsOf(html)).toHaveLength(0);
  });

  it("con documentos NO muestra el estado vacío", async () => {
    const html = await render();
    expect(html).not.toContain("Los documentos van a aparecer acá");
  });
});

describe("la fila-link", () => {
  it("apunta a la ruta autenticada /api/mi/documentos/{id}, no al archivo", async () => {
    const html = await render();
    const normas = sectionTitled(html, "Normas")!;
    expect(normas).toContain('href="/api/mi/documentos/2"');
    expect(sectionTitled(html, "Memorias")!).toContain('href="/api/mi/documentos/3"');
    // Nada del nombre del archivo en el HTML: la ruta es por id.
    expect(html).not.toContain("x.pdf");
  });

  it("avisa que el PDF se abre en otra pestaña (WCAG 3.2.5)", async () => {
    const html = await render();
    // Los dos caminos al PDF: la fila de una sección y el botón de la destacada.
    expect(sectionTitled(html, "Normas")!).toContain("(se abre en una pestaña nueva)");
    const featured = sectionsOf(html).find((s) => s.includes('aria-label="Estatuto"'))!;
    expect(featured).toContain("(se abre en una pestaña nueva)");
  });
});

describe("la guarda de socio", () => {
  it("se pide con allowSuspended (el suspendido lee su panel)", async () => {
    await render();
    expect(h.requireMember).toHaveBeenCalledWith({ allowSuspended: true });
  });

  it("sin sesión de socio no renderiza contenido ni consulta la base", async () => {
    h.requireMember.mockResolvedValue({
      ok: false,
      reason: "anonymous",
      error: "Ingresá a tu cuenta para ver tu panel de socio.",
    });
    await expect(MiDocumentosPage()).resolves.toBeNull();
    expect(h.prisma.institutionalDocument.findMany).not.toHaveBeenCalled();
  });
});
