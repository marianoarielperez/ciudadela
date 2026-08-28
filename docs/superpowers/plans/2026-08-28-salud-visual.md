# Rediseño visual de /admin/salud — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar `/admin/salud` con el veredicto como banner protagonista siempre visible y los seis paneles en 4 pestañas client-side, sin tocar la capa de datos, el veredicto lógico ni la única escritura (reenvío de recibos).

**Architecture:** El veredicto (`HealthVerdict`) se re-estiliza en su lugar (`health-panels.tsx`) manteniendo semántica byte-idéntica y traduciendo sus `#ancla` a `?tab=X#ancla` con una función pura nueva; un componente cliente `SaludTabs` (calco del mecanismo de `ConfigTabs`, SIN forceMount — acá no hay form multi-panel) recibe los cuatro contenidos server-rendered por props; los 4 `Section` uppercase migran al `PanelHeader` compartido (que se muda a `src/components/admin/`), y Backup/MP conservan sus cards con `CardTitle as="h2"` para que el conteo de 6 `<h2>` siga verde. Spec: `docs/superpowers/specs/2026-08-28-salud-visual-design.md`.

**Tech Stack:** Next.js 16 App Router, React 19, Radix Tabs vía `@/components/ui/tabs`, Tailwind v4 con tokens, lucide-react, vitest (`renderToStaticMarkup` en el test de pantalla).

## Global Constraints

- **PROHIBIDO modificar**: `src/lib/admin/health.ts`, `src/lib/admin/health-alerts.ts`, `src/lib/admin/health-backup.ts`, `src/app/admin/salud/actions.ts`, `src/app/admin/salud/resend-form.tsx`, `src/lib/admin/status-badges.ts`, todo `src/lib/treasury/*` y `src/lib/mp/*`, y los tests `tests/admin-health.test.ts`, `tests/health-actions-auth.test.ts`, `tests/status-badges.test.ts`. Verificación final: `git diff --stat main -- <esas rutas>` vacío.
- **`tests/admin-health-screen.test.ts` SÍ se adapta, pero SOLO en las aserciones estructurales que este plan nombra explícitamente** (traducción de hrefs del veredicto y el test de anclas). Toda aserción de TEXTO queda intacta y verde — los rótulos los cita el runbook `docs/10` ("Al día", "Sin rastro", "sin novedades", "desde que existe", "EMAIL_ALLOWLIST"…). Si al correr la suite falla una aserción NO listada acá, el implementador la REPORTA en vez de adaptarla.
- Los textos de spec §2b son intocables aunque el markup cambie. Los seis `id` de ancla (`tareas`, `backup`, `mercado-pago`, `dinero`, `avisos`, `recibos`) se conservan, igual que `aria-labelledby`, `scroll-mt-4`, `role="none"` en el veredicto y el patrón `renderResend`.
- El conteo "exactamente 6 `<h2>`" se preserva: 4 `PanelHeader` (tareas, dinero, avisos, recibos) + 2 `CardTitle as="h2"` (backup, MP). NINGÚN encabezado por pestaña.
- Badges de solapa: SOLO condiciones `act`, vía `actCountByTab` — nunca review ni historia.
- UI es-AR; código y commits en inglés; colores solo por token; a11y canon (`outline-hidden` + `focus-visible:ring-*`, `min-h-11`, íconos `aria-hidden`).
- Comandos: `npx tsc --noEmit`, `npx vitest run` (completa), `npx vitest run tests/salud-tabs.test.ts tests/admin-health-screen.test.ts` (focalizada).
- Branch `salud-visual`. Cada commit termina con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. El working tree tiene `datos/padron_socios.xlsx` modificado ajeno a esto: nunca stagearlo (`git add` por path explícito, jamás `-A`).
- La verificación en navegador (con datos rotos sembrados y limpiados) es del controlador al final; los implementadores corren typecheck + suite y anotan la deferral.

---

### Task 1: Config pura de pestañas y mapeo de alertas (`salud-tabs.ts`) + test

**Files:**
- Create: `src/lib/admin/salud-tabs.ts`
- Test: `tests/salud-tabs.test.ts`

**Interfaces:**
- Produces: `type SaludTabId = "tareas" | "infraestructura" | "dinero" | "correo"`; `type SaludTab = { value: SaludTabId; label: string; icon: "clock" | "server" | "banknote" | "mail" }`; `const SALUD_TABS: SaludTab[]`; `tabForAlertHref(href: string): SaludTabId | null`; `alertHrefFor(href: string): string`; `actCountByTab(act: ReadonlyArray<{ href: string }>): Partial<Record<SaludTabId, number>>`. Consumen: Task 3 (`alertHrefFor` en el veredicto), Task 5 (`SALUD_TABS`, `actCountByTab`, tipos) y la adaptación del test de anclas.

- [ ] **Step 1: Write the failing test**

Crear `tests/salud-tabs.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { SALUD_TABS, actCountByTab, alertHrefFor, tabForAlertHref } from "@/lib/admin/salud-tabs";

describe("SALUD_TABS", () => {
  it("define las cuatro pestañas en orden, sin valores repetidos", () => {
    expect(SALUD_TABS.map((t) => t.value)).toEqual([
      "tareas", "infraestructura", "dinero", "correo",
    ]);
    expect(new Set(SALUD_TABS.map((t) => t.value)).size).toBe(4);
  });
});

describe("tabForAlertHref", () => {
  // Los literales están COPIADOS de health-alerts.ts (que no se toca): son
  // todos los href que el veredicto puede emitir hoy. El cruce contra el
  // render real lo hace admin-health-screen.test.ts.
  it("mapea cada ancla a su pestaña", () => {
    expect(tabForAlertHref("#tareas")).toBe("tareas");
    expect(tabForAlertHref("#backup")).toBe("infraestructura");
    expect(tabForAlertHref("#mercado-pago")).toBe("infraestructura");
    expect(tabForAlertHref("#dinero")).toBe("dinero");
    expect(tabForAlertHref("#avisos")).toBe("correo");
    expect(tabForAlertHref("#recibos")).toBe("correo");
  });
  it("las rutas de Tesorería cuentan como Dinero", () => {
    expect(tabForAlertHref("/admin/tesoreria/suscripciones")).toBe("dinero");
    expect(tabForAlertHref("/admin/tesoreria/sin-conciliar")).toBe("dinero");
  });
  it("un ancla desconocida o una ruta ajena no mapean", () => {
    expect(tabForAlertHref("#otra-cosa")).toBeNull();
    expect(tabForAlertHref("/admin/socios/3")).toBeNull();
  });
});

describe("alertHrefFor", () => {
  it("traduce un ancla a ?tab=X#ancla", () => {
    expect(alertHrefFor("#tareas")).toBe("?tab=tareas#tareas");
    expect(alertHrefFor("#recibos")).toBe("?tab=correo#recibos");
  });
  it("deja las rutas y las anclas desconocidas como están", () => {
    expect(alertHrefFor("/admin/tesoreria/suscripciones")).toBe("/admin/tesoreria/suscripciones");
    expect(alertHrefFor("#otra-cosa")).toBe("#otra-cosa");
  });
});

describe("actCountByTab", () => {
  it("cuenta act por pestaña, rutas de tesorería incluidas", () => {
    expect(actCountByTab([
      { href: "#tareas" },
      { href: "#tareas" },
      { href: "#recibos" },
      { href: "/admin/tesoreria/suscripciones" },
    ])).toEqual({ tareas: 2, correo: 1, dinero: 1 });
  });
  it("sin act, no hay puntos", () => {
    expect(actCountByTab([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/salud-tabs.test.ts`
Expected: FAIL — `Cannot find module '@/lib/admin/salud-tabs'` (o equivalente).

- [ ] **Step 3: Write the implementation**

Crear `src/lib/admin/salud-tabs.ts`:

```ts
// Pestañas de /admin/salud y el mapeo alerta→pestaña. Client-side (`?tab=`,
// mismo criterio que config-tabs.ts): una sola URL = una sola guarda de
// superadmin y los dos revalidatePath de las actions de reenvío intactos.
// El mapa ícono→componente vive en el componente cliente (salud-tabs.tsx);
// lib/ es puro y testeable en node sin arrastrar lucide.
//
// health-alerts.ts NO se toca: sigue emitiendo `#ancla` y rutas absolutas.
// La traducción a `?tab=X#ancla` es de PRESENTACIÓN y vive acá, en un solo
// lugar, para que el veredicto, el badge de solapa y el test de anclas no
// puedan divergir (la lección de coverageFloor).
export type SaludTabId = "tareas" | "infraestructura" | "dinero" | "correo";

export type SaludTab = {
  value: SaludTabId;
  label: string;
  icon: "clock" | "server" | "banknote" | "mail";
};

export const SALUD_TABS: SaludTab[] = [
  { value: "tareas", label: "Tareas", icon: "clock" },
  { value: "infraestructura", label: "Infraestructura", icon: "server" },
  { value: "dinero", label: "Dinero", icon: "banknote" },
  { value: "correo", label: "Correo", icon: "mail" },
];

// Las seis anclas que los paneles publican como `id`. `#dinero` existe aunque
// hoy ninguna alerta lo emita (las de dinero van directo a Tesorería).
const ANCHOR_TAB: Record<string, SaludTabId> = {
  tareas: "tareas",
  backup: "infraestructura",
  "mercado-pago": "infraestructura",
  dinero: "dinero",
  avisos: "correo",
  recibos: "correo",
};

/** A qué pestaña pertenece el destino de una alerta. Las rutas de Tesorería
 *  son asuntos de plata: cuentan para Dinero aunque naveguen a otra pantalla.
 *  `null` = destino ajeno a la pantalla, se deja tal cual. */
export function tabForAlertHref(href: string): SaludTabId | null {
  if (href.startsWith("#")) return ANCHOR_TAB[href.slice(1)] ?? null;
  if (href.startsWith("/admin/tesoreria")) return "dinero";
  return null;
}

/** El href que renderiza el veredicto: un ancla se traduce a `?tab=X#ancla`
 *  (activa la pestaña y scrollea al panel); todo lo demás queda como vino. */
export function alertHrefFor(href: string): string {
  if (!href.startsWith("#")) return href;
  const tab = tabForAlertHref(href);
  return tab ? `?tab=${tab}${href}` : href;
}

/** Cuántas condiciones ACT caen en cada pestaña. Es la ÚNICA fuente del punto
 *  rojo de solapa: review e historia no cuentan jamás (la lección de las 51
 *  firmas: un numerito que suma lo que no requiere acción enseña a ignorar el
 *  tablero). */
export function actCountByTab(
  act: ReadonlyArray<{ href: string }>,
): Partial<Record<SaludTabId, number>> {
  const counts: Partial<Record<SaludTabId, number>> = {};
  for (const alert of act) {
    const tab = tabForAlertHref(alert.href);
    if (tab) counts[tab] = (counts[tab] ?? 0) + 1;
  }
  return counts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/salud-tabs.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/salud-tabs.ts tests/salud-tabs.test.ts
git commit -m "feat(salud): pure tab config with alert-to-tab mapping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `PanelHeader` compartido (mudanza + `titleId` + descripción ReactNode)

**Files:**
- Move: `src/app/admin/configuracion/panel-header.tsx` → `src/components/admin/panel-header.tsx` (con `git mv`)
- Modify: `src/components/admin/panel-header.tsx` (dos ampliaciones aditivas)
- Modify: `src/app/admin/configuracion/config-form.tsx`, `src/app/admin/configuracion/tesoreria-panel.tsx`, `src/app/admin/configuracion/feriados-panel.tsx` (solo la línea de import)

**Interfaces:**
- Produces: `PanelHeader({ icon, title, description, titleId? })` con `description?: ReactNode` (antes `string` requerido) y `titleId?: string` (id del `<h2>`, para `aria-labelledby`). Import path nuevo: `@/components/admin/panel-header`. Consumen: Task 4 (los paneles de salud) y las tres pantallas de Configuración.

- [ ] **Step 1: Mover el archivo**

```bash
git mv src/app/admin/configuracion/panel-header.tsx src/components/admin/panel-header.tsx
```

- [ ] **Step 2: Ampliar el componente**

El archivo movido queda así (dos cambios sobre el actual: `description` pasa a `ReactNode` opcional y aparece `titleId`; el markup no cambia salvo el `id` del h2 y el render condicional de la descripción):

```tsx
import type { ComponentType, ReactNode } from "react";

// Encabezado de panel compartido por Configuración y Salud: chip de ícono
// tintado (el mismo gesto que las tarjetas del tablero /admin) + título +
// descripción. `titleId` existe para las secciones que se nombran por
// `aria-labelledby` (los paneles anclados de /admin/salud).
export function PanelHeader({ icon: Icon, title, description, titleId }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  titleId?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0">
        <h2 id={titleId} className="font-heading text-base font-medium leading-snug">{title}</h2>
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Actualizar los tres imports de Configuración**

En `config-form.tsx`, `tesoreria-panel.tsx` y `feriados-panel.tsx`, reemplazar

```tsx
import { PanelHeader } from "./panel-header";
```

por

```tsx
import { PanelHeader } from "@/components/admin/panel-header";
```

(verificar con `grep -r "from \"./panel-header\"" src/` que no quede ninguno).

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` y `npx vitest run` — Expected: verde, cero tests modificados.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/panel-header.tsx src/app/admin/configuracion/config-form.tsx src/app/admin/configuracion/tesoreria-panel.tsx src/app/admin/configuracion/feriados-panel.tsx
git commit -m "refactor(admin): share PanelHeader with optional titleId and rich description

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(El `git mv` del Step 1 ya dejó la eliminación stageada; `git status` debe mostrar `renamed:` y las tres ediciones, nada más.)

---

### Task 3: El banner del veredicto (restyle de `HealthVerdict`) + adaptación de sus aserciones

**Files:**
- Modify: `src/components/admin/health-panels.tsx` (solo el bloque `HealthVerdict` y sus imports)
- Modify: `tests/admin-health-screen.test.ts` (SOLO las aserciones de href del veredicto)

**Interfaces:**
- Consumes: `alertHrefFor` (Task 1). Firma de `HealthVerdict({ alerts, now })` SIN cambios.
- Produces: el banner; Task 5 no lo toca (queda fuera de las pestañas).

- [ ] **Step 1: Reescribir `HealthVerdict`**

En `health-panels.tsx`: agregar a los imports

```tsx
import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { alertHrefFor } from "@/lib/admin/salud-tabs";
```

y reemplazar el componente completo (líneas del bloque `HealthVerdict` actual) por:

```tsx
/** Lo primero y —el martes que todo anda— lo único que el operador necesita leer.
 *
 *  Un tablero que obliga a recorrer seis paneles para descubrir que no pasa nada
 *  se deja de mirar a la semana. Acá arriba está la respuesta: si no hay nada
 *  para atender, lo dice en una línea verde y el resto de la pantalla queda como
 *  consulta.
 *
 *  Es un BANNER, no un FormMessage: el estado del sistema es el héroe de esta
 *  pantalla. La semántica no cambió — mismos titulares, mismos umbrales de kind,
 *  mismo role="none" (no es la respuesta a una acción) — y los `#ancla` se
 *  traducen a `?tab=X#ancla` vía alertHrefFor: activan la pestaña del panel y
 *  scrollean hasta él. health-alerts.ts sigue emitiendo anclas peladas. */
const VERDICT_STYLE = {
  error: { icon: TriangleAlert, border: "border-l-destructive", tone: "text-destructive" },
  neutral: { icon: Info, border: "border-l-border", tone: "text-foreground" },
  success: { icon: CircleCheck, border: "border-l-success", tone: "text-success" },
} as const;

export function HealthVerdict({ alerts, now }: { alerts: HealthAlerts; now: Date }) {
  const { act, review } = alerts;
  const kind = act.length > 0 ? "error" : review.length > 0 ? "neutral" : "success";
  const headline = act.length > 0
    ? act.length === 1 ? "Hay una cosa para atender" : `Hay ${act.length} cosas para atender`
    : review.length > 0
      ? "No hay nada roto"
      : "Todo en orden";
  const style = VERDICT_STYLE[kind];
  const Icon = style.icon;
  return (
    // `role="none"`: es el estado de la pantalla al abrirla, no la respuesta a
    // una acción. Un `alert` acá interrumpiría al lector de pantalla en cada
    // recarga (misma regla que la ayuda estática de los formularios).
    <div role="none" className={cn("rounded-xl border border-l-4 bg-card p-4", style.border)}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden className={cn("mt-0.5 size-6 shrink-0", style.tone)} />
        <div className="min-w-0 flex-1 text-sm">
          <p className={cn("text-base font-semibold", style.tone)}>{headline}</p>
          {act.length > 0 && (
            <ul className="mt-2 space-y-1">
              {act.map((a) => (
                <li key={a.key}>
                  <Link className={INLINE_LINK} href={alertHrefFor(a.href)}>{a.label}</Link>
                </li>
              ))}
            </ul>
          )}
          {review.length > 0 && (
            <div className="mt-2 text-muted-foreground">
              <p className="text-xs font-semibold tracking-widest uppercase">Para revisar</p>
              <ul className="mt-1 space-y-1">
                {review.map((a) => (
                  <li key={a.key}>
                    <Link className={INLINE_LINK} href={alertHrefFor(a.href)}>{a.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {act.length === 0 && review.length === 0 && (
            <p className="mt-1 text-muted-foreground">
              Las tareas automáticas corrieron cuando tenían que correr, el backup está al día, Mercado Pago
              sigue avisando y no quedó ningún email sin salir.
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Estado al {formatDateTimeAR(now)}.</p>
        </div>
      </div>
    </div>
  );
}
```

Nota: `FormMessage` sigue importado (lo usa la pantalla de bloqueo vía page.tsx; si el import queda sin uso EN ESTE archivo, quitarlo de acá). Los textos son byte-idénticos al componente actual.

- [ ] **Step 2: Correr el test de pantalla y adaptar SOLO los hrefs**

Run: `npx vitest run tests/admin-health-screen.test.ts`
Expected: fallan ÚNICAMENTE aserciones de href del veredicto. Adaptación permitida (y ninguna otra):

- `expect(html).toContain('href="#tareas"')` → `expect(html).toContain('href="?tab=tareas#tareas"')` (y cualquier gemela de otros paneles, con la traducción de `alertHrefFor`).

Si falla algo MÁS (un texto, `text-success`/`text-destructive`, `role`), NO adaptarlo: reportarlo como bloqueo. Las clases `text-success`/`text-destructive` deben seguir presentes por diseño (el `tone` del banner).

- [ ] **Step 3: Verificar**

Run: `npx vitest run tests/admin-health-screen.test.ts tests/admin-health.test.ts` y `npx tsc --noEmit` — Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/health-panels.tsx tests/admin-health-screen.test.ts
git commit -m "feat(salud): verdict banner with tab-aware alert links

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Los 4 `Section` migran al `PanelHeader` compartido

**Files:**
- Modify: `src/components/admin/health-panels.tsx` (el helper `Section` y las 4 llamadas)

**Interfaces:**
- Consumes: `PanelHeader` (Task 2, con `titleId` y `description: ReactNode`).
- Produces: los mismos 4 paneles con sus firmas intactas; `BackupPanel`/`MpPanel` NO se tocan.

- [ ] **Step 1: Reescribir `Section` sobre `PanelHeader`**

Agregar a los imports de `health-panels.tsx`:

```tsx
import { Banknote, Clock, Mail, Receipt } from "lucide-react";
import { PanelHeader } from "@/components/admin/panel-header";
```

Reemplazar el helper `Section` actual por:

```tsx
/** Encabezado común de las secciones ancladas. El `id` es el ancla a la que
 *  apunta el veredicto (via `?tab=X#id`); el `<h2>` lo emite PanelHeader y el
 *  `aria-labelledby` lo referencia por `titleId`. */
function Section({ id, icon, title, hint, children }: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 space-y-3">
      <PanelHeader icon={icon} title={title} description={hint} titleId={`${id}-title`} />
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Pasar el ícono en las 4 llamadas**

Los cuatro call-sites de `Section` ganan su prop `icon` (nada más cambia en ellos — títulos, ids y hints byte-idénticos):

- `CronsPanel`: `<Section id="tareas" icon={Clock} title="Tareas automáticas" hint={...igual...}>`
- `MoneyPanel`: `<Section id="dinero" icon={Banknote} title="Dinero sin resolver">`
- `FailedNoticesPanel`: `<Section id="avisos" icon={Mail} title="Avisos por email que no salieron">`
- `PendingReceiptsPanel`: `<Section id="recibos" icon={Receipt} title="Recibos sin enviar por email" hint={...igual...}>`

`BackupPanel` y `MpPanel` quedan SIN tocar (sus `CardTitle as="h2"` son los h2 5 y 6).

- [ ] **Step 3: Verificar**

Run: `npx vitest run tests/admin-health-screen.test.ts` — Expected: verde SIN adaptar nada (el conteo de 6 `<h2>` y las anclas sobreviven porque PanelHeader emite `<h2 id="...-title">` y el `<section id>` no cambió). `npx tsc --noEmit` limpio.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/health-panels.tsx
git commit -m "feat(salud): panel sections adopt the shared PanelHeader

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `SaludTabs` + ensamblado de la página + test de anclas adaptado

**Files:**
- Create: `src/app/admin/salud/salud-tabs.tsx`
- Modify: `src/app/admin/salud/page.tsx`
- Modify: `tests/admin-health-screen.test.ts` (SOLO el test de anclas)

**Interfaces:**
- Consumes: `SALUD_TABS`, `SaludTab`, `SaludTabId`, `actCountByTab`, `tabForAlertHref`, `alertHrefFor` (Task 1); los paneles (Task 4).
- Produces: `SaludTabs({ actCounts, tareas, infraestructura, dinero, correo })`.

- [ ] **Step 1: Crear `salud-tabs.tsx`**

```tsx
"use client";
// Pestañas de Salud: Radix Tabs con `?tab=` (mismo mecanismo que ConfigTabs) —
// los cuatro contenidos ya vinieron en el HTML y mostrar otro no espera al
// servidor; el `router.replace` re-pide el payload RSC en segundo plano (la
// ruta es force-dynamic). Sin `forceMount`: acá no hay un form que abarque
// varias pestañas (los ResendForm viven por fila, dentro de su panel).
//
// El punto de solapa cuenta SOLO condiciones `act` (actCountByTab): un numerito
// que sume review o historia enseña a ignorar el tablero — la lección de las 51
// firmas. El veredicto, siempre visible arriba, es quien lista el detalle.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { Banknote, Clock, Mail, Server } from "lucide-react";

import { SALUD_TABS, type SaludTab, type SaludTabId } from "@/lib/admin/salud-tabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ICONS: Record<SaludTab["icon"], ComponentType<{ className?: string }>> = {
  clock: Clock,
  server: Server,
  banknote: Banknote,
  mail: Mail,
};

const INITIAL: SaludTabId = "tareas";

export function SaludTabs({ actCounts, tareas, infraestructura, dinero, correo }: {
  actCounts: Partial<Record<SaludTabId, number>>;
  tareas: ReactNode;
  infraestructura: ReactNode;
  dinero: ReactNode;
  correo: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Un `?tab=` inventado a mano no rompe la pantalla: cae en la inicial.
  const requested = params.get("tab");
  const current = requested && SALUD_TABS.some((t) => t.value === requested) ? requested : INITIAL;
  const panels: Record<SaludTabId, ReactNode> = { tareas, infraestructura, dinero, correo };
  return (
    <Tabs
      value={current}
      onValueChange={(value) => {
        const next = new URLSearchParams(params.toString());
        if (value === INITIAL) next.delete("tab");
        else next.set("tab", value);
        const qs = next.toString();
        // `replace` y no `push`: cada clic de solapa en el historial obligaría
        // a apretar "atrás" cuatro veces para salir de Salud.
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    >
      {/* `h-auto` pisa el `h-8` de la variante (targets de 44px); `pb-2` deja
          adentro la línea activa que Radix dibuja 5px bajo el trigger;
          `border-b` es el riel canónico de las pestañas del panel. */}
      <TabsList
        variant="line"
        aria-label="Secciones de salud"
        className="group-data-horizontal/tabs:h-auto w-full justify-start overflow-x-auto border-b pb-2"
      >
        {SALUD_TABS.map((t) => {
          const Icon = ICONS[t.icon];
          const count = actCounts[t.value] ?? 0;
          return (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="min-h-11 flex-none gap-1.5 px-3 after:bg-primary data-active:font-semibold"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
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
      {SALUD_TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="pt-4">
          {panels[t.value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
```

- [ ] **Step 2: Ensamblar `page.tsx`**

El `return` autorizado de `page.tsx` (los imports suman `Suspense` de `"react"`, `SaludTabs` de `"./salud-tabs"` y `actCountByTab` de `"@/lib/admin/salud-tabs"`; el resto de la página — guard, fetches, `renderResend`, comentarios de cabecera — queda igual, y se agrega `const actCounts = actCountByTab(alerts.act);` después de `const alerts = …`):

```tsx
  return (
    <div className="space-y-6">
      <PageHeader title="Salud">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Las tareas automáticas, el backup, Mercado Pago y los avisos por email. Todo lo que el sistema
          hace solo mientras nadie mira.
        </p>
      </PageHeader>

      {/* El veredicto vive FUERA de las pestañas, siempre visible: es el
          contrato de la pantalla ("el martes que todo anda, una línea"). Las
          pestañas guardan el detalle, nunca la existencia de un problema. */}
      <HealthVerdict alerts={alerts} now={now} />

      <Suspense fallback={null}>
        <SaludTabs
          actCounts={actCounts}
          tareas={<CronsPanel crons={health.crons} now={now} />}
          infraestructura={
            /* Los dos que se leen de un vistazo van uno al lado del otro: cada
               uno es un estado y un puñado de números, no una lista. */
            <div className="grid gap-4 md:grid-cols-2">
              <BackupPanel backup={backup} now={now} />
              <MpPanel mp={health.mp} now={now} />
            </div>
          }
          dinero={<MoneyPanel money={health.money} />}
          correo={
            <div className="space-y-6">
              <FailedNoticesPanel
                failed={health.failed}
                failedEver={health.failedEver}
                renderResend={renderResend}
              />
              <PendingReceiptsPanel receipts={health.receipts} renderResend={renderResend} />
            </div>
          }
        />
      </Suspense>
    </div>
  );
```

- [ ] **Step 3: Adaptar el test de anclas (única adaptación permitida en esta task)**

En `tests/admin-health-screen.test.ts`, el test `"cada `#ancla` que puede emitir healthAlerts tiene su id en la pantalla"` gana la verificación del mapeo (el resto del test queda igual). Agregar el import:

```ts
import { alertHrefFor, tabForAlertHref } from "@/lib/admin/salud-tabs";
```

y, dentro del test, después de `expect(anchors.length).toBeGreaterThan(0);`, insertar:

```ts
    // Con las pestañas, "seguir el link" es activar la solapa + scrollear al
    // ancla. Cada href que el veredicto puede emitir tiene que mapear a una
    // pestaña (las anclas) o ser una ruta absoluta que navega sola.
    for (const alert of [...alerts.act, ...alerts.review]) {
      if (alert.href.startsWith("#")) {
        expect(tabForAlertHref(alert.href), alert.href).not.toBeNull();
        expect(alertHrefFor(alert.href), alert.href).toMatch(/^\?tab=[a-z]+#[a-z-]+$/);
      } else {
        expect(alert.href, alert.href).toMatch(/^\/admin\//);
      }
    }
```

La verificación existente de `id="${anchor}"` sobre el HTML concatenado de los seis paneles QUEDA (los paneles conservan sus ids; que se rendericen dentro de pestañas no cambia su markup propio).

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` y `npx vitest run` — Expected: TODA la suite verde; en `tests/`, `git diff --stat main -- tests` muestra SOLO `salud-tabs.test.ts` (nuevo) y `admin-health-screen.test.ts` (adaptado en las dos zonas permitidas).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/salud/salud-tabs.tsx src/app/admin/salud/page.tsx tests/admin-health-screen.test.ts
git commit -m "feat(salud): client-side tabs with act-only badges around the fixed verdict

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Verificación final (spec §7)

**Files:** ninguno nuevo; solo arreglos que salgan de la verificación.

- [ ] **Step 1: Suite, typecheck y lint completos**

Run: `npx tsc --noEmit` — sin errores.
Run: `npx vitest run` — toda la suite verde; `admin-health.test.ts`, `health-actions-auth.test.ts` y `status-badges.test.ts` sin tocar.
Run: `npx eslint src/app/admin/salud src/lib/admin/salud-tabs.ts src/components/admin/panel-header.tsx src/components/admin/health-panels.tsx tests/salud-tabs.test.ts` — sin errores.

- [ ] **Step 2: Guarda del diff (spec §7.2)**

```bash
git diff --stat main -- src/lib/admin/health.ts src/lib/admin/health-alerts.ts src/lib/admin/health-backup.ts src/app/admin/salud/actions.ts src/app/admin/salud/resend-form.tsx src/lib/admin/status-badges.ts src/lib/treasury src/lib/mp tests/admin-health.test.ts tests/health-actions-auth.test.ts tests/status-badges.test.ts
```

Expected: **salida vacía**.

- [ ] **Step 3: Pasada de navegador (controlador + operador, con datos rotos sembrados)**

Sembrar temporalmente en la base LOCAL (y limpiar al final): una fila `cron_runs` con `ok: false` y un `error` de prueba para un job, y una `Notification` `failed` de tipo `receipt` apuntando a un recibo real del seed. Verificar:

1. Estado sano (antes de sembrar): banner verde "Todo en orden" de una línea, cuatro solapas sin punto.
2. Estado roto: banner rojo "Hay N cosas para atender"; punto rojo SOLO en las solapas con act; cada link del veredicto activa su pestaña y scrollea al panel (la interacción que el test NO ve); los links a Tesorería navegan.
3. Reenviar un recibo desde Correo: resultado en la fila, y la fila se limpia al recargar (`revalidatePath`).
4. `?tab=basura` cae en Tareas; botón atrás no acumula historial de solapas.
5. Responsive 375px: solapas con scroll, banner legible, tablas con scroll propio.
6. Teclado: flechas entre solapas con foco visible; recorrido lógico.
7. Admin común: pantalla de bloqueo.
8. Limpiar las filas sembradas y verificar que el banner vuelve a verde.

- [ ] **Step 4: Commit de arreglos (si los hay)**

```bash
git add -A -- src/app/admin/salud src/lib/admin/salud-tabs.ts src/components/admin
git commit -m "fix(salud): browser-verification fixes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Notas de riesgo para el ejecutor

- Si al cambiar de solapa un panel "desaparece" del DOM: es el comportamiento esperado (sin `forceMount`); acá no hay ningún form que lo necesite montado. NO copiar el `forceMount` de Configuración: ese existía por el form de 8 claves.
- Si el test de anclas falla porque un `id` no aparece: el bug está en un panel que perdió su `id` o su `section`, no en el test.
- Si una aserción de TEXTO falla en cualquier task: ALTO y reportar — los textos son la parte congelada del contrato (runbook docs/10).
- El badge de solapa jamás suma `review`: si alguien pide "mostrar también lo amarillo", es una decisión de producto que reabre la corrección de las 51 firmas — escalar, no implementar.
