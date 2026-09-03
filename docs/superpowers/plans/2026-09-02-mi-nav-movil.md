# Navegación móvil de `/mi` — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En celulares (< 640 px), reemplazar la tira de pestañas del shell de `/mi` por una tira grande con la activa en bloque celeste, flechas flotantes que la desplazan y la activa siempre a la vista al cargar; en escritorio nada cambia.

**Architecture:** Un solo archivo de producto, `src/components/mi/mi-tabs.tsx`, pasa a renderizar dos hermanos a partir de la MISMA lista `MiTab[]`: `DesktopTabs` (el markup de hoy, `hidden sm:block`) y `MobileStrip` (`sm:hidden`), que es el único con estado (bordes del scroll) y efectos (`ResizeObserver`, listener de scroll, `useLayoutEffect` de posicionado). `src/lib/mi/nav.ts`, el layout y las páginas no se tocan.

**Tech Stack:** Next.js 16.3 (App Router), React 19.2, Tailwind v4, lucide-react, vitest 4 (entorno `node`, render con `renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-09-02-mi-nav-movil-design.md`.

## Global Constraints

- UI en español (es-AR, "vos"); código, nombres y commits en inglés.
- Cambio **visual**: `src/lib/mi/nav.ts`, `src/app/mi/layout.tsx`, `src/components/mi/solicitudes-tabs.tsx` y `src/lib/ui/section-tabs.ts` no se modifican (salvo un comentario en el último, Tarea 3).
- `mi-tabs.tsx` **NO** importa `@/lib/ui/section-tabs` y conserva el literal `border-b-2` (lo fija `tests/section-tabs.test.ts`, "la nav del shell de /mi NO usa el módulo y conserva su subrayado").
- Corte: `sm` (640 px). Tira nueva `sm:hidden`; nav actual `hidden sm:block`.
- Medidas de la spec §3: pestaña `basis-20` (80 px) que crece, `min-h-16` (64 px), radio 10 px, ícono `size-6`, texto `text-sm font-medium` (`font-semibold` en la activa), activa `bg-primary text-primary-foreground`, inactiva `text-foreground` con ícono `text-primary`; botón de 44 px con círculo visible de 36 px (`size-9`), chevron `size-5`, degradado de 64 px (`w-16`).
- Targets ≥ 44 px; `outline-hidden` + `focus-visible:ring-2 focus-visible:ring-ring`; íconos `aria-hidden`; `aria-current="page"` con la `isMiTabActive` existente.
- Sin migración, sin variable de entorno, sin dependencia nueva.
- Tests: `npm test` (vitest, `tests/**/*.test.ts`, sin JSX: `createElement`). Los tests de render mockean `next/navigation` con `vi.hoisted` + `vi.mock` como en `tests/section-tabs.test.ts`.
- Git: un commit por tarea; `git add` sólo de los archivos de la tarea (el árbol tiene cambios ajenos sin commitear: `datos/padron_socios.xlsx`, `assets/hero-2.jpg`, `est/` — **no tocarlos**).

---

### Task 1: `MiTabs` renderiza la nav de escritorio y la tira móvil

**Files:**
- Modify: `src/components/mi/mi-tabs.tsx` (archivo entero)
- Test: `tests/mi-tabs.test.ts` (nuevo)

**Interfaces:**
- Consumes: `miTabsFor(paysFee: boolean): MiTab[]`, `isMiTabActive(pathname: string, href: string): boolean`, tipo `MiTab { href; label; icon: MiTabIcon; paysFeeOnly? }` de `@/lib/mi/nav`; `cn` de `@/lib/utils`.
- Produces: `export function MiTabs({ tabs }: { tabs: MiTab[] })` — misma firma que hoy; el layout no cambia. Los nombres accesibles de los botones son exactamente "Ver más secciones" (derecha) y "Ver secciones anteriores" (izquierda): la Tarea 2 los busca en el navegador.

- [ ] **Step 1: Escribir el test de render que falla**

Crear `tests/mi-tabs.test.ts`:

```ts
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
    // fija a nivel archivo; acá se fija a nivel render) y se esconde bajo sm.
    expect(desktop).toMatch(/<nav [^>]*class="[^"]*\bhidden\b[^"]*\bsm:block\b/);
    expect(desktop).toContain("border-b-2");
    // La móvil vive dentro de un envoltorio sm:hidden y no usa subrayado.
    expect(html.slice(html.indexOf(desktop) + desktop.length)).toMatch(/class="[^"]*\bsm:hidden\b/);
    expect(mobile).not.toContain("border-b-2");
  });

  it("en celular la activa es un bloque celeste y la inactiva lleva el ícono celeste", async () => {
    const html = await render("/mi/cuenta");
    const mobile = navs(html)[1];
    const [inicio, cuenta] = links(mobile);
    expect(cuenta).toContain('aria-current="page"');
    expect(cuenta).toMatch(/class="[^"]*\bbg-primary\b[^"]*\btext-primary-foreground\b/);
    expect(inicio).not.toContain("bg-primary");
    expect(inicio).toMatch(/<svg [^>]*class="[^"]*\btext-primary\b/);
  });

  it("las pestañas móviles miden 80×64 y crecen si sobra ancho", async () => {
    const html = await render("/mi");
    const mobile = navs(html)[1];
    expect(mobile).toMatch(/<li [^>]*class="[^"]*\bbasis-20\b[^"]*\bgrow\b/);
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/mi-tabs.test.ts`
Expected: FAIL. El primer test cae en `expect(navs(html)).toHaveLength(2)` (hoy hay una sola nav); los de botones caen con `toHaveLength(2)` sobre `[]`.

- [ ] **Step 3: Reescribir `src/components/mi/mi-tabs.tsx`**

Reemplazar el archivo entero por:

```tsx
"use client";
// Nav del shell del panel de socio: pestañas por URL (links, no botones —
// deep-link, botón atrás y aria-current gratis; mismo criterio que
// TreasuryTabs). Dos presentaciones de la MISMA lista, una por corte:
//   < sm  MobileStrip: pestañas de 80×64 con el ícono arriba, la activa en
//         bloque celeste y una flecha flotante que desplaza la tira. Nace de
//         que en 375px "Solicitudes" y "Documentos" quedaban fuera de la vista
//         sin ninguna señal (spec 2026-09-02-mi-nav-movil-design).
//   ≥ sm  DesktopTabs: la tira con subrayado de siempre, sin cambios.
// Ninguna de las dos importa `section-tabs`: son la nav del shell (nivel 1),
// no pestañas de sección; tests/section-tabs.test.ts lo fija.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Home,
  Library,
  RefreshCw,
  User,
  Wallet,
} from "lucide-react";

import { isMiTabActive, type MiTab, type MiTabIcon } from "@/lib/mi/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<MiTabIcon, React.ComponentType<{ className?: string }>> = {
  home: Home,
  wallet: Wallet,
  user: User,
  "file-text": FileText,
  library: Library,
  "refresh-cw": RefreshCw,
};

export function MiTabs({ tabs }: { tabs: MiTab[] }) {
  const pathname = usePathname();
  return (
    <>
      <DesktopTabs tabs={tabs} pathname={pathname} />
      <MobileStrip tabs={tabs} pathname={pathname} />
    </>
  );
}

// ---- Escritorio (≥ sm): sin cambios respecto de la 5A ----------------------
// Targets de 48px. El -my-1/py-1 evita que overflow-x-auto recorte el anillo
// de foco (la trampa documentada en section-tabs.ts).
function DesktopTabs({ tabs, pathname }: { tabs: MiTab[]; pathname: string }) {
  return (
    <nav aria-label="Secciones del panel" className="-mx-4 -my-1 hidden overflow-x-auto px-4 py-1 sm:block">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = isMiTabActive(pathname, tab.href);
          const Icon = ICONS[tab.icon];
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-12 items-center gap-1.5 border-b-2 px-3 text-sm outline-hidden transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---- Celular (< sm) ---------------------------------------------------------

type Edges = { overflows: boolean; atStart: boolean; atEnd: boolean };

// Holgura para "estoy en el borde": con zoom del sistema scrollLeft queda
// fraccionario y sin holgura la flecha del final no se apagaría nunca.
const EDGE_SLACK = 2;

function readEdges(el: HTMLElement): Edges {
  const max = el.scrollWidth - el.clientWidth;
  return {
    overflows: max > EDGE_SLACK,
    atStart: el.scrollLeft <= EDGE_SLACK,
    atEnd: el.scrollLeft >= max - EDGE_SLACK,
  };
}

// Lo que pinta el servidor (y la hidratación): desborde y al inicio, o sea la
// flecha derecha visible. Es el estado más probable en un celular; el layout
// effect lo corrige con medidas reales antes del primer pintado.
const SSR_EDGES: Edges = { overflows: true, atStart: true, atEnd: false };

function MobileStrip({ tabs, pathname }: { tabs: MiTab[]; pathname: string }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState<Edges>(SSR_EDGES);

  const sync = useCallback(() => {
    const el = listRef.current;
    if (el) setEdges(readEdges(el));
  }, []);

  // Posicionado inicial (spec §4): la activa a la vista ANTES de pintar,
  // escribiendo scrollLeft directo — scrollIntoView puede mover la página en
  // vertical. Se repite al cambiar de sección. `offsetLeft` del <li> es
  // relativo al <ul> porque el <ul> es `relative`.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const item = el.querySelector<HTMLElement>('[aria-current="page"]')?.closest("li");
    if (item) {
      el.scrollLeft = Math.max(0, item.offsetLeft - (el.clientWidth - item.offsetWidth) / 2);
    }
    sync();
  }, [pathname, sync]);

  // Las flechas se derivan del scroll y del ancho. Como flotan (absolute), que
  // aparezcan o desaparezcan no cambia el ancho de la tira: no hay vaivén
  // posible entre "hay desborde" y "ya no lo hay".
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    el.addEventListener("scroll", sync, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", sync);
    };
  }, [sync]);

  function nudge(direction: -1 | 1) {
    const el = listRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    // `-mx-4`: la tira usa el ancho entero de la pantalla (el envoltorio del
    // header trae px-4). `relative`: las flechas se posicionan contra esto.
    <div className="relative -mx-4 sm:hidden">
      <nav aria-label="Secciones del panel">
        {/* El padding vertical vive DENTRO del contenedor con scroll para que
            el anillo de foco (2px) de las pestañas no se recorte. La barra de
            scroll se esconde: las flechas son la señal. */}
        <ul
          ref={listRef}
          className="relative flex gap-1 overflow-x-auto px-1 pt-1.5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => {
            const active = isMiTabActive(pathname, tab.href);
            const Icon = ICONS[tab.icon];
            return (
              <li key={tab.href} className="flex shrink-0 grow basis-20">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-[10px] px-1 text-sm font-medium outline-hidden transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-primary font-semibold text-primary-foreground" : "text-foreground hover:bg-muted",
                  )}
                >
                  <Icon
                    className={cn("size-6 shrink-0", active ? "text-primary-foreground" : "text-primary")}
                    aria-hidden
                  />
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <EdgeButton side="left" shown={edges.overflows && !edges.atStart} onClick={() => nudge(-1)} />
      <EdgeButton side="right" shown={edges.overflows && !edges.atEnd} onClick={() => nudge(1)} />
    </div>
  );
}

// El degradado y el botón flotan sobre el borde: no ocupan ancho, así que
// aparecer o desaparecer no mueve la tira. Se esconden con `hidden` (no con
// `invisible`): un botón que no se ve tampoco tiene que estar en el orden de
// tabulación. `pointer-events-none` en el envoltorio y `-auto` en el botón:
// el degradado no roba el toque a la pestaña parcial que tiene debajo.
function EdgeButton({
  side,
  shown,
  onClick,
}: {
  side: "left" | "right";
  shown: boolean;
  onClick: () => void;
}) {
  const Chevron = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div
      hidden={!shown}
      className={cn(
        "pointer-events-none absolute inset-y-0 flex w-16 items-center",
        side === "left"
          ? "left-0 justify-start bg-linear-to-r from-background from-40% to-transparent"
          : "right-0 justify-end bg-linear-to-l from-background from-40% to-transparent",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "pointer-events-auto flex size-11 items-center justify-center rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          side === "left" ? "ml-1" : "mr-1",
        )}
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
          <Chevron className="size-5" aria-hidden />
        </span>
        <span className="sr-only">{side === "left" ? "Ver secciones anteriores" : "Ver más secciones"}</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Correr el test nuevo y los que fijan esta nav**

Run: `npx vitest run tests/mi-tabs.test.ts tests/mi-nav.test.ts tests/section-tabs.test.ts`
Expected: PASS los tres archivos. En particular, en `section-tabs.test.ts` sigue verde "la nav del shell de /mi NO usa el módulo y conserva su subrayado".

Si `mi-tabs.test.ts` falla en "en el servidor sólo se ve la flecha derecha" porque React serializa `hidden` de otra forma, mirar el HTML con `console.log(html)` y ajustar la regex del test, **no** el componente: React 19 emite `hidden=""` para `hidden={true}` y omite el atributo para `false`.

- [ ] **Step 5: Lint y tipos**

Run: `npx tsc --noEmit -p . && npx eslint src/components/mi/mi-tabs.tsx tests/mi-tabs.test.ts`
Expected: sin errores. Si ESLint marca `react-hooks/set-state-in-effect` por el `setEdges` dentro de `sync` llamado desde `useLayoutEffect`: es la regla del compilador de React; el `setState` acá deriva de medidas del DOM que sólo existen en el efecto, que es el caso permitido. Si la regla igual lo marca, agregar arriba de la línea `// eslint-disable-next-line react-hooks/set-state-in-effect -- lee medidas del DOM que sólo existen tras el layout` y NO reestructurar el componente.

- [ ] **Step 6: Commit**

```bash
git add src/components/mi/mi-tabs.tsx tests/mi-tabs.test.ts
git commit -m "feat(mi): mobile nav strip — large tabs, filled active tab, floating scroll buttons, active tab in view

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Verificación en el navegador (375 px y 640 px)

Esta tarea no escribe código salvo que la verificación encuentre un defecto. Necesita una sesión de socio en el dev server; **Claude no tipea contraseñas**: el operador (Mariano) inicia sesión en la pestaña del Browser pane y avisa.

**Files:**
- Ninguno (capturas en el scratchpad de la sesión).

**Interfaces:**
- Consumes: la app corriendo con `.claude/launch.json` → configuración `sigev-dev` (puerto 3000).

- [ ] **Step 1: Levantar el dev server y pedir la sesión**

`preview_start` con `{ name: "sigev-dev" }`. Navegar a `http://localhost:3000/ingresar`. Pedirle al operador que inicie sesión con un socio **que paga cuota** (seis pestañas) y que avise cuando esté en `/mi`.

- [ ] **Step 2: Estado inicial en 375 × 812**

`resize_window` `{ preset: "mobile" }` y recargar. Verificar con `read_page` y una captura:
- cuatro pestañas enteras (Inicio, Mi cuenta, Débito, Mis datos) y "Solicitudes" parcial bajo la flecha derecha;
- Inicio en bloque celeste con texto blanco;
- un solo botón visible, con nombre "Ver más secciones" (`find` con ese texto); "Ver secciones anteriores" no aparece (`find` devuelve vacío);
- `read_console_messages` sin errores de hidratación.

Guardar la captura como `scratchpad/mi-nav-375-inicio.png` (captura del Browser pane).

- [ ] **Step 3: La flecha desplaza y cambia de lado**

Click en el botón "Ver más secciones". Esperar 1 s. Verificar: Documentos visible, el botón derecho desapareció y apareció "Ver secciones anteriores" a la izquierda. Captura `mi-nav-375-final.png`. Click en "Ver secciones anteriores": vuelve al inicio y se apaga la izquierda.

- [ ] **Step 4: Deslizar con el dedo sigue funcionando**

Con el preset mobile activo (toque emulado), `left_click_drag` desde el centro de la tira (aprox. x=300, y de la tira) hasta x=60. Verificar que la tira se desplazó (Documentos visible) y que las flechas reflejan la posición.

- [ ] **Step 5: La activa a la vista al cargar**

`navigate` a `http://localhost:3000/mi/documentos`. Sin tocar nada, verificar con captura: Documentos en bloque celeste y visible, flecha izquierda visible, derecha ausente. Repetir con `/mi/solicitudes/reportes`: Solicitudes marcada (subruta) y visible, y **las sub-pestañas de Solicitudes** (Solicitudes | Reportes, solapa "Carpeta") se ven debajo sin confundirse con la tira. Captura `mi-nav-375-documentos.png`.

- [ ] **Step 6: Escritorio intacto**

`resize_window` `{ preset: "desktop" }` (y luego `{ width: 640, height: 900 }` para el borde del corte). Verificar: la tira grande no está, la nav con subrayado se ve con las seis pestañas, Documentos activa con `border-primary`. Captura `mi-nav-640.png`.

- [ ] **Step 7: Socio que no paga cuota (si hay uno a mano)**

Si el operador tiene un vitalicio de prueba: en 375 px la tira muestra cinco pestañas (sin Débito) y sigue habiendo flecha derecha (5 × 80 + gaps > 375). Si no hay, dejarlo asentado en el informe como no verificado en vivo (el test de render lo cubre).

- [ ] **Step 8: Volver el viewport a desktop y reportar**

`resize_window` `{ preset: "desktop" }`. Enviar al operador las capturas con `SendUserFile`. Si algo falló, arreglar en `mi-tabs.tsx`, correr `npx vitest run tests/mi-tabs.test.ts` y commitear el arreglo con `fix(mi): …` antes de la Tarea 3.

---

### Task 3: Documentación del patrón

**Files:**
- Modify: `CLAUDE.md` (bullet "Pestañas de sección", líneas 89-97)
- Modify: `src/lib/ui/section-tabs.ts` (comentario de cabecera, líneas 8-12)
- Modify: `docs/superpowers/specs/2026-09-02-mi-nav-movil-design.md` (estado)

- [ ] **Step 1: CLAUDE.md**

En el bullet que empieza con `- **Pestañas de sección: solapa "Carpeta" desde ...`, reemplazar la frase

```
la nav del shell de `/mi` es
  subrayado (`mi-tabs.tsx`, NO usa el módulo), las pestañas de sección son
```

por

```
la nav del shell de `/mi` es
  subrayado en escritorio y **tira grande en celular** (`mi-tabs.tsx`, NO usa
  el módulo; bajo `sm` pinta pestañas de 80×64 con la activa en bloque celeste,
  flechas flotantes que desplazan y la activa a la vista al cargar — spec
  2026-09-02-mi-nav-movil), las pestañas de sección son
```

- [ ] **Step 2: Comentario de `section-tabs.ts`**

Reemplazar la línea

```
//   1. nav del shell de /mi  → subrayado fino (mi-tabs.tsx, NO usa este módulo)
```

por

```
//   1. nav del shell de /mi  → subrayado fino en ≥sm y tira grande con la
//      activa en bloque bajo sm (mi-tabs.tsx, NO usa este módulo)
```

- [ ] **Step 3: Estado del spec**

En `docs/superpowers/specs/2026-09-02-mi-nav-movil-design.md`, cambiar la línea `**Estado:** aprobado por el operador (entrevista de cuatro rondas + mockup)` por `**Estado:** implementado y verificado en el navegador (2026-09-02)`.

- [ ] **Step 4: Suite entera**

Run: `npm test`
Expected: PASS, sin archivos en rojo (el test de fuente de `section-tabs.test.ts` no lee comentarios, así que el cambio del Step 2 no lo afecta).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md src/lib/ui/section-tabs.ts docs/superpowers/specs/2026-09-02-mi-nav-movil-design.md
git commit -m "docs: mobile nav strip of /mi in CLAUDE.md and the section-tabs header comment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
