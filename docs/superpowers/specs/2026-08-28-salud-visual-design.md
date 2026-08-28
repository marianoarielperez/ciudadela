# Rediseño visual de /admin/salud — veredicto protagonista y 4 pestañas

**Fecha**: 28/08/2026 · **Branch**: `salud-visual` · **Estado**: spec aprobada por el operador

## 1. Objetivo y alcance

Rediseño **puramente presentacional** de `/admin/salud` (la pantalla de salud de la
fase 4C): el veredicto pasa a ser un banner protagonista siempre visible y los seis
paneles se reorganizan en **4 pestañas client-side**. No cambia ninguna consulta,
ningún umbral, ningún texto de estado ni la única escritura de la pantalla (el
reenvío de recibos).

Fundamento (análisis del 28/08 con tres agentes): el render es 100% de solo
lectura — ~20 consultas locales con índice y **cero llamadas a la API de Mercado
Pago** —; los seis paneles son componentes puros alimentados por props; y la única
escritura (reenviar recibo) vive en server actions con `requireSuperadmin` propio.
El riesgo no está en el dinero: está en (a) la **semántica del veredicto** — 16
condiciones act/review que encarnan tres correcciones históricas de alarmas mal
calibradas — y (b) un **test de presentación real** (`admin-health-screen.test.ts`,
638 líneas) que fija textos, anclas y estructura.

## 2. Contratos

### 2a. Congelado (ni un byte)

- `src/lib/admin/health.ts`, `health-alerts.ts`, `health-backup.ts` — datos,
  veredicto y backup: umbrales (stale > 2× período, 26 h del backup, gracia de
  2 h del hung, ventanas 72/24 h), la partición act/review completa, el
  enmascarado Ley 25.326.
- `src/app/admin/salud/actions.ts` y `resend-form.tsx` — el reenvío (efectos,
  auditoría, `revalidatePath("/admin/salud")` ×2, textos de
  `receipt-resend.ts`).
- `src/lib/treasury/*`, `src/lib/mp/*`, `src/lib/admin/status-badges.ts` (los
  variants por estado tienen test propio).
- Tests congelados: `tests/admin-health.test.ts`, `tests/health-actions-auth.test.ts`,
  `tests/status-badges.test.ts`.

### 2b. Textos y semántica intocables (aunque el markup cambie)

Todos los rótulos y frases que fijan `admin-health-screen.test.ts` y/o cita
`docs/10` §salud: los titulares del veredicto ("Todo en orden", "No hay nada
roto", "Hay N cosa(s) para atender", "Para revisar"), los estados de cron ("Al
día", "Terminó con errores", "Hace mucho que no corre", "Quedó colgada", "Nunca
corrió") y sus frecuencias ("una vez por día/mes", "cuando hay novedades"), los
estados de backup ("Al día", "Atrasado", "Sin rastro", "No se puede leer", "Sin
configurar"), el texto especial del digest ("sin novedades que contar…", nunca
"atrasado"), la redacción de historia de los tres acumulados ("desde que
existe", "N registrados", "N intentos fallidos registrados"), las dos
aclaraciones de `EMAIL_ALLOWLIST`, "Rehacer desde su pantalla", "duplicaría el
PDF", la etiqueta prohibida ("suscripciones no activas" no puede reaparecer), la
regla "en cero se apaga" de las líneas de dinero, la política de Reenviar
(`canResend`: solo `failed` y `not_attempted`), `role="none"` en el veredicto, y
"nunca un `<thead>` sin filas".

### 2c. Se adapta (con el mismo rigor, no se borra)

`tests/admin-health-screen.test.ts` — SOLO sus aserciones estructurales:

- El test de anclas (hoy: cada `#ancla` emitida por `healthAlerts` existe como
  `id` en el HTML concatenado) pasa a verificar DOS cosas: (1) cada href de
  alerta mapea a una pestaña válida vía la función pura nueva (§4), y (2) cada
  `id` de panel sigue existiendo en el render de su panel.
- El conteo "exactamente 6 `<h2>`" se conserva (PanelHeader emite `<h2>`).
- Toda aserción de TEXTO queda como está y debe seguir verde.

## 3. Decisiones (2 rondas con el operador, 28/08)

1. **Contrato de tests**: adaptar el de pantalla (§2c); datos, actions y textos
   congelados.
2. **Pestañas client-side** (`?tab=`, calco del mecanismo de Configuración):
   una URL, una guarda, `revalidatePath` intactos.
3. **4 pestañas temáticas**: Tareas · Infraestructura (Backup + Mercado Pago) ·
   Dinero · Correo (avisos fallidos + recibos sin enviar).
4. **Badges de solapa: punto/contador SOLO con condiciones `act`** — jamás
   review ni historia (la lección de las 51 firmas).
5. **El veredicto como banner protagonista**, semántica byte-idéntica.
6. **`PanelHeader` compartido**: se muda a `src/components/admin/` y titula los
   seis paneles.
7. **Audacia "refinado + un gesto"**: canon M4/M5; el gesto es el banner.

## 4. Estructura de la pantalla

1. **`PageHeader` "Salud"** con el subtítulo actual — sin cambios.
2. **Banner del veredicto** (restyle de `HealthVerdict` en
   `health-panels.tsx`; MISMO componente, misma firma, mismos datos):
   - Contenedor con borde izquierdo de 4px en el token del estado
     (`--destructive` / borde neutro / `--success`) y fondo tenue del mismo
     token; ícono de estado `size-6`+ (`TriangleAlert` / `Info` /
     `CircleCheck`, `aria-hidden`); titular en `text-base font-medium` o mayor.
   - Las listas act ("Para atender") y review ("Para revisar") conservan sus
     encabezados y textos; cada ítem es la fila-link actual con `INLINE_LINK`.
   - Los `href` de ancla cambian de `#panel` a **`?tab={pestaña}#panel`** — ESTE
     es el único cambio de datos del banner, y vive en la capa de presentación
     (el mapeo se aplica al renderizar, `health-alerts.ts` NO se toca: sigue
     emitiendo `#ancla` y la presentación lo traduce).
   - "Estado al DD/MM/AAAA HH:mm" queda.
   - `role="none"`, sin `role="alert"`, como hoy.
3. **Pestañas** — config pura `src/lib/admin/salud-tabs.ts`:
   - `SALUD_TABS`: `tareas` ("Tareas", icon `clock`) · `infraestructura`
     ("Infraestructura", icon `server`) · `dinero` ("Dinero", icon `banknote`) ·
     `correo` ("Correo", icon `mail`).
   - `tabForAlertHref(href): SaludTabId | null` — la función pura del mapeo:
     `#tareas → tareas`; `#backup`, `#mercado-pago` → `infraestructura`;
     `#avisos`, `#recibos` → `correo`; `href.startsWith("/admin/tesoreria")` →
     `dinero`; cualquier otra ruta → `null` (link externo directo, sin
     traducción). Testeada contra TODOS los href que `health-alerts.ts` puede
     emitir.
   - `actCountByTab(alerts)` — cuenta de condiciones act por pestaña usando el
     mismo mapeo (los href a tesorería cuentan para Dinero). Es la ÚNICA fuente
     del badge de solapa.
   - Componente cliente `src/app/admin/salud/salud-tabs.tsx`: calco del
     mecanismo de ConfigTabs (Radix, `?tab=` con `useSearchParams`, valor
     inválido → `tareas`, `router.replace` `{scroll:false}` al clickear
     solapas), SIN `forceMount` (acá no hay un form multi-panel: los ResendForm
     viven por fila dentro de su panel). Subrayado canónico con ícono `size-4`
     y, si `actCount > 0`, el contador en `text-destructive font-mono
     tabular-nums` con `aria-label` textual ("2 para atender").
   - Navegación por link de alerta: `<Link href="?tab=correo#avisos">` cambia
     el search param → la pestaña activa cambia → el fragmento scrollea al
     panel. Verificación EN NAVEGADOR con datos rotos sembrados (el test no ve
     esta interacción).
4. **Los cuatro paneles de pestaña** (server-rendered, pasados por props como
   en Configuración). Regla de conteo: hoy los 6 `<h2>` son 4 `Section`
   (tareas, dinero, avisos, recibos) + 2 `CardTitle as="h2"` (backup, MP).
   Migran a `PanelHeader` SOLO los 4 `Section`; Backup/MP conservan sus cards
   tal cual; NINGUNA pestaña lleva encabezado propio. Total: 6 `<h2>`, igual
   que hoy.
   - **Tareas**: `CronsPanel` con `PanelHeader` (icon `Clock`).
   - **Infraestructura**: el grid `md:grid-cols-2` actual con `BackupPanel` +
     `MpPanel`, sin cambios internos; los `id="backup"` y `id="mercado-pago"`
     se conservan.
   - **Dinero**: `MoneyPanel` con `PanelHeader` (icon `Banknote`).
   - **Correo**: `FailedNoticesPanel` + `PendingReceiptsPanel` apilados, con
     `PanelHeader` (icons `Mail` / `Receipt`) y el patrón `renderResend`
     intacto.
   - Los seis `id` de ancla se conservan.
5. **`PanelHeader`** se muda de `src/app/admin/configuracion/panel-header.tsx`
   a `src/components/admin/panel-header.tsx` (`git mv` + actualizar los 3
   imports de Configuración). Sin cambios de firma.

## 5. Autorización y efectos

Sin cambios: `requireSuperadmin()` en la page con pantalla de bloqueo (no
redirect), y dentro de cada action. Una sola URL ⇒ los `revalidatePath` de las
actions siguen válidos. El render sigue sin efectos.

## 6. Archivos

**Nuevos**: `src/lib/admin/salud-tabs.ts` (+ `tests/salud-tabs.test.ts`),
`src/app/admin/salud/salud-tabs.tsx`, `src/components/admin/panel-header.tsx`
(movido).

**Modificados** (presentación): `src/app/admin/salud/page.tsx`,
`src/components/admin/health-panels.tsx` (banner + PanelHeader + wrappers),
`tests/admin-health-screen.test.ts` (solo §2c), los 3 imports de Configuración
que apuntan a `panel-header`.

**Prohibidos**: los de §2a.

## 7. Criterios de aceptación

1. `npx tsc --noEmit` y `npx vitest run` verdes; `admin-health.test.ts`,
   `health-actions-auth.test.ts` y `status-badges.test.ts` **sin tocar**;
   `admin-health-screen.test.ts` adaptado solo en §2c y con TODAS sus
   aserciones de texto intactas y verdes.
2. `git diff --stat main` vacío sobre `src/lib/admin/health*.ts`,
   `src/app/admin/salud/actions.ts`, `resend-form.tsx`, `src/lib/treasury`,
   `src/lib/mp`.
3. La aserción "exactamente 6 `<h2>`" sigue verde sobre el render de los seis
   paneles, con la composición de §4.4 (4 `PanelHeader` + 2 `CardTitle
   as="h2"`; sin encabezados de pestaña).
4. Navegador (con el operador; con datos rotos sembrados temporalmente en la
   base local — una `CronRun` con `ok:false`, una `Notification` failed de tipo
   receipt — y limpiados al final):
   - Estado sano: banner verde "Todo en orden" de una línea; cuatro solapas sin
     punto; el operador no necesita entrar a ninguna pestaña.
   - Estado roto: banner rojo "Hay N cosas para atender"; punto rojo SOLO en
     las solapas con act; cada link del veredicto activa su pestaña y scrollea
     a su panel; los links a Tesorería navegan como siempre.
   - Reenviar un recibo desde Correo funciona y la fila se limpia
     (`revalidatePath`).
   - Responsive 375px (solapas con scroll, banner legible, tablas con scroll
     propio) y teclado (flechas entre solapas, foco visible, orden lógico).
5. El admin común sigue viendo la pantalla de bloqueo.

## 8. Fuera de alcance

Tocar umbrales, textos o la partición act/review; botones de re-correr crons
(las escotillas siguen siendo `curl` de docs/11); auto-refresh; subrutas;
cambiar rótulos citados por docs/10; toasts.
