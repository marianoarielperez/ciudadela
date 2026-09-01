// Callout del sitio público (spec §4.2): ícono + borde lateral + fondo al 5%,
// calcado del banner de veredicto de /admin/salud. `inset` es la piel para
// vivir dentro de otro recuadro (la cabecera de la boleta del paso 6).
//
// `children` viaja DENTRO de las props y el elemento se arma en un helper, igual
// que en form-message-info.test.ts: como Callout declara `children` obligatorio,
// `createElement(C, props, "aviso")` no typechequea (los hijos posicionales no
// satisfacen la prop) y escribir `children` en el literal del `createElement` lo
// rechaza `react/no-children-prop`. Las aserciones no cambian.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Landmark } from "lucide-react";
import { Callout } from "@/components/public/callout";

const render = (props: Parameters<typeof Callout>[0]) =>
  renderToStaticMarkup(createElement(Callout, props));

describe("Callout", () => {
  it("standalone info: rounded-xl + border-l-4 primary + fondo al 5%", () => {
    const html = render({ tone: "info", icon: Landmark, children: "aviso" });
    expect(html).toContain("rounded-xl");
    expect(html).toContain("border-l-4");
    expect(html).toContain("border-l-primary");
    expect(html).toContain("bg-primary/5");
    expect(html).toContain('aria-hidden'); // el ícono es decorativo
  });
  it("inset: sin redondeo ni border-l, con línea inferior del tono", () => {
    const html = render({
      tone: "info", icon: Landmark, inset: true, role: "note", id: "aviso-admision", children: "aviso",
    });
    expect(html).not.toContain("rounded-xl");
    expect(html).not.toContain("border-l-4");
    expect(html).toContain("border-b-2");
    expect(html).toContain('role="note"');
    expect(html).toContain('id="aviso-admision"');
  });
});
