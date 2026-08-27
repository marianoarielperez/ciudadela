# Exención de cuota (Art. 7 inc. a.4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La Comisión exime a un socio ACTIVO de la cuota mensual por hasta 24 meses, con acta obligatoria: el sistema materializa las cuotas exentas, bloquea todos los caminos de pago del eximido mientras dure, y lo muestra en Tesorería, en la ficha y en el panel del socio — sin registrar un peso y sin modificar un solo archivo existente del núcleo de pagos.

**Architecture:** Una tabla-registro (`fee_exemptions`, con acta `Restrict` en las dos puntas) + filas de `Fee` en estado `exempt` con origen nuevo `exemption`, creadas en la transacción del asiento — el devengo, la deuda, el recordatorio y las pantallas existentes ya las tratan bien por construcción (verificado camino por camino, spec §9). El dominio es un **archivo nuevo** en `src/lib/treasury/` con Prisma inyectado; `activeExemption` es LA función compartida que consultan las cinco guardas de bloqueo (la lección de `coverageFloor`: una definición, no cinco copias). Los bloqueos viven en la capa de pantallas/actions; la única modificación fuera de tesorería es un input **aditivo** al veredicto puro de adhesión al débito.

**Tech Stack:** Next.js 16 App Router, React 19 (`useActionState`), Prisma 7 + MariaDB, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-exencion-cuota-design.md` (aprobada 27/08/2026, 12 decisiones del operador en §2). Ledger: `.superpowers/sdd/progress.md`.

## Global Constraints

- UI en **es-AR con "vos"**; código, variables y commits en **inglés** (cuerpo del mensaje incluido). Commits terminan con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` (línea en blanco antes).
- **Núcleo de dinero: ningún archivo EXISTENTE de `src/lib/treasury/*` ni `src/lib/mp/*` se modifica**; tampoco `src/components/admin/account-section.tsx`, `src/lib/admin/digest.ts` ni `tests/integration/*`. Se permiten: **crear** `src/lib/treasury/exemptions.ts` (archivo nuevo), e **importar** `member-search`, `subscription-status` (`canStillCharge`), `periods`, `labels`, `rules` (`categoryPaysFee`). Única excepción aditiva fuera: `src/lib/members/debit-adhesion.ts` gana un input opcional (Task 4). La Task 5 verifica esto **mecánicamente por diff**.
- **El cliente de Prisma se INYECTA** en el dominio (`makeExemptions(deps)` + singleton); los módulos puros no importan `@/lib/prisma`.
- **Los dobles de base honran el `where` literal** (nunca reimplementan la condición — el vicio que el M6 cazó tres veces), y toda guarda nueva se verifica **por mutación**: borrarla → test en rojo → restaurar.
- Migraciones con `npx prisma migrate dev`, jamás `db push`. Trampa conocida: `migrate dev` NO regenera el cliente (correr `npx prisma generate` aparte), y el dev server cachea el cliente en `globalThis` — tras migrar, `touch next.config.ts` lo recarga sin matarlo.
- **Autorización**: las páginas nuevas llaman `requireAdmin()` por su cuenta; **asentar y anular exenciones revalida `requireSuperadmin()` en la action** (doble nivel de Valores: `valores/page.tsx:33`). Auditoría con ids, períodos y conteos — nunca datos personales.
- **Lenguaje visual del panel**: componentes compartidos antes que reinventar (`PageHeader`, `FormMessage`, `EmptyState`, `Card`/`CardTitle as="h2"`, `Badge`, `MinutePicker`, `synced-fields`, `SELECT_CLASS`, `INLINE_LINK`, `PaginationNav`); targets ≥44px (`min-h-11`); foco `outline-hidden` + `focus-visible:ring-2 focus-visible:ring-ring` (nunca `outline-none`); colores solo por tokens; `font-mono tabular-nums` en números y períodos; responsivo sin desborde a 375px; mapa ícono→Lucide siempre en el client component, nunca en `lib/`.
- Comentarios en castellano que explican **por qué** y que sean **verdaderos** (toda afirmación medible se verifica antes de escribirse).
- Tests: `npx vitest run`, `npm run lint`, `npm run build` — los tres en verde antes de cada commit de tarea.
- Rama de trabajo: `fee-exemption` (ya existe, con la spec en `9fb298a`).
- **Protocolo de verificación en localhost**: el dev server corre en `:3000` con la base real local (MariaDB Docker `sigev-db`) — no matarlo ni levantar otro. Los pasos marcados **🖥️ SESIÓN DEL OPERADOR** necesitan la sesión de superadmin abierta en el navegador: **PAUSAR y pedírsela al operador** en ese momento (él la abre a demanda); nunca tipear una contraseña. Sembrar datos de prueba por script y **revertirlos documentando cómo**. Este módulo no manda ningún correo.

---

### Task 1: Migración — el registro, los enums y las dos guardas que crecen

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/members/labels.ts` (labels de movimiento), `src/lib/members/minute-form.ts` (sexto referente), `src/lib/padron/prune.ts` (+`feeExemptions` a la enumeración)
- Create: `prisma/migrations/*` (la genera `migrate dev`)
- Test: `tests/minute-form.test.ts` (+1 caso), `tests/padron-prune.test.ts` (+1 caso), `tests/reregistration-labels.test.ts` o el archivo de labels que corresponda (+2 movimientos)

**Interfaces:**
- Produces (schema — nombres EXACTOS que consumen las tasks 2-5): el modelo `FeeExemption` **verbatim de la spec §3.1** (tabla `fee_exemptions`; FKs a `Minute` con `onDelete: Restrict` en `minuteId` Y en `revokeMinuteId`; `member` con `Restrict`; `fromPeriod`/`toPeriod` `Char(7)`; `months Int`; `note VarChar(300)?`; `revokedAt DateTime?`; `@@index([memberId])`). `FeeOrigin` gana `exemption`; `MovementType` gana `fee_exemption` y `fee_exemption_revoked`. Relaciones inversas que Prisma exija en `Member`, `Minute`, `User`.

- [ ] **Step 1: Schema + migración.** Escribir el modelo y los tres valores de enum; `npx prisma migrate dev --name fee-exemptions` + `npx prisma generate`. Revisar el SQL: los `ON DELETE RESTRICT` de las tres FKs tienen que estar (un acta que respalda una exención no se puede borrar; una ficha con exención tampoco). Verificar que la migración es SOLO esto.
- [ ] **Step 2: Labels.** `MOVEMENT_LABELS` (en `src/lib/members/labels.ts`, que es `Record<MovementType, string>` — exhaustivo por tipo, así que **no compila** hasta agregar): `fee_exemption: "Exención de cuota"`, `fee_exemption_revoked: "Exención anulada"`. El test de labels existente (grep cuál cubre `MOVEMENT_LABELS`) gana los dos casos.
- [ ] **Step 3: El sexto referente.** `discardUnusedMinute` (`src/lib/members/minute-form.ts:126-148`) suma `db.feeExemption.count({ where: { OR: [{ minuteId }, { revokeMinuteId }] } })` a su lista, y su tipo `Pick<...>` gana `"feeExemption"`. El comentario normativo de `:100-101` lo exige ("la lista tiene que crecer con el schema"). TDD: el caso nuevo en `tests/minute-form.test.ts` ("keeps a minute that backs a fee exemption", calcando el de fee value de `:245`) primero en rojo. Los dobles de `prisma` en los tests que ya delegan (`application-decision-actions`, `application-record-action`, `arrears-actions-auth` — el precedente del M6, el fix `7e91d6d`) ganan la delegación nueva si el type-check lo pide.
- [ ] **Step 4: La guarda de poda.** `pruneBlockReasons` (`src/lib/padron/prune.ts`) suma `feeExemptions` al `_count` de `PrunableMember` y al armado de motivos ("tiene una exención de cuota asentada con acta"): con la FK `Restrict`, sin esto la poda revienta con un error crudo en vez del mensaje diseñado — exactamente lo que el M6 arregló para las presentaciones. Caso nuevo en `tests/padron-prune.test.ts`, primero en rojo. Ojo: el `include` del script (`scripts/import-padron.ts:553-570`) tiene que traer el conteo nuevo — verificar y ajustar.
- [ ] **Step 5: Suite + lint + build; `touch next.config.ts`** (el dev server sigue con el cliente viejo si no). **Commit** `feat(exemption): fee exemption registry, enums and the two guards that grow`

---

### Task 2: Dominio — `src/lib/treasury/exemptions.ts` (archivo NUEVO)

**Files:**
- Create: `src/lib/treasury/exemptions.ts`
- Test: `tests/treasury-exemptions.test.ts`

**Interfaces:**
- Consumes: `currentPeriod`, `addMonths`, `comparePeriods`, `periodLabel` de `@/lib/treasury/periods` (verificar nombres reales antes de importar); `canStillCharge` de `@/lib/mp/subscription-status`; tipos de Prisma como `import type`.
- Produces (contrato de las tasks 3-5):

```ts
// Reglas puras
export const MAX_EXEMPTION_MONTHS = 24;   // Art. 7 inc. a.4: "hasta veinticuatro (24) meses"
export function exemptionPeriods(fromPeriod: Period, months: number): Period[];   // [from .. from+months-1]
export function exemptionToPeriod(fromPeriod: Period, months: number): Period;    // último mes, inclusive
export function monthsLeft(toPeriod: Period, at?: Date): number;                  // 0 si venció
/** Vigente = no anulada y toPeriod >= período corriente (en curso O POR COMENZAR:
 *  el bloqueo de pagos rige desde el asiento — spec §3.1). */
export function isInForce(e: { revokedAt: Date | null; toPeriod: string }, at?: Date): boolean;

// LA función compartida por las cinco guardas de bloqueo y las tres pantallas.
export type ActiveExemption = { id: number; fromPeriod: string; toPeriod: string; months: number; minuteId: number; note: string | null };
export async function activeExemption(db: ExemptionDb, memberId: number, at?: Date): Promise<ActiveExemption | null>;

// Servicio con Prisma inyectado
export function makeExemptions(deps: { db: ExemptionDb; now?: () => Date }): {
  grant(input: { memberId: number; fromPeriod: string; months: number; minuteId: number;
                 note: string | null; actorId: number }): Promise<
    | { ok: true; exemptionId: number; periods: string[]; skippedPaid: string[] }
    | { ok: false; error: string }>;
  revoke(input: { exemptionId: number; revokeMinuteId: number; actorId: number }): Promise<
    | { ok: true; removedFuture: number }
    | { ok: false; error: string }>;
  listInForce(): Promise<Array<ActiveExemption & { memberId: number; member: { fullName: string; memberNumber: number | null } }>>;
  history(): Promise<Array<...>>;   // vencidas y anuladas, con sus dos actas
};
export const exemptions: ReturnType<typeof makeExemptions>;   // singleton al final, patrón de la casa
```

Semántica de `grant`, TODA dentro de una `$transaction` sin una sola llamada de red (spec §5, las seis guardas revalidadas acá — la pantalla pre-valida para el mensaje, nunca como única defensa):
1. Ficha viva: `category === "active"` y `status === "active"` (un suspendido no se exime).
2. Al día: `fee.count({ memberId, status: "pending" }) === 0`.
3. Sin débito cobrable: `mpSubscription.findMany({ where: { memberId }, select: { status } })` y ninguna con `canStillCharge` (importado — el mismo predicado de siempre; `findMany`, nunca `findFirst`: `memberId` no es unique).
4. Sin otra vigente: `feeExemption.findFirst({ where: { memberId, revokedAt: null, toPeriod: { gte: currentPeriod(now) } } })`.
5. Rango: `months` entero 1..24; `fromPeriod >= currentPeriod(now)` (hacia adelante; el corriente se permite — el devengo crea hasta el mes VENCIDO, así que el corriente no tiene fila salvo pago adelantado).
6. Escrituras: leer las filas existentes del rango (`fee.findMany({ where: { memberId, period: { in: periods } } })`) — las `paid` van a `skippedPaid` (quedan pagas, decisión 11; `pending` no puede haber por la guarda 2, si aparece una → error: carrera con el devengo, reintentar); `fee.createMany` de las restantes `{ status: "exempt", origin: "exemption" }` **sin** `skipDuplicates` (la lectura previa es la decisión, no el silencio — el criterio documentado del devengo en `accrual.ts:113-118`); `feeExemption.create`; `movement.create({ type: "fee_exemption", date: minute.date, minuteId, detail: "Exención de cuota: {from} a {to} ({n} meses)" — sin datos personales })`.

Semántica de `revoke`: cerrojo `feeExemption.updateMany({ where: { id, revokedAt: null }, data: { revokedAt, revokeMinuteId } })` — `count 0` → "otro administrador ya la anuló"; `fee.deleteMany({ where: { memberId, origin: "exemption", status: "exempt", period: { gt: currentPeriod(now), lte: toPeriod, gte: fromPeriod } } })` (el corriente y los pasados quedan exentos — decisión 9); `movement.create({ type: "fee_exemption_revoked", ... })`.

- [ ] **Step 1: Tests de las reglas puras** (tabla): `exemptionPeriods("2026-09", 24)` → 24 períodos hasta `"2028-08"` con cruce de año; `isInForce` con vencida/anulada/por-comenzar/en-curso; `monthsLeft` en el último mes = 1. → FAIL → implementar → PASS.
- [ ] **Step 2: Tests del servicio con doble que honra el `where` literal** (calcar `matchesWhere` de `tests/board-notice.test.ts` — el patrón ya probado): cada guarda de `grant` tiene su caso (adherente → error; suspendido → error; con 2 pendientes → error nombrando el conteo; con sub `authorized` → error; con sub `cancelled` → PASA; con vigente → error; con una POR COMENZAR → error también, es vigente; `months: 25` → error; `fromPeriod` pasado → error); el happy path crea registro + N filas exentas + movimiento y devuelve `skippedPaid` con el mes pago del medio; `revoke` doble-anulación → cerrojo; `revoke` borra SOLO futuras del origen `exemption` (una `exempt` de otro origen o fuera de rango en el fake NO se borra). → FAIL → implementar → PASS.
- [ ] **Step 3: Mutación** (entregable, se reporta): borrar la guarda 3 (débito) → rojo; borrar `revokedAt: null` del cerrojo → rojo; borrar `origin: "exemption"` del `deleteMany` → rojo. Restaurar.
- [ ] **Step 4: Suite + lint + build. Commit** `feat(exemption): domain — grant, revoke and the one shared activeExemption`

---

### Task 3: Tesorería — pestaña "Exenciones" (listado + alta + anulación)

**Files:**
- Modify: `src/lib/admin/treasury-tabs.ts` (+1 al final: `{ href: "/admin/tesoreria/exenciones", label: "Exenciones" }`)
- Create: `src/app/admin/tesoreria/exenciones/page.tsx`, `src/app/admin/tesoreria/exenciones/actions.ts`, `src/app/admin/tesoreria/exenciones/grant-form.tsx`, `src/app/admin/tesoreria/exenciones/revoke-form.tsx`
- Test: `tests/exemption-actions.test.ts`, `tests/treasury-tabs.test.ts` pasa solo (verifica que la ruta exista en disco)

**Interfaces:**
- Consumes: `exemptions`/`activeExemption` (Task 2); el molde de pantalla es `src/app/admin/tesoreria/otros-ingresos/page.tsx` (el único "listado + alta" de Tesorería: chips, tarjeta de alta, avisos por querystring `?registrado=1`, `hasNotice()` para el foco); el doble nivel de Valores (`valores/page.tsx:33`: `Promise.all([requireAdmin(), requireSuperadmin()])`, el segundo solo display); `MinutePicker` con TODAS sus props actuales (`minute-picker.tsx:23-61`) + `initialMinuteChoice`/`describeMinuteChoice` de `@/lib/members/minute-choice`; el patrón acta-huérfana completo (`socios/[id]/actions.ts:6-26` y `89-172`: parseo del acta APARTE con `minuteSelectionSchema.safeParse` — es un union, `parseForm` no lo soporta — → `resolveMinuteId` → ejecutar → `discardUnusedMinute` si falla y era nueva → audit con IP → redirect fuera del try); buscador de socio `searchMembers` de `@/lib/treasury/member-search` (importado, INTOCABLE — devuelve los tres estados con el status para el badge; la pantalla muestra el resultado y las guardas del dominio cortan al no-elegible con su motivo); `suggestedMinuteNumber` vía el `groupBy` por máximo del precedente (`cierre/confirmar/page.tsx:124-135`).
- Produces: `grantExemptionAction(prev, formData)` y `revokeExemptionAction(prev, formData)`; la ruta `/admin/tesoreria/exenciones` con `?socio={id}` (precarga el buscador — lo consume la Task 5) y `?asentada=1`/`?anulada=1` de éxito.

- [ ] **Step 1: La pestaña.** El elemento en `TREASURY_TABS` (al final). `tests/treasury-tabs.test.ts` queda en rojo hasta que exista `page.tsx` — es la señal, no un problema.
- [ ] **Step 2: Actions con TDD.** `grantExemptionAction`: `requireSuperadmin()` primera línea → `parseForm` de `{ memberId, months: z.coerce.number().int().min(1).max(24), fromPeriod: z.string().regex(/^\d{4}-\d{2}$/), note: z.string().max(300).optional() }` con mensajes es-AR → acta aparte (`minuteSelectionSchema`) → `exemptions.grant(...)` → si falla y el acta era nueva, `discardUnusedMinute` → `audit({ action: "fee_exemption_create", entity: "member", entityId: memberId, detail: { exemptionId, fromPeriod, toPeriod, months, minuteId, skippedPaid } })` → `redirect("/admin/tesoreria/exenciones?asentada=1")`. `revokeExemptionAction`: `requireSuperadmin` → `{ exemptionId }` + acta → `exemptions.revoke` → compensación → `audit fee_exemption_revoke` → redirect `?anulada=1`. Tests (mock del servicio y de `requireSuperadmin`): el admin común no llega al servicio; el acta huérfana se descarta si `grant` falla; el detail no lleva nombres. Mutación: borrar el `requireSuperadmin` de una action → rojo.
- [ ] **Step 3: La pantalla.** `requireAdmin()` propio + doble nivel display. Secciones: **Vigentes** (cards patrón `RequestCard`: `CardTitle as="h2"` con ícono `ShieldCheck` + nombre del socio como link `INLINE_LINK` a la ficha; metadatos `N° {memberNumber} · {rango en palabras} · faltan {monthsLeft} meses` en `font-mono tabular-nums` donde toque; badge `success` "Vigente" o `secondary` "Comienza en {mes}"; el acta como link a `/admin/actas/{minuteId}`; la nota si hay; y —solo superadmin— el `<details>` de **Anular** con `MinutePicker` propio y botón `variant="destructive"` `min-h-11`); **Historial** (cards `size="sm"` de una línea: vencida/anulada con sus actas); **Alta** (card "Eximir de cuota", solo superadmin la ve operable): buscador de socio (con `?socio=` precargado), meses (numérico 1..24, 24 precargado), inicio (input mes con el siguiente sugerido: `addMonths(currentPeriod(), 1)`), `MinutePicker`, nota — y el **resumen previo** que nombra el acta (`describeMinuteChoice`) y los meses exactos, actualizándose en el cliente, ANTES del botón (la lección del cierre: confirmar sin ver el acta es imposible). `EmptyState size="list"` para cada sección vacía. Avisos de éxito por querystring.
- [ ] **Step 4: 🖥️ SESIÓN DEL OPERADOR.** Pedirle al operador la sesión de superadmin en `localhost:3000` y verificar en vivo: asentar una exención de prueba a un activo al día (12 meses) → aparece en Vigentes con su acta; el devengo manual NO le crea cuotas del rango (correr `/api/cron/accrual?force=1&upTo=...` con `CRON_SECRET` local si hace falta, o verificar por consulta); anularla con acta nueva → pasa al historial y las futuras desaparecen de la base; 375px sin desborde. **Revertir el dato de prueba documentando cómo** (la anulación + borrar registro y movimientos por SQL anotado, o restaurar). Si el operador no está: dejar la checklist escrita y NO marcar la verificación como hecha.
- [ ] **Step 5: Suite + lint + build. Commit** `feat(exemption): tesoreria tab — in-force list, grant and revoke with their minutes`

---

### Task 4: El bloqueo de los cinco caminos de pago

**Files:**
- Modify: `src/app/admin/tesoreria/efectivo/page.tsx` + `actions.ts` (guarda + aviso), `src/app/admin/socios/[id]/link/page.tsx` + `actions.ts` (ídem), `src/app/mi/cuenta/page.tsx` + `actions.ts` (banner + corte en `startMemberPaymentAction`), `src/lib/members/debit-adhesion.ts` (input ADITIVO), `src/lib/members/member-debit.ts` (los dos callers pasan el dato), `src/app/mi/debito/page.tsx` (el mensaje ya sale del veredicto)
- Test: `tests/debit-adhesion.test.ts` (+casos), `tests/mi-cuenta-actions.test.ts` o el que cubra `startMemberPaymentAction` (grep), `tests/exemption-blocks.test.ts` (nuevo, para los cortes de efectivo y link)

**Interfaces:**
- Consumes: `activeExemption` (Task 2) — **la única fuente**; `periodLabel` para los mensajes.
- Produces en `debit-adhesion.ts` (aditivo, sin tocar lo existente):

```ts
export type AdhesionVerdict = ... | { ok: false; reason: "exempted"; until: string /* toPeriod */ };
// adhesionVerdict gana el input opcional `exemptedUntil?: string | null` y la guarda
// va PRIMERA (antes que categoría: un eximido es activo, la categoría pasa).
// adhesionBlockMessage: "Estás eximido de la cuota hasta {mes}: no hay nada que debitar."
```

Regla de mensaje compartida para las pantallas admin: **"El socio está eximido de la cuota hasta {mes} (acta N° {minuteId})."** — mismo texto en efectivo y link, `FormMessage kind="neutral" box`.

- [ ] **Step 1: Adhesión (TDD).** Casos nuevos en la tabla de `adhesionVerdict`: `exemptedUntil` presente → `{ ok:false, reason:"exempted", until }` aunque todo lo demás pase; `null` → sin cambio (los casos existentes NO se tocan). `member-debit.ts`: `preview()` y `start()` consultan `activeExemption(db, memberId)` y pasan `exemptedUntil: ex?.toPeriod ?? null` (el `deps.db` del servicio gana `feeExemption` en su `Pick`). `start()` corta ANTES de llamar a MP. Mutación: quitar la guarda del veredicto → rojo.
- [ ] **Step 2: Efectivo.** En `efectivo/page.tsx`: si el socio elegido (`?socio=`) tiene exención vigente → en lugar del formulario de conceptos, el aviso compartido (mismo patrón con que la pantalla ya recorta conceptos al cesante — leerlo). En `efectivo/actions.ts`: la action re-consulta `activeExemption` y corta con el mismo texto antes de llamar al núcleo (defensa en profundidad; `registerCashPayment` NO se toca). Test del corte con mock: la action con eximido no llama a treasury.
- [ ] **Step 3: Link admin.** `socios/[id]/link/page.tsx`: con exención vigente, la pantalla muestra el aviso en lugar del formulario. `link/actions.ts`: corte en la action antes de `paymentLinks.create`. Test ídem.
- [ ] **Step 4: Panel del socio.** `mi/cuenta/page.tsx`: consulta `activeExemption`; con vigente → banner `FormMessage kind="neutral" box` **"Tenés una exención de cuota vigente hasta {mes}."** arriba de la cuenta, y la sección `#pagar` no se renderiza (la card entera — `AccountSection` NO se toca, el "Estás al día." que muestra adentro es verdadero). `mi/cuenta/actions.ts` → `startMemberPaymentAction` corta con el mensaje del socio. Test: la action con eximido no llama al gateway.
- [ ] **Step 5: 🖥️ SESIÓN DEL OPERADOR** (superadmin en `localhost:3000`, con una exención de prueba sembrada): Efectivo con `?socio=` del eximido muestra el aviso y ningún concepto; el link de pago desde su ficha muestra el aviso; y — solo si el operador puede loguearse además como el socio de prueba — `/mi/cuenta` con banner y sin "Pagar ahora", `/mi/debito` bloqueado con el mensaje. Si la sesión de socio no está disponible, esas dos se cubren con los tests de render y se deja dicho. Revertir la siembra.
- [ ] **Step 6: Suite + lint + build. Commit** `feat(exemption): the five payment paths refuse an exempted member`

---

### Task 5: Ficha, verificación mecánica, docs y cierre

**Files:**
- Modify: `src/app/admin/socios/[id]/page.tsx` (badge + aviso + botón), `docs/07-plan-de-etapas.md` (sección del módulo), `CLAUDE.md` (nota corta), memoria del proyecto
- Test: los de pantalla que correspondan (`renderToStaticMarkup`, precedente `tests/admin-health-screen.test.ts`)

**Interfaces:**
- Consumes: `activeExemption` (Task 2); la fila de badges del header (`[id]/page.tsx:224-238`), el bloque de avisos (`:139-191`, donde vive el de baja recurrible) y la botonera (`:199-222`) — los tres ya mapeados.

- [ ] **Step 1: Ficha.** Badge `success` **"Eximido"** en la fila de badges (con `sr-only` del rango); aviso `FormMessage kind="neutral" box` "Exención de cuota vigente hasta {mes} — acta N° {minuteId}" junto a los avisos existentes; botón **"Eximir de cuota"** en las actions del header (`Button asChild variant="outline"`, visible si `status === "active"` y sin exención vigente y el actor es superadmin — display, como Valores) → `Link href={"/admin/tesoreria/exenciones?socio=" + member.id}`. Test de pantalla: con exención → badge y aviso presentes, botón ausente; sin → botón presente para superadmin.
- [ ] **Step 2: Verificación mecánica del núcleo** (entregable, se pega en el reporte): `git diff main..HEAD --stat -- src/lib/treasury src/lib/mp src/components/admin/account-section.tsx src/lib/admin/digest.ts tests/integration` tiene que mostrar **únicamente** `src/lib/treasury/exemptions.ts` (archivo nuevo) y **ningún archivo existente modificado**. Si aparece otro, FRENAR.
- [ ] **Step 3: CA en vivo — 🖥️ SESIÓN DEL OPERADOR.** El circuito entero de la spec §11 con el operador mirando: eximir → devengo no crea → los cinco bloqueos → ficha con badge/aviso → historial con el movimiento y su acta → padrón electoral lo incluye → anular → el devengo forzado del mes siguiente le crea `pending` normalmente. Revertir todo documentando cómo.
- [ ] **Step 4: Docs.** `docs/07`: sección "Exención de cuota (Art. 7 inc. a.4) — CERRADO" con el estilo de la casa, solo afirmaciones verificables en el repo. `CLAUDE.md`: una nota corta en los patrones (la exención como registro con acta + filas materializadas que el núcleo ya sabía tratar; `activeExemption` única). Memoria: actualizar `sigev` con el estado.
- [ ] **Step 5: Suite + lint + build finales. Commit** `feat(exemption): member card, mechanical core check and module docs` y ofrecer el merge con `superpowers:finishing-a-development-branch`.

---

## Self-Review (aplicado)

- **Cobertura de spec**: §1-§2 (constraints + tasks), §3 modelo (T1), §3.3 materialización y §4 dominio (T2), §5 guardas (T2 revalida, T3 pre-valida), §6 bloqueo de cinco caminos (T4, con la tabla de la spec cubierta camino por camino), §7 pantallas (T3 tesorería, T5 ficha, T4 panel del socio), §8 auditoría (T3 actions), §9 invariantes (constraint global + T5 Step 2 mecánico), §10 fuera de alcance (respetado: sin correos, sin salud, sin cancelación admin de débito), §11 CA (T5 Step 3).
- **Sin placeholders**: cada paso nombra el archivo real y el patrón exacto a calcar con archivo:línea del análisis del 27/08; las firmas de todo lo nuevo están escritas; la regla de la casa aplica (si la forma real difiere, gana el archivo y se anota).
- **Consistencia de tipos**: `activeExemption`/`ActiveExemption` (T2) los consumen T3/T4/T5 con la misma firma; `exemptedUntil?: string | null` (T4) alimenta el `reason: "exempted"` con `until: string`; los querystrings `?socio=`/`?asentada=1` que T3 produce los consume T5.
- **Riesgos señalados**: la carrera exención-vs-devengo el día 1 (la guarda 2 la detecta y el `grant` la convierte en error reintentabl e, no en silencio); el buscador de socio devuelve los tres estados a propósito y el corte lo pone el dominio con su motivo; `tests/treasury-tabs.test.ts` en rojo entre el Step 1 y el 3 de la T3 es esperado dentro de la MISMA task (un solo commit).
