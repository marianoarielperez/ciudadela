# Rediseño visual de /actividades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la presentación de la página pública `/actividades`: días dinámicos (solo días con actividad), tarjetas con reborde completo del color del espacio, encabezado con firma mono + leyenda, selector móvil restilizado — sin tocar dominio, SEO ni pagos.

**Architecture:** Todo el cambio es de presentación. Una capa pura nueva (`src/lib/activities/presentation.ts`, con tests propios) decide qué días se ven y cómo se resume la semana; `page.tsx`, `activity-card.tsx` y `day-tabs.tsx` se reescriben solo en su render; `room-meta.ts` cambia sus campos de color (los íconos, que comparte `/ubicacion`, no se tocan). `rules.ts` y sus 42 tests quedan intactos.

**Tech Stack:** Next.js 16 App Router (Server Components + un client component), Tailwind v4 (tokens de `globals.css`), `tw-animate-css` (ya importado), lucide-react (ya instalado), Vitest puro (entorno node, sin jsdom).

**Spec:** `docs/superpowers/specs/2026-08-28-actividades-visual-design.md` — leerla antes de arrancar. Ante conflicto entre plan y spec, manda la spec.

## Global Constraints

- **Rama:** `actividades-visual` (ya creada; la spec está commiteada ahí). Commits en inglés, mensajes `feat(actividades): …`, con el footer `Co-Authored-By` del harness.
- **NO tocar:** `src/lib/activities/rules.ts`, `query.ts`, `year-param.ts`, `src/lib/dates.ts`, `src/lib/site.ts`, `src/app/admin/**`, `src/app/mi/**`, `src/lib/treasury/**`, `src/lib/mp/**`, `src/app/sitemap.ts`, `src/lib/public-nav.ts`, header/footer/layout público, `prisma/schema.prisma`.
- **NO tocar en `page.tsx`:** `export const dynamic = "force-dynamic"` (línea 21 y su comentario), `generateMetadata` completo (líneas 23–41), el redirect canónico (`if (!isCanonical) redirect(canonicalHref)`), el `<main className="mx-auto w-full max-w-5xl px-4 py-10">`.
- **NO modificar ningún test existente.** `npm test` (~3186 casos) tiene que pasar sin cambiar una aserción.
- **Los `icon` de `ROOM_META` no cambian** (los importa `src/app/(public)/ubicacion/page.tsx`).
- Sin dependencias npm nuevas.
- UI en es-AR ("vos"); código, variables y commits en inglés. Sitio público light-only: los campos nuevos de color NO llevan variantes `dark:`.
- `outline-hidden` (nunca `outline-none`) + `focus-visible:ring-2 focus-visible:ring-ring` en todo control; targets ≥ 44px (`min-h-11`); toda animación con `motion-reduce:animate-none`.
- Comentarios importantes del código actual se CONSERVAN (adaptados donde el diseño cambió): el de `force-dynamic`, el del único `currentYearAR()`, el del redirect, el del criterio `busyDays`, el del chip "Hoy" AA, el de `role="group"` en DayTabs, el de `[overflow-wrap:anywhere]`.

---

### Task 1: Módulo puro de presentación (`presentation.ts`)

**Files:**
- Create: `src/lib/activities/presentation.ts`
- Test: `tests/activities-presentation.test.ts`

**Interfaces:**
- Consumes: `AgendaDay`, `AgendaEntry`, `RoomKey`, `ROOM_KEYS` de `@/lib/activities/rules` (existentes; `AgendaDay = { day: number; label: string; entries: AgendaEntry[] }`).
- Produces (las usan las Tasks 3 y 4):
  - `visibleAgendaDays(agenda: AgendaDay[]): AgendaDay[]`
  - `initialVisibleDay(visible: AgendaDay[], todayAR: number): number` — precondición: `visible` no vacío
  - `weekSpanLabel(visible: AgendaDay[]): string`
  - `agendaSummary(visible: AgendaDay[]): { activityCount: number; roomCount: number }`
  - `visibleRooms(visible: AgendaDay[]): RoomKey[]`

- [ ] **Step 1: Write the failing test**

Crear `tests/activities-presentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  agendaSummary,
  initialVisibleDay,
  visibleAgendaDays,
  visibleRooms,
  weekSpanLabel,
} from "@/lib/activities/presentation";
import type { AgendaDay, AgendaEntry } from "@/lib/activities/rules";

const entry = (id: number, room: AgendaEntry["room"] = "historic"): AgendaEntry => ({
  id,
  name: `Actividad ${id}`,
  room,
  startTime: "18:00",
  endTime: "19:00",
});

const day = (d: number, label: string, entries: AgendaEntry[] = []): AgendaDay => ({
  day: d,
  label,
  entries,
});

// Semana con huecos: miércoles, viernes y sábado vacíos. La actividad 1 se
// dicta dos días (lunes y jueves): en los conteos vale UNA vez.
const WEEK: AgendaDay[] = [
  day(1, "Lunes", [entry(1)]),
  day(2, "Martes", [entry(2, "glass")]),
  day(3, "Miércoles"),
  day(4, "Jueves", [entry(1), entry(3, "kitchen")]),
  day(5, "Viernes"),
  day(6, "Sábado"),
];
const VISIBLE = visibleAgendaDays(WEEK);

describe("visibleAgendaDays", () => {
  it("deja solo los días con actividades, en el mismo orden", () => {
    expect(VISIBLE.map((d) => d.day)).toEqual([1, 2, 4]);
    expect(VISIBLE.map((d) => d.label)).toEqual(["Lunes", "Martes", "Jueves"]);
  });
  it("semana llena → los seis días; sin actividades → vacío", () => {
    const full = WEEK.map((d) => ({ ...d, entries: [entry(9)] }));
    expect(visibleAgendaDays(full)).toHaveLength(6);
    expect(visibleAgendaDays(WEEK.map((d) => ({ ...d, entries: [] })))).toEqual([]);
  });
});

describe("initialVisibleDay", () => {
  it("hoy visible → hoy", () => {
    expect(initialVisibleDay(VISIBLE, 1)).toBe(1);
    expect(initialVisibleDay(VISIBLE, 4)).toBe(4);
  });
  it("hoy no visible → el próximo día visible", () => {
    // Miércoles (3) vacío → jueves (4).
    expect(initialVisibleDay(VISIBLE, 3)).toBe(4);
  });
  it("fin de semana → vuelve al primer día visible (orden cíclico)", () => {
    expect(initialVisibleDay(VISIBLE, 6)).toBe(1); // sábado → lunes
    expect(initialVisibleDay(VISIBLE, 7)).toBe(1); // domingo (currentWeekdayAR puede devolver 7)
  });
  it("un solo día visible → siempre ese día", () => {
    const single = [day(6, "Sábado", [entry(1)])];
    expect(initialVisibleDay(single, 2)).toBe(6);
    expect(initialVisibleDay(single, 6)).toBe(6);
    expect(initialVisibleDay(single, 7)).toBe(6);
  });
});

describe("weekSpanLabel", () => {
  it("primer y último día visible", () => {
    expect(weekSpanLabel(VISIBLE)).toBe("Lunes — Jueves");
  });
  it("un solo día → solo ese día; vacío → cadena vacía", () => {
    expect(weekSpanLabel([day(6, "Sábado", [entry(1)])])).toBe("Sábado");
    expect(weekSpanLabel([])).toBe("");
  });
});

describe("agendaSummary", () => {
  it("cuenta actividades DISTINTAS (una actividad de dos días vale una) y espacios distintos", () => {
    expect(agendaSummary(VISIBLE)).toEqual({ activityCount: 3, roomCount: 3 });
  });
  it("vacío → ceros", () => {
    expect(agendaSummary([])).toEqual({ activityCount: 0, roomCount: 0 });
  });
});

describe("visibleRooms", () => {
  it("devuelve los espacios presentes en orden ROOM_KEYS, no en orden de aparición", () => {
    // Aparecen en orden classroom → kitchen; ROOM_KEYS manda kitchen antes.
    const agenda = [
      day(1, "Lunes", [entry(1, "classroom")]),
      day(2, "Martes", [entry(2, "kitchen")]),
    ];
    expect(visibleRooms(agenda)).toEqual(["kitchen", "classroom"]);
  });
  it("sin actividades → vacío", () => {
    expect(visibleRooms([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/activities-presentation.test.ts`
Expected: FAIL — "Cannot find module '@/lib/activities/presentation'" (o equivalente).

- [ ] **Step 3: Write minimal implementation**

Crear `src/lib/activities/presentation.ts`:

```ts
// Lógica de PRESENTACIÓN del calendario público: qué días se muestran y cómo
// se resume la semana. Vive aparte de rules.ts (el dominio: solapes,
// capacidad, forma de la semana) a propósito: esto puede cambiar con cada
// rediseño sin tocar las reglas ni sus tests. Desde el rediseño del 28/08 el
// calendario lo dibujan los datos: un día sin actividades no se renderiza.
import { ROOM_KEYS, type AgendaDay, type RoomKey } from "@/lib/activities/rules";

export function visibleAgendaDays(agenda: AgendaDay[]): AgendaDay[] {
  return agenda.filter((d) => d.entries.length > 0);
}

// El selector abre en hoy si hoy tiene actividades; si no, en el PRÓXIMO día
// visible en orden cíclico de semana (sábado → lunes, miércoles vacío →
// jueves, domingo = 7 → lunes). Reemplaza a initialAgendaDay de rules.ts SOLO
// en la página pública; aquella queda donde está, con sus tests.
// Precondición: `visible` no está vacío — la página corta antes con el estado
// vacío global.
export function initialVisibleDay(visible: AgendaDay[], todayAR: number): number {
  if (visible.some((d) => d.day === todayAR)) return todayAR;
  const next = visible.find((d) => d.day > todayAR);
  return (next ?? visible[0]).day;
}

// "Lunes — Viernes": primer y último día VISIBLE, para el eyebrow del
// encabezado. No promete que todos los días intermedios tengan actividad; el
// detalle lo da el calendario.
export function weekSpanLabel(visible: AgendaDay[]): string {
  if (visible.length === 0) return "";
  if (visible.length === 1) return visible[0].label;
  return `${visible[0].label} — ${visible[visible.length - 1].label}`;
}

// Conteos para la bajada. Una actividad que se dicta N días aparece N veces en
// la agenda: acá vale UNA (se cuenta por id).
export function agendaSummary(visible: AgendaDay[]): {
  activityCount: number;
  roomCount: number;
} {
  const ids = new Set<number>();
  const rooms = new Set<RoomKey>();
  for (const d of visible) {
    for (const e of d.entries) {
      ids.add(e.id);
      rooms.add(e.room);
    }
  }
  return { activityCount: ids.size, roomCount: rooms.size };
}

// Espacios presentes en el calendario visible, en orden ROOM_KEYS (el
// desempate visual estable de todo el calendario), no en orden de aparición.
export function visibleRooms(visible: AgendaDay[]): RoomKey[] {
  const present = new Set<RoomKey>();
  for (const d of visible) for (const e of d.entries) present.add(e.room);
  return ROOM_KEYS.filter((k) => present.has(k));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/activities-presentation.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test` → todo verde. Run: `npx tsc --noEmit` → sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/activities/presentation.ts tests/activities-presentation.test.ts
git commit -m "feat(actividades): presentation module for the dynamic public calendar"
```

---

### Task 2: Colores nuevos en `room-meta.ts` + tarjeta con reborde completo

**Files:**
- Modify: `src/lib/activities/room-meta.ts` (completo)
- Modify: `src/app/(public)/actividades/activity-card.tsx` (completo)

**Interfaces:**
- Consumes: `RoomKey`, `ROOM_LABELS`, `AgendaEntry` de `@/lib/activities/rules`; íconos lucide existentes.
- Produces (lo usan las Tasks 3 y 4): `ROOM_META: Record<RoomKey, { icon: LucideIcon; cardBorder: string; cardBg: string; timeText: string; roomText: string }>` — los campos `accentBorder`/`accentText` DESAPARECEN.

- [ ] **Step 1: Verificar que nadie más consume los campos viejos**

Run: `grep -rn "accentBorder\|accentText" src/`
Expected: solo `src/lib/activities/room-meta.ts` y `src/app/(public)/actividades/activity-card.tsx`. Si aparece otro consumidor, PARAR y revisar (la spec §2 dice que no existe).

- [ ] **Step 2: Reescribir `room-meta.ts`**

Contenido completo del archivo:

```ts
// Identidad visual de cada espacio en el sitio público: ícono + juego de
// colores de la tarjeta (reborde completo + fondo tintado + textos).
//
// Los ÍCONOS los comparte /ubicacion (ubicacion/page.tsx importa ROOM_META
// para "La sede por dentro"): cambiarlos impacta ahí. Los COLORES solo los
// consumen ActivityCard y la leyenda de /actividades: son libres.
//
// Light-only: el sitio público solo renderiza en claro (el ThemeProvider vive
// en el panel; decisión escrita en turnstile-widget.tsx), así que estos
// campos no llevan variantes dark:.
//
// El Salón Vidriado lleva el celeste institucional (--primary); los demás,
// paleta explícita de Tailwind v4 (oklch: los hex de v3 no aplican). Es
// decoración de tarjetas, no mensajes de estado: los tokens
// --success/--warning quedan para FormMessage.
//
// Contraste: los textos son de 12px y piden 4.5:1 sobre el fondo REAL
// compuesto (tinte al 60% sobre --card / --background). La tabla de valores
// MEDIDOS en el navegador se asienta acá en la verificación visual de esta
// misma rama (plan 2026-08-28-actividades-visual, Task 5); si algún par no
// llega a 4.5:1, se oscurece el texto (p. ej. text-primary → text-sky-800)
// antes de cerrar.
import { Building2, GraduationCap, Landmark, Utensils, type LucideIcon } from "lucide-react";
import type { RoomKey } from "@/lib/activities/rules";

export const ROOM_META: Record<
  RoomKey,
  { icon: LucideIcon; cardBorder: string; cardBg: string; timeText: string; roomText: string }
> = {
  historic: {
    icon: Landmark,
    cardBorder: "border-amber-600/40",
    cardBg: "bg-amber-50/60",
    timeText: "text-amber-900",
    roomText: "text-amber-800",
  },
  glass: {
    icon: Building2,
    cardBorder: "border-primary/40",
    cardBg: "bg-sky-50/60",
    timeText: "text-sky-900",
    roomText: "text-primary",
  },
  kitchen: {
    icon: Utensils,
    cardBorder: "border-rose-600/40",
    cardBg: "bg-rose-50/60",
    timeText: "text-rose-900",
    roomText: "text-rose-800",
  },
  classroom: {
    icon: GraduationCap,
    cardBorder: "border-emerald-600/40",
    cardBg: "bg-emerald-50/60",
    timeText: "text-emerald-900",
    roomText: "text-emerald-800",
  },
};
```

- [ ] **Step 3: Reescribir `activity-card.tsx`**

Contenido completo del archivo:

```tsx
import { ROOM_LABELS, type AgendaEntry } from "@/lib/activities/rules";
import { ROOM_META } from "@/lib/activities/room-meta";

// Tarjeta de una actividad: horario primero en mono (el esqueleto de la
// cartelera), nombre protagonista y el espacio con su ícono. Reborde COMPLETO
// y fondo tintado del color del espacio. Sin hover: la tarjeta no es
// clickeable, y una sombra al pasar el mouse prometería una interacción que
// no existe. El nombre lo escribe la Comisión y puede ser largo:
// [overflow-wrap:anywhere] evita que empuje el ancho de la columna
// (verificado a 375px).
export function ActivityCard({ entry }: { entry: AgendaEntry }) {
  const meta = ROOM_META[entry.room];
  const Icon = meta.icon;
  return (
    <li className={`rounded-xl border p-3 ${meta.cardBorder} ${meta.cardBg}`}>
      <p className={`font-mono text-xs font-semibold tabular-nums ${meta.timeText}`}>
        {entry.startTime} — {entry.endTime}
      </p>
      <p className="mt-1 text-sm font-semibold [overflow-wrap:anywhere]">{entry.name}</p>
      <p className={`mt-1.5 flex items-center gap-1 text-xs ${meta.roomText}`}>
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="[overflow-wrap:anywhere]">{ROOM_LABELS[entry.room]}</span>
      </p>
    </li>
  );
}
```

- [ ] **Step 4: Suite + typecheck**

Run: `npm test` → verde (nada testea estos archivos, pero nada debe romperse).
Run: `npx tsc --noEmit` → sin errores (si `tsc` acusa `accentBorder` en otro archivo, volver al Step 1).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activities/room-meta.ts "src/app/(public)/actividades/activity-card.tsx"
git commit -m "feat(actividades): full room-color border on activity cards"
```

---

### Task 3: `page.tsx` — encabezado con firma, leyenda, días dinámicos

**Files:**
- Modify: `src/app/(public)/actividades/page.tsx` (solo desde la línea 43 en adelante; las líneas 1–41 cambian ÚNICAMENTE en los imports)

**Interfaces:**
- Consumes: todo lo de Task 1 (`visibleAgendaDays`, `initialVisibleDay`, `weekSpanLabel`, `agendaSummary`, `visibleRooms`), `ROOM_META` de Task 2, `ROOM_LABELS`/`buildDailyAgenda` de `rules.ts`, `CalendarDays`/`MapPin` de lucide-react.
- Produces: monta `<DayTabs agenda={visibleDays} initialDay={initialDay} />` con la firma VIEJA de DayTabs (Task 4 la cambia; en esta task el componente viejo funciona porque recibe solo días con entradas y su rama de día vacío queda inalcanzable).

- [ ] **Step 1: Actualizar imports**

Reemplazar las líneas 1–14 por:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { CalendarDays, MapPin } from "lucide-react";
import { getActivitiesForYear, getActivityYears } from "@/lib/activities/query";
import {
  agendaSummary,
  initialVisibleDay,
  visibleAgendaDays,
  visibleRooms,
  weekSpanLabel,
} from "@/lib/activities/presentation";
import { buildDailyAgenda, ROOM_LABELS } from "@/lib/activities/rules";
import { ROOM_META } from "@/lib/activities/room-meta";
import {
  activitiesYearHref,
  currentWeekdayAR,
  currentYearAR,
  resolveActivitiesYear,
} from "@/lib/activities/year-param";
import { siteBaseUrl } from "@/lib/site";
import { ActivityCard } from "./activity-card";
import { DayTabs } from "./day-tabs";
```

(Salen `initialAgendaDay` y `SITE`; `siteBaseUrl` queda para el metadata. NO tocar `force-dynamic`, `DESCRIPTION` ni `generateMetadata`.)

- [ ] **Step 2: Constantes de módulo (arriba del componente, después de `generateMetadata`)**

```tsx
// Tailwind no compila clases interpoladas: el número de columnas sale de un
// mapa estático. Con 1–2 días visibles el ancho se acota para que las
// columnas no queden de borde a borde en escritorio.
const GRID_COLS: Record<number, string> = {
  1: "lg:mx-auto lg:max-w-md lg:grid-cols-1",
  2: "lg:mx-auto lg:max-w-2xl lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

// Entrada escalonada por columna: 50ms por índice, tope 250ms. La única
// animación orquestada de la página; motion-reduce la apaga en cada uso.
const STAGGER = [
  "",
  "[animation-delay:50ms]",
  "[animation-delay:100ms]",
  "[animation-delay:150ms]",
  "[animation-delay:200ms]",
  "[animation-delay:250ms]",
];

const ENTER =
  "animate-in fade-in-0 slide-in-from-bottom-2 duration-300 [animation-fill-mode:backwards] motion-reduce:animate-none";
```

- [ ] **Step 3: Reescribir el cuerpo del componente**

Reemplazar el componente `ActividadesPage` completo por (conservando los comentarios señalados):

```tsx
export default async function ActividadesPage({ searchParams }: PageProps<"/actividades">) {
  const sp = await searchParams;
  const years = await getActivityYears(); // descendente, solo años con actividades activas
  // (CONSERVAR el comentario actual del único currentYearAR por render)
  const currentYear = currentYearAR();
  const { year, fallback, canonicalHref, isCanonical } = resolveActivitiesYear(
    sp.anio,
    years,
    currentYear,
  );

  // (CONSERVAR el comentario actual del redirect canónico)
  if (!isCanonical) redirect(canonicalHref);

  const activities = await getActivitiesForYear(year);
  const agenda = buildDailyAgenda(activities);
  // Desde el rediseño del 28/08 el calendario lo dibujan los datos: un día
  // sin actividades no se renderiza (ni columna ni pill). No alcanza con
  // `activities.length` para el estado vacío: una actividad activa con
  // `weekdays` vacío o corrupto no cae en ningún día y dejaría el calendario
  // en blanco sin explicar nada. Lo que decide es lo que se puede MOSTRAR.
  const visibleDays = visibleAgendaDays(agenda);
  const hasDays = visibleDays.length > 0;
  // Hoy en hora argentina, para la columna resaltada del escritorio y el día
  // que trae elegido el selector del celular.
  const todayAR = currentWeekdayAR();
  // El resaltado de "hoy" sólo tiene sentido sobre el año en curso: en el
  // calendario de 2024 el jueves de esta semana no es ningún "hoy".
  const isCurrentYear = year === currentYear;
  const todayVisible = isCurrentYear && visibleDays.some((d) => d.day === todayAR);
  const initialDay = hasDays ? initialVisibleDay(visibleDays, todayAR) : 0;
  const initialDayLabel = visibleDays.find((d) => d.day === initialDay)?.label ?? "";
  const { activityCount, roomCount } = agendaSummary(visibleDays);
  const rooms = visibleRooms(visibleDays);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      {/* Título y bajada van juntos en el mismo bloque: si el selector de años
          se mete entre los dos, en el celular (donde el flex apila) la bajada
          queda separada del título que describe. En sm+ el selector se va a la
          derecha y quedan los dos en la misma línea. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          {hasDays && (
            // La firma de la página (el eyebrow mono que estrenó /ubicacion):
            // el rango REAL de la semana según los datos. Decorativo y
            // aria-hidden: la bajada dice lo mismo con palabras.
            <p
              aria-hidden
              className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase"
            >
              {weekSpanLabel(visibleDays)} · {year}
            </p>
          )}
          <h1 className="mt-1 text-2xl font-semibold">Actividades</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasDays
              ? `${activityCount} ${activityCount === 1 ? "actividad" : "actividades"} en ${roomCount} ${roomCount === 1 ? "espacio" : "espacios"} de la sede en ${year}.`
              : "La agenda de actividades de la sede vecinal."}
          </p>
          <Link
            href="/ubicacion"
            className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MapPin aria-hidden className="size-4 shrink-0" />
            Ver dónde queda la sede
          </Link>
        </div>
        {years.length > 1 && (
          // min-h-11 en cada año: se toca desde el celular, igual que los
          // links del menú.
          <nav aria-label="Elegir año">
            <ul className="flex flex-wrap gap-2">
              {years.map((y) => (
                <li key={y}>
                  <Link
                    // (CONSERVAR el comentario actual del href canónico)
                    href={activitiesYearHref(y, fallback)}
                    aria-current={y === year ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
                      y === year
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    {y}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>

      {!hasDays ? (
        <div className="mt-8 rounded-xl border border-dashed px-4 py-12 text-center">
          <CalendarDays aria-hidden className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Todavía no hay actividades cargadas para {year}. Consultá en la sede vecinal.
          </p>
        </div>
      ) : (
        <>
          {isCurrentYear && !todayVisible && (
            <p className="mt-4 text-sm text-muted-foreground">
              Hoy no hay actividades — te esperamos el{" "}
              {initialDayLabel.toLocaleLowerCase("es-AR")}.
            </p>
          )}

          {/* Leyenda estática: solo los espacios presentes en el calendario,
              con el mismo juego de colores de sus tarjetas. No son controles:
              sin hover y sin min-h-11. */}
          <ul className="mt-6 flex flex-wrap gap-2">
            {rooms.map((room) => {
              const meta = ROOM_META[room];
              const Icon = meta.icon;
              return (
                <li
                  key={room}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${meta.cardBorder} ${meta.cardBg} ${meta.roomText}`}
                >
                  <Icon aria-hidden className="size-3.5 shrink-0" />
                  {ROOM_LABELS[room]}
                </li>
              );
            })}
          </ul>

          {/* Dos lecturas de la misma semana:
              — desde lg, "¿cómo viene la semana?": una columna por día CON
                actividades, todo de un vistazo;
              — hasta lg, "¿qué hay hoy?": un día por vez con el de hoy (o el
                próximo) elegido.
              Sin `items-start`: el `stretch` del grid empareja la altura de
              las columnas de la fila; con items-start quedaban dentadas, que
              es lo contrario de "la semana de un vistazo". */}
          <div className={`mt-8 hidden gap-3 lg:grid ${GRID_COLS[visibleDays.length]}`}>
            {visibleDays.map(({ day, label, entries }, i) => {
              const isToday = isCurrentYear && day === todayAR;
              return (
                <section
                  key={day}
                  className={`rounded-xl border bg-card p-3 ${ENTER} ${STAGGER[i]} ${
                    isToday ? "ring-2 ring-primary" : ""
                  }`}
                >
                  <h2 className="flex items-center justify-between gap-2 text-sm font-semibold">
                    <span className="flex items-center gap-1.5">
                      {label}
                      {isToday && (
                        // (CONSERVAR el comentario actual del par lleno
                        // bg-primary/text-primary-foreground medido AA)
                        <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-primary-foreground">
                          Hoy
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
                      {entries.length}
                      <span className="sr-only">
                        {entries.length === 1 ? " actividad" : " actividades"}
                      </span>
                    </span>
                  </h2>
                  <ul className="mt-2.5 space-y-2">
                    {entries.map((e) => (
                      <ActivityCard key={e.id} entry={e} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          <div className={`mt-6 lg:hidden ${ENTER}`}>
            <DayTabs agenda={visibleDays} initialDay={initialDay} />
          </div>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Suite + typecheck**

Run: `npm test` → verde. Run: `npx tsc --noEmit` → sin errores.

- [ ] **Step 5: Humo en dev**

Levantar el dev server (`sigev-dev` de `.claude/launch.json`) y abrir `/actividades`: la página renderiza sin error de servidor, muestra solo días con actividades, y `/actividades?anio=1999` redirige a la canónica. (La verificación visual completa es la Task 5.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/(public)/actividades/page.tsx"
git commit -m "feat(actividades): redesign the public page with data-driven days"
```

---

### Task 4: `day-tabs.tsx` — pills, punto de hoy, fade de panel

**Files:**
- Modify: `src/app/(public)/actividades/day-tabs.tsx` (completo)
- Modify: `src/app/(public)/actividades/page.tsx` (solo la línea del montaje de `DayTabs`)

**Interfaces:**
- Consumes: `AgendaDay` de `rules.ts`, `ActivityCard` de Task 2, `initialDay`/`visibleDays`/`todayVisible`/`todayAR` ya calculados en `page.tsx` (Task 3).
- Produces: `DayTabs({ days, initialDay, todayDay }: { days: AgendaDay[]; initialDay: number; todayDay: number | null })`.

- [ ] **Step 1: Reescribir `day-tabs.tsx`**

Contenido completo del archivo:

```tsx
"use client";
// Selector de día para el celular: estado local, sin parámetro de URL (mismo
// criterio que MemberTabs — no navega, es una vista de la misma página). El
// día inicial llega del servidor calculado con hora argentina, ya resuelto
// sobre los días VISIBLES (los que tienen actividades): acá no hay días
// vacíos, así que tampoco hay rama de "sin actividades" — el vacío total lo
// corta la página antes de montar este componente.
import { useState } from "react";
import type { AgendaDay } from "@/lib/activities/rules";
import { ActivityCard } from "./activity-card";

export function DayTabs({
  days,
  initialDay,
  todayDay,
}: {
  days: AgendaDay[];
  initialDay: number;
  todayDay: number | null;
}) {
  const [selected, setSelected] = useState(initialDay);
  const current = days.find((d) => d.day === selected) ?? days[0];
  return (
    <div>
      {/* `role="group"` y no `<nav>`: un div pelado mapea a `generic`, que
          PROHIBE nombrarse, así que el `aria-label` se caía y quedaban los
          botones sueltos sin nada que dijera qué eligen. Los chips de año sí
          son `<nav>` porque son links que navegan a otra URL; estos botones no
          navegan —cambian una vista de la misma página, sin tocar la barra de
          direcciones—, y un landmark de navegación prometería lo contrario en
          la lista de landmarks del lector de pantalla. No es un `tablist`: eso
          debería flechas del teclado, y no es parte de este arreglo. */}
      <div role="group" aria-label="Elegir día" className="flex gap-1.5 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d.day}
            type="button"
            aria-pressed={d.day === selected}
            onClick={() => setSelected(d.day)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
              d.day === selected
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
          >
            {d.label}
            {d.day === todayDay && (
              // El punto es la marca de "hoy"; como el color es la única señal
              // visual, el sr-only la duplica en texto. Sobre la pill elegida
              // (fondo celeste lleno) el punto pasa a blanco.
              <>
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${
                    d.day === selected ? "bg-primary-foreground" : "bg-primary"
                  }`}
                />
                <span className="sr-only">(hoy)</span>
              </>
            )}
          </button>
        ))}
      </div>
      {/* El `key` re-monta la lista al cambiar de día: el fade corto hace
          legible que el contenido cambió. motion-reduce lo apaga. */}
      <ul
        key={current.day}
        className="mt-4 space-y-3 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
      >
        {current.entries.map((e) => (
          <ActivityCard key={e.id} entry={e} />
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Actualizar el montaje en `page.tsx`**

En el bloque mobile de `page.tsx`, reemplazar:

```tsx
<DayTabs agenda={visibleDays} initialDay={initialDay} />
```

por:

```tsx
<DayTabs
  days={visibleDays}
  initialDay={initialDay}
  todayDay={todayVisible ? todayAR : null}
/>
```

- [ ] **Step 3: Suite + typecheck**

Run: `npm test` → verde. Run: `npx tsc --noEmit` → sin errores.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(public)/actividades/day-tabs.tsx" "src/app/(public)/actividades/page.tsx"
git commit -m "feat(actividades): redesign the mobile day selector"
```

---

### Task 5: Verificación en navegador + medición de contrastes

**Files:**
- Create (temporal): `scripts/tmp-actividades-visual-check.ts`
- Modify: `src/lib/activities/room-meta.ts` (solo el comentario con la tabla medida; clases solo si algún par no llega a 4.5:1)

**Interfaces:**
- Consumes: el dev server `sigev-dev` (`.claude/launch.json`, puerto 3000) y las herramientas del Browser pane.
- Produces: tabla de contrastes medida en `room-meta.ts` + capturas desktop/375px enviadas al operador.

- [ ] **Step 1: Crear fixtures temporales**

Crear `scripts/tmp-actividades-visual-check.ts` (imitar el estilo de import de Prisma de `scripts/seed-holidays.ts` — mirar ese archivo y usar EXACTAMENTE el mismo import del cliente):

```ts
// Fixtures TEMPORALES para la verificación visual del rediseño de
// /actividades. Años sintéticos que no chocan con los datos reales:
//   2030 → 2 días visibles (lunes y jueves)
//   2029 → 5 días visibles (lunes a viernes, sin sábado), con los 4 espacios
// Uso:  npx tsx scripts/tmp-actividades-visual-check.ts          (crea)
//       npx tsx scripts/tmp-actividades-visual-check.ts --clean  (borra)
// BORRAR este archivo antes del merge (Task 6).
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const FIXTURES = [
  { name: "Prueba visual A", room: "historic", weekdays: [1, 4], startTime: "10:00", endTime: "11:00", year: 2030 },
  { name: "Prueba visual B", room: "glass", weekdays: [4], startTime: "18:00", endTime: "19:30", year: 2030 },
  { name: "Prueba visual C", room: "kitchen", weekdays: [1, 2, 3], startTime: "09:00", endTime: "10:00", year: 2029 },
  { name: "Prueba visual D", room: "classroom", weekdays: [2, 4, 5], startTime: "14:00", endTime: "15:00", year: 2029 },
  { name: "Prueba visual E", room: "glass", weekdays: [5], startTime: "20:00", endTime: "21:00", year: 2029 },
  { name: "Prueba visual F", room: "historic", weekdays: [1, 5], startTime: "16:00", endTime: "17:30", year: 2029 },
] as const;

async function main() {
  if (process.argv.includes("--clean")) {
    const res = await prisma.activity.deleteMany({
      where: { year: { in: [2029, 2030] }, name: { startsWith: "Prueba visual" } },
    });
    console.log(`Borradas ${res.count} actividades de prueba.`);
  } else {
    for (const f of FIXTURES) {
      await prisma.activity.create({
        data: { ...f, weekdays: [...f.weekdays], active: true },
      });
    }
    console.log(`Creadas ${FIXTURES.length} actividades de prueba (2029 y 2030).`);
  }
  await prisma.$disconnect();
}
main();
```

Run: `npx tsx scripts/tmp-actividades-visual-check.ts`
Expected: "Creadas 6 actividades de prueba (2029 y 2030)."
**Ojo caché:** la página lee con `unstable_cache`; después de crear (y después de borrar) los fixtures hay que REINICIAR el dev server para que los vea.

- [ ] **Step 2: Verificación visual desktop**

Con el dev server arriba (preview `sigev-dev`), en `/actividades`:
1. Consola y red limpias (`read_console_messages` con onlyErrors, sin 500).
2. La página muestra SOLO los días con actividades del año actual; el domingo no existe.
3. Si hoy tiene actividades: la columna de hoy lleva `ring-2` celeste + chip "Hoy"; si no, aparece "Hoy no hay actividades — te esperamos el …" con el día correcto.
4. Eyebrow mono con el rango real (p. ej. `LUNES — VIERNES · 2026`), bajada con conteos correctos (cotejar a mano contra `/admin/actividades`), leyenda solo con espacios presentes.
5. `/actividades?anio=2030` → DOS columnas centradas (no de borde a borde), eyebrow `LUNES — JUEVES · 2030`, sin resaltado de hoy (no es el año en curso).
6. `/actividades?anio=2029` → CINCO columnas, sin sábado, leyenda con los 4 espacios.
7. `/actividades?anio=1999` → redirige a `/actividades`.
8. Chips de año como pills, el activo lleno, `aria-current="page"` en el activo (verificar con `read_page`).
9. Screenshot desktop de `/actividades` y de `?anio=2029`.

- [ ] **Step 3: Verificación visual mobile (375px)**

`resize_window` preset mobile, recargar:
1. Selector de pills con solo los días visibles; la de hoy (si está) con su punto; `aria-pressed` correcto.
2. Tocar otra pill: el panel cambia con fade y las tarjetas son las del día.
3. Sin scroll horizontal del body; nombres largos de actividad envuelven dentro de la tarjeta.
4. Targets: pills y chips de año ≥ 44px de alto real (medir con `javascript_tool`: `getBoundingClientRect().height`).
5. Screenshot mobile.
6. Volver a `resize_window` preset desktop al terminar.

- [ ] **Step 4: Medir contrastes y asentar la tabla**

En `/actividades?anio=2029` (tiene los 4 espacios), correr con `javascript_tool`:

```js
(() => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  const parse = (s) => { const m = (s.match(/[\d.]+/g) || []).map(Number); return { rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
  const over = (fg, bg) => fg.rgb.map((v, i) => v * fg.a + bg[i] * (1 - fg.a));
  const bgOf = (el) => { let bg = [255, 255, 255]; const chain = []; for (let n = el; n; n = n.parentElement) chain.unshift(n); for (const n of chain) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0) bg = over(c, bg); } return bg; };
  const ratio = (el) => { const t = parse(getComputedStyle(el).color); const bg = bgOf(el); const [a, b] = [lum(over(t, bg)), lum(bg)].sort((x, y) => y - x); return Number(((a + 0.05) / (b + 0.05)).toFixed(2)); };
  const out = {};
  document.querySelectorAll("main section li").forEach((li) => {
    const ps = li.querySelectorAll("p");
    const key = ps[2].textContent.trim();
    if (!out[key]) out[key] = { time: ratio(ps[0]), room: ratio(ps[2]), name: ratio(ps[1]) };
  });
  return out;
})()
```

Con los resultados:
1. Todos los pares `time`/`room`/`name` deben dar ≥ 4.5. Si alguno no llega, oscurecer SOLO ese texto en `room-meta.ts` (candidatos: `text-primary` → `text-sky-800`; tono 800 → 900) y volver a medir.
2. Reemplazar en el comentario de `room-meta.ts` la tabla pendiente por la tabla medida real (espacio × timeText/roomText con los ratios), citando que se midió sobre el fondo compuesto en claro.

- [ ] **Step 5: Reduced motion**

Verificar por DOM (con `read_page` o `javascript_tool`) que las columnas, el bloque mobile y el panel de DayTabs llevan `motion-reduce:animate-none` en su `class`. (El Browser pane no emula `prefers-reduced-motion`; la clase presente es el criterio.)

- [ ] **Step 6: Limpiar fixtures y enviar evidencia**

Run: `npx tsx scripts/tmp-actividades-visual-check.ts --clean`
Expected: "Borradas 6 actividades de prueba." Reiniciar el dev server (caché).
Enviar al operador las capturas (desktop, 5 días, 2 días, mobile) con `SendUserFile`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/activities/room-meta.ts
git commit -m "docs(actividades): record measured AA contrasts in room-meta"
```

(Si el Step 4 obligó a cambiar clases, el mensaje es `fix(actividades): darken room text colors to AA and record measurements`.)

---

### Task 6: Cierre de rama

**Files:**
- Delete: `scripts/tmp-actividades-visual-check.ts`

- [ ] **Step 1: Borrar el script temporal**

```bash
rm scripts/tmp-actividades-visual-check.ts
```

(Nunca se commiteó; verificar con `git status` que no aparece.)

- [ ] **Step 2: Verificación final (superpowers:verification-before-completion)**

- Run: `npm test` → TODO verde; anotar el total de casos (esperado: los ~3186 + 12 nuevos).
- Run: `npx tsc --noEmit` → sin errores.
- Run: `git diff --stat main...HEAD` → SOLO estos archivos:
  `docs/superpowers/specs/2026-08-28-actividades-visual-design.md`,
  `docs/superpowers/plans/2026-08-28-actividades-visual.md`,
  `src/lib/activities/presentation.ts`, `tests/activities-presentation.test.ts`,
  `src/lib/activities/room-meta.ts`, `src/app/(public)/actividades/page.tsx`,
  `src/app/(public)/actividades/activity-card.tsx`,
  `src/app/(public)/actividades/day-tabs.tsx`.
  Si aparece CUALQUIER archivo de `src/lib/treasury/`, `src/lib/mp/`,
  `src/app/admin/` o `src/app/mi/`: PARAR y revisar (criterio de aceptación 8).

- [ ] **Step 3: Cierre**

Invocar superpowers:finishing-a-development-branch para decidir la integración con el operador (merge `--no-ff` a `main` como las ramas anteriores; el push lo corre Mariano — NUNCA pushear desde acá).
