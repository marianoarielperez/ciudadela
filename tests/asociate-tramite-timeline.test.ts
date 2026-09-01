// La línea de tiempo del trámite (spec §4.4): el camino del ProcessRail en
// vertical y con estado. Verde = cumplido; celeste + "Estás acá" = en curso.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Landmark, Stamp } from "lucide-react";
import { TramiteTimeline } from "@/app/(public)/asociate/tramite-timeline";

const ITEMS = [
  { state: "done" as const, title: "Solicitud completa y pago acreditado" },
  { state: "now" as const, icon: Landmark, title: "La Comisión Directiva resuelve" },
  { state: "next" as const, icon: Stamp, title: "Alta en acta" },
];

describe("TramiteTimeline", () => {
  const html = renderToStaticMarkup(createElement(TramiteTimeline, { items: ITEMS }));
  it("estados por tono: done verde, now foreground, next muted", () => {
    expect(html).toContain("text-success");
    expect(html).toContain("bg-success");
    expect(html).toContain("border-primary");
    expect(html).toContain("border-border");
  });
  it('el hito en curso lleva el chip "Estás acá" y solo ése', () => {
    expect(html.match(/Estás acá/g)).toHaveLength(1);
  });
  it("los discos son decorativos; los títulos son texto", () => {
    expect(html).toContain("aria-hidden");
    for (const item of ITEMS) expect(html).toContain(String(item.title));
  });
});
