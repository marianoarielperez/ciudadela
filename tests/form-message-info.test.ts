// El quinto kind de FormMessage (spec 2026-09-01 §4.3): celeste institucional,
// ADITIVO — los cuatro kinds existentes no cambian ni una clase.
//
// `children` viaja DENTRO de las props y el elemento se arma en un helper: como
// FormMessage declara `children` obligatorio, `createElement(C, props, "hola")`
// no typechequea (los hijos posicionales no satisfacen la prop) y escribir
// `children` en el literal del `createElement` lo rechaza `react/no-children-prop`.
// El helper deja verdes las dos puertas sin tocar el componente.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormMessage } from "@/components/admin/form-message";

const render = (props: Parameters<typeof FormMessage>[0]) =>
  renderToStaticMarkup(createElement(FormMessage, props));

describe("FormMessage kind=info", () => {
  it("texto text-primary y caja border-primary/40 bg-primary/5, sin role", () => {
    const html = render({ kind: "info", box: true, children: "hola" });
    expect(html).toContain("text-primary");
    expect(html).toContain("border-primary/40");
    expect(html).toContain("bg-primary/5");
    expect(html).not.toContain('role="');
  });
  it("role explícito lo pisa, como en los demás kinds", () => {
    const html = render({ kind: "info", role: "status", children: "hola" });
    expect(html).toContain('role="status"');
  });
  it("los cuatro kinds existentes conservan sus clases exactas", () => {
    const pairs = [
      ["error", "text-destructive"], ["success", "text-success"],
      ["warning", "text-warning"], ["neutral", "text-muted-foreground"],
    ] as const;
    for (const [kind, cls] of pairs) {
      expect(render({ kind, children: "x" })).toContain(cls);
    }
  });
});
