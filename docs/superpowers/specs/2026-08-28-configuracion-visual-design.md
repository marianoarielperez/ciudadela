# Rediseño visual de /admin/configuracion — pestañas y consola del sistema

**Fecha**: 28/08/2026 · **Branch**: `configuracion-visual` · **Estado**: spec aprobada por el operador

## 1. Objetivo y alcance

Rediseño **puramente presentacional** de `/admin/configuracion`: la pantalla pasa de
tres bloques apilados a una consola en **5 pestañas client-side** con una tira de
estado del sistema arriba. Cambia solo la capa de presentación (`page.tsx` y los
componentes cliente de la carpeta); **ninguna server action, módulo de dominio ni
test existente se modifica**.

Fundamento de viabilidad (análisis del 28/08 con tres agentes): ningún test
renderiza la página (la cobertura es de actions y nav), no hay snapshots de markup,
y nada externo apunta a secciones internas — no hay anclas `#` ni query params
entrantes; los únicos (`?guardado/cuota/feriado`) los generan los redirects de las
propias actions.

## 2. Restricciones duras (verificables con `git diff`)

Estos archivos NO se tocan:

- `src/app/admin/configuracion/actions.ts` — completo: schemas, nombres de campo,
  orden transacción → `updateTag` → `audit`, y los strings de redirect
  (`?guardado=1`, `?cuota=1`, `?feriado=1`, `?feriado=2`), que 3 tests asertan
  textualmente.
- `src/lib/config.ts`, `src/lib/config-keys.ts`, `src/lib/forms.ts`,
  `src/lib/auth/require-admin.ts`.
- `src/lib/treasury/*` y `src/lib/mp/*` (misma garantía estructural que la exención:
  el módulo de plata no se pisa).
- `tests/*` — la suite pasa sin tocar una aserción.

Contratos que la presentación nueva preserva byte a byte:

| Action | Campos (`name=`) | Redirect |
|---|---|---|
| `updateConfigAction` | `asociateActivo` (checkbox `value="on"`), `contactPhone`, `contactEmail`, `termsText`, `privacyConsentText`, `mpPlanActiveId`, `mpPlanSharedId`, `digestRecipients` | `?guardado=1` |
| `createFeeValueAction` | `activeAmount`, `sharedAmount`, `validFrom`, `minuteId` | `?cuota=1` |
| `createHolidayAction` | `date`, `label` | `?feriado=1` |
| `deleteHolidayAction` | `id` (hidden) | `?feriado=2` |

Además: `requireSuperadmin()` sigue cortando en la página (pantalla de bloqueo, no
redirect) y en cada action; los cuatro asientos de auditoría no cambian; el select
de acta del valor de cuota sigue siendo un select simple (`minuteId`, `""` = sin
acta) — **no** se migra a `MinutePicker`; el cálculo de `divergentCount` sigue
disparándose solo bajo `?cuota=1`.

## 3. Decisiones tomadas (3 rondas con el operador, 28/08)

1. **Pestañas client-side en una sola URL** (`?tab=`), estilo `MemberTabs`. Se
   descartaron subrutas tipo `TreasuryTabs`: obligaban a cambiar los 4 redirects de
   las actions (camino de plata + 3 tests) y a replicar la guarda por subruta.
2. **5 pestañas temáticas**: Sitio público · ASOCIATE · Avisos · Tesorería ·
   Feriados.
3. **Restyling completo pagando deuda**: `holidays-form` migra a `synced-fields`;
   checkbox de ASOCIATE estilizado como switch conservando contrato; `window.confirm`
   reemplazado; historial de valores nombra actas por tipo y número.
4. **La pestaña de cuota se llama "Tesorería"**: el mensaje de dominio
   `NO_FEE_VALUE_MESSAGE` ("registralo en Configuración → Tesorería", vive en
   `src/lib/treasury/fee-values.ts`) y los runbooks `docs/10`/`docs/11` siguen
   siendo verdad sin tocar una letra.
5. **Tira de estado** arriba de las pestañas (el gesto distintivo).
6. **Pestañas subrayadas con íconos Lucide** (canon del panel, como Socios).
7. **Barra sticky de cambios sin guardar** para el form de 8 claves.
8. **Audacia "refinado + un gesto"**: canon M4/M5 + la tira de estado; sin
   transiciones nuevas de panel.
9. **Se corrige "acta #id"** en el historial de valores → `minuteName` con enlace.
10. **Branch nueva** `configuracion-visual`; merge tras verificación visual.

## 4. Estructura de la pantalla

De arriba hacia abajo dentro del `space-y-*` de la página:

1. **`PageHeader title="Configuración"`** — sin cambios.
2. **Mensajes de éxito globales** — los tres avisos post-redirect se renderizan acá
   (bajo el header, arriba de la tira y las pestañas), para que se vean aterrice
   donde aterrice el redirect. Mismos textos y `FormMessage kind="success" box` de
   hoy, incluido el mensaje condicional de `?cuota=1` con `divergentCount` y su
   link a `/admin/tesoreria/valores`.
3. **Tira de estado** — 4 mini-cards con datos que la página ya consulta hoy
   (cero consultas nuevas, salvo el join del historial del punto 6.4):
   - **Valor de cuota**: montos vigentes en `font-mono tabular-nums` + "desde
     {fecha}"; sin valor vigente → "Sin valor vigente" en `text-warning`.
   - **ASOCIATE**: "Activado" / "Desactivado" (este último en `text-warning`).
   - **Feriados**: "2026 (12) · 2027 (9)" o "Ninguno cargado" en `text-warning`.
   - **Resumen diario**: "N destinatarios" o "Sin destinatarios" en `text-warning`.
   Cada card usa el patrón de las tarjetas del tablero (`Card size="sm"`, chip de
   ícono `size-9 rounded-lg bg-primary/10 text-primary`, link estirado con
   pseudo-elemento y foco inset, `hover:shadow-md`) y navega a su pestaña con
   `href="?tab=…"`. Grid `grid gap-3 sm:grid-cols-2 lg:grid-cols-4`.
4. **Pestañas** — Radix Tabs controladas por URL:
   - Config pura en `src/lib/admin/config-tabs.ts` (ids, labels, nombre de ícono
     serializable — el mapa ícono→componente va en el componente cliente, patrón
     `socios-tabs`). Ids: `sitio`, `asociate`, `avisos`, `tesoreria`, `feriados`.
   - Visual: subrayado canónico (lista con `border-b`, trigger `min-h-11 px-3`,
     activa `border-primary font-semibold`, inactiva `text-muted-foreground`),
     ícono `size-4 shrink-0 aria-hidden`, scroll horizontal en móvil con el truco
     `-mx-4 px-4 / -my-1 py-1` para no recortar el anillo de foco.
   - Comportamiento `MemberTabs`: valor controlado por `useSearchParams`
     (`?tab=`), `router.replace` al cambiar (sin ensuciar historial), envuelto en
     `Suspense`. Un valor inventado cae en la inicial.
   - **Pestaña inicial derivada en el server**: `?cuota=1` → `tesoreria`;
     `?feriado=1|2` → `feriados`; `?tab=` explícito manda; si no, `sitio`.
     (`?guardado=1` aterriza en `sitio`; el éxito se ve igual porque es global.)

## 5. El form de 8 claves a través de tres pestañas (riesgo N° 1, resuelto)

`updateConfigAction` escribe las 8 claves SIEMPRE y trata campo ausente como
`""`/`false`: si un campo no viaja en el FormData, se borra en silencio (y con eso
se apaga el resumen diario y el aviso de divergencia de la conciliación). Por eso:

- El form principal sigue siendo **UN solo `<form>`** (client component), que
  envuelve los tres paneles como `TabsContent` con **`forceMount`** y ocultamiento
  por CSS (`data-[state=inactive]:hidden`). Los 8 campos están montados en el DOM
  en todo momento; el POST siempre viaja completo.
- Radix exige que los `TabsContent` desciendan del root de Tabs: el root envuelve
  al form, y los paneles de Tesorería y Feriados quedan como `TabsContent` hermanos
  (contenido server-rendered pasado por props a través de la frontera cliente),
  cada uno con su form propio — sin forms anidados.
- El **checkbox de ASOCIATE** conserva `name="asociateActivo"`, `value="on"`,
  semántica de checkbox nativo y su sincronización vía `useSyncedForm` (el hazard
  documentado del reset de forms de React 19, `config-form.tsx:4-11`, queda
  intacto). Solo cambia la piel: input nativo estilizado como switch (track +
  thumb), foco visible, sin dependencias nuevas.

**Barra sticky de cambios**: fija al pie del área de contenido, visible solo cuando
algún valor de `useSyncedForm` difiere del inicial (snapshot pasado por props).
Texto: "Tenés cambios sin guardar en {grupos}" — donde {grupos} nombra las pestañas
con diferencias (Sitio público / ASOCIATE / Avisos) — más el botón "Guardar"
("Guardando…" en pending). El `state.error` de la action se muestra en la barra
(`FormMessage kind="error"`). Tras el redirect exitoso la página re-renderiza con
valores frescos y la barra desaparece sola. La barra respeta el canon de foco y no
tapa contenido (padding-bottom compensatorio cuando está visible).

## 6. Los cinco paneles

Cada panel abre con un encabezado de sección: chip de ícono tintado
(`bg-primary/10 text-primary`) + título + descripción de una línea. Esto reemplaza
los `h2` uppercase duplicados a mano (hoy en `page.tsx:148`, `page.tsx:196` y el
`Section` local de `config-form.tsx`). Los formularios van en cards del canon
(`Card` con `rounded-xl ring-1 ring-foreground/10`).

1. **Sitio público** (Globe): switch de ASOCIATE + teléfono y email de contacto
   (`TextField` de synced-fields, como hoy).
2. **ASOCIATE** (UserPlus): los dos textareas legales (términos y consentimiento
   Ley 25.326) + los dos ids de planes de MP. El título pierde el "— Módulo 3"
   (jerga de desarrollo fuera de la UI); los labels de los campos no cambian.
3. **Avisos** (Mail): destinatarios del resumen diario, con su hint.
4. **Tesorería** (Wallet, el mismo ícono que la sección Tesorería de la nav):
   valor vigente como par de mini-KPI (`font-mono tabular-nums`, eco de
   `tesoreria/valores`), leyenda "única fuente de montos", `FeeValueForm` en card
   (campos idénticos), e **historial** que ahora nombra el acta por tipo y número
   ("Comisión Directiva N° 124") con enlace `INLINE_LINK` a `/admin/actas/[id]`.
   Para eso la consulta del historial en `page.tsx` suma los campos del acta
   (join/`include` de lectura; tercera aparición del error "acta por id"
   documentado en CLAUDE.md, corregida). Historial vacío → `EmptyState
   size="card"` (hoy no se renderiza nada).
5. **Feriados** (CalendarOff): explicación del Art. 5° ter y advertencia de
   puentes como hoy; línea "Años cargados"; `HolidayForm` **migrado a
   synced-fields** (`TextField` fecha + `TextField` etiqueta — paga la deuda de
   inputs crudos anotada en CLAUDE.md, mismos `name`); lista de futuros con
   borrado por **confirmación accesible**: si el repo ya tiene un diálogo del
   design system se usa ese; si no, confirmación inline de dos pasos en la fila
   ("Borrar" → "¿Confirmás? [Sí, borrar] [Cancelar]") sin dependencias nuevas.
   El mini-form de borrado conserva el hidden `name="id"` y su action.

## 7. Accesibilidad (canon del shell, no romper)

- Foco: SIEMPRE `outline-hidden` + `focus-visible:ring-2 focus-visible:ring-ring`
  (nunca `outline-none`). Targets ≥44px (`min-h-11`) en pestañas, cards de la
  tira, filas y botones de fila.
- `aria-current` no aplica a Radix Tabs (usa `aria-selected` solo); la lista de
  pestañas lleva `aria-label`. Íconos `aria-hidden` siempre acompañados de texto.
- La barra sticky no interrumpe: es contenido estático visible, no un live region
  agresivo; el error dentro de ella usa el `role` que `FormMessage` deriva.
- `EmptyState` para vacíos; nunca un `thead` sin filas (no hay tablas nuevas).
- Modo oscuro: solo tokens (`--primary`, `--success`, `--warning`, `bg-card`,
  `border-input`, `dark:bg-input/30` en campos); ningún color crudo de Tailwind.

## 8. Archivos

**Se modifican** (solo presentación): `src/app/admin/configuracion/page.tsx`,
`config-form.tsx`, `fee-value-form.tsx`, `holidays-form.tsx`.

**Nuevos**: `src/lib/admin/config-tabs.ts` (config pura de pestañas, testeable),
`src/app/admin/configuracion/config-tabs.tsx` (Radix + URL, íconos, forceMount),
y los componentes de presentación que hagan falta en la carpeta del route
(tira de estado, encabezado de panel, barra sticky).

**Prohibidos**: los listados en §2.

## 9. Criterios de aceptación

1. `npx tsc --noEmit` y la suite entera de tests pasan **sin modificar ningún
   test**.
2. `git diff --stat main` no muestra cambios en `actions.ts`, `src/lib/config*`,
   `src/lib/treasury/*`, `src/lib/mp/*` ni `tests/*` (se admite el archivo nuevo
   `src/lib/admin/config-tabs.ts` y un test nuevo si se agrega).
3. Verificación en navegador (dev server, superadmin):
   - Guardar el form de 8 claves **desde la pestaña Avisos** con cambios hechos
     en Sitio público: las 8 claves llegan (ninguna se borra) y aterriza con
     "Configuración guardada." visible.
   - Registrar un valor de cuota aterriza en la pestaña Tesorería con su mensaje
     (con y sin suscripciones divergentes); cargar y borrar un feriado aterriza
     en Feriados con el suyo.
   - La barra sticky aparece al editar, nombra las pestañas con cambios y
     desaparece tras guardar.
   - La tira de estado refleja los cuatro estados y navega a las pestañas.
   - Historial de valores nombra actas por tipo y número con enlace vivo.
   - Responsive 375px (pestañas con scroll horizontal, tira en 1 columna,
     barra sticky usable) y teclado (foco visible en todo el recorrido).
4. El admin común sigue viendo la pantalla de bloqueo (no redirect).

## 10. Fuera de alcance

Migrar el select de acta a `MinutePicker`; tocar textos de dominio
(`NO_FEE_VALUE_MESSAGE`); editar `elecciones_en_curso` o
`reregistrationProcessId` desde esta pantalla; montar un `ThemeProvider` (la app
sigue light-only; el modo oscuro se sirve por tokens, como el resto del panel);
toasts o guardado por AJAX (los éxitos siguen siendo redirect + `FormMessage`).
