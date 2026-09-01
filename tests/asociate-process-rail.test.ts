// El stepper de proceso (spec §4.1): la barra mide el formulario; las etapas
// "La Comisión resuelve" y "Alta en acta" están SIEMPRE a la vista.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProcessRail } from "@/app/(public)/asociate/process-rail";

describe("ProcessRail", () => {
  const html = renderToStaticMarkup(createElement(ProcessRail, { step: 2, total: 6 }));
  it("eyebrow mono con el paso, y el gráfico es decorativo", () => {
    expect(html).toContain("Paso 2 de 6");
    expect(html).toContain("font-mono");
    expect(html).toContain("aria-hidden");
  });
  it("muestra las tres etapas del camino", () => {
    expect(html).toContain("Tu solicitud");
    expect(html).toMatch(/La Comisión\s*<br\/?>?\s*resuelve/);
    expect(html).toMatch(/Alta\s*<br\/?>?\s*en acta/);
  });
  it("la barra refleja el avance del formulario", () => {
    expect(html).toContain("width:33.3"); // 2/6 → 33.33…%
  });
  it("frase sr-only con el dato para lector de pantalla", () => {
    expect(html).toContain("sr-only");
    expect(html).toContain("la resuelve la Comisión Directiva");
  });
  it("respeta motion-reduce en la transición de la barra", () => {
    expect(html).toContain("motion-reduce:transition-none");
  });
});
