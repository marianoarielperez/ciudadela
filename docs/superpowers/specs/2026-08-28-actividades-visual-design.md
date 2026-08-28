# Rediseño visual de /actividades — "La cartelera de la sede"

**Fecha:** 2026-08-28
**Estado:** aprobado por el operador (dos rondas de preguntas + diseño presentado)
**Alcance:** solo cambios visuales y de presentación. Cero cambios en pagos,
tesorería, Mercado Pago, panel, wizards ni en el dominio de actividades
(`rules.ts` y sus 42 tests quedan intactos).

## 1. Objetivo

Rediseñar por completo la presentación de la página pública `/actividades`:

- **Días dinámicos**: el calendario muestra únicamente los días que tienen al
  menos una actividad. Si la Comisión carga lunes a viernes, se ven cinco
  columnas; si carga también sábado, seis. El domingo no existe (ya lo impide
  el dominio). Un día intermedio sin actividades desaparece.
- **Tarjeta con reborde completo**: la tarjeta de actividad pasa de
  `border-l-2` a un contorno completo del color de su espacio, con fondo
  tintado suave del mismo tono.
- **Adoptar el lenguaje visual nuevo del sitio** (módulos 4/5 y los rediseños
  del 27–28/08): eyebrow en Geist Mono, horarios en mono con `tabular-nums`,
  `rounded-xl`, chips tintados, `motion-reduce:`. `/actividades` es la única
  página pública informativa que quedó fuera de ese vocabulario.
- La URL no cambia, la nav sigue diciendo "Actividades", el esquema `?anio=`
  y el SEO quedan byte-idénticos.

## 2. Contexto verificado (28/08/2026)

- Una actividad tiene SOLO estos datos (`prisma/schema.prisma:524-542`):
  nombre, espacio (`Room`: historic/glass/kitchen/classroom), días (JSON de
  enteros 1-6), hora desde/hasta ("HH:MM"), año, visible. No hay descripción,
  arancel ni contacto: el rediseño no puede mostrar lo que no existe.
- La semana está fija en presentación: `buildDailyAgenda`
  (`src/lib/activities/rules.ts:191`) devuelve SIEMPRE 6 `AgendaDay` (uno por
  entrada de `WEEKDAYS`), y la grilla desktop es `lg:grid-cols-6` hardcodeada
  (`page.tsx:143`). Hacer los días dinámicos es un filtro de presentación:
  `page.tsx` ya calcula `busyDays = agenda.filter(d => d.entries.length > 0)`
  para el estado vacío global.
- La tarjeta actual (`activity-card.tsx:11`) es
  `rounded-md border-l-2 bg-muted/40` + color por espacio de
  `src/lib/activities/room-meta.ts`, cuyos contrastes están medidos SOBRE ESE
  fondo (`room-meta.ts:9-13`). Si cambia el fondo, hay que re-medir.
- Los **íconos** de `room-meta.ts` los comparte `/ubicacion`
  (`ubicacion/page.tsx:5,40-43`): no se tocan. Los campos de color solo los
  consume `activity-card.tsx`: son libres.
- Ningún test cubre el markup de `page.tsx`, `activity-card.tsx`, `day-tabs.tsx`
  ni `room-meta.ts` (verificado por grep sobre `tests/`). La suite protege el
  dominio (`tests/activities-rules.test.ts`, 42 casos) y los rótulos
  (`WEEKDAYS` con nombres exactos, `ROOM_LABELS === SITE.rooms`).
- Intocables de `page.tsx`: `export const dynamic = "force-dynamic"` (línea 21
  — sin él, "Hoy" se congela en el día del build), `generateMetadata` con
  canonical absoluto (25-41), el redirect canónico de `?anio=` (60) y el
  `<main>` propio (82 — el layout público no pone uno).
- Cero acoplamiento con pagos: la cadena de imports transitiva de la página no
  toca `src/lib/treasury/*` ni `src/lib/mp/*` (verificado por grep e imports).
- El sitio público es light-only (el ThemeProvider vive solo en el panel);
  la CSP permite `style-src 'unsafe-inline'` y el SVG inline no la toca.

## 3. Decisiones tomadas (rondas con el operador)

| Tema | Decisión |
|---|---|
| Días visibles | Solo días con actividad; un hueco intermedio desaparece |
| Domingo | Nunca (ya lo garantiza el dominio; no cambia) |
| Reborde de tarjeta | Contorno completo del color del espacio + fondo tintado suave |
| Organización | Se mantiene el modelo: columnas por día en desktop, selector en móvil |
| Encabezado | "Con firma": eyebrow mono + h1 + bajada con datos reales; sin foto |
| Hoy sin actividad | Se preselecciona el próximo día con actividad (orden cíclico de semana) y una línea discreta dice "Hoy no hay actividades" |
| Espacios | Leyenda estática (ícono + nombre + tinte) integrada al encabezado; sin filtro |
| Animación | Sutil y puntual: fade de entrada escalonado + transiciones en controles, todo con `motion-reduce:` |
| Paleta | Se mantienen los 4 matices (ámbar/celeste/rosa/verde), re-ajustando intensidades para AA sobre el fondo nuevo |

Refinamiento sobre lo aprobado: las tarjetas de actividad NO llevan
`hover:shadow` — no son clickeables, y una sombra al hover es una promesa de
interacción que la tarjeta no cumple. El movimiento va donde hay interacción
real (pills de día, chips de año) y en la entrada escalonada.

## 4. Diseño de la página

Contenedor: `<main class="mx-auto w-full max-w-5xl px-4 py-10">` (molde
estándar; se conserva).

### 4.1 Encabezado con firma

- **Eyebrow mono** (la firma que estrenó `/ubicacion`, `aria-hidden`):
  `font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase`,
  con el rango real de la semana derivado de los datos —
  `LUNES — VIERNES · 2026` (primer y último día visible; con un solo día,
  solo ese día). Sale de una función pura, no hardcodeado.
- `h1` "Actividades" — `text-2xl font-semibold` (patrón de sección).
- Bajada `mt-2 text-sm text-muted-foreground` con el resumen REAL del año:
  "12 actividades en 4 espacios de la sede." (conteos derivados de los datos:
  actividades distintas y espacios distintos del calendario visible).
- Línea de enlace a la sede (se conserva la intención actual): ícono `MapPin`
  `size-4` + "Ver dónde queda la sede" → `/ubicacion`, patrón
  `inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary
  outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring`.
- **Aviso "hoy"**: si es el año en curso y el día de hoy NO está en el
  calendario visible, una línea discreta (`text-sm text-muted-foreground`,
  `role` ninguno — texto estático): "Hoy no hay actividades — te esperamos el
  jueves." (el día es el próximo visible). Server-rendered, una sola vez,
  visible en ambos breakpoints.

### 4.2 Leyenda de espacios

Fila de chips estáticos bajo el encabezado (`mt-6 flex flex-wrap gap-2`),
SOLO con los espacios presentes en el calendario visible, en orden
`ROOM_KEYS`:

- Chip: `inline-flex items-center gap-1.5 rounded-full border px-3 py-1
  text-xs font-medium` + borde/tinte/texto del espacio (mismos tokens que la
  tarjeta) + ícono de `ROOM_META` `size-3.5 aria-hidden shrink-0`.
- No son botones ni links: sin hover, sin `min-h-11` (no son targets).

### 4.3 Chips de año

Cuando `years.length > 1`, se conserva el `<nav aria-label="Elegir año">` con
`activitiesYearHref` y `aria-current="page"` intactos; solo cambia la piel:
pills `rounded-full` `min-h-11` coherentes con el selector de día — activo
`border-primary bg-primary text-primary-foreground`, resto
`border hover:bg-muted`, `outline-hidden focus-visible:ring-2
focus-visible:ring-ring`, `transition-colors`.

### 4.4 Desktop (`lg+`): la grilla dinámica

- Wrapper `hidden lg:grid gap-3` + clase de columnas por MAPA ESTÁTICO
  (Tailwind no compila clases interpoladas):
  `{1: "lg:grid-cols-1", 2: "lg:grid-cols-2", …, 6: "lg:grid-cols-6"}`.
  Con 1–2 días, el wrapper agrega `lg:max-w-md` / `lg:max-w-2xl` + `lg:mx-auto`
  para que las columnas no queden de borde a borde.
- Columna de día: `<section class="rounded-xl border bg-card p-3">` con las
  tarjetas apiladas (`ul` + `space-y-2`). El grid estira las columnas a la
  misma altura (comportamiento actual, se conserva a propósito).
- Encabezado de columna: `<h2 class="flex items-baseline justify-between
  gap-2 text-sm font-semibold">` con el nombre completo del día y la cantidad
  en mono (`<span class="font-mono text-xs tabular-nums
  text-muted-foreground">3</span>`, con `sr-only` "actividades" al lado).
- **La columna de hoy es la firma de la página** (solo año en curso):
  `ring-2 ring-primary` sobre la sección + chip "Hoy" lleno en el encabezado
  (`rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium uppercase
  tracking-wide text-primary-foreground` — el par lleno ya medido AA, se
  conserva). El chip suelto actual desaparece: lo reemplazan el halo + chip.
- Ya no existen columnas "Sin actividades" en desktop: los días vacíos no se
  renderizan.

### 4.5 Móvil (`< lg`): selector de día

- Se conserva la semántica documentada: `role="group"
  aria-label="Elegir día"`, botones con `aria-pressed`, NO tablist
  (`day-tabs.tsx:14-21` explica por qué; ese razonamiento se preserva en
  comentario).
- Pills: `min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium
  transition-colors outline-hidden focus-visible:ring-2
  focus-visible:ring-ring`; activa `border-primary bg-primary
  text-primary-foreground`; resto `hover:bg-muted`. Contenedor
  `flex gap-1.5 overflow-x-auto pb-1` (se conserva).
- La pill del día de hoy (cuando hoy está visible y no seleccionado) lleva un
  punto celeste `aria-hidden` (`size-1.5 rounded-full bg-primary`) + sufijo
  `sr-only` "(hoy)".
- **Solo se listan los días visibles**: la rama "Sin actividades el …" de
  `day-tabs.tsx` se elimina (inalcanzable: todo día listado tiene entradas;
  el vacío total lo cubre el estado vacío global antes de montar el selector).
- **Preselección nueva**: `initialVisibleDay` — si hoy está visible, hoy; si
  no, el próximo día visible en orden cíclico de semana (sábado→lunes,
  miércoles vacío→jueves, domingo(7)→lunes). Reemplaza a `initialAgendaDay`
  SOLO en esta página; `rules.ts` no se toca (su función queda, con sus
  tests).
- Cambio de día: el panel de tarjetas entra con
  `animate-in fade-in-0 duration-200 motion-reduce:animate-none` re-disparado
  por `key={selectedDay}`.

### 4.6 La tarjeta de actividad

```
<li class="rounded-xl border p-3 {meta.cardBorder} {meta.cardBg}">
  <p class="font-mono text-xs font-semibold tabular-nums {meta.timeText}">
    18:00 — 19:30
  </p>
  <p class="mt-1 text-sm font-semibold [overflow-wrap:anywhere]">
    Nombre de la actividad
  </p>
  <p class="mt-1.5 flex items-center gap-1 text-xs {meta.roomText}">
    <Icon aria-hidden class="size-3.5 shrink-0" /> Salón Histórico
  </p>
</li>
```

- **Horario primero** en Geist Mono con `tabular-nums` (el esqueleto de la
  cartelera; separador "—" en vez del " a " actual), nombre como protagonista,
  pie con ícono + espacio.
- Reborde completo + fondo tintado del espacio (ver §4.8). Sin hover (no es
  clickeable). `[overflow-wrap:anywhere]` se conserva (texto de la Comisión,
  verificación a 375px).

### 4.7 Estados vacíos

- **Año sin actividades** (criterio actual `busyDays.length === 0`, se
  conserva): bloque `mt-8 rounded-xl border border-dashed px-4 py-12
  text-center` con ícono `CalendarDays` `size-6 text-muted-foreground
  aria-hidden` centrado, el texto actual ("Todavía no hay actividades cargadas
  para {year}. Consultá en la sede vecinal.") y debajo el link a `/ubicacion`
  con el patrón de link del encabezado. Ni la leyenda ni el aviso "hoy" se
  muestran en este estado.
- Días vacíos: ya no se renderizan (ni columna ni pill).

### 4.8 Color y contraste (`room-meta.ts`)

- Los **íconos no cambian** (los comparte `/ubicacion`): `Landmark`,
  `Building2`, `Utensils`, `GraduationCap`.
- Los campos `accentBorder`/`accentText` se REEMPLAZAN por el juego nuevo por
  espacio: `cardBorder` (borde completo, tono ~600 con opacidad),
  `cardBg` (tinte suave, tono ~50), `timeText` y `roomText` (tonos ~800).
  Punto de partida (a validar midiendo):
  - historic: `border-amber-600/40 bg-amber-50/60`, textos `text-amber-800/900`
  - glass: `border-primary/40 bg-sky-50/60`, textos `text-primary` / `text-sky-900`
  - kitchen: `border-rose-600/40 bg-rose-50/60`, textos `text-rose-800/900`
  - classroom: `border-emerald-600/40 bg-emerald-50/60`, textos `text-emerald-800/900`
- **Regla de cierre**: los contrastes se MIDEN en el navegador sobre el fondo
  real compuesto (tinte sobre `bg-card`/`--background`) para texto de 12px —
  objetivo ≥ 4.5:1 — y la tabla de mediciones nuevas reemplaza a la actual en
  el comentario de `room-meta.ts` (convención del proyecto: contrastes
  medidos, no estimados). El nombre de la actividad va en `text-foreground`
  (sin riesgo).
- Las variantes `dark:` de los campos de color se eliminan: el sitio público
  es light-only por decisión escrita (`turnstile-widget.tsx:134-137`) y estos
  campos solo se consumen en público. (Los íconos no llevan color propio.)

### 4.9 Animación de entrada

- Una sola orquestación al cargar: las columnas (desktop) / las pills y el
  panel (móvil) entran con `animate-in fade-in-0 slide-in-from-bottom-2`
  escalonado por índice (`[animation-delay:…]` en pasos de 50ms, tope 300ms),
  `duration-300`, `fill-mode-backwards`, y SIEMPRE
  `motion-reduce:animate-none`. Nada más se anima solo.
- `tw-animate-css` ya está importado en `globals.css`: sin dependencias
  nuevas ni `@keyframes` propios.

## 5. Arquitectura de componentes

```
src/app/(public)/actividades/
├── page.tsx              Server Component. NO cambian: force-dynamic,
│                         generateMetadata, redirect canónico, <main>,
│                         consulta y años. Cambia solo el render: encabezado
│                         con firma, leyenda, aviso "hoy", grilla dinámica,
│                         estado vacío.
├── activity-card.tsx     Rediseñada (§4.6).
└── day-tabs.tsx          Rediseñada (§4.5): recibe SOLO días visibles +
                          initialDay ya resuelto; pierde la rama de día vacío.

src/lib/activities/
├── presentation.ts       NUEVO, puro, sin "use client" ni Prisma:
│                         visibleAgendaDays(agenda), initialVisibleDay(visible,
│                         todayAR), weekSpanLabel(visible),
│                         agendaSummary(visible) → {activityCount, roomCount}.
│                         Es lo que se testea.
└── room-meta.ts          Íconos intactos; campos de color nuevos + tabla de
                          contrastes re-medida (§4.8).
```

- `rules.ts`, `query.ts`, `year-param.ts`, `dates.ts`, `site.ts`: sin cambios.
- `initialAgendaDay` de `rules.ts` deja de usarse en la página pero se queda
  donde está, con sus tests (no se toca el módulo).
- Sin dependencias npm nuevas.

## 6. Qué NO se toca

- `src/lib/treasury/*`, `src/lib/mp/*`, rutas de pago, panel `/admin` y `/mi`,
  wizards: nada. (Criterio de cierre: `git diff --stat` no lista ninguno.)
- `src/app/admin/actividades/*` (el CRUD del operador): nada.
- SEO byte-idéntico: `generateMetadata` (title, description, canonical),
  redirect de `?anio=`, `src/app/sitemap.ts`, `public-nav.ts`.
- Header, footer, layout público: nada.
- `tests/` existentes: deben pasar SIN modificar una aserción.

## 7. Tests

- `tests/activities-presentation.test.ts` (nuevo, Vitest puro):
  - `visibleAgendaDays`: filtra días sin entradas; conserva orden; 6 días
    llenos → 6; ninguno → `[]`.
  - `initialVisibleDay`: hoy visible → hoy; hoy no visible → próximo cíclico
    (sábado→lunes, miércoles→jueves, domingo 7→lunes); lista de un solo día.
  - `weekSpanLabel`: "Lunes — Viernes", un solo día → "Sábado".
  - `agendaSummary`: cuenta actividades DISTINTAS (una actividad en 3 días
    cuenta una vez) y espacios distintos.
- Suite completa verde (`npm test`) sin tocar tests existentes.
- Verificación visual con dev server + navegador (registrada con capturas):
  - Desktop y 375px, con datos que produzcan 6, 5 y 2 días visibles.
  - Columna/pill de hoy resaltada el día real; caso "hoy sin actividad"
    forzado por datos (quitar las actividades del día actual en local).
  - Contrastes de §4.8 medidos sobre el fondo compuesto y documentados.
  - Estado vacío del año, chips de año con `?anio=` y redirect canónico.
  - `prefers-reduced-motion` activado: sin animación de entrada.

## 8. Criterios de aceptación

1. El calendario muestra SOLO los días con actividad, en desktop (columnas) y
   móvil (pills); con datos de lunes a viernes se ven 5 columnas, y nunca
   aparece el domingo.
2. La tarjeta de actividad tiene el reborde completo y el fondo tintado del
   color de su espacio, con contrastes ≥ 4.5:1 medidos y documentados en
   `room-meta.ts`.
3. Con hoy fuera del calendario, la página muestra "Hoy no hay actividades —
   te esperamos el {día}" y el móvil preselecciona ese día; con hoy visible,
   la columna lleva halo + chip "Hoy" y la pill su punto.
4. El encabezado muestra eyebrow mono con el rango real de días, el resumen
   real (actividades y espacios) y la leyenda solo con espacios presentes.
5. `?anio=` y su redirect canónico, metadata, sitemap y nav siguen
   byte-idénticos; `/ubicacion` sigue mostrando los mismos íconos de espacios.
6. `npm test` entero verde sin modificar tests existentes; los nuevos tests de
   `presentation.ts` pasan.
7. Accesibilidad conservada: targets ≥ 44px en todo control, `aria-pressed` en
   el selector, `aria-current` en años, `outline-hidden` +
   `focus-visible:ring`, `motion-reduce:` en toda animación, `sr-only` donde
   el color/punto es la única señal.
8. `git diff --stat` del cierre no toca `src/lib/treasury/*`, `src/lib/mp/*`,
   `src/app/admin/*` ni `src/app/mi/*`.
