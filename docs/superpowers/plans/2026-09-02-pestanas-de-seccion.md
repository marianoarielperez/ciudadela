# Pestañas de sección "Carpeta" — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las nueve barras de pestañas de sección del sistema (cinco por URL, cuatro Radix) compartan un mismo dibujo de solapa "Carpeta", más visible y distinto de la nav del shell y de los segmentos de vista, cambiando sólo `className`.

**Architecture:** Un módulo puro `src/lib/ui/section-tabs.ts` es la única fuente de las clases; los ocho componentes que cambian sólo reemplazan sus strings de `className` (y `variant="line"` por `variant="section"` en los cuatro Radix). Una variante `section` nueva en `tabsListVariants` (`src/components/ui/tabs.tsx`) evita que las reglas de estado de la variante `line` —que pesan más que `data-active:` porque shadcn define `data-active` con `:where()`— pisen los overrides. Un test de fuente fija que los ocho importen del módulo y que `mi-tabs.tsx` (la nav del shell) NO lo haga.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind v4.3 (`inset-shadow-[…]`, `data-[state=inactive]:`), shadcn radix-nova (`radix-ui` monopaquete, `cva`, `tailwind-merge` 3), Vitest en entorno node con `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-09-02-pestanas-de-seccion-design.md`.

## Global Constraints

- **Sólo visual.** Ninguna lógica de activación, ruta, `?tab=`, `router.replace`, `useEffect`, contador ni ícono cambia. Ninguna aserción existente se toca.
- **No tocar** `src/components/mi/mi-tabs.tsx` (nav del shell), ningún segmento/chip, ningún archivo de `src/lib/treasury/*` ni `src/lib/mp/*`.
- **Accesibilidad del shell (canon):** `min-h-11` (≥44 px), `outline-hidden` + `focus-visible:ring-2 focus-visible:ring-ring` en todo control, `aria-current="page"` en la activa de las barras por URL, `aria-label` en toda lista, íconos `aria-hidden` con texto, modo oscuro **sólo por tokens** (nada de color crudo de Tailwind).
- **El truco del envoltorio** `-mx-4 -my-1 overflow-x-auto px-4 py-1` se conserva: sin ese padding el anillo de foco queda recortado por `overflow-x-auto`.
- **Guardas por mutación:** toda guarda nueva se rompe a propósito y se ve el test en rojo antes de darla por buena (se documenta en el paso).
- Código y commits en inglés; comentarios y UI en español (es-AR).
- Tests: `npm test` (Vitest, `tests/**/*.test.ts`; los `.test.tsx` NO se colectan). Un archivo puntual: `npx vitest run tests/section-tabs.test.ts`.
- Commits pequeños con `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. No hacer `git push` (lo corre el operador). No agregar al stage los cambios preexistentes del árbol (`datos/padron_socios.xlsx`, `assets/hero-2.jpg`, `est/`).

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/lib/ui/section-tabs.ts` | crear | ÚNICA fuente de las clases; `withPrefix` |
| `src/components/ui/tabs.tsx` | modificar (1 línea) | variante `section` en `tabsListVariants` |
| `tests/section-tabs.test.ts` | crear (T1), extender (T2, T3) | módulo, fuente, render |
| `src/components/admin/treasury-tabs.tsx` | modificar | barra por URL |
| `src/components/admin/socios-tabs.tsx` | modificar | barra por URL con íconos |
| `src/components/admin/solicitudes-tabs.tsx` | modificar | barra por URL con contadores |
| `src/components/mi/solicitudes-tabs.tsx` | modificar | barra por URL del panel de socio |
| `src/components/admin/member-tabs.tsx` | modificar | Radix; gana `aria-label` |
| `src/app/admin/configuracion/config-tabs.tsx` | modificar | Radix con íconos |
| `src/app/admin/salud/salud-tabs.tsx` | modificar | Radix con íconos y alerta |
| `src/app/admin/documentos/documentos-tabs.tsx` | modificar | Radix con íconos |
| `CLAUDE.md` | modificar | un bullet en "Panel de administración: shell y patrones" |

---

### Task 1: El módulo compartido y la variante `section`

**Files:**
- Create: `src/lib/ui/section-tabs.ts`
- Modify: `src/components/ui/tabs.tsx:27-40` (`tabsListVariants`)
- Test: `tests/section-tabs.test.ts`

**Interfaces:**
- Produces: `withPrefix(prefix: string, classes: string): string` y las constantes string `SECTION_TABS_NAV`, `SECTION_TABS_NAV_ADMIN`, `SECTION_TABS_LIST`, `SECTION_TAB`, `SECTION_TAB_ACTIVE`, `SECTION_TAB_INACTIVE`, `SECTION_TAB_COUNT`, `SECTION_TAB_COUNT_ACTIVE`, `SECTION_TAB_ICON`, `SECTION_TABS_RADIX_LIST`, `SECTION_TAB_RADIX_TRIGGER`. `TabsList` acepta `variant="section"`.

- [ ] **Step 1: Escribir el test del módulo (falla: el módulo no existe)**

Crear `tests/section-tabs.test.ts`:

```ts
// Pestañas de sección "Carpeta" (spec 2026-09-02-pestanas-de-seccion-design):
// el módulo puro que es la ÚNICA fuente de las clases de las nueve barras.
//
// Tres partes, que las tareas 2 y 3 del plan extienden: (1) el módulo y la
// derivación de las variantes Radix; (2) de fuente: qué archivos importan del
// módulo y cuáles NO (la nav del shell conserva su subrayado); (3) de render,
// una barra por URL y una Radix.
import { describe, expect, it } from "vitest";

import {
  SECTION_TAB,
  SECTION_TAB_ACTIVE,
  SECTION_TAB_INACTIVE,
  SECTION_TAB_RADIX_TRIGGER,
  SECTION_TABS_LIST,
  SECTION_TABS_NAV,
  SECTION_TABS_NAV_ADMIN,
  SECTION_TABS_RADIX_LIST,
  withPrefix,
} from "@/lib/ui/section-tabs";

describe("withPrefix", () => {
  it("antepone el prefijo a cada token, incluidos los que llevan / o corchetes", () => {
    expect(withPrefix("data-active:", "bg-card  inset-shadow-[0_3px_0_0_var(--color-primary)] bg-input/30")).toBe(
      "data-active:bg-card data-active:inset-shadow-[0_3px_0_0_var(--color-primary)] data-active:bg-input/30",
    );
  });

  it("con una cadena vacía devuelve vacío", () => {
    expect(withPrefix("data-active:", "")).toBe("");
  });
});

describe("las clases de la solapa", () => {
  it("conservan el canon de accesibilidad del shell", () => {
    for (const token of ["min-h-11", "outline-hidden", "focus-visible:ring-2", "focus-visible:ring-ring"]) {
      expect(SECTION_TAB).toContain(token);
    }
  });

  it("dibujan la solapa con tokens, no con color crudo de Tailwind", () => {
    expect(SECTION_TAB_ACTIVE).toContain("bg-card");
    expect(SECTION_TAB_ACTIVE).toContain("border-border");
    expect(SECTION_TAB_ACTIVE).toContain("inset-shadow-[0_3px_0_0_var(--color-primary)]");
    expect(SECTION_TAB_INACTIVE).toContain("hover:bg-muted");
    const all = [SECTION_TAB, SECTION_TAB_ACTIVE, SECTION_TAB_INACTIVE, SECTION_TABS_LIST].join(" ");
    expect(all).not.toMatch(/\b(?:bg|text|border)-(?:gray|slate|zinc|neutral|sky|blue|green|amber|red)-\d{2,3}\b/);
  });

  it("la solapa activa pisa el riel: -mb-px y border-b-0 en la base, border-b en la lista", () => {
    expect(SECTION_TAB).toContain("-mb-px");
    expect(SECTION_TAB).toContain("border-b-0");
    expect(SECTION_TABS_LIST).toContain("border-b");
    expect(SECTION_TABS_LIST).toContain("items-end");
  });

  it("el envoltorio conserva el truco del anillo de foco, y el admin deja de sangrar en lg", () => {
    expect(SECTION_TABS_NAV).toBe("-mx-4 -my-1 overflow-x-auto px-4 py-1");
    expect(SECTION_TABS_NAV_ADMIN).toBe("-mx-4 -my-1 overflow-x-auto px-4 py-1 lg:mx-0 lg:px-0");
  });
});

describe("las variantes Radix se DERIVAN de las mismas constantes", () => {
  it("el trigger lleva la solapa bajo data-active: y el hover bajo data-[state=inactive]:", () => {
    expect(SECTION_TAB_RADIX_TRIGGER).toContain(withPrefix("data-active:", SECTION_TAB_ACTIVE));
    expect(SECTION_TAB_RADIX_TRIGGER).toContain(withPrefix("data-[state=inactive]:", SECTION_TAB_INACTIVE));
    // La base de shadcn pinta la activa en oscuro con dark:data-active:bg-input/30
    // (más específica que data-active:), así que el override tiene que repetirse
    // con ese mismo prefijo para que tailwind-merge lo reemplace.
    expect(SECTION_TAB_RADIX_TRIGGER).toContain("dark:data-active:bg-card");
    expect(SECTION_TAB_RADIX_TRIGGER).toContain("dark:data-active:border-border");
    expect(SECTION_TAB_RADIX_TRIGGER).toContain("flex-none");
    expect(SECTION_TAB_RADIX_TRIGGER).toContain(SECTION_TAB);
  });

  it("la lista Radix pisa el h-8, el p-[3px] y el rounded-lg de la variante compartida", () => {
    for (const token of ["group-data-horizontal/tabs:h-auto", "p-0", "rounded-none", "border-b", "w-full", "items-end", "justify-start"]) {
      expect(SECTION_TABS_RADIX_LIST).toContain(token);
    }
    expect(SECTION_TABS_RADIX_LIST).not.toContain("pb-2");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/section-tabs.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ui/section-tabs"`.

- [ ] **Step 3: Crear el módulo**

Crear `src/lib/ui/section-tabs.ts`:

```ts
// Pestañas de SECCIÓN "Carpeta" (spec 2026-09-02-pestanas-de-seccion-design).
// ÚNICA fuente de las clases de las nueve barras: cinco por URL (Tesorería,
// Socios, Solicitudes admin, /mi/solicitudes) y cuatro Radix (ficha del socio,
// Configuración, Salud, Documentos). Sin React, sin Prisma: sólo strings.
//
// Tres niveles visuales, cada uno con su forma, para que una pestaña de sección
// no se confunda con la nav ni con los filtros:
//   1. nav del shell de /mi  → subrayado fino (mi-tabs.tsx, NO usa este módulo)
//   2. pestañas de sección   → esta solapa
//   3. segmentos de vista    → píldora sobre pista gris (filter-chips.tsx)
//
// La solapa activa: fondo de tarjeta, contorno en tres lados, tapa celeste de
// 3 px y `-mb-px` + `border-b-0` para que su fondo pise la línea del riel — es
// lo que la "abre" hacia el contenido. La tapa es un `inset-shadow` y no un
// `border-t` para que activa e inactiva midan lo mismo y el anillo de foco
// (que también es box-shadow) componga con ella en vez de pisarla.

/** Antepone `prefix` a cada token. Las variantes Radix se DERIVAN de las
 *  constantes de abajo con esto, no se copian a mano. */
export function withPrefix(prefix: string, classes: string): string {
  return classes
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `${prefix}${token}`)
    .join(" ");
}

// Envoltorio. `-my-1 py-1`: overflow-x-auto calcula overflow-y en auto también
// (CSS Overflow), así que el contenedor recorta en vertical; el anillo de foco
// es un box-shadow ~2px afuera del borde y no cuenta como desborde. Sin este
// padding, el foco por teclado queda cortado. El margen negativo cancela el
// padding, no mueve nada visualmente. El admin deja de sangrar a partir de lg.
export const SECTION_TABS_NAV = "-mx-4 -my-1 overflow-x-auto px-4 py-1";
export const SECTION_TABS_NAV_ADMIN = `${SECTION_TABS_NAV} lg:mx-0 lg:px-0`;

// El riel. `items-end`: las solapas apoyan sobre la línea. `px-0.5`: que el
// contorno de la primera no toque el borde del envoltorio.
export const SECTION_TABS_LIST = "flex min-w-max items-end gap-1 border-b px-0.5";

// Base de cada pestaña (link o trigger).
export const SECTION_TAB =
  "relative -mb-px inline-flex min-h-11 items-center gap-1.5 rounded-t-md border border-b-0 border-transparent px-3.5 text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";

export const SECTION_TAB_ACTIVE =
  "border-border bg-card font-semibold text-foreground inset-shadow-[0_3px_0_0_var(--color-primary)]";

export const SECTION_TAB_INACTIVE = "text-muted-foreground hover:bg-muted hover:text-foreground";

// Contador (Solicitudes admin): gris en la inactiva, celeste en la activa. La
// alerta roja de Salud NO pasa por acá: es roja siempre.
export const SECTION_TAB_COUNT = "font-mono text-xs tabular-nums text-muted-foreground";
export const SECTION_TAB_COUNT_ACTIVE = "font-mono text-xs tabular-nums text-primary";

export const SECTION_TAB_ICON = "size-4 shrink-0";

// Radix. Va sobre `<TabsList variant="section">`: con esa variante ninguna regla
// de estado de `line` ni de `default` se dispara (están escritas contra
// `group-data-[variant=…]`, que pesa más que `data-active:` porque shadcn lo
// define con `:where()`), y lo que queda en la base lleva los mismos prefijos
// que estos overrides, así que tailwind-merge sí los reemplaza.
// `h-auto` pisa el `h-8` de la variante compartida (los targets de 44px no
// entran en 32px). Ya no hay `pb-2`: el subrayado que `line` dibujaba 5px por
// debajo del trigger no se activa en `section`.
export const SECTION_TABS_RADIX_LIST =
  "group-data-horizontal/tabs:h-auto w-full items-end justify-start overflow-x-auto rounded-none border-b p-0 px-0.5";

export const SECTION_TAB_RADIX_TRIGGER = [
  SECTION_TAB,
  "flex-none justify-start py-0 font-normal",
  withPrefix("data-[state=inactive]:", SECTION_TAB_INACTIVE),
  withPrefix("data-active:", SECTION_TAB_ACTIVE),
  // La base pinta la activa en oscuro con `dark:data-active:border-input` y
  // `dark:data-active:bg-input/30`; el prefijo `dark:` pesa más que
  // `data-active:` a secas, así que el override se repite con el suyo.
  withPrefix("dark:data-active:", "border-border bg-card"),
].join(" ");
```

- [ ] **Step 4: Agregar la variante `section` a `tabsListVariants`**

En `src/components/ui/tabs.tsx`, reemplazar el bloque `variants`:

```ts
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        // Pestañas de sección "Carpeta" (src/lib/ui/section-tabs.ts). Misma
        // lista que `line`; la diferencia está en el TRIGGER: sus reglas de
        // estado activo apuntan a `group-data-[variant=line|default]`, y con
        // `section` ninguna se dispara, así que las clases del módulo mandan.
        section: "gap-1 bg-transparent",
      },
    },
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run tests/section-tabs.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Mutación de la guarda de derivación**

En `section-tabs.ts`, cambiar temporalmente `withPrefix("data-active:", SECTION_TAB_ACTIVE)` por el string `"data-active:bg-card"` copiado a mano. Run: `npx vitest run tests/section-tabs.test.ts` → Expected: FAIL en "el trigger lleva la solapa bajo data-active:". Restaurar. Volver a correr: PASS.

- [ ] **Step 7: Tipos y lint**

Run: `npx tsc --noEmit -p tsconfig.json` → Expected: sin errores. Run: `npx eslint src/lib/ui/section-tabs.ts src/components/ui/tabs.tsx tests/section-tabs.test.ts` → Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ui/section-tabs.ts src/components/ui/tabs.tsx tests/section-tabs.test.ts
git commit -m "feat(ui): shared section-tab classes and a section variant for TabsList

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Las cuatro barras por URL

**Files:**
- Modify: `src/components/admin/treasury-tabs.tsx`
- Modify: `src/components/admin/socios-tabs.tsx`
- Modify: `src/components/admin/solicitudes-tabs.tsx`
- Modify: `src/components/mi/solicitudes-tabs.tsx`
- Test: `tests/section-tabs.test.ts` (extender)

**Interfaces:**
- Consumes: de `@/lib/ui/section-tabs`: `SECTION_TABS_NAV`, `SECTION_TABS_NAV_ADMIN`, `SECTION_TABS_LIST`, `SECTION_TAB`, `SECTION_TAB_ACTIVE`, `SECTION_TAB_INACTIVE`, `SECTION_TAB_COUNT`, `SECTION_TAB_COUNT_ACTIVE`, `SECTION_TAB_ICON`.
- Produces: nada nuevo; las props de los cuatro componentes no cambian.

- [ ] **Step 1: Extender el test: fuente + render de `SolicitudesTabs` (falla)**

Agregar al final de `tests/section-tabs.test.ts` (los imports nuevos van arriba, junto a los existentes):

```ts
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
```

y el bloque:

```ts
// ---- (2) De fuente: quién usa el módulo y quién NO -------------------------
//
// La lista se completa en la tarea 3 con los cuatro Radix. `mi-tabs.tsx` es la
// nav del shell y CONSERVA su subrayado: si alguien la migra "por prolijidad",
// las sub-pestañas de /mi/solicitudes vuelven a confundirse con ella, que es
// exactamente el problema que este módulo resuelve.
const SECTION_TAB_FILES = [
  "src/components/admin/treasury-tabs.tsx",
  "src/components/admin/socios-tabs.tsx",
  "src/components/admin/solicitudes-tabs.tsx",
  "src/components/mi/solicitudes-tabs.tsx",
];

describe("de fuente", () => {
  it.each(SECTION_TAB_FILES)("%s importa del módulo y no conserva el subrayado suelto", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain('from "@/lib/ui/section-tabs"');
    expect(src).not.toContain("border-b-2");
    expect(src).not.toContain("after:bg-primary");
    expect(src).not.toContain('variant="line"');
    expect(src).not.toContain("min-h-12");
  });

  it("la nav del shell de /mi NO usa el módulo y conserva su subrayado", () => {
    const src = readFileSync("src/components/mi/mi-tabs.tsx", "utf8");
    expect(src).not.toContain("@/lib/ui/section-tabs");
    expect(src).toContain("border-b-2");
  });
});

// ---- (3) Render: una barra por URL --------------------------------------------
const nav = vi.hoisted(() => ({ pathname: "/admin/solicitudes/socios" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("SolicitudesTabs (por URL)", () => {
  const TABS = [
    { href: "/admin/solicitudes", label: "Altas", count: 3 },
    { href: "/admin/solicitudes/socios", label: "De socios", count: 1 },
    { href: "/admin/solicitudes/reportes", label: "Reportes", count: 0 },
  ];

  async function render() {
    const { SolicitudesTabs } = await import("@/components/admin/solicitudes-tabs");
    return renderToStaticMarkup(createElement(SolicitudesTabs, { tabs: TABS }));
  }

  function links(html: string): string[] {
    return html.match(/<a [^>]*>[\s\S]*?<\/a>/g) ?? [];
  }

  it("marca exactamente una pestaña con aria-current y la viste de solapa", async () => {
    const html = await render();
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const [altas, socios, reportes] = links(html);
    expect(socios).toContain('aria-current="page"');
    expect(socios).toContain(SECTION_TAB_ACTIVE);
    expect(altas).not.toContain(SECTION_TAB_ACTIVE);
    expect(reportes).not.toContain(SECTION_TAB_ACTIVE);
    expect(altas).toContain("hover:bg-muted");
  });

  it("el contador es celeste en la activa y gris en las otras; en cero no se muestra", async () => {
    const html = await render();
    const [altas, socios, reportes] = links(html);
    expect(socios).toContain("text-primary");
    expect(altas).toContain("text-muted-foreground");
    expect(altas).not.toContain("text-primary");
    expect(reportes).not.toMatch(/tabular-nums/);
  });

  it("riel y envoltorio: border-b, items-end, min-h-11 y el truco del foco", async () => {
    const html = await render();
    expect(html).toContain(SECTION_TABS_LIST);
    expect(html).toContain(SECTION_TABS_NAV_ADMIN);
    expect(html.match(/min-h-11/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Secciones de solicitudes"');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/section-tabs.test.ts`
Expected: FAIL — los cuatro `it.each` de fuente (no importan del módulo) y los tres de render (no contienen `SECTION_TAB_ACTIVE`).

- [ ] **Step 3: `treasury-tabs.tsx`**

Reemplazar el archivo entero por:

```tsx
"use client";
// Barra de pestañas por URL. Links, no botones: navegan. Scroll horizontal en
// móvil, targets ≥44px, foco visible. Las clases viven en
// src/lib/ui/section-tabs.ts (solapa "Carpeta"), no acá.
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isTreasuryTabActive, type TreasuryTab } from "@/lib/admin/treasury-tabs";
import {
  SECTION_TAB,
  SECTION_TAB_ACTIVE,
  SECTION_TAB_INACTIVE,
  SECTION_TABS_LIST,
  SECTION_TABS_NAV_ADMIN,
} from "@/lib/ui/section-tabs";
import { cn } from "@/lib/utils";

export function TreasuryTabs({ tabs }: { tabs: TreasuryTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de tesorería" className={SECTION_TABS_NAV_ADMIN}>
      <ul className={SECTION_TABS_LIST}>
        {tabs.map((tab) => {
          const active = isTreasuryTabActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(SECTION_TAB, active ? SECTION_TAB_ACTIVE : SECTION_TAB_INACTIVE)}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: `socios-tabs.tsx`**

Conservar el comentario de cabecera y el mapa `ICONS` tal cual están (líneas 1-20). Reemplazar los imports de estilo y el cuerpo del componente:

```tsx
import { isSociosTabActive, type SociosTab } from "@/lib/admin/socios-tabs";
import {
  SECTION_TAB,
  SECTION_TAB_ACTIVE,
  SECTION_TAB_ICON,
  SECTION_TAB_INACTIVE,
  SECTION_TABS_LIST,
  SECTION_TABS_NAV_ADMIN,
} from "@/lib/ui/section-tabs";
import { cn } from "@/lib/utils";

const ICONS: Record<SociosTab["icon"], React.ComponentType<{ className?: string }>> = {
  users: Users,
  "book-marked": BookMarked,
  history: History,
};

export function SociosTabs({ tabs }: { tabs: SociosTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de socios" className={SECTION_TABS_NAV_ADMIN}>
      <ul className={SECTION_TABS_LIST}>
        {tabs.map((tab) => {
          const active = isSociosTabActive(pathname, tab.href);
          const Icon = ICONS[tab.icon];
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(SECTION_TAB, active ? SECTION_TAB_ACTIVE : SECTION_TAB_INACTIVE)}
              >
                <Icon className={SECTION_TAB_ICON} aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 5: `solicitudes-tabs.tsx` (admin)**

Conservar el comentario de cabecera (líneas 1-6). Reemplazar imports y componente:

```tsx
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isSolicitudesTabActive, type SolicitudesTab } from "@/lib/admin/solicitudes-tabs";
import {
  SECTION_TAB,
  SECTION_TAB_ACTIVE,
  SECTION_TAB_COUNT,
  SECTION_TAB_COUNT_ACTIVE,
  SECTION_TAB_INACTIVE,
  SECTION_TABS_LIST,
  SECTION_TABS_NAV_ADMIN,
} from "@/lib/ui/section-tabs";
import { cn } from "@/lib/utils";

export function SolicitudesTabs({ tabs }: { tabs: SolicitudesTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de solicitudes" className={SECTION_TABS_NAV_ADMIN}>
      <ul className={SECTION_TABS_LIST}>
        {tabs.map((tab) => {
          const active = isSolicitudesTabActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(SECTION_TAB, active ? SECTION_TAB_ACTIVE : SECTION_TAB_INACTIVE)}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  // Un span aparte, a propósito: el link se anuncia "Altas", no "Altas 3".
                  <span className={active ? SECTION_TAB_COUNT_ACTIVE : SECTION_TAB_COUNT}>{tab.count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 6: `src/components/mi/solicitudes-tabs.tsx`**

Conservar el comentario de cabecera (líneas 1-6). Reemplazar imports y componente (nótese `SECTION_TABS_NAV`, sin `lg:`: el panel de socio sangra siempre):

```tsx
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isMiSolicitudesTabActive, type MiSolicitudesTab } from "@/lib/mi/solicitudes-tabs";
import {
  SECTION_TAB,
  SECTION_TAB_ACTIVE,
  SECTION_TAB_INACTIVE,
  SECTION_TABS_LIST,
  SECTION_TABS_NAV,
} from "@/lib/ui/section-tabs";
import { cn } from "@/lib/utils";

export function MiSolicitudesTabs({ tabs }: { tabs: MiSolicitudesTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Tipos de solicitud" className={SECTION_TABS_NAV}>
      <ul className={SECTION_TABS_LIST}>
        {tabs.map((tab) => {
          const active = isMiSolicitudesTabActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(SECTION_TAB, active ? SECTION_TAB_ACTIVE : SECTION_TAB_INACTIVE)}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 7: Correr el archivo y verificar que pasa**

Run: `npx vitest run tests/section-tabs.test.ts` → Expected: PASS (8 + 5 + 3 = 16 tests).

- [ ] **Step 8: Mutaciones**

(a) En `solicitudes-tabs.tsx` (admin) cambiar `active ? SECTION_TAB_ACTIVE : SECTION_TAB_INACTIVE` por `SECTION_TAB_INACTIVE` → Expected: FAIL "marca exactamente una pestaña…". Restaurar.
(b) En `mi-tabs.tsx` agregar la línea `import { SECTION_TAB } from "@/lib/ui/section-tabs";` → Expected: FAIL "la nav del shell de /mi NO usa el módulo". Restaurar (y verificar con `git diff src/components/mi/mi-tabs.tsx` que quedó vacío).

- [ ] **Step 9: Suite completa, tipos y lint**

Run: `npm test` → Expected: todo en verde (en particular `treasury-manual-collection`, `socios-tabs`, `solicitudes-tabs`, `treasury-tabs`, `mi-solicitudes-tabs`, sin tocar una aserción). Run: `npx tsc --noEmit -p tsconfig.json` y `npx eslint src/components/admin/treasury-tabs.tsx src/components/admin/socios-tabs.tsx src/components/admin/solicitudes-tabs.tsx src/components/mi/solicitudes-tabs.tsx tests/section-tabs.test.ts` → sin errores.

- [ ] **Step 10: Commit**

```bash
git add src/components/admin/treasury-tabs.tsx src/components/admin/socios-tabs.tsx src/components/admin/solicitudes-tabs.tsx src/components/mi/solicitudes-tabs.tsx tests/section-tabs.test.ts
git commit -m "feat(tabs): folder-style section tabs on the four URL tab bars

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Las cuatro barras Radix

**Files:**
- Modify: `src/components/admin/member-tabs.tsx`
- Modify: `src/app/admin/configuracion/config-tabs.tsx`
- Modify: `src/app/admin/salud/salud-tabs.tsx`
- Modify: `src/app/admin/documentos/documentos-tabs.tsx`
- Test: `tests/section-tabs.test.ts` (extender)

**Interfaces:**
- Consumes: `SECTION_TABS_RADIX_LIST`, `SECTION_TAB_RADIX_TRIGGER`, `SECTION_TAB_ICON` de `@/lib/ui/section-tabs`; `variant="section"` de `TabsList`.
- Produces: nada nuevo; las props no cambian.

- [ ] **Step 1: Extender el test (falla)**

En `tests/section-tabs.test.ts`, completar `SECTION_TAB_FILES`:

```ts
const SECTION_TAB_FILES = [
  "src/components/admin/treasury-tabs.tsx",
  "src/components/admin/socios-tabs.tsx",
  "src/components/admin/solicitudes-tabs.tsx",
  "src/components/mi/solicitudes-tabs.tsx",
  "src/components/admin/member-tabs.tsx",
  "src/app/admin/configuracion/config-tabs.tsx",
  "src/app/admin/salud/salud-tabs.tsx",
  "src/app/admin/documentos/documentos-tabs.tsx",
];
```

y agregar al final del archivo:

```ts
// ---- (3b) Render: una barra Radix ---------------------------------------------
describe("SaludTabs (Radix)", () => {
  async function render(actCounts: Record<string, number> = {}) {
    nav.pathname = "/admin/salud";
    const { SaludTabs } = await import("@/app/admin/salud/salud-tabs");
    return renderToStaticMarkup(
      createElement(SaludTabs, {
        actCounts,
        tareas: "PANEL-TAREAS",
        infraestructura: "PANEL-INFRA",
        dinero: "PANEL-DINERO",
        correo: "PANEL-CORREO",
      }),
    );
  }

  it("la lista es variant=section, con el riel y sin el pb-2 del subrayado viejo", async () => {
    const html = await render();
    expect(html).toContain('data-variant="section"');
    expect(html).toContain('aria-label="Secciones de salud"');
    expect(html).not.toContain("pb-2");
    const list = html.match(/<div [^>]*role="tablist"[^>]*>/)?.[0] ?? "";
    expect(list).toContain("border-b");
    expect(list).toContain("items-end");
  });

  it("los cuatro triggers llevan la solapa derivada, con targets de 44px", async () => {
    const html = await render();
    const triggers = html.match(/<button [^>]*role="tab"[^>]*>/g) ?? [];
    expect(triggers).toHaveLength(4);
    for (const t of triggers) {
      expect(t).toContain("min-h-11");
      expect(t).toContain("data-active:bg-card");
      expect(t).toContain("data-[state=inactive]:hover:bg-muted");
      expect(t).not.toContain("after:bg-primary");
    }
    expect(html.match(/data-state="active"/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("la alerta roja de Salud sigue roja y con su sr-only, fuera del contador celeste", async () => {
    const html = await render({ dinero: 1 });
    expect(html).toContain("text-destructive");
    expect(html).toContain(", 1 para atender");
    expect(html).not.toContain("text-primary");
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/section-tabs.test.ts`
Expected: FAIL — los cuatro archivos Radix en "de fuente" (importan `variant="line"`, no importan del módulo) y los tres de `SaludTabs`.

- [ ] **Step 3: `member-tabs.tsx`**

Reemplazar el import de `ui/tabs` y el JSX de la lista (líneas 13 y 38-47). Mantener intacto el `onValueChange`.

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SECTION_TAB_RADIX_TRIGGER, SECTION_TABS_RADIX_LIST } from "@/lib/ui/section-tabs";
```

```tsx
      {/* Solapa "Carpeta" (src/lib/ui/section-tabs.ts). `variant="section"`
          apaga las reglas de estado de `line`, que pesan más que `data-active:`. */}
      <TabsList
        variant="section"
        aria-label="Secciones de la ficha"
        className={SECTION_TABS_RADIX_LIST}
      >
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className={SECTION_TAB_RADIX_TRIGGER}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
```

(`aria-label` es el único extra no visual del plan: era la única lista sin etiqueta.)

- [ ] **Step 4: `config-tabs.tsx`**

Agregar el import y reemplazar el comentario + `TabsList` + `TabsTrigger` (líneas 57-79):

```tsx
import { SECTION_TAB_ICON, SECTION_TAB_RADIX_TRIGGER, SECTION_TABS_RADIX_LIST } from "@/lib/ui/section-tabs";
```

```tsx
      {/* Solapa "Carpeta" (src/lib/ui/section-tabs.ts). `variant="section"`
          apaga las reglas de estado de `line`, que pesan más que `data-active:`. */}
      <TabsList
        variant="section"
        aria-label="Secciones de configuración"
        className={SECTION_TABS_RADIX_LIST}
      >
        {CONFIG_TABS.map((t) => {
          const Icon = ICONS[t.icon];
          return (
            <TabsTrigger key={t.value} value={t.value} className={SECTION_TAB_RADIX_TRIGGER}>
              <Icon className={SECTION_TAB_ICON} aria-hidden />
              {t.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
```

- [ ] **Step 5: `salud-tabs.tsx`**

Agregar el import y reemplazar el comentario + `TabsList` + `TabsTrigger` (líneas 64-94). El contador rojo y su `sr-only` quedan tal cual:

```tsx
import { SECTION_TAB_ICON, SECTION_TAB_RADIX_TRIGGER, SECTION_TABS_RADIX_LIST } from "@/lib/ui/section-tabs";
```

```tsx
      {/* Solapa "Carpeta" (src/lib/ui/section-tabs.ts). `variant="section"`
          apaga las reglas de estado de `line`, que pesan más que `data-active:`. */}
      <TabsList variant="section" aria-label="Secciones de salud" className={SECTION_TABS_RADIX_LIST}>
        {SALUD_TABS.map((t) => {
          const Icon = ICONS[t.icon];
          const count = actCounts[t.value] ?? 0;
          return (
            <TabsTrigger key={t.value} value={t.value} className={SECTION_TAB_RADIX_TRIGGER}>
              <Icon className={SECTION_TAB_ICON} aria-hidden />
              {t.label}
              {count > 0 && (
                <>
                  <span aria-hidden className="font-mono text-xs font-semibold tabular-nums text-destructive">
                    {count}
                  </span>
                  <span className="sr-only">, {count} para atender</span>
                </>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
```

- [ ] **Step 6: `documentos-tabs.tsx`**

Agregar el import y reemplazar el comentario + `TabsList` + `TabsTrigger` (líneas 53-74):

```tsx
import { SECTION_TAB_ICON, SECTION_TAB_RADIX_TRIGGER, SECTION_TABS_RADIX_LIST } from "@/lib/ui/section-tabs";
```

```tsx
      {/* Solapa "Carpeta" (src/lib/ui/section-tabs.ts). `variant="section"`
          apaga las reglas de estado de `line`, que pesan más que `data-active:`. */}
      <TabsList variant="section" aria-label="Tipos de documento" className={SECTION_TABS_RADIX_LIST}>
        {DOCUMENTOS_TABS.map((t) => {
          const Icon = ICONS[t.icon];
          return (
            <TabsTrigger key={t.value} value={t.value} className={SECTION_TAB_RADIX_TRIGGER}>
              <Icon className={SECTION_TAB_ICON} aria-hidden />
              {t.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
```

- [ ] **Step 7: Correr el archivo y verificar que pasa**

Run: `npx vitest run tests/section-tabs.test.ts` → Expected: PASS (8 + 9 + 3 + 3 = 23 tests).

- [ ] **Step 8: Mutación**

En `salud-tabs.tsx` volver `variant="section"` a `variant="line"` → Expected: FAIL en "de fuente" (salud-tabs) y en "la lista es variant=section". Restaurar. PASS.

- [ ] **Step 9: Suite completa, tipos y lint**

Run: `npm test` → Expected: todo en verde; `documentos-tabs-component`, `admin-health-screen`, `config-tabs`, `salud-tabs`, `documentos-tabs` sin tocar una aserción. Run: `npx tsc --noEmit -p tsconfig.json` y `npx eslint src/components/admin/member-tabs.tsx src/app/admin/configuracion/config-tabs.tsx src/app/admin/salud/salud-tabs.tsx src/app/admin/documentos/documentos-tabs.tsx tests/section-tabs.test.ts` → sin errores.

- [ ] **Step 10: Verificar que el alcance no se pasó de la raya**

Run: `git diff --stat main -- src/lib/treasury src/lib/mp src/components/mi/mi-tabs.tsx` → Expected: vacío.

- [ ] **Step 11: Commit**

```bash
git add src/components/admin/member-tabs.tsx src/app/admin/configuracion/config-tabs.tsx src/app/admin/salud/salud-tabs.tsx src/app/admin/documentos/documentos-tabs.tsx tests/section-tabs.test.ts
git commit -m "feat(tabs): folder-style section tabs on the four Radix tab bars

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Verificación en vivo y documentación

**Files:**
- Modify: `CLAUDE.md` (sección "Panel de administración: shell y patrones", después del bullet "Badges de estado", línea 88)
- Create: `.superpowers/section-tabs/` (capturas; carpeta gitignored, no se commitea)

**Interfaces:**
- Consumes: todo lo anterior. Produces: nada.

- [ ] **Step 1: Levantar el dev server e iniciar sesión**

Usar el preview `sigev-dev` (`.claude/launch.json`, puerto 3000). Iniciar sesión con un usuario admin/superadmin y con un socio del entorno local (ver `docs/11` o `scripts/seed*` para las credenciales locales; NUNCA usar credenciales de producción).

- [ ] **Step 2: Recorrer las nueve pantallas y capturar**

En modo claro y oscuro, guardando cada captura en `.superpowers/section-tabs/<pantalla>-<modo>.png`:

| Pantalla | Qué mirar |
|---|---|
| `/mi/solicitudes` y `/mi/solicitudes/reportes` | la solapa se distingue de la nav del shell de arriba; 44 px de alto; sobre el fondo gris la solapa blanca se lee como parte de la tarjeta |
| `/admin/solicitudes`, `/socios`, `/reportes` | contador celeste en la activa, gris en las otras; los segmentos Pendientes \| Historial de abajo siguen iguales |
| `/admin/socios` (Padrón \| Libros \| Histórico) | íconos alineados con el texto |
| `/admin/socios/[id]?tab=cuenta` | Radix: la activa es la solapa, ninguna línea de Radix asoma por debajo, el contenido arranca a la misma distancia que antes |
| `/admin/tesoreria/deudores` a **375 px** de ancho | ocho pestañas con scroll horizontal; el anillo de foco no se recorta (Tab hasta una pestaña) |
| `/admin/configuracion`, `/admin/salud`, `/admin/documentos` | íconos, alerta roja de Salud (si hay una `act`), chips de año de Documentos intactos debajo |
| Impresión de la ficha (`Ctrl+P` o `media: print` en DevTools) | la barra no se imprime (ya estaba en `print:hidden`) |

Foco por teclado en una barra por URL (`/admin/tesoreria`) y una Radix (`/admin/configuracion`): el anillo rodea la solapa completa.

- [ ] **Step 3: Si algo se ve mal, arreglar en el MÓDULO**

Cualquier ajuste de clases se hace en `src/lib/ui/section-tabs.ts`, nunca en un componente. Si hay que cambiar una constante, actualizar la aserción correspondiente de `tests/section-tabs.test.ts` en el mismo commit y volver a correr `npm test`.

- [ ] **Step 4: Documentar el patrón en `CLAUDE.md`**

Insertar después del bullet "Badges de estado" (línea 88):

```markdown
- **Pestañas de sección: solapa "Carpeta" desde `src/lib/ui/section-tabs.ts`**
  (02/09/2026). Tres niveles con tres formas: la nav del shell de `/mi` es
  subrayado (`mi-tabs.tsx`, NO usa el módulo), las pestañas de sección son
  solapas (las 5 por URL y las 4 Radix, con `TabsList variant="section"`) y los
  filtros de vista son segmentos (`FilterChips`). Una barra nueva importa las
  constantes del módulo; `tests/section-tabs.test.ts` lo fija de fuente. Ojo
  Radix: `data-active` de shadcn es un `:where()` de especificidad cero y las
  reglas de `variant="line"` pesan más, así que un override por `className`
  sobre `line` pierde siempre — por eso existe la variante `section`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: folder-style section tabs pattern in CLAUDE.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Informe final al operador**

Resumen con: capturas antes/después de `/mi/solicitudes` y `/admin/solicitudes`, resultado de `npm test` (conteo), `git log --oneline main..section-tabs`, y `git diff --stat main -- src/lib/treasury src/lib/mp` vacío. Ofrecer merge a `main`; el push lo corre el operador.
