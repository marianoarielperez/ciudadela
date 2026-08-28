# Rediseño visual de /admin/configuracion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar `/admin/configuracion` como consola en 5 pestañas client-side (tira de estado + Radix Tabs por `?tab=`) sin tocar una sola server action ni módulo de dominio.

**Architecture:** La página server (`page.tsx`) conserva guard, consultas y mensajes de éxito (globales, arriba); una tira de estado de 4 mini-cards navega a las pestañas; un componente cliente `ConfigTabs` (calco de `MemberTabs`) monta las 5 pestañas, donde el form de 8 claves sigue siendo UN `<form>` que envuelve sus tres paneles con `forceMount` (campo desmontado = borrado silencioso en `updateConfigAction`) y Tesorería/Feriados son paneles server pasados por props. Spec: `docs/superpowers/specs/2026-08-28-configuracion-visual-design.md`.

**Tech Stack:** Next.js 16 App Router, React 19, Radix Tabs/Dialog (paquete `radix-ui` vía `@/components/ui/*`), Tailwind v4 con tokens, lucide-react, vitest.

## Global Constraints

- **PROHIBIDO modificar**: `src/app/admin/configuracion/actions.ts`, `src/lib/config.ts`, `src/lib/config-keys.ts`, `src/lib/forms.ts`, `src/lib/auth/require-admin.ts`, todo `src/lib/treasury/*`, todo `src/lib/mp/*`, `src/components/admin/synced-fields.tsx`, y **ningún test existente**. Verificación final: `git diff --stat main -- <esas rutas>` vacío (solo se admite el test NUEVO `tests/config-tabs.test.ts`).
- **Nombres de campo intocables** (las actions leen `formData` por nombre): `asociateActivo` (checkbox `value="on"`), `contactPhone`, `contactEmail`, `termsText`, `privacyConsentText`, `mpPlanActiveId`, `mpPlanSharedId`, `digestRecipients`, `activeAmount`, `sharedAmount`, `validFrom`, `minuteId`, `date`, `label`, `id`.
- **El form de 8 claves es UNO solo y sus 8 campos están SIEMPRE montados en el DOM** (los tres `TabsContent` del form llevan `forceMount` + `data-[state=inactive]:hidden`). Nunca partirlo en un form por pestaña.
- Los redirects de las actions (`?guardado=1`, `?cuota=1`, `?feriado=1`, `?feriado=2`) apuntan a la raíz: los mensajes de éxito se renderizan GLOBALES (bajo el `PageHeader`), y la pestaña inicial se deriva de esos params.
- UI en es-AR (vos); código, nombres y commits en inglés. Colores SOLO por token (`--primary`, `--success`, `--warning`, `bg-card`, `border-input`…), nunca verde/ámbar crudo de Tailwind.
- Accesibilidad canon del shell: `outline-hidden` + `focus-visible:ring-2 focus-visible:ring-ring` (NUNCA `outline-none`), targets `min-h-11`, íconos `aria-hidden` acompañados de texto.
- El select de acta del valor de cuota queda como select simple (`minuteId`, `""` = sin acta). NO migrarlo a `MinutePicker`.
- Comandos de verificación: `npx tsc --noEmit` (typecheck), `npx vitest run` (suite unit completa), `npx vitest run tests/config-tabs.test.ts` (test nuevo).
- Branch de trabajo: `configuracion-visual`. Cada commit termina con la línea `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Dev server para verificación en navegador: configuración `sigev-dev` de `.claude/launch.json` (puerto 3000).

---

### Task 1: Config pura de pestañas (`config-tabs.ts`) + test

**Files:**
- Create: `src/lib/admin/config-tabs.ts`
- Test: `tests/config-tabs.test.ts`

**Interfaces:**
- Produces: `type ConfigTabId = "sitio" | "asociate" | "avisos" | "tesoreria" | "feriados"`; `type ConfigTab = { value: ConfigTabId; label: string; icon: "globe" | "user-plus" | "mail" | "wallet" | "calendar-off" }`; `const CONFIG_TABS: ConfigTab[]`; `function initialConfigTab(sp: { cuota?: string | string[]; feriado?: string | string[] }): ConfigTabId`. Los consumen Task 5 (`config-tabs.tsx`, `page.tsx`).

- [ ] **Step 1: Write the failing test**

Crear `tests/config-tabs.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { CONFIG_TABS, initialConfigTab } from "@/lib/admin/config-tabs";

describe("CONFIG_TABS", () => {
  it("define las cinco pestañas en orden, sin valores repetidos", () => {
    expect(CONFIG_TABS.map((t) => t.value)).toEqual([
      "sitio", "asociate", "avisos", "tesoreria", "feriados",
    ]);
    expect(new Set(CONFIG_TABS.map((t) => t.value)).size).toBe(5);
  });

  // NO_FEE_VALUE_MESSAGE (src/lib/treasury/fee-values.ts) dice "Configuración →
  // Tesorería" y no se toca: la pestaña tiene que llamarse así. No se importa el
  // módulo de treasury acá porque arrastra @/lib/prisma, que tira sin .env.
  it('la pestaña del valor de cuota se llama "Tesorería"', () => {
    expect(CONFIG_TABS.find((t) => t.value === "tesoreria")?.label).toBe("Tesorería");
  });
});

describe("initialConfigTab", () => {
  it("sin params de éxito abre en Sitio público", () => {
    expect(initialConfigTab({})).toBe("sitio");
  });
  it("?cuota=1 (redirect de createFeeValueAction) aterriza en Tesorería", () => {
    expect(initialConfigTab({ cuota: "1" })).toBe("tesoreria");
  });
  it("?feriado=1 y ?feriado=2 (ABM de feriados) aterrizan en Feriados", () => {
    expect(initialConfigTab({ feriado: "1" })).toBe("feriados");
    expect(initialConfigTab({ feriado: "2" })).toBe("feriados");
  });
  it("valores raros o repetidos caen en Sitio público", () => {
    expect(initialConfigTab({ cuota: "2", feriado: "x" })).toBe("sitio");
    expect(initialConfigTab({ cuota: ["1", "1"] })).toBe("sitio");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config-tabs.test.ts`
Expected: FAIL — `Cannot find module '@/lib/admin/config-tabs'` (o equivalente).

- [ ] **Step 3: Write the implementation**

Crear `src/lib/admin/config-tabs.ts`:

```ts
// Pestañas de /admin/configuracion. Client-side (`?tab=`, calco de MemberTabs)
// y NO subrutas: los cuatro redirects de actions.ts apuntan a la raíz y tres
// tests los asertan textualmente — una sola URL conserva actions, tests y la
// guarda de superadmin en un solo lugar. El mapa ícono→componente vive en el
// componente cliente (config-tabs.tsx), como socios-tabs: lib/ es puro y
// testeable en node sin arrastrar lucide.
export type ConfigTabId = "sitio" | "asociate" | "avisos" | "tesoreria" | "feriados";

export type ConfigTab = {
  value: ConfigTabId;
  label: string;
  icon: "globe" | "user-plus" | "mail" | "wallet" | "calendar-off";
};

// "Tesorería" no es negociable: NO_FEE_VALUE_MESSAGE ("registralo en
// Configuración → Tesorería") vive en src/lib/treasury y no se toca.
export const CONFIG_TABS: ConfigTab[] = [
  { value: "sitio", label: "Sitio público", icon: "globe" },
  { value: "asociate", label: "ASOCIATE", icon: "user-plus" },
  { value: "avisos", label: "Avisos", icon: "mail" },
  { value: "tesoreria", label: "Tesorería", icon: "wallet" },
  { value: "feriados", label: "Feriados", icon: "calendar-off" },
];

// En qué pestaña ATERRIZA cada redirect de las actions. `?cuota=1` es el éxito
// del valor de cuota y `?feriado=1|2` los del ABM de feriados; `?guardado=1`
// es del form de 8 claves, cuyo mensaje es global, así que abre en la primera.
// Acepta el union crudo de searchParams (string | string[] | undefined): un
// param repetido no matchea "1" y cae en la inicial, que es lo inofensivo.
export function initialConfigTab(sp: {
  cuota?: string | string[];
  feriado?: string | string[];
}): ConfigTabId {
  if (sp.cuota === "1") return "tesoreria";
  if (sp.feriado === "1" || sp.feriado === "2") return "feriados";
  return "sitio";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config-tabs.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/config-tabs.ts tests/config-tabs.test.ts
git commit -m "feat(configuracion): pure tab config with landing-tab derivation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `PanelHeader`, `StatusStrip` y mensajes globales en la página

**Files:**
- Create: `src/app/admin/configuracion/panel-header.tsx`
- Create: `src/app/admin/configuracion/status-strip.tsx`
- Modify: `src/app/admin/configuracion/page.tsx` (los sections viejos quedan; solo se mueven los mensajes y se agrega la tira)

**Interfaces:**
- Produces: `PanelHeader({ icon, title, description })` (icon: `ComponentType<{ className?: string }>`) — lo consumen Tasks 3 y 4. `StatusStrip({ current, asociateActivo, coverage, digestCount })` con `current: CurrentFeeValue | null` (import type de `@/lib/treasury/fee-values`), `coverage: Array<[number, number]>` ordenado, `digestCount: number`.

- [ ] **Step 1: Crear `panel-header.tsx`**

```tsx
import type { ComponentType } from "react";

// Encabezado de cada panel de Configuración: chip de ícono tintado (el mismo
// gesto que las tarjetas del tablero /admin) + título + una línea de contexto.
// Reemplaza los h2 uppercase que esta pantalla duplicaba a mano en tres lugares.
// Sin "use client": lo importan paneles server (Task 3) y el form cliente
// (Task 4), y en cada grafo compila como lo que corresponde.
export function PanelHeader({ icon: Icon, title, description }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0">
        <h2 className="font-heading text-base font-medium leading-snug">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Crear `status-strip.tsx`**

```tsx
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { CalendarOff, Globe, Mail, Wallet } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatARS, formatDateAR } from "@/lib/format";
import type { CurrentFeeValue } from "@/lib/treasury/fee-values";

// La tira de estado: cuatro lecturas en vivo del sistema, cada una clickeable
// hacia su pestaña. Todo sale de datos que la página YA consulta; acá no hay
// ninguna query. El patrón de card es el del tablero /admin: chip tintado,
// link semántico estirado con pseudo-elemento y anillo de foco inset (la Card
// recorta con overflow-hidden).
type Item = {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  warning: boolean;
};

export function StatusStrip({ current, asociateActivo, coverage, digestCount }: {
  current: CurrentFeeValue | null;
  asociateActivo: boolean;
  coverage: Array<[number, number]>;
  digestCount: number;
}) {
  const items: Item[] = [
    {
      href: "?tab=tesoreria",
      icon: Wallet,
      label: "Valor de cuota",
      value: current ? (
        <>
          <span className="font-mono tabular-nums">{formatARS(current.activeAmount)}</span>
          {" / "}
          <span className="font-mono tabular-nums">{formatARS(current.sharedAmount)}</span>
          <span className="font-normal text-muted-foreground"> · desde {formatDateAR(current.validFrom)}</span>
        </>
      ) : (
        "Sin valor vigente"
      ),
      warning: !current,
    },
    {
      href: "?tab=sitio",
      icon: Globe,
      label: "Botón ASOCIATE",
      value: asociateActivo ? "Activado" : "Desactivado",
      warning: !asociateActivo,
    },
    {
      href: "?tab=feriados",
      icon: CalendarOff,
      label: "Feriados cargados",
      value: coverage.length > 0
        ? coverage.map(([year, count]) => `${year} (${count})`).join(" · ")
        : "Ninguno cargado",
      warning: coverage.length === 0,
    },
    {
      href: "?tab=avisos",
      icon: Mail,
      label: "Resumen diario",
      value: digestCount > 0
        ? `${digestCount} ${digestCount === 1 ? "destinatario" : "destinatarios"}`
        : "Sin destinatarios",
      warning: digestCount === 0,
    },
  ];
  return (
    <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.label}>
          <Card size="sm" className="relative h-full transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <item.icon aria-hidden className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">
                  <Link
                    href={item.href}
                    className="outline-hidden after:absolute after:inset-0 after:rounded-xl after:ring-ring after:ring-inset focus-visible:after:ring-2"
                  >
                    {item.label}
                  </Link>
                </div>
                <div className={cn("truncate text-sm font-medium", item.warning && "text-warning")}>
                  {item.value}
                </div>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
```

Nota: los `href` son query-only (`?tab=…`): resuelven contra la ruta actual y descartan los params de éxito viejos, que es lo deseable. En esta task las pestañas todavía no existen y el link solo re-renderiza la página — inofensivo hasta la Task 5.

- [ ] **Step 3: Modificar `page.tsx`**

Tres ediciones (los sections de Tesorería y Feriados quedan como están):

a. Imports: agregar `import { StatusStrip } from "./status-strip";`.

b. Después del cálculo de `divergentCount` (línea ~124), agregar:

```tsx
  // Insumos de la tira de estado — datos ya consultados, cero queries nuevas.
  const digestCount = (digestRecipients ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length;
  const coverageEntries = [...coverage.entries()].sort((a, b) => a[0] - b[0]);
```

c. En el JSX: mover los CUATRO mensajes de éxito arriba (los bloques `sp.cuota === "1"` de la sección Tesorería y `sp.feriado === "1"|"2"` de Feriados se CORTAN de sus secciones y se PEGAN, textuales, después del bloque `sp.guardado === "1"`), y agregar la tira. El comienzo del `return` queda:

```tsx
  return (
    <div className="space-y-4">
      <PageHeader title="Configuración" />
      {sp.guardado === "1" && (
        <FormMessage kind="success" box>
          Configuración guardada.
        </FormMessage>
      )}
      {sp.cuota === "1" && (
        <FormMessage kind="success" box as="div">
          {divergentCount === 0 ? (
            <p>Valor de cuota registrado, y ninguna suscripción de Mercado Pago para actualizar.</p>
          ) : (
            <p>
              {`Valor de cuota registrado. Hay ${divergentCount} ${divergentCount === 1 ? "suscripción" : "suscripciones"} de Mercado Pago para actualizar: `}
              <Link
                className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                href="/admin/tesoreria/valores"
              >
                Ir a Valores de cuota
              </Link>
              .
            </p>
          )}
        </FormMessage>
      )}
      {sp.feriado === "1" && <FormMessage kind="success" box>Feriado cargado.</FormMessage>}
      {sp.feriado === "2" && <FormMessage kind="success" box>Feriado borrado.</FormMessage>}
      <StatusStrip
        current={current}
        asociateActivo={asociateActivo}
        coverage={coverageEntries}
        digestCount={digestCount}
      />
      <ConfigForm
        ...
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` — Expected: sin errores.
Run: `npx vitest run` — Expected: suite entera verde, ningún test tocado.
Navegador (dev server `sigev-dev`, superadmin local): `/admin/configuracion` muestra la tira con los 4 estados reales; registrar nada — solo mirar que los mensajes ya no estén duplicados y la página siga entera.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/configuracion/panel-header.tsx src/app/admin/configuracion/status-strip.tsx src/app/admin/configuracion/page.tsx
git commit -m "feat(configuracion): status strip and global success messages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Paneles server de Tesorería y Feriados (diseño final + actas por nombre)

**Files:**
- Create: `src/app/admin/configuracion/tesoreria-panel.tsx`
- Create: `src/app/admin/configuracion/feriados-panel.tsx`
- Modify: `src/app/admin/configuracion/page.tsx` (reemplaza los dos `<section>` por los paneles; suma la consulta de nombres de acta)

**Interfaces:**
- Consumes: `PanelHeader` (Task 2), `FeeValueForm`/`HolidayForm`/`HolidayRow` (existentes, sin cambios acá), `minuteName` de `@/lib/members/labels`, `INLINE_LINK` de `@/lib/admin/link-styles`.
- Produces: `TesoreriaPanel({ current, history, minutes, suggestedValidFrom })` con `history: FeeHistoryItem[]` (`{ id, dateLabel, activeLabel, sharedLabel, minute: { id, name } | null }`); `FeriadosPanel({ coverageLabel, futureHolidays, suggestedDate })` con `futureHolidays: Array<{ id: number; label: string; dateLabel: string }>`. Task 5 los envuelve en `TabsContent`.

- [ ] **Step 1: Crear `tesoreria-panel.tsx`**

```tsx
import Link from "next/link";
import { Wallet } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/admin/empty-state";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { FeeValueForm } from "./fee-value-form";
import { PanelHeader } from "./panel-header";

// El panel del valor de cuota. Presentación pura: la página le da todo ya
// formateado. El acta del historial se nombra por TIPO y NÚMERO (minuteName),
// nunca por id — tercera aparición del error documentado en CLAUDE.md,
// corregida acá.
export type FeeHistoryItem = {
  id: number;
  dateLabel: string;
  activeLabel: string;
  sharedLabel: string;
  minute: { id: number; name: string } | null;
};

export function TesoreriaPanel({ current, history, minutes, suggestedValidFrom }: {
  current: { dateLabel: string; activeLabel: string; sharedLabel: string } | null;
  history: FeeHistoryItem[];
  minutes: Array<{ id: number; label: string }>;
  suggestedValidFrom: string;
}) {
  return (
    <section aria-label="Tesorería — valor de cuota" className="max-w-2xl space-y-4">
      <PanelHeader
        icon={Wallet}
        title="Valor de cuota"
        description="La única fuente de montos del sistema: devengo, deuda, efectivo y alta web. Los planes de Mercado Pago son solo referencia."
      />
      {current ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card size="sm">
            <CardContent className="space-y-1">
              <div className="text-xs text-muted-foreground">Socio activo</div>
              <div className="font-mono text-2xl font-medium tabular-nums">{current.activeLabel}</div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="space-y-1">
              <div className="text-xs text-muted-foreground">Adherente / colaborador</div>
              <div className="font-mono text-2xl font-medium tabular-nums">{current.sharedLabel}</div>
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Vigente desde {current.dateLabel}.
          </p>
        </div>
      ) : (
        <p className="text-sm text-warning">Todavía no rige ningún valor de cuota.</p>
      )}
      <Card>
        <CardContent>
          <FeeValueForm minutes={minutes} suggestedValidFrom={suggestedValidFrom} />
        </CardContent>
      </Card>
      <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Historial
      </h3>
      {history.length === 0 ? (
        <EmptyState size="card" description="Todavía no se registró ningún valor de cuota." />
      ) : (
        <ul className="list-none divide-y rounded-xl border p-0 text-sm">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                Desde {h.dateLabel} ·{" "}
                {h.minute ? (
                  <Link className={INLINE_LINK} href={`/admin/actas/${h.minute.id}`}>
                    {h.minute.name}
                  </Link>
                ) : (
                  "sin acta"
                )}
              </span>
              <span className="font-mono tabular-nums">
                {h.activeLabel} / {h.sharedLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Crear `feriados-panel.tsx`**

```tsx
import { CalendarOff } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/admin/empty-state";
import { HolidayForm, HolidayRow } from "./holidays-form";
import { PanelHeader } from "./panel-header";

// El panel de feriados de la cartelera. Los textos legales (Art. 5° ter y la
// advertencia de los "puentes") se conservan textuales de la pantalla vieja.
export function FeriadosPanel({ coverageLabel, futureHolidays, suggestedDate }: {
  coverageLabel: string | null;
  futureHolidays: Array<{ id: number; label: string; dateLabel: string }>;
  suggestedDate: string;
}) {
  return (
    <section aria-label="Cartelera — feriados" className="max-w-2xl space-y-4">
      <PanelHeader
        icon={CalendarOff}
        title="Feriados"
        description="El calendario sobre el que se cuentan los plazos de la cartelera."
      />
      <p className="text-sm text-muted-foreground">
        Los veinte días hábiles de la notificación por cartelera (Art. 5° ter) se cuentan sobre
        esta tabla: lunes a viernes menos los feriados nacionales. Un feriado que falte se cuenta
        como día hábil y le acorta el plazo al vecino, así que el aviso de cartelera se niega a
        computar un plazo que entre en un año sin cargar.{" "}
        <strong>Los días no laborables con fines turísticos (los &ldquo;puentes&rdquo;) no van
        acá</strong>: son días de opción, no feriados, y alargarían los plazos sin fundamento.
      </p>
      <p className="text-sm">
        Años cargados:{" "}
        {coverageLabel ?? <span className="text-warning">ninguno.</span>}
      </p>
      <Card>
        <CardContent>
          <HolidayForm suggestedDate={suggestedDate} />
        </CardContent>
      </Card>
      {futureHolidays.length === 0 ? (
        <EmptyState size="card" description="No hay feriados cargados de hoy en adelante." />
      ) : (
        <ul className="list-none divide-y p-0 text-sm">
          {futureHolidays.map((h) => (
            <HolidayRow key={h.id} id={h.id} label={h.label} dateLabel={h.dateLabel} />
          ))}
        </ul>
      )}
    </section>
  );
}
```

(La lista de feriados recibe borde redondeado en la Task 7, junto con el `px-3` de `HolidayRow` — un solo lugar toca ese markup.)

- [ ] **Step 3: Modificar `page.tsx`**

a. Imports: quitar `EmptyState` (ya no se usa acá); agregar `minuteName` al import de labels y los dos paneles:

```tsx
import { MINUTE_TYPE_LABELS, minuteName } from "@/lib/members/labels";
import { TesoreriaPanel } from "./tesoreria-panel";
import { FeriadosPanel } from "./feriados-panel";
```

b. Después de `coverageEntries` (Task 2), agregar los view models:

```tsx
  // Nombres de acta del historial: minuteName (tipo + número), nunca el id de
  // la fila. Consulta aparte porque el `take: 30` del combo no garantiza traer
  // las actas viejas que el historial referencia.
  const historyMinuteIds = [...new Set(
    history.flatMap((h) => (h.minuteId === null ? [] : [h.minuteId])),
  )];
  const historyMinutes = historyMinuteIds.length
    ? await prisma.minute.findMany({
        where: { id: { in: historyMinuteIds } },
        select: { id: true, type: true, number: true },
      })
    : [];
  const minuteNameById = new Map(historyMinutes.map((m) => [m.id, minuteName(m)]));
  const historyView = history.map((h) => ({
    id: h.id,
    dateLabel: formatDateAR(h.validFrom),
    activeLabel: formatARS(h.activeAmount),
    sharedLabel: formatARS(h.sharedAmount),
    minute: h.minuteId === null
      ? null
      : { id: h.minuteId, name: minuteNameById.get(h.minuteId) ?? `Acta #${h.minuteId}` },
  }));
  const currentView = current
    ? {
        dateLabel: formatDateAR(current.validFrom),
        activeLabel: formatARS(current.activeAmount),
        sharedLabel: formatARS(current.sharedAmount),
      }
    : null;
  const coverageLabel = coverageEntries.length === 0
    ? null
    : coverageEntries.map(([year, count]) => `${year} (${count})`).join(" · ");
  const futureView = futureHolidays.map((h) => ({
    id: h.id,
    label: h.label,
    dateLabel: formatDateAR(h.date),
  }));
```

c. En el JSX, reemplazar los DOS `<section className="max-w-2xl space-y-4 border-t pt-6">…</section>` completos (Tesorería y Feriados, ya sin sus mensajes de éxito) por:

```tsx
      <TesoreriaPanel
        current={currentView}
        history={historyView}
        minutes={minutes}
        suggestedValidFrom={suggestedValidFrom}
      />
      <FeriadosPanel
        coverageLabel={coverageLabel}
        futureHolidays={futureView}
        suggestedDate={suggestedHoliday}
      />
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` y `npx vitest run` — Expected: verde.
Navegador: los dos paneles con chip de ícono, KPI del valor vigente, form en card; el historial nombra "Comisión Directiva N° X" con link que abre el acta.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/configuracion/tesoreria-panel.tsx src/app/admin/configuracion/feriados-panel.tsx src/app/admin/configuracion/page.tsx
git commit -m "feat(configuracion): extract treasury and holidays panels with the new look

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Rediseño interno del form de 8 claves (cards + switch)

**Files:**
- Modify: `src/app/admin/configuracion/config-form.tsx` (reescritura de presentación; el `<form>`, los `name` y la action quedan idénticos)

**Interfaces:**
- Consumes: `PanelHeader` (Task 2).
- Produces: `export type ConfigFormInitial` (la forma del prop `initial`, que Task 5 importa); `ConfigForm({ initial })` sigue exportándose con la MISMA firma que hoy. Los tres bloques quedan como `<section>`; Task 5 los convierte en `TabsContent`.

- [ ] **Step 1: Reescribir `config-form.tsx`**

```tsx
"use client";
// Formulario de Configuración.
//
// El campo delicado es el switch del botón ASOCIATE: React 19 resetea el
// <form action> cuando la server action termina, y un checkbox destildado por
// ese reset no lo corrige React (ver el comentario largo de
// use-form-reset-sync.ts). Acá el daño sería del peor tipo: el superadmin cierra
// el alta de socios, la action rechaza por otro campo, el reset vuelve a
// mostrarlo abierto y él se va creyendo que lo cerró. Por eso el estado del
// switch vive en `useSyncedForm` bajo la misma clave que su `name`, con el
// "on"/"" que manda el navegador: el hook lo re-tilda después de cada render.
// El switch es un checkbox NATIVO con piel de switch: mismo name, mismo
// value="on", misma semántica de formulario que el checkbox que reemplaza.
import { useActionState } from "react";
import { Globe, Mail, UserPlus } from "lucide-react";

import { updateConfigAction } from "./actions";
import { useSyncedForm, TextField, TextareaField } from "@/components/admin/synced-fields";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "./panel-header";

export type ConfigFormInitial = {
  asociateActivo: boolean;
  contactPhone: string;
  contactEmail: string;
  termsText: string;
  privacyConsentText: string;
  mpPlanActiveId: string;
  mpPlanSharedId: string;
  digestRecipients: string;
};

function AsociateSwitch({ checked, onChange }: {
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor="asociateActivo" className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          id="asociateActivo"
          type="checkbox"
          role="switch"
          name="asociateActivo"
          value="on"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="relative inline-flex h-6 w-10 shrink-0 rounded-full bg-muted ring-1 ring-inset ring-border transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-background after:shadow-sm after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
        />
        Botón ASOCIATE habilitado en el sitio público
      </label>
      <p className="text-xs text-muted-foreground">
        Apagado, el sitio muestra el aviso de asociaciones suspendidas. Se prende recién con el
        wizard del Módulo 3 funcionando.
      </p>
    </div>
  );
}

export function ConfigForm({ initial }: { initial: ConfigFormInitial }) {
  const [state, formAction, pending] = useActionState(updateConfigAction, {});
  const initialValues = {
    asociateActivo: initial.asociateActivo ? "on" : "",
    contactPhone: initial.contactPhone,
    contactEmail: initial.contactEmail,
    termsText: initial.termsText,
    privacyConsentText: initial.privacyConsentText,
    mpPlanActiveId: initial.mpPlanActiveId,
    mpPlanSharedId: initial.mpPlanSharedId,
    digestRecipients: initial.digestRecipients,
  };
  const { values, setValue, formRef, field } = useSyncedForm(initialValues);

  return (
    <form ref={formRef} action={formAction} className="max-w-2xl space-y-6">
      <section className="space-y-4">
        <PanelHeader
          icon={Globe}
          title="Sitio público"
          description="Lo que ve el vecino: el botón de alta y los datos de contacto."
        />
        <Card>
          <CardContent className="space-y-4">
            <AsociateSwitch
              checked={values.asociateActivo === "on"}
              onChange={(on) => setValue("asociateActivo", on ? "on" : "")}
            />
            <TextField
              label="Teléfono de contacto"
              field={field("contactPhone")}
              type="tel"
              maxLength={40}
              hint="Se muestra en la página Ubicación. Dejalo vacío para ocultarlo."
            />
            <TextField
              label="Email de contacto"
              field={field("contactEmail")}
              type="email"
              maxLength={191}
              hint="Se muestra en la página Ubicación. Dejalo vacío para ocultarlo."
            />
          </CardContent>
        </Card>
      </section>
      <section className="space-y-4">
        <PanelHeader
          icon={UserPlus}
          title="ASOCIATE"
          description="Los textos legales del wizard de alta y los planes de referencia de Mercado Pago."
        />
        <Card>
          <CardContent className="space-y-4">
            {/* Texto PLANO a propósito: el wizard lo muestra con `whitespace-pre-line`,
                así que los saltos de línea se respetan pero nada de lo que se escriba
                acá llega al navegador como HTML. Ver el comentario de getLegalTexts. */}
            <TextareaField
              label="Términos y condiciones de la solicitud"
              field={field("termsText")}
              rows={10}
              maxLength={20000}
              hint="Texto plano: los saltos de línea se respetan, el HTML no se interpreta. Lo acepta el solicitante en el paso final del wizard."
            />
            <TextareaField
              label="Consentimiento de datos personales (Ley 25.326)"
              field={field("privacyConsentText")}
              rows={10}
              maxLength={20000}
              hint="Texto plano. Se muestra junto al tilde de consentimiento antes de enviar la solicitud."
            />
            <TextField
              label="Id del plan de MP — SOCIO ACTIVO"
              field={field("mpPlanActiveId")}
              maxLength={64}
              placeholder="2c93808491…"
              hint="Opcional. Los montos salen de la tabla de valores de cuota, no de acá: el alta web, el ajuste por recategorización y el lote de actualización leen de ahí. Cargado, la conciliación diaria avisa si el plan de MP quedó con otro monto. Se obtiene del panel de MP."
            />
            <TextField
              label="Id del plan de MP — SOCIO ADHERENTE/COLABORADOR"
              field={field("mpPlanSharedId")}
              maxLength={64}
              placeholder="2c93808491…"
              hint="Opcional, igual que el anterior; es el plan compartido por las dos categorías."
            />
          </CardContent>
        </Card>
      </section>
      {/* Tercer bloque, y el primero que NO mira al sitio público: acá se
          configura a quién le habla el sistema puertas adentro. El título lo
          dice para que nadie busque estos destinatarios entre los datos de
          contacto que ve el vecino. */}
      <section className="space-y-4">
        <PanelHeader
          icon={Mail}
          title="Avisos internos"
          description="A quién le habla el sistema puertas adentro."
        />
        <Card>
          <CardContent className="space-y-4">
            <TextField
              label="Destinatarios del resumen diario"
              field={field("digestRecipients")}
              maxLength={500}
              placeholder="comision@vecinalciudadela.ar, tesoreria@vecinalciudadela.ar"
              hint="Direcciones separadas por comas. Reciben todas las mañanas las novedades del día anterior: pagos, altas, cobros sin conciliar, avisos que no salieron y tareas automáticas con problemas. Un día sin novedades no genera correo. Vacío, el resumen no se envía a nadie."
            />
          </CardContent>
        </Card>
      </section>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
```

(El botón y el error del pie son transitorios: la Task 6 los muda a la barra flotante. `initialValues` queda como const separada porque la Task 6 la compara para el estado sucio.)

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit` y `npx vitest run` — Expected: verde.
Navegador: el switch prende/apaga con click y con teclado (Space con foco visible en el track); guardar con un cambio en cada bloque → "Configuración guardada." y los 8 valores persistidos; guardar con un email inválido → el error del server aparece y NINGÚN campo pierde lo tipeado (hazard de React 19 intacto).

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/configuracion/config-form.tsx
git commit -m "feat(configuracion): card layout and switch for the eight-key form

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Pestañas client-side y ensamblado final de la página

**Files:**
- Create: `src/app/admin/configuracion/config-tabs.tsx`
- Modify: `src/app/admin/configuracion/config-form.tsx` (los tres `<section>` → `TabsContent` con `forceMount`)
- Modify: `src/app/admin/configuracion/page.tsx` (ensamblado final)

**Interfaces:**
- Consumes: `CONFIG_TABS`, `ConfigTabId`, `initialConfigTab` (Task 1); `ConfigForm`, `ConfigFormInitial` (Task 4); `TesoreriaPanel`, `FeriadosPanel` (Task 3); `Tabs/TabsList/TabsTrigger/TabsContent` de `@/components/ui/tabs`.
- Produces: `ConfigTabs({ initial, configInitial, tesoreria, feriados })` — `initial: ConfigTabId`, `configInitial: ConfigFormInitial`, `tesoreria/feriados: ReactNode`.

- [ ] **Step 1: Crear `config-tabs.tsx`**

```tsx
"use client";
// Pestañas de Configuración: Radix Tabs con `?tab=` (calco de MemberTabs) — los
// cinco paneles ya vinieron en el HTML y cambiar es puro cliente. Client-side y
// NO subrutas: los cuatro redirects de actions.ts apuntan a la raíz y no se
// tocan; una sola URL = una sola guarda de superadmin.
//
// El form de 8 claves envuelve sus TRES paneles con `forceMount`
// (config-form.tsx): updateConfigAction escribe las 8 claves SIEMPRE y trata
// campo ausente como vacío, así que un panel desmontado sería un borrado
// silencioso. Con forceMount Radix deja el panel montado y VISIBLE: el
// data-[state=inactive]:hidden de cada panel lo oculta por CSS y los campos
// siguen viajando en el POST (display:none no saca un control del FormData).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { CalendarOff, Globe, Mail, UserPlus, Wallet } from "lucide-react";

import { CONFIG_TABS, type ConfigTab, type ConfigTabId } from "@/lib/admin/config-tabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfigForm, type ConfigFormInitial } from "./config-form";

const ICONS: Record<ConfigTab["icon"], ComponentType<{ className?: string }>> = {
  globe: Globe,
  "user-plus": UserPlus,
  mail: Mail,
  wallet: Wallet,
  "calendar-off": CalendarOff,
};

export function ConfigTabs({ initial, configInitial, tesoreria, feriados }: {
  initial: ConfigTabId;
  configInitial: ConfigFormInitial;
  tesoreria: ReactNode;
  feriados: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Un `?tab=` inventado a mano no rompe la pantalla: cae en la pestaña inicial.
  const requested = params.get("tab");
  const current = requested && CONFIG_TABS.some((t) => t.value === requested) ? requested : initial;
  return (
    <Tabs
      value={current}
      onValueChange={(value) => {
        const next = new URLSearchParams(params.toString());
        if (value === initial) next.delete("tab");
        else next.set("tab", value);
        const qs = next.toString();
        // `replace` y no `push`: cada clic de pestaña en el historial obligaría
        // a apretar "atrás" cinco veces para salir de Configuración.
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    >
      {/* `h-auto` pisa el `h-8` de la variante compartida (los targets de 44px
          no entran en 32px); `pb-2` deja adentro la línea activa que Radix
          dibuja 5px por debajo del trigger; `border-b` es el riel que las
          pestañas por URL del panel dibujan con su ul. */}
      <TabsList
        variant="line"
        aria-label="Secciones de configuración"
        className="group-data-horizontal/tabs:h-auto w-full justify-start overflow-x-auto border-b pb-2"
      >
        {CONFIG_TABS.map((t) => {
          const Icon = ICONS[t.icon];
          return (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="min-h-11 flex-none gap-1.5 px-3 after:bg-primary data-active:font-semibold"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {t.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
      <TabsContent value="tesoreria" className="pt-2">{tesoreria}</TabsContent>
      <TabsContent value="feriados" className="pt-2">{feriados}</TabsContent>
      <ConfigForm initial={configInitial} />
    </Tabs>
  );
}
```

- [ ] **Step 2: Convertir los tres `<section>` del form en `TabsContent`**

En `config-form.tsx`: agregar el import

```tsx
import { TabsContent } from "@/components/ui/tabs";
```

y reemplazar cada wrapper — el `<section className="space-y-4">` del bloque Sitio público pasa a:

```tsx
      <TabsContent value="sitio" forceMount className="space-y-4 pt-2 data-[state=inactive]:hidden">
```

el de ASOCIATE a:

```tsx
      <TabsContent value="asociate" forceMount className="space-y-4 pt-2 data-[state=inactive]:hidden">
```

y el de Avisos internos a:

```tsx
      <TabsContent value="avisos" forceMount className="space-y-4 pt-2 data-[state=inactive]:hidden">
```

(cerrando cada uno con `</TabsContent>`). El `<form>` conserva `className="max-w-2xl space-y-6"` y todo lo demás igual. Nota: `PanelHeader` dentro de cada `TabsContent` sigue siendo el título del panel; los `<h2>` quedan uno por panel visible.

- [ ] **Step 3: Ensamblado final de `page.tsx`**

a. Imports: agregar

```tsx
import { Suspense } from "react";
import { initialConfigTab } from "@/lib/admin/config-tabs";
import { ConfigTabs } from "./config-tabs";
```

y quitar el import de `ConfigForm` (ahora lo renderiza `ConfigTabs`).

b. El JSX final del `return` (después de `<StatusStrip …/>`) reemplaza `<ConfigForm …/>`, `<TesoreriaPanel …/>` y `<FeriadosPanel …/>` por:

```tsx
      {/* Suspense: ConfigTabs usa useSearchParams; con force-dynamic el SSR ya
          resuelve la pestaña real y el fallback no llega a verse. */}
      <Suspense fallback={null}>
        <ConfigTabs
          initial={initialConfigTab({ cuota: sp.cuota, feriado: sp.feriado })}
          configInitial={{
            asociateActivo,
            contactPhone: contactPhone ?? "",
            contactEmail: contactEmail ?? "",
            termsText: termsText ?? "",
            privacyConsentText: privacyConsentText ?? "",
            mpPlanActiveId: mpPlanActiveId ?? "",
            mpPlanSharedId: mpPlanSharedId ?? "",
            digestRecipients: digestRecipients ?? "",
          }}
          tesoreria={
            <TesoreriaPanel
              current={currentView}
              history={historyView}
              minutes={minutes}
              suggestedValidFrom={suggestedValidFrom}
            />
          }
          feriados={
            <FeriadosPanel
              coverageLabel={coverageLabel}
              futureHolidays={futureView}
              suggestedDate={suggestedHoliday}
            />
          }
        />
      </Suspense>
```

- [ ] **Step 4: Verificar — LA prueba del rediseño**

Run: `npx tsc --noEmit` y `npx vitest run` — Expected: verde.

Navegador (crítico, spec §9.3):
1. En la pestaña **Sitio público** cambiar el teléfono; SIN guardar, ir a **Avisos** y guardar. Expected: aterriza con "Configuración guardada.", y al revisar, el teléfono NUEVO está guardado y **los textos legales y los ids de plan siguen intactos** (las 8 claves viajaron).
2. Registrar un valor de cuota → aterriza con la pestaña **Tesorería** abierta y su mensaje global visible. Cargar un feriado → aterriza en **Feriados** con "Feriado cargado.".
3. Las cards de la tira navegan a su pestaña; botón atrás no acumula historial de pestañas (`replace`).
4. `?tab=cualquiercosa` a mano → cae en Sitio público sin romper.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/configuracion/config-tabs.tsx src/app/admin/configuracion/config-form.tsx src/app/admin/configuracion/page.tsx
git commit -m "feat(configuracion): client-side tabs with force-mounted form panels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Barra flotante de cambios sin guardar

**Files:**
- Modify: `src/app/admin/configuracion/config-form.tsx`

**Interfaces:**
- Consumes: `values`/`initialValues` de la Task 4 (comparación por clave). Sin exports nuevos.

- [ ] **Step 1: Agregar la detección de cambios y la barra**

En `config-form.tsx`, arriba de `AsociateSwitch` agregar:

```tsx
// Qué claves viven en qué pestaña, para que la barra diga DÓNDE quedaron los
// cambios sin guardar. Mismo orden que las pestañas.
const GROUPS: Array<{ label: string; keys: Array<keyof ConfigFormInitial & string> }> = [
  { label: "Sitio público", keys: ["asociateActivo", "contactPhone", "contactEmail"] },
  { label: "ASOCIATE", keys: ["termsText", "privacyConsentText", "mpPlanActiveId", "mpPlanSharedId"] },
  { label: "Avisos", keys: ["digestRecipients"] },
];

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}
```

Dentro de `ConfigForm`, después de `useSyncedForm`, agregar:

```tsx
  const dirtyGroups = GROUPS.filter((g) => g.keys.some((k) => values[k] !== initialValues[k]))
    .map((g) => g.label);
  const dirty = dirtyGroups.length > 0;
```

Y reemplazar el cierre del form — el bloque

```tsx
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
```

por:

```tsx
      {/* La barra vive DENTRO del form (el submit no necesita form=) y es
          `fixed`: sigue visible aunque el operador esté mirando Tesorería o
          Feriados con cambios pendientes en las pestañas del form. Tras el
          redirect exitoso la página re-renderiza con valores frescos y la
          barra desaparece sola. z-40: debajo de los diálogos (z-50). */}
      {(dirty || state.error) && (
        <>
          <div aria-hidden className="h-24" />
          <div className="fixed inset-x-4 bottom-4 z-40 sm:left-1/2 sm:right-auto sm:w-full sm:max-w-xl sm:-translate-x-1/2">
            <div className="space-y-2 rounded-xl bg-card p-3 shadow-lg ring-1 ring-foreground/10">
              {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {dirty ? (
                    <>
                      Tenés cambios sin guardar en{" "}
                      <span className="font-medium text-foreground">{listNames(dirtyGroups)}</span>.
                    </>
                  ) : (
                    "Revisá el error y volvé a guardar."
                  )}
                </p>
                <Button type="submit" disabled={pending}>
                  {pending ? "Guardando…" : "Guardar"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit` y `npx vitest run` — Expected: verde.
Navegador: editar el teléfono → aparece la barra "…en Sitio público"; editar además los términos → "…en Sitio público y ASOCIATE"; cambiar a la pestaña Feriados → la barra sigue visible; guardar → desaparece; provocar un error de validación (email inválido) → el error se lee EN la barra y lo tipeado no se pierde; revertir a mano el único cambio → la barra se va sola.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/configuracion/config-form.tsx
git commit -m "feat(configuracion): floating unsaved-changes bar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Feriados a synced-fields y confirmación con diálogo

**Files:**
- Modify: `src/app/admin/configuracion/holidays-form.tsx` (reescritura de presentación; actions y `name` idénticos)
- Modify: `src/app/admin/configuracion/feriados-panel.tsx` (la lista gana `rounded-xl border`)

**Interfaces:**
- Consumes: `Dialog/DialogTrigger/DialogContent/DialogHeader/DialogTitle/DialogDescription/DialogFooter/DialogClose` de `@/components/ui/dialog`; `TextField`, `useSyncedForm` de synced-fields.
- Produces: `HolidayForm({ suggestedDate })` y `HolidayRow({ id, label, dateLabel })` con las MISMAS firmas que hoy (`feriados-panel.tsx` no cambia sus llamadas).

- [ ] **Step 1: Reescribir `holidays-form.tsx`**

```tsx
"use client";
// El ABM de feriados: alta y borrado. Dos formularios chicos con acciones
// propias, como el valor de cuota, y no un bloque más del form de
// configuración: acá se escriben FILAS de una tabla, no claves de `Configuration`.
//
// Por qué existe esta pantalla: los veinte días hábiles de la notificación por
// cartelera (Art. 5° ter) se cuentan sobre esta tabla. Un feriado que falte se
// cuenta como día hábil y le acorta el plazo al vecino; los trasladables cambian
// por decreto cada año y el sembrador cargó sólo 2026 y 2027. Sin esta pantalla,
// corregir una fecha pedía un deploy.
//
// El borrado pide confirmación aunque sea una fila: de esa fila cuelga cuándo
// vence el plazo de cien vecinos, y el error no se ve en ninguna pantalla —se ve
// en un plazo que salió corto—. La confirmación es el Dialog del design system
// (antes era window.confirm); la validación de los campos es del server (la
// action rechaza fecha inválida y nombre corto con su propio mensaje).
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { createHolidayAction, deleteHolidayAction } from "./actions";

const NUM = "font-mono tabular-nums";

export function HolidayForm({ suggestedDate }: { suggestedDate: string }) {
  const [state, formAction, pending] = useActionState(createHolidayAction, {});
  const { formRef, field } = useSyncedForm({ date: suggestedDate, label: "" });
  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <TextField label="Fecha" field={field("date")} type="date" />
        <TextField
          label="Nombre del feriado"
          field={field("label")}
          maxLength={80}
          placeholder="Día del Respeto a la Diversidad Cultural"
        />
      </div>
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" size="lg" className="min-h-11 px-4" disabled={pending}>
        {pending ? "Cargando…" : "Cargar feriado"}
      </Button>
    </form>
  );
}

export function DeleteHolidayButton({ id, label, dateLabel }: {
  id: number;
  label: string;
  dateLabel: string;
}) {
  const [state, formAction, pending] = useActionState(deleteHolidayAction, {});
  // DialogContent se monta en un portal, FUERA del árbol del form: el botón de
  // confirmar lo referencia por id con `form=`. Tras un borrado exitoso el
  // redirect re-renderiza, la fila desaparece y el diálogo se desmonta solo;
  // si la action rechaza, no hay navegación y el error se lee en el diálogo.
  const formId = `holiday-delete-${id}`;
  return (
    <Dialog>
      <form id={formId} action={formAction}>
        <input type="hidden" name="id" value={id} />
      </form>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 px-3"
          // Sin esto, una lista de treinta feriados le dicta al lector de
          // pantalla treinta botones "Borrar" idénticos.
          aria-label={`Borrar el feriado ${label} del ${dateLabel}`}
        >
          Borrar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`¿Borrar "${label}"?`}</DialogTitle>
          <DialogDescription>
            El {dateLabel} pasa a contarse como día hábil en los plazos de cartelera que se
            asienten desde ahora.
          </DialogDescription>
        </DialogHeader>
        {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DialogClose>
          <Button type="submit" form={formId} variant="destructive" disabled={pending}>
            {pending ? "Borrando…" : "Borrar feriado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** La fila de un feriado futuro. Cliente porque arrastra el botón de borrado; el
 *  resto del bloque lo dibuja el panel. */
export function HolidayRow({ id, label, dateLabel }: {
  id: number;
  label: string;
  dateLabel: string;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span>
        <span className={NUM}>{dateLabel}</span> — {label}
      </span>
      <DeleteHolidayButton id={id} label={label} dateLabel={dateLabel} />
    </li>
  );
}
```

- [ ] **Step 2: Borde de la lista en `feriados-panel.tsx`**

Reemplazar `<ul className="list-none divide-y p-0 text-sm">` por:

```tsx
        <ul className="list-none divide-y rounded-xl border p-0 text-sm">
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit` y `npx vitest run` — Expected: verde (los tests de `holiday-actions` no se tocan y siguen pasando).
Navegador: cargar un feriado (campos con el estilo del design system, error del server visible si la fecha es basura); "Borrar" abre el diálogo con título y advertencia; Cancelar y Escape cierran sin borrar; "Borrar feriado" borra y aterriza en la pestaña Feriados con "Feriado borrado.".

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/configuracion/holidays-form.tsx src/app/admin/configuracion/feriados-panel.tsx
git commit -m "feat(configuracion): migrate holidays form to synced-fields and dialog confirm

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Verificación final (spec §9)

**Files:**
- Ninguno nuevo; solo arreglos que salgan de la verificación.

- [ ] **Step 1: Suite y typecheck completos**

Run: `npx tsc --noEmit` — Expected: sin errores.
Run: `npx vitest run` — Expected: TODA la suite verde, cero tests modificados (solo sumado `tests/config-tabs.test.ts`).
Run: `npx eslint src/app/admin/configuracion src/lib/admin/config-tabs.ts tests/config-tabs.test.ts` — Expected: sin errores.

- [ ] **Step 2: Guarda del diff (spec §9.2)**

```bash
git diff --stat main -- src/app/admin/configuracion/actions.ts src/lib/config.ts src/lib/config-keys.ts src/lib/forms.ts src/lib/treasury src/lib/mp src/components/admin/synced-fields.tsx
```

Expected: **salida vacía**. Y `git diff --stat main -- tests` muestra SOLO `tests/config-tabs.test.ts` (nuevo).

- [ ] **Step 3: Pasada de navegador completa**

Con el dev server `sigev-dev` y el superadmin local:
1. La prueba reina otra vez (guardar desde Avisos con cambios en Sitio público → 8 claves intactas).
2. Los tres aterrizajes (`?guardado`, `?cuota` con y sin divergentes, `?feriado=1/2`) con su pestaña y su mensaje.
3. Responsive 375px: pestañas con scroll horizontal sin recortar el anillo de foco, tira en 1 columna, barra flotante usable, diálogo de borrado usable.
4. Teclado: Tab recorre tira → pestañas (flechas cambian de pestaña) → contenido; foco SIEMPRE visible; el switch responde a Space; ningún control por debajo de 44px.
5. Admin común (no superadmin): pantalla de bloqueo intacta.
6. Historial de valores: actas "Comisión Directiva N° X" con link vivo a `/admin/actas/[id]`.

- [ ] **Step 4: Commit de arreglos (si los hay)**

```bash
git add -A -- src/app/admin/configuracion src/lib/admin/config-tabs.ts
git commit -m "fix(configuracion): browser-verification fixes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Notas de riesgo para el ejecutor

- Si Radix deja VISIBLE un panel `forceMount` inactivo (los tres del form a la vez): el `data-[state=inactive]:hidden` es lo que lo oculta; verificá que la clase esté en cada uno de los TRES `TabsContent` del form. Es comportamiento esperado de Radix (con `forceMount` no aplica el atributo `hidden`), no un bug.
- Si al guardar desde una pestaña se borran claves de otra: ALTO — significa que un panel del form quedó desmontado. No "arreglarlo" tocando la action: el bug está en el `forceMount`.
- El `?tab=` se pierde tras un submit del form de 8 claves (el redirect fijo va a `?guardado=1`): es el comportamiento diseñado — el mensaje es global y la pestaña inicial es Sitio público. No intentar "mejorarlo" tocando el redirect.
- `HolidayForm` pierde los `required` del navegador al migrar a `TextField` (no expone esa prop): decisión tomada — la action valida y su mensaje se muestra. NO agregar props a `synced-fields.tsx` (archivo prohibido).
