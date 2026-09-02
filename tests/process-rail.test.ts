// `ProcessRail` gana `subject` y `phases` de forma ADITIVA (M7, spec §6.1): sin
// props renderiza exactamente lo de ASOCIATE ("Tu solicitud", "La Comisión
// resuelve", "Alta en acta"); con ellas, lo que pida el wizard de Reportes.
// Nota: el repo escribe los tests de componentes en `.ts` con `createElement`
// (el `include` de vitest.config.mts es `tests/**/*.test.ts`), no en `.tsx`.
import { createElement as h, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Landmark, Send } from "lucide-react";
import { describe, expect, it } from "vitest";
import { ProcessRail } from "@/app/(public)/asociate/process-rail";

describe("ProcessRail", () => {
  it("por defecto es el stepper de ASOCIATE", () => {
    const html = renderToStaticMarkup(h(ProcessRail, { step: 2, total: 6 }));
    expect(html).toContain("Paso 2 de 6 · Tu solicitud");
    expect(html).toContain("La Comisión");
    expect(html).toContain("resuelve");
    expect(html).toContain("Alta");
    expect(html).toContain("en acta");
    expect(html).toContain(
      "Después de enviar tu solicitud, la resuelve la Comisión Directiva y el alta se asienta en acta.",
    );
  });

  it("acepta un sujeto y fases propias", () => {
    const html = renderToStaticMarkup(
      h(ProcessRail, {
        step: 1,
        total: 3,
        subject: "Tu reporte",
        phases: [
          {
            icon: Landmark,
            label: h(Fragment, null, "La Comisión", h("br"), "lo canaliza"),
            srText: "lo revisa la Comisión Directiva",
          },
          {
            icon: Send,
            label: h(Fragment, null, "Presentado", h("br"), "al organismo"),
            srText: "y lo presenta ante el organismo",
          },
        ],
      }),
    );
    expect(html).toContain("Paso 1 de 3 · Tu reporte");
    expect(html).toContain("lo canaliza");
    expect(html).not.toContain("Alta");
    expect(html).toContain(
      "Después de enviar tu reporte, lo revisa la Comisión Directiva y lo presenta ante el organismo.",
    );
  });
});
