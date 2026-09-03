// Nav del shell de /mi (spec 2026-09-02-mi-nav-movil-design): dos
// presentaciones de la MISMA lista, una por corte. Render de servidor con
// `usePathname` mockeado, como en tests/section-tabs.test.ts. Lo que no se
// puede medir en node (desplazamiento, posicionado inicial, la flecha que
// cambia de lado) se verifica en el navegador (plan, Tarea 2).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { miTabsFor } from "@/lib/mi/nav";

const nav = vi.hoisted(() => ({ pathname: "/mi" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

async function render(pathname: string, paysFee = true): Promise<string> {
  nav.pathname = pathname;
  const { MiTabs } = await import("@/components/mi/mi-tabs");
  return renderToStaticMarkup(createElement(MiTabs, { tabs: miTabsFor(paysFee) }));
}

function navs(html: string): string[] {
  return html.match(/<nav [^>]*>[\s\S]*?<\/nav>/g) ?? [];
}

function links(html: string): string[] {
  return html.match(/<a [^>]*>[\s\S]*?<\/a>/g) ?? [];
}

function hrefs(html: string): string[] {
  return links(html).map((a) => /href="([^"]+)"/.exec(a)![1]);
}

function activeHrefs(html: string): string[] {
  return links(html)
    .filter((a) => a.includes('aria-current="page"'))
    .map((a) => /href="([^"]+)"/.exec(a)![1]);
}

function buttons(html: string): string[] {
  return html.match(/<button [^>]*>[\s\S]*?<\/button>/g) ?? [];
}

describe("MiTabs", () => {
  it("renderiza dos navs con las mismas pestañas en el mismo orden", async () => {
    const html = await render("/mi");
    const [desktop, mobile] = navs(html);
    expect(navs(html)).toHaveLength(2);
    const expected = miTabsFor(true).map((t) => t.href);
    expect(hrefs(desktop)).toEqual(expected);
    expect(hrefs(mobile)).toEqual(expected);
  });

  it("respeta el filtro por categoría en las dos (un vitalicio no ve Débito)", async () => {
    const html = await render("/mi", false);
    for (const n of navs(html)) {
      expect(hrefs(n)).toEqual(miTabsFor(false).map((t) => t.href));
      expect(hrefs(n)).not.toContain("/mi/debito");
    }
  });

  it.each([
    ["/mi", "/mi"],
    ["/mi/documentos", "/mi/documentos"],
    ["/mi/solicitudes/reportes", "/mi/solicitudes"],
  ])("en %s marca exactamente una activa por nav (%s)", async (pathname, active) => {
    const html = await render(pathname);
    for (const n of navs(html)) expect(activeHrefs(n)).toEqual([active]);
  });

  it("la primera nav es la de escritorio y la segunda la de celular", async () => {
    const html = await render("/mi");
    const [desktop, mobile] = navs(html);
    // La de escritorio conserva el subrayado (tests/section-tabs.test.ts lo
    // fija a nivel archivo; acá se fija a nivel render) y se esconde bajo md.
    expect(desktop).toMatch(/<nav [^>]*class="[^"]*\bhidden\b[^"]*\bmd:block\b/);
    expect(desktop).toContain("border-b-2");
    // La móvil vive dentro de un envoltorio md:hidden y no usa subrayado.
    expect(html.slice(html.indexOf(desktop) + desktop.length)).toMatch(/class="[^"]*\bmd:hidden\b/);
    expect(mobile).not.toContain("border-b-2");
  });

  it("en celular la activa es un bloque celeste y la inactiva lleva el ícono celeste", async () => {
    const html = await render("/mi/cuenta");
    const mobile = navs(html)[1];
    const [inicio, cuenta] = links(mobile);
    expect(cuenta).toContain('aria-current="page"');
    // Sin asumir el orden dentro del atributo: dos aserciones por token. Y
    // ancladas al `<a …>`: el string del link incluye el <svg>, que lleva la
    // misma clase `text-primary-foreground` cuando la pestaña está activa.
    expect(cuenta).toMatch(/<a [^>]*class="[^"]*(\s|")bg-primary(\s|")/);
    expect(cuenta).toMatch(/<a [^>]*class="[^"]*(\s|")text-primary-foreground(\s|")/);
    expect(inicio).not.toContain("bg-primary");
    expect(inicio).toMatch(/<svg [^>]*class="[^"]*\btext-primary\b/);
  });

  it("las pestañas móviles miden 80×64 y crecen si sobra ancho", async () => {
    const html = await render("/mi");
    const mobile = navs(html)[1];
    // Sin asumir el orden de las clases dentro del atributo: lo que importa es
    // que TODA pestaña lleve las dos (ancho base de 80px y reparto del sobrante).
    const items = mobile.match(/<li [^>]*>/g) ?? [];
    expect(items).toHaveLength(miTabsFor(true).length);
    for (const li of items) {
      expect(li).toMatch(/\bbasis-20\b/);
      // `grow` a secas, no `grow-0`: la clase tiene que terminar donde termina.
      // El borde izquierdo es `(\s|")` y no `(^|\s)`: después de `class="` el
      // ancla `^` no puede matchear nunca, así que sólo servía el `\s`.
      expect(li).toMatch(/class="[^"]*(\s|")grow(\s|")/);
    }
    expect(mobile).toMatch(/<a [^>]*class="[^"]*\bmin-h-16\b/);
  });

  it("los dos botones de desplazar tienen nombre accesible y no envían formularios", async () => {
    const html = await render("/mi");
    const found = buttons(html);
    expect(found).toHaveLength(2);
    for (const b of found) expect(b).toContain('type="button"');
    expect(found.map((b) => (/<span class="sr-only">([^<]+)<\/span>/.exec(b) ?? [])[1])).toEqual([
      "Ver secciones anteriores",
      "Ver más secciones",
    ]);
  });

  it("en el servidor sólo se ve la flecha derecha (al inicio de la tira)", async () => {
    const html = await render("/mi");
    // El envoltorio de cada flecha lleva `hidden` cuando no corresponde. En el
    // render de servidor no hay medidas: se asume desborde y scroll al inicio.
    const wrappers = html.match(/<div [^>]*>\s*<button [\s\S]*?<\/div>/g) ?? [];
    expect(wrappers).toHaveLength(2);
    const [left, right] = wrappers;
    expect(left).toContain("Ver secciones anteriores");
    expect(left).toMatch(/<div [^>]*\bhidden=""/);
    expect(right).toContain("Ver más secciones");
    expect(right).not.toMatch(/<div [^>]*\bhidden=""/);
  });
});

describe("readEdges", () => {
  // Sin DOM: lo único que mira la función son tres números.
  async function edgesOf(el: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
    const { readEdges } = await import("@/components/mi/mi-tabs");
    return readEdges(el as HTMLElement);
  }

  it("no hay desborde si entran todas las pestañas", async () => {
    expect(await edgesOf({ scrollWidth: 320, clientWidth: 375, scrollLeft: 0 })).toMatchObject({
      overflows: false,
    });
  });

  it("no hay desborde si lo que sobra no supera la holgura", async () => {
    const { EDGE_SLACK } = await import("@/components/mi/mi-tabs");
    expect(
      await edgesOf({ scrollWidth: 375 + EDGE_SLACK, clientWidth: 375, scrollLeft: 0 }),
    ).toMatchObject({ overflows: false });
  });

  it("con desborde real y scroll en cero está al inicio y no al final", async () => {
    expect(await edgesOf({ scrollWidth: 600, clientWidth: 375, scrollLeft: 0 })).toEqual({
      overflows: true,
      atStart: true,
      atEnd: false,
    });
  });

  it("a mitad de la tira no está ni al inicio ni al final", async () => {
    expect(await edgesOf({ scrollWidth: 600, clientWidth: 375, scrollLeft: 100 })).toEqual({
      overflows: true,
      atStart: false,
      atEnd: false,
    });
  });

  it("a un pixel del tope ya cuenta como final (holgura)", async () => {
    const max = 600 - 375;
    expect(await edgesOf({ scrollWidth: 600, clientWidth: 375, scrollLeft: max - 1 })).toMatchObject({
      atEnd: true,
    });
  });

  // El borde exacto de la holgura, clavado de los dos lados: si EDGE_SLACK
  // cambia de valor o el comparador pasa de >= a >, estos cuatro se caen.
  it("justo en la holgura cuenta como final, y un pixel antes no", async () => {
    const { EDGE_SLACK } = await import("@/components/mi/mi-tabs");
    const max = 600 - 375;
    expect(
      await edgesOf({ scrollWidth: 600, clientWidth: 375, scrollLeft: max - EDGE_SLACK }),
    ).toMatchObject({ atEnd: true });
    expect(
      await edgesOf({ scrollWidth: 600, clientWidth: 375, scrollLeft: max - EDGE_SLACK - 1 }),
    ).toMatchObject({ atEnd: false });
  });

  it("justo en la holgura cuenta como inicio, y un pixel después no", async () => {
    const { EDGE_SLACK } = await import("@/components/mi/mi-tabs");
    expect(
      await edgesOf({ scrollWidth: 600, clientWidth: 375, scrollLeft: EDGE_SLACK }),
    ).toMatchObject({ atStart: true });
    expect(
      await edgesOf({ scrollWidth: 600, clientWidth: 375, scrollLeft: EDGE_SLACK + 1 }),
    ).toMatchObject({ atStart: false });
  });
});
