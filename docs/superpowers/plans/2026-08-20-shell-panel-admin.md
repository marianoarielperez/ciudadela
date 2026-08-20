# Shell del panel de administración — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Darle al panel de admin navegación persistente (lateral colapsable en escritorio, cajón en móvil), encabezado de página compartido y los patrones FormMessage/EmptyState, según `docs/superpowers/specs/2026-08-20-shell-panel-admin-design.md`.

**Architecture:** Configuración de nav declarativa y pura en `src/lib/admin/nav.ts` (testeable en node); componentes cliente solo donde hace falta (`usePathname`, colapso, cajón); el layout sigue siendo server component que lee `requireAdmin()`, `auth()` y la cookie de colapso. Los patrones (PageHeader, FormMessage, EmptyState) son componentes chicos de servidor que las 16 pantallas adoptan por migración mecánica.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (`@theme` en CSS), shadcn/radix-ui (ya instalado), lucide-react (ya instalado), Vitest en node (sin jsdom).

## Global Constraints

- UI en es-AR ("vos"); código, variables y commits en inglés. Comentarios de código en español explicando el porqué (convención del repo).
- **PROHIBIDO tocar**: `src/components/public/**`, `src/app/(public)/**`, `src/app/not-found.tsx`, `src/app/error.tsx`, `src/components/ui/{button,card,input,label}.tsx`. En `globals.css` SOLO lo que este plan indica (tokens `--sidebar-*`, `--success`, `--warning`).
- `src/app/mi/**` solo recibe el cambio del Task 5 (SignOutButton); cero cambio visual.
- No se agregan dependencias a `package.json`. No hay migraciones de Prisma en este módulo.
- Tests con Vitest en node: solo `tests/**/*.test.ts` (los `.tsx` no se recogen — no intentar tests de render). Suite base: 689 tests verdes.
- Gates por task: `npx vitest run` + `npx tsc --noEmit`. Al final: `npm run lint` y `npm run build`.
- Commits frecuentes con el trailer `Co-Authored-By` habitual. **NO pushear**: Mariano pushea.
- Rama de trabajo: `feature/panel-shell` desde `main`.

---

### Task 1: Configuración de navegación (funciones puras + tests)

**Files:**
- Create: `src/lib/admin/nav.ts`
- Test: `tests/admin-nav.test.ts`

**Interfaces:**
- Consumes: `isSuperadmin(roles: string[])` de `src/lib/auth/roles.ts` (ya existe).
- Produces: `ADMIN_NAV: AdminNavGroup[]`, `navForRoles(roles: string[]): AdminNavGroup[]`, `isNavItemActive(pathname: string, href: string): boolean`, `parseSidebarState(value: string | undefined): "expanded" | "collapsed"`, `SIDEBAR_COOKIE = "sigev_sidebar"`, tipos `AdminNavItem`, `AdminNavGroup`, `AdminNavIcon`. Los usan Tasks 6, 7 y 13.

- [ ] **Step 0: Crear la rama**

```bash
git checkout -b feature/panel-shell
```

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/admin-nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, isNavItemActive, navForRoles, parseSidebarState } from "@/lib/admin/nav";

describe("navForRoles", () => {
  it("hides superadmin-only items from plain admins", () => {
    const groups = navForRoles(["admin"]);
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/admin/socios");
    expect(hrefs).not.toContain("/admin/configuracion");
  });

  it("keeps superadmin-only items for superadmin", () => {
    const hrefs = navForRoles(["superadmin"]).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/admin/configuracion");
  });

  it("drops groups left empty by the filter", () => {
    // "Sistema" solo tiene Configuración: para un admin común el grupo entero desaparece.
    const labels = navForRoles(["admin"]).map((g) => g.label);
    expect(labels).not.toContain("Sistema");
  });

  it("keeps every live section for superadmin, in stable order", () => {
    const hrefs = navForRoles(["superadmin", "admin"]).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual([
      "/admin", "/admin/socios", "/admin/actas",
      "/admin/noticias", "/admin/actividades", "/admin/configuracion",
    ]);
  });

  it("does not mutate ADMIN_NAV", () => {
    const before = JSON.stringify(ADMIN_NAV);
    navForRoles(["admin"]);
    expect(JSON.stringify(ADMIN_NAV)).toBe(before);
  });
});

describe("isNavItemActive", () => {
  it("marks Inicio only on the exact dashboard route", () => {
    expect(isNavItemActive("/admin", "/admin")).toBe(true);
    expect(isNavItemActive("/admin/socios", "/admin")).toBe(false);
  });

  it("marks a section on its root and nested routes", () => {
    expect(isNavItemActive("/admin/socios", "/admin/socios")).toBe(true);
    expect(isNavItemActive("/admin/socios/143", "/admin/socios")).toBe(true);
    expect(isNavItemActive("/admin/socios/carga/45", "/admin/socios")).toBe(true);
    expect(isNavItemActive("/admin/socios/143/baja", "/admin/socios")).toBe(true);
  });

  it("does not match sibling prefixes", () => {
    // "/admin/socios" NO debe activar un hipotético "/admin/soc".
    expect(isNavItemActive("/admin/socios", "/admin/soc")).toBe(false);
    expect(isNavItemActive("/admin/actas", "/admin/actividades")).toBe(false);
  });
});

describe("parseSidebarState", () => {
  it("falls back to expanded on missing or garbage values", () => {
    expect(parseSidebarState(undefined)).toBe("expanded");
    expect(parseSidebarState("")).toBe("expanded");
    expect(parseSidebarState("weird")).toBe("expanded");
  });

  it("honours collapsed", () => {
    expect(parseSidebarState("collapsed")).toBe("collapsed");
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/admin-nav.test.ts`
Expected: FAIL — `Cannot find module '@/lib/admin/nav'`.

- [ ] **Step 3: Implementar `src/lib/admin/nav.ts`**

```ts
// Configuración declarativa de la navegación del panel. Vive separada de los
// componentes para poder testearla en node sin DOM (patrón del proyecto) y para
// que M3-M6 agreguen secciones tocando SOLO este array (spec 2026-08-20 §3.1).
import { isSuperadmin } from "@/lib/auth/roles";

export type AdminNavIcon =
  | "home" | "users" | "scroll-text" | "newspaper" | "calendar-days" | "settings";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: AdminNavIcon;
  /** Oculta el ítem para admins comunes. La guarda real sigue en el servidor. */
  superadminOnly?: boolean;
};

export type AdminNavGroup = { label: string | null; items: AdminNavItem[] };

// Solo secciones vivas: el roadmap ("Próximamente") queda en las tarjetas de /admin.
export const ADMIN_NAV: AdminNavGroup[] = [
  { label: null, items: [{ href: "/admin", label: "Inicio", icon: "home" }] },
  {
    label: "Gestión",
    items: [
      { href: "/admin/socios", label: "Socios", icon: "users" },
      { href: "/admin/actas", label: "Actas", icon: "scroll-text" },
    ],
  },
  {
    label: "Contenido",
    items: [
      { href: "/admin/noticias", label: "Noticias", icon: "newspaper" },
      { href: "/admin/actividades", label: "Actividades", icon: "calendar-days" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { href: "/admin/configuracion", label: "Configuración", icon: "settings", superadminOnly: true },
    ],
  },
];

export function navForRoles(roles: string[]): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.superadminOnly || isSuperadmin(roles)),
  })).filter((group) => group.items.length > 0);
}

// `/admin` es prefijo de TODAS las rutas del panel: Inicio solo matchea exacto.
// El resto marca también sus subrutas (`/admin/socios/carga/45` → Socios),
// comparando contra `href + "/"` para no confundir prefijos hermanos.
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

export type SidebarState = "expanded" | "collapsed";

export const SIDEBAR_COOKIE = "sigev_sidebar";

// La escribe el cliente (toggle) y la lee el layout del servidor para renderizar
// el estado correcto de entrada, sin flash. Basura o ausencia caen a "expanded".
export function parseSidebarState(value: string | undefined): SidebarState {
  return value === "collapsed" ? "collapsed" : "expanded";
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run tests/admin-nav.test.ts` → PASS (10 tests).
Run: `npx tsc --noEmit` → sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/nav.ts tests/admin-nav.test.ts
git commit -m "feat: data-driven admin nav config with role filter and active-route logic"
```

---

### Task 2: Mapas estado→badge y labels de noticias (+ tests)

**Files:**
- Create: `src/lib/admin/status-badges.ts`
- Create: `src/lib/news/labels.ts`
- Test: `tests/status-badges.test.ts`

**Interfaces:**
- Consumes: tipos `MemberStatus`, `NewsStatus` de `@/generated/prisma/client`.
- Produces: `memberStatusBadgeVariant(status): BadgeVariant`, `newsStatusBadgeVariant(status): BadgeVariant`, `activityBadgeVariant(active: boolean): BadgeVariant` y `NEWS_STATUS_LABELS: Record<NewsStatus, string>`. Los usan Tasks 8, 11 y 12.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/status-badges.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  activityBadgeVariant, memberStatusBadgeVariant, newsStatusBadgeVariant,
} from "@/lib/admin/status-badges";
import { NEWS_STATUS_LABELS } from "@/lib/news/labels";

describe("memberStatusBadgeVariant", () => {
  // El mapa canónico es el que usaba el padrón; la ficha había divergido
  // (colapsaba suspended en outline). Un suspendido se ve IGUAL en todos lados.
  it("maps each member status", () => {
    expect(memberStatusBadgeVariant("active")).toBe("default");
    expect(memberStatusBadgeVariant("suspended")).toBe("secondary");
    expect(memberStatusBadgeVariant("withdrawn")).toBe("outline");
  });
});

describe("newsStatusBadgeVariant", () => {
  it("maps each news status", () => {
    expect(newsStatusBadgeVariant("published")).toBe("default");
    expect(newsStatusBadgeVariant("draft")).toBe("secondary");
  });
});

describe("activityBadgeVariant", () => {
  it("maps active flag", () => {
    expect(activityBadgeVariant(true)).toBe("default");
    expect(activityBadgeVariant(false)).toBe("secondary");
  });
});

describe("NEWS_STATUS_LABELS", () => {
  it("covers both statuses in es-AR", () => {
    expect(NEWS_STATUS_LABELS.draft).toBe("Borrador");
    expect(NEWS_STATUS_LABELS.published).toBe("Publicada");
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/status-badges.test.ts` → FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar**

`src/lib/admin/status-badges.ts`:

```ts
// Mapa único estado→variante de Badge. Antes cada pantalla tenía su ternario y
// divergieron: un suspendido se veía "secondary" en el padrón y "outline" en su
// propia ficha. El del padrón era el más expresivo: queda como canónico.
import type { MemberStatus, NewsStatus } from "@/generated/prisma/client";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";

export function memberStatusBadgeVariant(status: MemberStatus): BadgeVariant {
  if (status === "active") return "default";
  if (status === "suspended") return "secondary";
  return "outline";
}

export function newsStatusBadgeVariant(status: NewsStatus): BadgeVariant {
  return status === "published" ? "default" : "secondary";
}

export function activityBadgeVariant(active: boolean): BadgeVariant {
  return active ? "default" : "secondary";
}
```

`src/lib/news/labels.ts`:

```ts
// Etiquetas es-AR del estado de noticias. Antes vivían como const local en
// admin/noticias/page.tsx, con el mismo nombre que las del padrón: un solo lugar.
import type { NewsStatus } from "@/generated/prisma/client";

export const NEWS_STATUS_LABELS: Record<NewsStatus, string> = {
  draft: "Borrador",
  published: "Publicada",
};
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run tests/status-badges.test.ts` → PASS.
Run: `npx tsc --noEmit` → sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/status-badges.ts src/lib/news/labels.ts tests/status-badges.test.ts
git commit -m "feat: shared status-to-badge maps and centralized news status labels"
```

---

### Task 3: Tokens en `globals.css` (sidebar + success/warning)

**Files:**
- Modify: `src/app/globals.css` (bloques `:root` líneas ~80-87, `.dark` líneas ~116-123, `@theme inline` líneas ~7-49)

**Interfaces:**
- Produces: utilidades `bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border`, `ring-sidebar-ring`, `bg-sidebar-accent`, `text-success`, `text-warning`, `border-success/40`, `bg-warning/10`, etc. Las usan Tasks 4, 6, 7.

- [ ] **Step 1: Recalibrar `--sidebar-*` en `:root`**

Reemplazar el bloque actual de 8 variables `--sidebar*` de `:root` (valores shadcn sin consumidores — verificado en el análisis) por:

```css
  /* Shell del panel de administración (spec 2026-08-20 §3.2). El panel es
     SIEMPRE celeste profundo — no depende del modo oscuro — así que :root y
     .dark llevan los mismos valores. #003C5F deriva del --primary #0079BC
     oscurecido; el ítem activo se marca con el celeste de marca #2E9BDF, que
     sobre este fondo oscuro sí alcanza contraste de indicador (≥3:1). */
  --sidebar: #003C5F;
  --sidebar-foreground: rgb(255 255 255 / 0.85);
  --sidebar-primary: #2E9BDF;
  --sidebar-primary-foreground: #FFFFFF;
  --sidebar-accent: rgb(255 255 255 / 0.14);
  --sidebar-accent-foreground: #FFFFFF;
  --sidebar-border: rgb(255 255 255 / 0.16);
  --sidebar-ring: #9ED3F2;
```

- [ ] **Step 2: Mismo bloque en `.dark`**

Reemplazar las 8 variables `--sidebar*` de `.dark` por los MISMOS valores del Step 1 (con un comentario de una línea: `/* Panel: mismos valores que :root — ver arriba. */`).

- [ ] **Step 3: Agregar `--success` / `--warning`**

En `:root`, después de `--destructive`:

```css
  /* Feedback post-acción (FormMessage). Antes el verde/ámbar era Tailwind crudo
     copiado a mano; estos son los únicos tonos permitidos en el panel. */
  --success: #15803D;   /* green-700 — 4.54:1 sobre blanco */
  --warning: #B45309;   /* amber-700 — 4.52:1 sobre blanco */
```

En `.dark`, después de `--destructive`:

```css
  --success: #4ADE80;   /* green-400 sobre fondo oscuro */
  --warning: #FBBF24;   /* amber-400 sobre fondo oscuro */
```

En `@theme inline`, junto a `--color-destructive`:

```css
  --color-success: var(--success);
  --color-warning: var(--warning);
```

- [ ] **Step 4: Verificar**

Run: `npx vitest run` → 703 tests verdes (689 + 14 nuevos de Tasks 1-2).
Run: `npx tsc --noEmit` → sin errores.
Verificar por diff que `globals.css` solo cambió en los tres bloques indicados: `git diff src/app/globals.css`.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: repurpose dead sidebar tokens for the panel shell and add success/warning tokens"
```

---

### Task 4: Componentes de patrón — PageHeader, FormMessage, EmptyState

**Files:**
- Create: `src/components/admin/page-header.tsx`
- Create: `src/components/admin/form-message.tsx`
- Create: `src/components/admin/empty-state.tsx`

**Interfaces:**
- Produces:
  - `PageHeader({ title: string; breadcrumb?: Array<{ label: string; href?: string }>; actions?: ReactNode; children?: ReactNode })`
  - `FormMessage({ kind: "error" | "success" | "warning" | "neutral"; box?: boolean; as?: "p" | "span" | "div"; className?: string; children })`
  - `EmptyState({ description: string; action?: ReactNode; size?: "list" | "card" })`
  - Los usan Tasks 6 y 8-13.

No hay tests de render posibles (Vitest en node): el gate es `tsc` + la adopción de los tasks siguientes.

- [ ] **Step 1: `src/components/admin/page-header.tsx`**

```tsx
import Link from "next/link";

export type Crumb = { label: string; href?: string };

// Encabezado único de las pantallas del panel: migas + h1 + slot de acciones.
// flex-wrap + gap arreglan el pisado título/botón que 6 pantallas tenían en
// móvil. La última miga va sin href (es la pantalla actual).
export function PageHeader({ title, breadcrumb, actions, children }: {
  title: string;
  breadcrumb?: Crumb[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Ruta de navegación" className="text-sm text-muted-foreground">
          {breadcrumb.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`}>
              {i > 0 && <span aria-hidden> / </span>}
              {crumb.href ? (
                <Link href={crumb.href} className="text-primary hover:underline">{crumb.label}</Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: `src/components/admin/form-message.tsx`**

```tsx
import { cn } from "@/lib/utils";

const KIND_CLASSES = {
  error: "text-destructive",
  success: "text-success",
  warning: "text-warning",
  neutral: "text-muted-foreground",
} as const;

const BOX_CLASSES = {
  error: "border-destructive/40 bg-destructive/5",
  success: "border-success/40 bg-success/10",
  warning: "border-warning/40 bg-warning/10",
  neutral: "border-border bg-muted/50",
} as const;

// Mensaje post-acción único del panel (antes: 19 sitios, 6 estilos). `alert`
// interrumpe al lector de pantalla (errores y advertencias); `status` espera su
// turno (confirmaciones); los neutrales no anuncian nada. `as="span"` es para
// los dos sitios que viven dentro de una fila flex.
export function FormMessage({ kind, box = false, as: Tag = "p", className, children }: {
  kind: "error" | "success" | "warning" | "neutral";
  box?: boolean;
  as?: "p" | "span" | "div";
  className?: string;
  children: React.ReactNode;
}) {
  const role = kind === "error" || kind === "warning" ? "alert"
    : kind === "success" ? "status" : undefined;
  return (
    <Tag
      role={role}
      className={cn(
        "text-sm",
        KIND_CLASSES[kind],
        box && cn("rounded-md border p-3", BOX_CLASSES[kind]),
        className,
      )}
    >
      {children}
    </Tag>
  );
}
```

- [ ] **Step 3: `src/components/admin/empty-state.tsx`**

```tsx
// Estado vacío con la acción que lo resuelve (los de lista repiten el CTA del
// encabezado; los de tarjeta son una línea). `size="list"` reemplaza a la tabla
// entera: nunca renderizar un thead sin filas.
export function EmptyState({ description, action, size = "list" }: {
  description: string;
  action?: React.ReactNode;
  size?: "list" | "card";
}) {
  if (size === "card") {
    return <p className="text-sm text-muted-foreground">{description}</p>;
  }
  return (
    <div className="space-y-3 rounded-xl border border-dashed p-6 text-center">
      <p className="text-sm text-muted-foreground">{description}</p>
      {action && <div className="flex justify-center">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Verificar y commitear**

Run: `npx tsc --noEmit` → sin errores. `npx vitest run` → verde.

```bash
git add src/components/admin/page-header.tsx src/components/admin/form-message.tsx src/components/admin/empty-state.tsx
git commit -m "feat: shared PageHeader, FormMessage and EmptyState patterns for the admin panel"
```

---

### Task 5: SignOutButton compartido (+ adopción en `/mi`)

**Files:**
- Create: `src/components/admin/sign-out-button.tsx`
- Modify: `src/app/mi/layout.tsx` (líneas 11-18: el `<form>` inline)

**Interfaces:**
- Produces: `SignOutButton({ className?: string; iconOnly?: boolean })`. Lo usan Task 6 (lateral + estado bloqueado) y `/mi`.

- [ ] **Step 1: Crear el componente**

`src/components/admin/sign-out-button.tsx`:

```tsx
import { LogOut } from "lucide-react";

import { signOut } from "@/auth";
import { cn } from "@/lib/utils";

// El form de logout estaba copiado byte-idéntico en admin/layout.tsx y
// mi/layout.tsx. `className` gobierna la apariencia completa porque cada shell
// lo viste distinto (link subrayado en /mi, ítem claro sobre la lateral
// oscura). `iconOnly` es para la lateral colapsada: conserva el nombre
// accesible con sr-only + title.
export function SignOutButton({ className, iconOnly = false }: {
  className?: string;
  iconOnly?: boolean;
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button
        className={cn("text-sm underline", className)}
        title={iconOnly ? "Cerrar sesión" : undefined}
      >
        {iconOnly ? (
          <>
            <LogOut aria-hidden className="size-4" />
            <span className="sr-only">Cerrar sesión</span>
          </>
        ) : (
          "Cerrar sesión"
        )}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Adoptarlo en `/mi` sin cambio visual**

En `src/app/mi/layout.tsx`: borrar el `<form>` de las líneas 11-18 y poner en su lugar `<SignOutButton />` (las clases por defecto `text-sm underline` son EXACTAMENTE las del botón actual). Agregar el import `import { SignOutButton } from "@/components/admin/sign-out-button"` y borrar el import ahora sin uso de `signOut` (`@/auth`) si quedó huérfano.

- [ ] **Step 3: Verificar y commitear**

Run: `npx tsc --noEmit` y `npx vitest run` → verdes.
`git diff src/app/mi/layout.tsx` debe mostrar SOLO el reemplazo del form.

```bash
git add src/components/admin/sign-out-button.tsx src/app/mi/layout.tsx
git commit -m "feat: shared SignOutButton, adopt it in the member portal layout"
```

---

### Task 6: Lateral de escritorio + reescritura del layout

**Files:**
- Create: `src/components/admin/admin-nav-list.tsx`
- Create: `src/components/admin/admin-sidebar.tsx`
- Modify: `src/app/admin/layout.tsx` (reescritura completa)
- Add: `assets/logo-negativo.png` (ya está en el working tree, sin commitear)

**Interfaces:**
- Consumes: Task 1 (`navForRoles`, `parseSidebarState`, `SIDEBAR_COOKIE`, `isNavItemActive`, tipos), Task 4 (`FormMessage`), Task 5 (`SignOutButton`).
- Produces: `AdminNavList({ groups, collapsed? })` (client, compartido con el cajón del Task 7), `AdminSidebar({ groups, initialCollapsed, user, signOutExpanded, signOutCollapsed })`. El layout produce `<main id="contenido">` con `p-4 lg:p-6`.

- [ ] **Step 1: Lista de navegación compartida**

`src/components/admin/admin-nav-list.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays, Home, Newspaper, ScrollText, Settings, Users,
} from "lucide-react";

import { isNavItemActive, type AdminNavGroup, type AdminNavIcon } from "@/lib/admin/nav";
import { cn } from "@/lib/utils";

// El mapa nombre→componente vive acá y no en nav.ts para que la config sea
// serializable y testeable en node (lucide no carga fuera del bundle cliente).
const ICONS: Record<AdminNavIcon, typeof Home> = {
  home: Home,
  users: Users,
  "scroll-text": ScrollText,
  newspaper: Newspaper,
  "calendar-days": CalendarDays,
  settings: Settings,
};

// La misma lista sirve a la lateral (colapsable) y al cajón móvil (siempre
// expandido). Ítems con min-h-11 en el cajón vía padding: targets ≥44px.
export function AdminNavList({ groups, collapsed = false }: {
  groups: AdminNavGroup[];
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones del panel" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
      {groups.map((group, i) => (
        <div key={group.label ?? `top-${i}`} className="flex flex-col gap-0.5">
          {group.label && (collapsed ? (
            <hr className="mx-2 my-2 border-sidebar-border" />
          ) : (
            <p className="px-3 pt-4 pb-1 text-[10px] font-bold tracking-widest uppercase text-sidebar-foreground/50">
              {group.label}
            </p>
          ))}
          {group.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm outline-none",
                  "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active
                    ? "bg-sidebar-accent font-semibold text-sidebar-primary-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]"
                    : "hover:bg-sidebar-accent/60",
                  collapsed && "justify-center px-0",
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0 opacity-80" />
                <span className={cn(collapsed && "sr-only")}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: La lateral**

`src/components/admin/admin-sidebar.tsx`:

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import logoNegativo from "../../../assets/logo-negativo.png";
import { AdminNavList } from "@/components/admin/admin-nav-list";
import { SIDEBAR_COOKIE, type AdminNavGroup } from "@/lib/admin/nav";
import { cn } from "@/lib/utils";

// Lateral fija de escritorio (≥lg), colapsable a íconos. El estado inicial
// viene del servidor (cookie leída en el layout): sin flash de hidratación.
// signOutExpanded/signOutCollapsed son dos nodos porque SignOutButton es un
// server component y el cliente solo elige cuál mostrar.
export function AdminSidebar({ groups, initialCollapsed, user, signOutExpanded, signOutCollapsed }: {
  groups: AdminNavGroup[];
  initialCollapsed: boolean;
  user: { name: string; roleLabel: string };
  signOutExpanded: React.ReactNode;
  signOutCollapsed: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // Un año: preferencia de UI del operador, no un dato sensible.
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex",
        collapsed ? "w-14" : "w-[230px]",
      )}
    >
      <Link
        href="/admin"
        className={cn(
          "m-2 flex items-center gap-2.5 rounded-md px-2 py-3 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          collapsed && "justify-center px-0",
        )}
      >
        <Image src={logoNegativo} alt="" className="h-8 w-auto" priority />
        <span className={cn("leading-tight", collapsed && "sr-only")}>
          <span className="block text-sm font-semibold text-white">SIGeV</span>
          <span className="block text-[10.5px] text-sidebar-foreground/60">Panel de administración</span>
        </span>
      </Link>
      <AdminNavList groups={groups} collapsed={collapsed} />
      <div className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <p className="mb-2 text-xs">
            {user.name}
            <span className="block text-[10.5px] text-sidebar-foreground/60">{user.roleLabel}</span>
          </p>
        )}
        <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between gap-2")}>
          {collapsed ? signOutCollapsed : signOutExpanded}
          <button
            onClick={toggle}
            title={collapsed ? "Expandir navegación" : "Colapsar navegación"}
            className="flex size-8 items-center justify-center rounded-md outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            {collapsed ? <ChevronsRight aria-hidden className="size-4" /> : <ChevronsLeft aria-hidden className="size-4" />}
            <span className="sr-only">{collapsed ? "Expandir navegación" : "Colapsar navegación"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Reescribir `src/app/admin/layout.tsx`**

Contenido completo nuevo (conservar los DOS comentarios largos existentes — el de `requireAdmin` y el del rebote de `/ingresar` — moviéndolos a su lugar):

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { FormMessage } from "@/components/admin/form-message";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { navForRoles, parseSidebarState, SIDEBAR_COOKIE } from "@/lib/admin/nav";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSuperadmin } from "@/lib/auth/roles";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // [comentario existente de requireAdmin: los roles del token NO alcanzan…]
  const actor = await requireAdmin();

  if (!actor.ok) {
    // [comentario existente del rebote /ingresar → /redirigir → /admin…]
    if (actor.reason === "anonymous") redirect("/ingresar");
    // Bloqueado con sesión: barra mínima SIN navegación (no se muestra el mapa
    // del panel a quien no está habilitado) + motivo + salida. Antes esta
    // pantalla no ofrecía ninguna acción.
    return (
      <div className="min-h-screen">
        <header className="flex items-center justify-between bg-sidebar px-4 py-3">
          <span className="text-sm font-semibold text-white">SIGeV — Panel de administración</span>
          <SignOutButton className="text-white/85 hover:text-white" />
        </header>
        <main className="mx-auto w-full max-w-2xl p-4">
          <div className="space-y-3 rounded-xl border p-4">
            <h1 className="text-xl font-semibold">El panel no está disponible</h1>
            <FormMessage kind="error">{actor.error}</FormMessage>
          </div>
        </main>
      </div>
    );
  }

  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const roles = session?.user.roles ?? [];

  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Saltar al contenido
      </a>
      <AdminSidebar
        groups={navForRoles(roles)}
        initialCollapsed={parseSidebarState(cookieStore.get(SIDEBAR_COOKIE)?.value) === "collapsed"}
        user={{
          name: session?.user.name ?? "—",
          roleLabel: isSuperadmin(roles) ? "superadmin" : "admin",
        }}
        signOutExpanded={
          <SignOutButton className="text-xs text-sidebar-foreground/80 hover:text-white" />
        }
        signOutCollapsed={
          <SignOutButton
            iconOnly
            className="flex size-8 items-center justify-center rounded-md no-underline hover:bg-sidebar-accent/60"
          />
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* La barra móvil llega en el task siguiente (AdminMobileNav). */}
        <main id="contenido" tabIndex={-1} className="flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verificar**

Run: `npx vitest run` y `npx tsc --noEmit` → verdes.
Levantar `npm run dev` y entrar a `/admin` logueado (credenciales locales de siempre): lateral visible ≥1024px con Inicio activo solo en `/admin`, Socios activo en `/admin/socios/…`; colapsar → recargar → sigue colapsada (cookie); con un admin común la nav NO muestra Configuración; deslogueado → redirect a `/ingresar`.

- [ ] **Step 5: Commit (incluye el asset)**

```bash
git add assets/logo-negativo.png src/components/admin/admin-nav-list.tsx src/components/admin/admin-sidebar.tsx src/app/admin/layout.tsx
git commit -m "feat: persistent collapsible sidebar navigation for the admin panel"
```

---

### Task 7: Barra móvil + cajón

**Files:**
- Create: `src/components/admin/admin-mobile-nav.tsx`
- Modify: `src/app/admin/layout.tsx` (insertar `<AdminMobileNav …>` donde está el comentario placeholder)

**Interfaces:**
- Consumes: `AdminNavList` (Task 6), tipos de Task 1, `SignOutButton` (Task 5).
- Produces: `AdminMobileNav({ groups, user, signOut })`.

- [ ] **Step 1: El componente**

`src/components/admin/admin-mobile-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { Menu, X } from "lucide-react";

import { AdminNavList } from "@/components/admin/admin-nav-list";
import type { AdminNavGroup } from "@/lib/admin/nav";

// Barra superior (<lg) + cajón sobre las primitivas de Dialog de radix: foco
// atrapado, Escape y scroll-lock vienen gratis. Se cierra al navegar (efecto
// sobre pathname) y al tocar el overlay. Animación anulada con motion-reduce.
export function AdminMobileNav({ groups, user, signOut }: {
  groups: AdminNavGroup[];
  user: { name: string; roleLabel: string };
  signOut: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 flex items-center gap-2 bg-sidebar px-2 py-1.5 lg:hidden">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger
          className="flex size-11 items-center justify-center rounded-md text-white outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Menu aria-hidden className="size-5" />
          <span className="sr-only">Abrir la navegación</span>
        </Dialog.Trigger>
        <Link href="/admin" className="text-sm font-semibold text-white">
          SIGeV — Panel
        </Link>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar py-2 text-sidebar-foreground data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none"
          >
            <div className="flex items-center justify-between px-3 pb-2">
              <Dialog.Title className="text-sm font-semibold text-white">
                SIGeV — Panel de administración
              </Dialog.Title>
              <Dialog.Close className="flex size-11 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                <X aria-hidden className="size-5" />
                <span className="sr-only">Cerrar la navegación</span>
              </Dialog.Close>
            </div>
            <AdminNavList groups={groups} />
            <div className="border-t border-sidebar-border p-3">
              <p className="mb-2 text-xs">
                {user.name}
                <span className="block text-[10.5px] text-sidebar-foreground/60">{user.roleLabel}</span>
              </p>
              {signOut}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </header>
  );
}
```

Nota: si las utilidades `animate-in`/`slide-in-from-left` de `tw-animate-css` no existieran con esos nombres, quitar SOLO las clases de animación (el cajón funciona sin animar) y anotarlo en el commit.

- [ ] **Step 2: Integrarlo en el layout**

En `src/app/admin/layout.tsx`, reemplazar el comentario placeholder por:

```tsx
<AdminMobileNav
  groups={navForRoles(roles)}
  user={{ name: session?.user.name ?? "—", roleLabel: isSuperadmin(roles) ? "superadmin" : "admin" }}
  signOut={<SignOutButton className="text-xs text-sidebar-foreground/80 hover:text-white" />}
/>
```

(Extraer `groups` y `user` a consts arriba del `return` para no computarlos dos veces.)

- [ ] **Step 3: Verificar**

`npx vitest run` + `npx tsc --noEmit` → verdes. En `npm run dev` con viewport 375px: barra visible, cajón abre/cierra, navega y se cierra solo, Escape cierra, el fondo no scrollea con el cajón abierto, targets ≥44px.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/admin-mobile-nav.tsx src/app/admin/layout.tsx
git commit -m "feat: mobile top bar and navigation drawer for the admin panel"
```

---

### Task 8: Migración Socios (5 pantallas + formularios)

**Files:**
- Modify: `src/app/admin/socios/page.tsx`
- Modify: `src/app/admin/socios/[id]/page.tsx`
- Modify: `src/app/admin/socios/nuevo/page.tsx` y `src/app/admin/socios/nuevo/admit-form.tsx`
- Modify: `src/app/admin/socios/[id]/[accion]/page.tsx` y `src/app/admin/socios/[id]/action-form.tsx`
- Modify: `src/app/admin/socios/carga/[numero]/page.tsx` y `src/app/admin/socios/carga/[numero]/carga-form.tsx`
- Modify: `src/components/admin/send-verification-form.tsx`

**Interfaces:** Consumes `PageHeader`, `FormMessage`, `EmptyState` (Task 4) y `memberStatusBadgeVariant` (Task 2).

- [ ] **Step 1: `socios/page.tsx` (padrón)**

1. Reemplazar el bloque título+botonera (`<div className="flex flex-wrap items-center justify-between gap-2">…</div>`) por:

```tsx
<PageHeader
  title="Socios — Libro 1"
  actions={
    <>
      <Button asChild variant="outline">
        <a href={`/api/admin/padron-export?${exportQs}`}>Exportar Excel</a>
      </Button>
      <Button asChild><Link href="/admin/socios/nuevo">Alta manual</Link></Button>
    </>
  }
/>
```

2. El contador pasa a mostrarse solo con resultados, y la tabla deja de renderizarse incondicional (bug del `thead` huérfano). Reemplazar el `<p>` contador y el `<Table>…</Table>` por:

```tsx
{total === 0 ? (
  <EmptyState
    description="Ningún socio coincide con el filtro."
    action={<Button asChild variant="outline"><Link href="/admin/socios">Limpiar filtros</Link></Button>}
  />
) : (
  <>
    <p className="text-sm text-muted-foreground">
      {`${firstShown}–${lastShown} de ${total} socios`}
      {pageCount > 1 && ` · página ${page} de ${pageCount}`}
    </p>
    <Table>
      {/* …tabla existente sin cambios estructurales, con los 3 retoques de abajo… */}
    </Table>
  </>
)}
```

3. Tres retoques dentro de la tabla: (a) el `<TableHead></TableHead>` vacío pasa a `<TableHead><span className="sr-only">Acciones</span></TableHead>`; (b) el link del nombre gana `text-primary`: `className="text-primary hover:underline"`; (c) el ternario del Badge pasa a `<Badge variant={memberStatusBadgeVariant(member.status)}>`.
4. Imports nuevos: `PageHeader`, `EmptyState`, `memberStatusBadgeVariant`.

- [ ] **Step 2: `socios/[id]/page.tsx` (ficha)**

1. Miga a mano (`<p className="text-sm text-muted-foreground">Socios / N° X</p>`) + `<h1>` + botonera → `<PageHeader title={member.fullName} breadcrumb={[{ label: "Socios", href: "/admin/socios" }, { label: \`N° ${memberNumber}\` }]} actions={…botonera condicional existente sin cambios…}>` con la fila de badges existente como `children`.
2. El ternario del Badge de estado pasa a `memberStatusBadgeVariant(member.status)` (esto CORRIGE la divergencia: suspendido ahora se ve `secondary` como en el padrón).
3. Los vacíos "Sin movimientos." y "Sin notificaciones." pasan a `<EmptyState size="card" description="Sin movimientos." />` (ídem notificaciones).

- [ ] **Step 3: `socios/nuevo`**

`page.tsx`: miga + `<h1>` → `<PageHeader title="Alta manual" breadcrumb={[{ label: "Socios", href: "/admin/socios" }, { label: "Alta manual" }]} />`.
`admit-form.tsx`: `{state.error && <p role="alert" className="text-sm text-destructive">…}` → `{state.error && <FormMessage kind="error">{state.error}</FormMessage>}`.

- [ ] **Step 4: `socios/[id]/[accion]`**

`page.tsx`: miga → `PageHeader` con `breadcrumb={[{ label: "Socios", href: "/admin/socios" }, { label: member.fullName, href: \`/admin/socios/${member.id}\` }, { label: <título por acción> }]}`, donde la última hoja reutiliza el MISMO string que hoy alimenta el `<h1>` variable por slug (ya definido en ese archivo; pasarlo también como `title`). El `warning` REG-16 (caja destructive SIN role, ~línea 154) → `<FormMessage kind="warning" box>{…}</FormMessage>`; el bloqueo real (~línea 161) → `<FormMessage kind="error" box>{…}</FormMessage>`. El botón "Volver a la ficha" queda como está.
`action-form.tsx`: línea de error → `FormMessage kind="error"`.

- [ ] **Step 5: `socios/carga/[numero]`**

`page.tsx`: miga → `PageHeader` (`breadcrumb`: Socios → `/admin/socios`, hoja "Modo carga"; título `N° X — Nombre` existente; los botones prev/next existentes van en `actions`).
`carga-form.tsx`: "Guardado ✓" → `<FormMessage kind="success" as="span">Guardado ✓</FormMessage>`; "Sin cambios que guardar" y "Cambios sin guardar" → `kind="neutral" as="span"`; el ámbar → `kind="warning" as="span"`; el error → `kind="error" as="span"`. (Nota: `FormMessage` ya pone `role`; borrar los `role` manuales al migrar.)

- [ ] **Step 6: `send-verification-form.tsx`**

"Enviado ✓" → `kind="success" as="span"`; "Email verificado ✓" → `kind="success" as="span"` (gana `role="status"` que le faltaba); error → `kind="error" as="span"`.

- [ ] **Step 7: Verificar y commitear**

`npx vitest run` + `npx tsc --noEmit` → verdes. En dev: padrón con filtro sin resultados muestra EmptyState; ficha de un suspendido muestra badge gris; migas navegan.

```bash
git add src/app/admin/socios src/components/admin/send-verification-form.tsx
git commit -m "refactor: adopt PageHeader/FormMessage/EmptyState across the members section"
```

---

### Task 9: Migración Actas (4 pantallas)

**Files:**
- Modify: `src/app/admin/actas/page.tsx`, `src/app/admin/actas/nueva/page.tsx` y `nueva/minute-form.tsx`, `src/app/admin/actas/[id]/page.tsx`, `src/app/admin/actas/[id]/editar/page.tsx` y `editar/minute-edit-form.tsx`

**Interfaces:** Consumes `PageHeader`, `FormMessage`, `EmptyState`.

- [ ] **Step 1: `actas/page.tsx`** — título+botón → `<PageHeader title="Actas" actions={<Button asChild><Link href="/admin/actas/nueva">Nueva acta</Link></Button>} />`. El empty state textual → `<EmptyState description="Todavía no hay actas cargadas. Las acciones societarias (altas, bajas, cambios de categoría) se asientan siempre en un acta." action={<Button asChild><Link href="/admin/actas/nueva">Nueva acta</Link></Button>} />`.

- [ ] **Step 2: `actas/nueva`** — miga+`<h1>` → `<PageHeader title="Nueva acta" breadcrumb={[{ label: "Actas", href: "/admin/actas" }, { label: "Nueva" }]} />`. `minute-form.tsx`: error → `FormMessage kind="error"`.

- [ ] **Step 3: `actas/[id]`** — la miga de un solo eslabón + `<h1>`+botón Editar → `PageHeader` con `breadcrumb={[{ label: "Actas", href: "/admin/actas" }, { label: \`${tipoLabel} N° ${minute.number}\` }]}` y `actions={<Button asChild variant="outline"><Link href={…/editar}>Editar</Link></Button>}`. El `<h2 className="text-lg font-medium">Movimientos asentados</h2>` se normaliza a `text-lg font-semibold`. "Sin movimientos asociados." → `<EmptyState size="card" description="Sin movimientos." />` (unifica el copy con la ficha).

- [ ] **Step 4: `actas/[id]/editar`** — miga de 3 niveles → `breadcrumb={[{ label: "Actas", href: "/admin/actas" }, { label: \`${tipoLabel} N° ${minute.number}\`, href: \`/admin/actas/${minute.id}\` }, { label: "Editar" }]}`. `minute-edit-form.tsx`: error → `FormMessage kind="error"`.

- [ ] **Step 5: Verificar y commitear**

`npx vitest run` + `npx tsc --noEmit` → verdes.

```bash
git add src/app/admin/actas
git commit -m "refactor: adopt shared patterns across the minutes section"
```

---

### Task 10: Migración Actividades (3 pantallas)

**Files:**
- Modify: `src/app/admin/actividades/page.tsx`, `nueva/page.tsx`, `[id]/page.tsx`, `activity-form.tsx`

**Interfaces:** Consumes `PageHeader`, `FormMessage`, `EmptyState`, `activityBadgeVariant`.

- [ ] **Step 1: `actividades/page.tsx`** — título+botón → `<PageHeader title="Actividades de los salones" actions={<Button asChild><Link href="/admin/actividades/nueva">Nueva actividad</Link></Button>} />`. Empty state → `<EmptyState description={…texto existente con el año…} action={<Button asChild><Link href="/admin/actividades/nueva">Nueva actividad</Link></Button>} />`. Badge de estado → `activityBadgeVariant(a.active)` (labels "Activa"/"Oculta" quedan como están). El form de filtro por año NO se toca (deuda anotada).

- [ ] **Step 2: `actividades/nueva/page.tsx`** — el header con "Volver al calendario" a la derecha → `<PageHeader title="Nueva actividad" breadcrumb={[{ label: "Actividades", href: "/admin/actividades" }, { label: "Nueva" }]} />` (el link "Volver" desaparece: la miga y la lateral lo reemplazan).

- [ ] **Step 3: `actividades/[id]/page.tsx`** — ídem: `breadcrumb={[{ label: "Actividades", href: "/admin/actividades" }, { label: activity.name }]}`, título `activity.name`.

- [ ] **Step 4: `activity-form.tsx`** — las DOS líneas de error (~125 y ~159) → `FormMessage kind="error"`.

- [ ] **Step 5: Verificar y commitear**

`npx vitest run` + `npx tsc --noEmit` → verdes.

```bash
git add src/app/admin/actividades
git commit -m "refactor: adopt shared patterns across the activities section"
```

---

### Task 11: Migración Noticias (3 pantallas)

**Files:**
- Modify: `src/app/admin/noticias/page.tsx`, `nueva/page.tsx`, `[id]/page.tsx`, `news-form.tsx`

**Interfaces:** Consumes `PageHeader`, `FormMessage`, `EmptyState`, `newsStatusBadgeVariant`, `NEWS_STATUS_LABELS`.

- [ ] **Step 1: `noticias/page.tsx`** — borrar el `const STATUS_LABELS` local; importar `NEWS_STATUS_LABELS` de `@/lib/news/labels` y usarlo donde se usaba el local. Título+botón → `<PageHeader title="Noticias" actions={<Button asChild><Link href="/admin/noticias/nueva">Nueva noticia</Link></Button>} />`. Empty state → `<EmptyState description="Todavía no hay noticias. Las publicadas aparecen en la portada del sitio y en /noticias." action={<Button asChild><Link href="/admin/noticias/nueva">Nueva noticia</Link></Button>} />`. Badge → `newsStatusBadgeVariant(n.status)`.

- [ ] **Step 2: `noticias/nueva/page.tsx`** — era el callejón sin salida absoluto: `<h1>` → `<PageHeader title="Nueva noticia" breadcrumb={[{ label: "Noticias", href: "/admin/noticias" }, { label: "Nueva" }]} />`.

- [ ] **Step 3: `noticias/[id]/page.tsx`** — header → `<PageHeader title="Editar noticia" breadcrumb={[{ label: "Noticias", href: "/admin/noticias" }, { label: news.title }]} actions={…}>` donde `actions` conserva el link condicional "Ver en el sitio" y los `NewsStateButtons` existentes.

- [ ] **Step 4: `news-form.tsx`** — las DOS líneas de error (~90 y ~135) → `FormMessage kind="error"`.

- [ ] **Step 5: Verificar y commitear**

`npx vitest run` + `npx tsc --noEmit` → verdes. En dev: desde `/admin/noticias/nueva` se puede volver por miga y por lateral.

```bash
git add src/app/admin/noticias
git commit -m "refactor: adopt shared patterns across the news section, centralize status labels"
```

---

### Task 12: Migración Configuración

**Files:**
- Modify: `src/app/admin/configuracion/page.tsx`, `config-form.tsx`

**Interfaces:** Consumes `PageHeader`, `FormMessage`.

- [ ] **Step 1: `configuracion/page.tsx`** — `<h1>` → `<PageHeader title="Configuración" />` en las DOS ramas (la bloqueada por rol y la normal; la bloqueada además unifica su contenedor a `space-y-4`). El banner verde `?guardado=1` → `<FormMessage kind="success" box>Configuración guardada.</FormMessage>`. El `<p role="alert">` del bloqueo por rol → `<FormMessage kind="error">{SUPERADMIN_BLOCKED_MESSAGE}</FormMessage>` (con la lateral presente ya no es un callejón sin salida).

- [ ] **Step 2: `config-form.tsx`** — error → `FormMessage kind="error"`.

- [ ] **Step 3: Verificar y commitear**

`npx vitest run` + `npx tsc --noEmit` → verdes.

```bash
git add src/app/admin/configuracion
git commit -m "refactor: adopt shared patterns in the settings screen"
```

---

### Task 13: Inicio (dashboard) + error boundary

**Files:**
- Modify: `src/app/admin/page.tsx` (reescritura de la grilla)
- Modify: `src/app/admin/error.tsx` (botón a mano → `Button`)

**Interfaces:** Consumes `Button`, `Badge`, `isSuperadmin`, `auth()`.

- [ ] **Step 1: Reescribir `src/app/admin/page.tsx`**

```tsx
import Link from "next/link";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSuperadmin } from "@/lib/auth/roles";
import { SITE } from "@/lib/site";

export const metadata = { title: "Panel de administración — SIGeV" };

// Tarjetas agrupadas con el MISMO orden que la lateral (src/lib/admin/nav.ts).
// Acá sí aparecen las secciones futuras como "Próximamente": este es el lugar
// del roadmap; la lateral solo lista lo que funciona.
type DashboardCard = { title: string; description: string; href?: string; cta?: string; superadminOnly?: boolean };
const groups: { label: string; cards: DashboardCard[] }[] = [
  {
    label: "Gestión",
    cards: [
      { title: "Solicitudes", description: "Altas de socios pendientes de revisión y aprobación." },
      { title: "Socios", description: "Padrón, fichas y estado de cada socio.", href: "/admin/socios", cta: "Ver el padrón" },
      {
        title: "Actas",
        description: "Actas de Comisión Directiva y Asamblea donde se asientan los movimientos.",
        href: "/admin/actas",
        cta: "Ver las actas",
      },
      { title: "Tesorería", description: "Cuotas, pagos y conciliación con Mercado Pago." },
    ],
  },
  {
    label: "Contenido",
    cards: [
      { title: "Noticias", description: "Novedades y comunicados del sitio público.", href: "/admin/noticias", cta: "Gestionar noticias" },
      {
        title: "Actividades",
        // Los nombres salen de SITE.rooms, que es de donde también sale el selector
        // del formulario y la grilla pública: si alguna vez se renombra un salón, se
        // renombra en un solo lugar y esta tarjeta no queda mintiendo.
        description: `Calendario del ${SITE.rooms.historic} y el ${SITE.rooms.glass}.`,
        href: "/admin/actividades",
        cta: "Ver el calendario",
      },
    ],
  },
  {
    label: "Sistema",
    cards: [
      {
        title: "Configuración",
        description: "Parámetros del sistema.",
        href: "/admin/configuracion",
        cta: "Abrir",
        superadminOnly: true,
      },
    ],
  },
];

export default async function AdminHomePage() {
  const session = await auth();
  const superadmin = isSuperadmin(session?.user.roles ?? []);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Hola, {session?.user.name ?? "administrador/a"}</h1>
        <p className="text-muted-foreground">
          Estas son las secciones del panel. Se van a ir habilitando a medida que avancemos.
        </p>
      </div>
      {groups.map((group) => {
        const cards = group.cards.filter((c) => !c.superadminOnly || superadmin);
        if (cards.length === 0) return null;
        return (
          <section key={group.label} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{group.label}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card) => (
                <Card key={card.title}>
                  <CardHeader>
                    <CardTitle>{card.title}</CardTitle>
                    <CardDescription>{card.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {card.href ? (
                      <Button asChild size="sm">
                        <Link href={card.href}>{card.cta ?? "Abrir"}</Link>
                      </Button>
                    ) : (
                      <Badge variant="secondary">Próximamente</Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

(Nota: la tarjeta Configuración pierde el "(solo superadmin)" del texto porque ahora directamente no se muestra a quien no lo es. El `h1` pasa de `font-bold` a `font-semibold` — la única divergencia de título del panel.)

- [ ] **Step 2: `src/app/admin/error.tsx`**

Reemplazar el botón a mano (`rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground`, sin hover) por `<Button onClick={reset}>Reintentar</Button>` con su import. No tocar nada más del boundary.

- [ ] **Step 3: Verificar y commitear**

`npx vitest run` + `npx tsc --noEmit` → verdes. En dev: `/admin` muestra los 3 grupos; con admin común no aparece la tarjeta Configuración.

```bash
git add src/app/admin/page.tsx src/app/admin/error.tsx
git commit -m "refactor: group dashboard cards by nav section, migrate hand-made buttons"
```

---

### Task 14: Verificación final + documentación

**Files:**
- Modify: `.superpowers/sdd/progress.md` (bloque nuevo al final)
- Verify: todo

- [ ] **Step 1: Gates completos**

```bash
npx vitest run        # 703 verdes (689 + 14)
npx tsc --noEmit
npm run lint
npm run build
```

Expected: todo verde, build de producción sin warnings nuevos.

- [ ] **Step 2: Verificación de la restricción del sitio público**

```bash
git diff main --stat -- "src/app/(public)" src/components/public src/app/not-found.tsx src/app/error.tsx src/components/ui/button.tsx src/components/ui/card.tsx src/components/ui/input.tsx src/components/ui/label.tsx
```

Expected: **salida vacía** (cero archivos tocados).

- [ ] **Step 3: Recorrida contra los criterios de aceptación de la spec (§11)**

Con `npm run dev` y las credenciales locales: (1) de Socios a Actas en un click; (2) activo correcto en `/admin/socios/carga/N`; (3) colapso persiste tras recarga; (4) admin común sin Configuración en nav ni tarjeta, y la URL directa sigue bloqueando; (5) título+acciones sin solaparse a 375px; (6) REG-16 en ámbar; (7) padrón filtrado vacío → EmptyState; (8) suspendido igual en padrón y ficha. Anotar en el reporte de la task cualquier CA que falle.

- [ ] **Step 4: Actualizar `.superpowers/sdd/progress.md`**

Agregar al final un bloque `=== MINI-MODULO SHELL DEL PANEL (fecha) ===` con: qué se construyó, decisiones clave (colapsable elegido por Mariano contra recomendación, tokens --sidebar-* reciclados, deuda anotada de synced-fields), estado de tests y CA verificados.

- [ ] **Step 5: Commit final**

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs: progress notes for the admin panel shell mini-module"
```

La integración de la rama (merge `--no-ff` a `main`) se decide con la skill `superpowers:finishing-a-development-branch` — NO pushear: Mariano pushea y despliega.
