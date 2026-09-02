// El componente de chips-filtro (M7, spec §6.3), extraído del patrón de Socios,
// y el ícono de tipo de reporte.
//
// Nota de forma: el repo escribe los tests de componentes en `.ts` con
// `createElement` —el `include` de `vitest.config.ts` es `tests/**/*.test.ts`,
// así que un `.test.tsx` NO se colecta y pasaría verde sin correr nunca—. Ver
// `tests/process-rail.test.ts`.
//
// Lo que sostienen y no se ve en otro lado: sólo el chip cuya clave coincide
// lleva `aria-current="page"`, un contador en CERO se muestra igual (es un dato,
// no un chip sin contador), y —la que importa— una URL que ningún chip
// representa no prende ninguno. Y que el admin y el vecino dibujan el mismo
// tipo de reporte con el mismo ícono: se compara el markup contra el catálogo
// público, no el nombre de una clase.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FilterChips } from "@/components/admin/filter-chips";
import { ReportKindIcon } from "@/components/admin/report-kind-icon";
import { ReportIcon } from "@/app/(public)/reportes/report-icons";

const chips = [
  { key: "a", label: "Sin presentar", href: "/x", count: 7 },
  { key: "b", label: "Presentados", href: "/x?estado=b", count: 0 },
];

describe("FilterChips", () => {
  it("marca el activo con aria-current y muestra los contadores", () => {
    const html = renderToStaticMarkup(h(FilterChips, { label: "Estado", chips, active: "a" }));
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(">7<");
    // Cero se muestra: "Presentados 0" es información, no un chip mudo.
    expect(html).toContain(">0<");
    expect(html).toContain('aria-label="Estado"');
    // Uno solo, no los dos.
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(html).toContain('href="/x?estado=b"');
  });

  it("con una clave desconocida no prende ninguno", () => {
    const unknown = renderToStaticMarkup(h(FilterChips, { label: "Estado", chips, active: "zzz" }));
    expect(unknown).not.toContain("aria-current");
    // Y `null` —la combinación de filtros que ningún chip representa— es lo
    // mismo: "ninguno activo" es una respuesta válida, no un fallback al primero.
    const none = renderToStaticMarkup(h(FilterChips, { label: "Estado", chips, active: null }));
    expect(none).not.toContain("aria-current");
  });

  it("un chip sin contador no dibuja el hueco", () => {
    const html = renderToStaticMarkup(
      h(FilterChips, { label: "Estado", chips: [{ key: "a", label: "Todos", href: "/x" }], active: "a" }),
    );
    expect(html).not.toContain("tabular-nums");
  });

  it("cumple el shell del panel: target de 44px y foco visible", () => {
    const html = renderToStaticMarkup(h(FilterChips, { label: "Estado", chips, active: "a" }));
    expect(html).toContain("min-h-11");
    expect(html).toContain("outline-hidden");
    expect(html).toContain("focus-visible:ring-ring");
  });
});

describe("ReportKindIcon", () => {
  it("usa los MISMOS íconos que el catálogo público", () => {
    const claim = renderToStaticMarkup(h(ReportKindIcon, { kind: "claim", className: "size-4" }));
    const initiative = renderToStaticMarkup(h(ReportKindIcon, { kind: "initiative", className: "size-4" }));
    expect(claim).toBe(
      renderToStaticMarkup(h(ReportIcon, { name: "message-square-warning", className: "size-4" })),
    );
    expect(initiative).toBe(renderToStaticMarkup(h(ReportIcon, { name: "lightbulb", className: "size-4" })));
    // Y no son el mismo dibujo: si el mapa colapsara, lo de arriba pasaría igual.
    expect(claim).not.toBe(initiative);
  });

  it("es decorativo: el significado lo pone el texto de al lado", () => {
    expect(renderToStaticMarkup(h(ReportKindIcon, { kind: "claim" }))).toContain('aria-hidden="true"');
  });
});
