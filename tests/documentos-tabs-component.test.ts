// El componente cliente de pestañas de /admin/documentos: qué pestaña abre
// según `?tab=`, y qué URL arma un cambio de pestaña.
//
// `next/navigation` se dobla (los hooks de router no existen fuera de Next) y el
// componente se monta con `renderToStaticMarkup`, que es el molde del repo para
// probar presentación en el entorno node (precedentes `admin-health-screen`,
// `exemption-member-card-screen`). Radix sólo dibuja el panel activo, así que
// "qué panel se ve" se lee del markup directamente.
//
// El REPARTO del filtro de año entre paneles no se prueba acá: eso lo decide el
// servidor y vive en `documentos-screen.test.ts`. Y el módulo puro que dice cuál
// es la pestaña inicial es de `documentos-tabs.test.ts`: esto es el COMPONENTE.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/admin/documentos",
  useSearchParams: () => nav.params,
}));

import { DocumentosTabs } from "@/app/admin/documentos/documentos-tabs";

const PANELS = {
  normas: "PANEL-NORMAS",
  memorias: "PANEL-MEMORIAS",
  balances: "PANEL-BALANCES",
  otros: "PANEL-OTROS",
};

function render(qs: string, initial: "normas" | "memorias" | "balances" | "otros" = "normas") {
  nav.params = new URLSearchParams(qs);
  return renderToStaticMarkup(createElement(DocumentosTabs, { initial, ...PANELS }));
}

beforeEach(() => vi.clearAllMocks());

describe("qué pestaña abre", () => {
  it("sin `?tab=`, la inicial", () => {
    const html = render("");
    expect(html).toContain("PANEL-NORMAS");
    expect(html).not.toContain("PANEL-BALANCES");
  });

  it("con un `?tab=` válido, ésa", () => {
    const html = render("tab=balances", "balances");
    expect(html).toContain("PANEL-BALANCES");
    expect(html).not.toContain("PANEL-NORMAS");
  });

  it("un `?tab=` INVENTADO no rompe la pantalla: cae en la pestaña inicial", () => {
    const html = render("tab=inventado");
    expect(html).toContain("PANEL-NORMAS");
    expect(html).not.toContain("PANEL-MEMORIAS");
  });

  it("y tampoco rompe cuando la inicial no es la primera", () => {
    // `initial` sale del servidor con el mismo criterio, así que un `?tab=`
    // inventado deja las dos puntas de acuerdo en la misma pestaña.
    const html = render("tab=inventado", "otros");
    expect(html).toContain("PANEL-OTROS");
  });
});

describe("las cuatro pestañas siguen siendo navegables", () => {
  it("dibuja los cuatro disparadores, con la lista rotulada", () => {
    const html = render("");
    for (const label of ["Normas", "Memorias", "Balances", "Otros"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('aria-label="Tipos de documento"');
  });
});
