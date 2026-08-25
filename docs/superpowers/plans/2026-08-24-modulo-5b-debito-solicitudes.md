# Módulo 5 — Fase 5B: Débito automático autogestionado y solicitudes de socios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El socio se adhiere y cancela su débito automático desde `/mi/debito` (con la regla anti-duplicación mensual), y pide su baja (REG-19) o su cambio de categoría (REG-07) desde `/mi/solicitudes`; la CD decide desde la sección **Solicitudes unificada** del panel admin — rediseñada entera con el lenguaje de la 5A: pestañas Altas | De socios, cola vs. historial, tarjetas con íconos, barra de asiento fija y visor de DNI embebido — actualizando el monto en Mercado Pago en el acto cuando corresponde.

**Architecture:** Tabla nueva `member_requests` + servicio con mutex por socio (Tasks 1-5, HECHAS); la sección `/admin/solicitudes` gana un layout con pestañas por URL (patrón Tesorería) y la bandeja de socios vive en `/admin/solicitudes/socios`; el rediseño de Altas es de **presentación pura** (las server actions, actas y emails quedan intactos); la adhesión al débito crea el preapproval con la fila `MpSubscription` naciendo con `memberId`, así los cobros entran por la **regla 3 existente** de `resolve.ts` sin tocarla; la aceptación admin reutiliza `runAction`/`withdrawWithDebits`/`changeCategory` con un `requestId` opcional.

**Tech Stack:** Next.js 16 App Router, React 19 (`useActionState`), Prisma 7 + MariaDB, `mpGateway` existente, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-modulo-5-panel-socio-design.md` §4, §6, §7 (con la enmienda del 24/08 a la noche: sección unificada) y §12 (CA-5B). Ledger: `.superpowers/sdd/progress.md`.

**Estado**: Tasks 1-5 completas y commiteadas (targets 48px, modelo, reglas, servicio, `/mi/solicitudes`). La ejecución retoma en la **Task 6**. Quedó una solicitud de BAJA pendiente del socio 298 en la base local: la consumen las QA de las Tasks 8 y 9.

## Global Constraints

- UI en **es-AR con "vos"**; código, variables y commits en **inglés**. Commits terminan con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (línea en blanco antes).
- **Núcleo de dinero intocable**: `src/lib/treasury/*`, `src/lib/mp/resolve.ts`, `src/lib/mp/webhook-processor.ts`, `src/lib/mp/gateway.ts`, `src/lib/mp/payment-link*.ts`, `src/lib/mp/reconcile.ts`, `src/lib/mp/link-subscription.ts`, `src/components/admin/account-section.tsx` y `tests/integration/*` NO se modifican — solo se importan. Excepción acotada: `src/lib/mp/references.ts` admite **agregados aditivos** (el formato `socio:{id}`); lo existente no se toca.
- **Trabajo validado intocable (pedido expreso del cliente)**: el rediseño de la bandeja de Altas es de PRESENTACIÓN. `src/app/admin/solicitudes/actions.ts` (las tres actions: asentar, recategorizar, rechazar), `src/lib/applications/*` (`query.ts` admite agregados aditivos, ver Task 6), `record.ts`, el circuito de actas (`minute-form.ts`, `MinutePicker`) y los emails NO cambian de comportamiento. La suite existente de applications tiene que pasar SIN modificar sus aserciones.
- **Lenguaje visual de la 5A, obligatorio en toda pantalla nueva o rediseñada**: tarjetas con ícono Lucide (`aria-hidden`) en el título, badges con palabra además de color, targets ≥48px en `/mi` y ≥44px en admin (`min-h-11`), foco `outline-hidden` + `focus-visible:ring-2 focus-visible:ring-ring` (nunca `outline-none`), colores solo por tokens (prohibidos `--sidebar-*` en contenido y verde/ámbar crudo), light-only, responsivo sin scroll horizontal del body, componentes compartidos antes que reinventar.
- **El `memberId` de toda action de socio sale de `requireMember()`, nunca del formulario.** Ids que viajan en formularios (`requestId`, `preapprovalId`) se revalidan contra la base ANTES de actuar.
- Matriz del suspendido (spec §5): páginas de `/mi` con `{ allowSuspended: true }`; ninguna action nueva la pasa. El cesante bloqueado en todo.
- Auditoría y logs: ids, códigos y flags — nunca DNI, email, teléfono, domicilio, el texto libre del socio ni la URL de un checkout (Ley 25.326). Los `preapprovalId` sí pueden ir al asiento.
- Migraciones con `npx prisma migrate dev` — nunca `db push`.
- **Nunca probar cobros en producción.** El circuito MP se prueba en sandbox local con túnel (`docs/11` Parte J); el CA-5B-1 se cierra ahí con el operador.
- **El resumen diario NO informa nada de `member_requests`** (`src/lib/admin/digest.ts:60-72`). Esta fase NO modifica el digest: el canal de aviso a la CD es la pestaña con contador + la tarjeta del tablero (enmienda a la spec §7.2).
- Tests: `npx vitest run`, `npm run lint`, `npm run build` antes de cada commit de tarea.
- Rama de trabajo: `m5b-debit-requests` (ya existe, con las Tasks 1-5).

---

### Task 6: Sección Solicitudes unificada — pestañas, cola/historial de Altas, barra de asiento y contadores

**Files:**
- Create: `src/lib/admin/solicitudes-tabs.ts`, `src/components/admin/solicitudes-tabs.tsx`, `src/app/admin/solicitudes/layout.tsx`, `src/app/admin/solicitudes/application-cards.tsx` (client: tarjetas + selección + barra fija)
- Modify: `src/app/admin/solicitudes/page.tsx` (reescritura de presentación), `src/app/admin/solicitudes/record-form.tsx` (se reemplaza por la barra fija — puede borrarse si queda vacío), `src/lib/applications/query.ts` (SOLO agregados: el chip de domicilio), `src/lib/admin/dashboard-cards.ts` NO se toca — el contador lo inyecta `src/app/admin/page.tsx` (Modify)
- Test: `tests/solicitudes-tabs.test.ts` (config pura); la suite de applications existente pasa sin tocar aserciones

**Interfaces:**
- Consumes: `TreasuryTabs` como REFERENCIA de patrón (no se modifica); `parseApplicationFilters`/`fetchApplicationsPage`/badges de `src/lib/applications/query.ts`; `APPLICATION_STATUS_LABELS`; `applicationStatusBadgeVariant`; `MinutePicker`; `recordApplicationsAction` (INTACTA); `PaginationNav` + `pageHref` de `src/lib/admin/pagination.ts`; `categoryAllowedForResidence` de `src/lib/applications/wizard.ts` (verificar nombre y firma reales antes de usar); `RECORDABLE_STATUSES` de `record.ts`, `DECIDABLE_STATUSES` de `decision.ts`.
- Produces: `SOLICITUDES_TABS`, `isSolicitudesTabActive(pathname, href)` (config pura; `/admin/solicitudes` matchea exacto O en `[id]`/`resumen` — es la pestaña Altas; `/admin/solicitudes/socios` matchea con prefijo); componente `SolicitudesTabs({ tabs })` donde `tabs: Array<{ href, label, count?: number }>` — calca `treasury-tabs.tsx` (mismo `-my-1 py-1`, `aria-current`, `min-h-11`) y suma el contador como `<span>` con `font-mono tabular-nums` cuando `count > 0`; el layout que consulta los DOS contadores y monta header+tabs.

- [ ] **Step 1: Config pura + test.** `solicitudes-tabs.ts` con el porqué en prosa (por qué `/admin/solicitudes/socios` no puede ser `/admin/socios/...`: `isNavItemActive` de la nav marca por prefijo y encendería dos ítems). OJO con el matcheo: la pestaña Altas está activa en `/admin/solicitudes`, `/admin/solicitudes/{id}` y `/admin/solicitudes/resumen`, pero NO en `/admin/solicitudes/socios` — la regla es "socios gana por prefijo, todo lo demás es Altas". Test con esos cinco casos.
- [ ] **Step 2: Layout.** `src/app/admin/solicitudes/layout.tsx` calcado de `src/app/admin/tesoreria/layout.tsx` (leerlo: PageHeader + tabs envueltos en `print:hidden`; la autorización NO vive en el layout — cada página llama `requireAdmin()`). Los contadores se consultan acá: `prisma.application.count({ where: { status: { in: ["pending_payment", "approved_pending_minute", "pending_board"] } } })` y `prisma.memberRequest.count({ where: { status: "pending" } })`, en `Promise.all`. `PageHeader title="Solicitudes"`. El botón "Resumen para acta" se MUEVE del header viejo a la vista Pendientes de Altas (Step 4).
- [ ] **Step 3: El chip "Revisar domicilio" (agregado aditivo a `query.ts`).** Cierra el ítem 8 ABIERTO de `docs/07:467-469`. En `src/lib/applications/query.ts`, agregar al armado de cada fila un booleano `residenceMismatch` derivado con la función pura de `wizard.ts` (categoría pedida vs. domicilio declarado — mirar cómo lo computa `recategorizeApplicationAction` en `actions.ts:275-294` y usar EXACTAMENTE el mismo criterio: dos definiciones divergirían). NO tocar nada existente del módulo; sumar el caso a los tests de query existentes si los hay (grep `tests/*application*query*`), si no, test nuevo chico.
- [ ] **Step 4: Reescritura de `page.tsx` (presentación).** Conmutador **Pendientes | Historial** por querystring `?vista=historial` con el segmented de `sin-conciliar/page.tsx:96-115` (nav aria-label, `bg-muted p-1`, activo `bg-background shadow-sm`, `min-h-11`).
  - **Pendientes** (default): SOLO `pending_payment | approved_pending_minute | pending_board`, ordenadas por accionabilidad (primero las asentables, después `pending_board`, después `pending_payment`) y dentro de cada grupo por fecha asc (la más vieja primero: es una cola). Tarjetas apiladas: ícono por tipo (`Inbox`/`UserPlus` — a criterio del implementador dentro de lucide), nombre como link al detalle, DNI, categoría pedida, débito Sí/No, fecha, y los badges existentes (estado, Reingreso, Sin débito, Verificar débito — misma lógica de `query.ts`, NO recalcular) más el chip nuevo `Revisar domicilio` (`Badge variant="outline"` con ícono `MapPinOff` o similar + palabra). Arriba, una fila con el contador de la cola y el botón "Resumen para acta".
  - **Historial**: búsqueda por nombre/DNI + select de estado (por fin con `SELECT_CLASS` — copiar la constante de `deudores/page.tsx:34-37`) + tarjetas compactas (una línea: nombre, DNI, badge, fecha) + `PaginationNav` con `pageHref` de `src/lib/admin/pagination.ts` (reemplaza la paginación duplicada a mano — es el reemplazo de presentación permitido).
  - `EmptyState size="list"` en las dos vistas ("No hay solicitudes pendientes. Las nuevas aparecen acá solas." / con "Limpiar filtros" en historial).
- [ ] **Step 5: La barra de asiento fija.** `application-cards.tsx` (client): estado de selección de las tarjetas asentables (checkbox en la tarjeta, `<label>` envolvente para el target); al haber ≥1 tildada aparece una barra `fixed bottom-0 inset-x-0 z-40` (dentro de un contenedor que respete el ancho del main, con `border-t bg-background/95 backdrop-blur p-3` y sombra) con "N seleccionadas", el `MinutePicker` COMPARTIDO y el botón "Asentar en acta" — el `<form>` postea a `recordApplicationsAction` con los MISMOS names que hoy emite `record-form.tsx` (leerlo antes de tocar: checkboxes `ids`, names del acta de `minuteSelectionSchema`; la action NO se modifica, así que los names son el contrato). El manejo de éxito parcial (lista de fallos linkeados) se conserva tal cual lo hace `record-form.tsx:99-113`. En móvil la barra queda al alcance del pulgar; probar que no tape la última tarjeta (padding-bottom en la lista cuando la barra está visible).
- [ ] **Step 6: Contador en el tablero.** En `src/app/admin/page.tsx`: consultar los dos counts (mismas queries del layout) y, para la tarjeta cuyo `href === "/admin/solicitudes"`, renderizar debajo de la descripción una línea `font-mono tabular-nums` tipo "3 altas · 1 de socios pendientes" (ocultarla si ambos son 0). `dashboard-cards.ts` NO se toca (sus tests de sincronía siguen intactos).
- [ ] **Step 7: Verificar.** `npx vitest run` (la suite de applications pasa SIN tocar aserciones — si un test existente falla, el rediseño rompió comportamiento: corregir el rediseño, no el test), `npm run lint`, `npm run build`. En navegador (sesión admin): pestañas con contadores, cola con la solicitud de baja NO (es de socios) y las altas de prueba que haya, barra fija al tildar, historial con filtros, tablero con el desglose. 375px sin desborde.
- [ ] **Step 8: Commit** `feat(m5b): unified solicitudes section — tabs, queue/history split and sticky minute bar`

---

### Task 7: Detalle de alta rediseñado — jerarquía, íconos y visor de DNI embebido

**Files:**
- Modify: `src/app/admin/solicitudes/[id]/page.tsx` (reordenado + íconos), `src/app/admin/solicitudes/[id]/decision-forms.tsx` (SOLO clases: el `<select>` con tokens — cero cambios de lógica)
- Create: `src/app/admin/solicitudes/[id]/document-viewer.tsx`

**Interfaces:**
- Consumes: la ruta existente `GET /api/admin/solicitudes/{id}/documentos/{docId}` — ya sirve `inline` con `no-store, private`, `nosniff` y CSP `default-src 'none'; sandbox` (`route.ts:104-114`): está PREPARADA para embeber y nadie la embebe. El modelo de documentos: verificar en `prisma/schema.prisma` qué campo trae el tipo MIME (o la extensión) para decidir `<img>` vs `<iframe>`.
- Produces: `DocumentViewer({ documents })` — para cada documento: imagen → `<img>` embebida con `max-w-full` y borde de tarjeta; PDF → `<iframe>` con altura razonable; siempre el link "Abrir en otra pestaña" como respaldo (`target="_blank" rel="noopener"`, `min-h-11`). Etiqueta del tipo (frente/dorso/anexo) y tamaño como hoy.

- [ ] **Step 1: Reordenar `[id]/page.tsx`.** Nuevo orden: (1) los hasta-4 `FormMessage kind="warning"` de MP salen de la Card de Pago y van ARRIBA de todo, debajo del PageHeader; (2) Card **Acciones** (si `isDecidable`) — sube de quinta a primera, `md:col-span-2`; (3) Estado + Datos personales (el grid 2 columnas de hoy); (4) **Documentación** con el `DocumentViewer` (`md:col-span-2`); (5) Pago y suscripción (sin los avisos, que ya subieron); (6) Notificaciones. Cada `CardTitle as="h2"` gana su ícono Lucide (`ClipboardList`, `User`, `FileImage`, `CreditCard`, `Bell` — o equivalentes). NADA de la lógica de datos cambia: mismas consultas, mismos `Field`, mismos textos.
- [ ] **Step 2: El visor.** Componente server-safe (sin estado): decide img/iframe por el tipo del documento. El DNI frente y dorso lado a lado en desktop (`grid gap-4 md:grid-cols-2`), apilados en móvil.
- [ ] **Step 3: `decision-forms.tsx`** — únicamente el `className` del `<select>` de recategorizar pasa a los tokens (`SELECT_CLASS` copiada o el patrón de `deudores`); el `<details>` del rechazo y toda la lógica quedan tal cual (su comentario de cabecera explica por qué está cerrado).
- [ ] **Step 4: Verificar.** Suite (sin tocar aserciones), lint, build. En navegador: un detalle con documentos muestra el DNI embebido; los avisos de MP arriba; Acciones primera; 375px sin desborde (el iframe/img no desbordan: `max-w-full`).
- [ ] **Step 5: Commit** `feat(m5b): application detail redesign — hierarchy, icons and embedded document viewer`

---

### Task 8: Pestaña "De socios" — la bandeja de member requests

**Files:**
- Create: `src/app/admin/solicitudes/socios/page.tsx`, `src/app/admin/solicitudes/socios/actions.ts`, `src/app/admin/solicitudes/socios/reject-form.tsx`
- Test: `tests/solicitudes-socios-actions.test.ts`

**Interfaces:**
- Consumes: `memberRequests.reject({ requestId, decidedById, note })` (Task 4 — devuelve `{ ok, memberId, type }` o error); labels `REQUEST_TYPE_LABELS`/`REQUEST_STATUS_LABELS`/`CATEGORY_LABELS`; los badges e íconos YA elegidos por `/mi/solicitudes` (`mi/solicitudes/page.tsx:25-35`: `pending→default`, `accepted→success`, `rejected→destructive`, `cancelled→secondary`; `UserMinus`/`ArrowLeftRight`) — REUTILIZAR el mapeo, no reinventarlo (si conviene, extraerlo a `src/lib/members/labels.ts` o un módulo chico compartido para que las dos pantallas no diverjan); `requireAdmin`; `formatDateTimeAR`.
- Produces: `rejectRequestAction(prev, formData)`; la ruta `/admin/solicitudes/socios` (pestaña con contador ya montada por el layout de la Task 6). La notificación al socio se cablea en la Task 9 (que crea `notifyRequestDecided`) — esta action deja el punto de enganche comentado.

- [ ] **Step 1: Página.** `requireAdmin()` propio (el layout no protege). Conmutador **Pendientes | Resueltas** (`?estado=resueltas`, mismo segmented de la Task 6). Consulta con `include: { member: { select: { id, fullName, category, status, memberships: { select: { memberNumber, book: { select: { status } } } } } }, decidedBy: { select: { name: true } }, movement: { select: { minuteId: true } } }`, orden `{ id: "desc" }`, y en resueltas paginación simple si supera 50 (usar `paginate`/`PaginationNav`). Tarjetas con el lenguaje de `/mi/solicitudes`: ícono por tipo, título con el tipo, badge de estado con palabra, el socio como link a `/admin/socios/{id}` con su N° del libro abierto, fecha de presentación, el `text` completo (`whitespace-pre-line`), y `message` NO se repite aparte (ya viene dentro del escrito). En resueltas: quién decidió (`decidedBy.name`), cuándo, la `decisionNote` si hay, y si `movement?.minuteId` el link "Ver acta" a `/admin/actas/{minuteId}`.
- [ ] **Step 2: Las dos salidas de una pendiente.** **Aplicar**: link-botón (`Button asChild`) a `/admin/socios/{memberId}/baja?solicitud={id}` o `/admin/socios/{memberId}/categoria?solicitud={id}` según el tipo (la precarga la construye la Task 9 — hasta entonces el link lleva al flujo normal SIN precarga, que ya funciona). **Rechazar**: `reject-form.tsx` (client) detrás de un `<details>` (el patrón del rechazo de altas: la acción destructiva no se ofrece abierta), con `TextareaField` para la nota (máx 500, mensaje en castellano) y botón `variant="destructive"` con confirm. `EmptyState size="list"` por vista.
- [ ] **Step 3: `rejectRequestAction`.** `requireAdmin` → zod `{ requestId: z.coerce.number().int().positive(), note: z.string().max(500, "La nota no puede superar los 500 caracteres").optional() }` → `memberRequests.reject({ requestId, decidedById: actor.actorId, note })` → si `ok`: audit `member_request_reject` con `{ requestId, type }` + IP (patrón de las actions vecinas de `socios/[id]/actions.ts` — nunca la nota en el asiento) → `revalidatePath("/admin/solicitudes/socios")` → `{ done: true }`. Si el servicio rechaza (ya resuelta), mostrar su error.
- [ ] **Step 4: Tests.** Andamiaje de `tests/mi-solicitudes-actions.test.ts` adaptado a admin (mock de `requireAdmin`): actor no-admin no llega al servicio; `requestId` del form llega al servicio con el `decidedById` del ACTOR; la nota NO viaja al asiento de auditoría (aserción sobre el mock de audit); nota >500 → error en castellano sin tocar el servicio.
- [ ] **Step 5: Verificar en navegador** (sesión admin): la pestaña De socios muestra la solicitud de baja pendiente de Rodrigo (dejada por la Task 5); el contador de la pestaña dice 1; rechazar CON nota la mueve a Resueltas con "quién/cuándo/nota"; y el socio la ve "Rechazada" con la nota en `/mi/solicitudes`. **Volver a crear la solicitud de baja pendiente** (desde la sesión del socio) para la QA de la Task 9. Suite + lint + build.
- [ ] **Step 6: Commit** `feat(m5b): member requests tab in the unified solicitudes section`

---

### Task 9: Aceptación precargada en los flujos con acta + aviso al socio

**Files:**
- Create: `src/lib/members/member-requests/notify.ts`, plantilla en `src/lib/email/templates.ts` (agregado al final, mismo estilo de las existentes)
- Modify: `src/app/admin/socios/[id]/actions.ts` (`withdrawAction` y `changeCategoryAction`: `requestId` opcional), `src/app/admin/socios/[id]/[accion]/page.tsx` (precarga), `src/app/admin/socios/[id]/action-form.tsx` (prop `hidden` — ver Step 3), `src/app/admin/solicitudes/socios/actions.ts` (cablear la notificación del rechazo)
- Test: `tests/member-requests-notify.test.ts` (la plantilla es pura)

**Interfaces:**
- Consumes: `runAction` (leer entero: `extraSchema`, `guard(member, data)` y `run(ctx, member, data)` son los puntos de extensión; NO cambiar su estructura); `memberRequests.markAccepted` (Task 4 — exige `requestId` + `memberId` + estar `pending`: el par sale de la fila leída en el guard, no de dos fuentes); `mailer.sendToMember` — **firma real en `src/lib/email/index.ts:83-92`**: `{ memberId: number | null; to: string; type: NotificationType; message: Omit<MailMessage, "to">; summary: string; period?: string | null }`. Acepta cualquier `NotificationType`, así que `request_accepted`/`request_rejected` entran sin tocar el mailer. (La copia de `account-email-notice.ts:116-123` está estrechada a `email_verification` y NO sirve de referencia.) La allowlist y el ledger `Notification` los pone el transporte/mailer — no reimplementar.
- Produces: `notifyRequestDecided({ memberId, type, accepted, note? }): Promise<void>` (best-effort: lee el email utilizable de la ficha — `email && emailStatus !== "bounced"` —, arma la plantilla y manda con `type: accepted ? "request_accepted" : "request_rejected"`; cualquier fallo se loguea con código y NO propaga); plantilla `memberRequestDecided({ type, accepted, note }): { message, summary }` (es-AR, "vos"; la de baja aceptada dice que la baja quedó asentada con acta; la de categoría aceptada, que ya rige; las rechazadas incluyen la nota si hay).

- [ ] **Step 1: Test de la plantilla** (pura): las cuatro variantes contienen las palabras clave ("baja", "categoría", "aceptada"/"rechazada") y la nota cuando se pasa. → FAIL → implementar plantilla + `notify.ts` → PASS.
- [ ] **Step 2: `requestId` en las dos actions.** En `withdrawAction` y `changeCategoryAction`, el `extraSchema` gana `requestId: z.coerce.number().int().positive().optional()`. En cada `guard`, si vino `requestId`: cargar la solicitud y validar que exista, esté `pending`, sea del `memberId` del form y del tipo correcto — y en categoría, que `requestedCategory === data.newCategory`; mismatch → `{ ok: false, error: "La solicitud no corresponde a esta operación. Volvé a la bandeja." }`. En cada `run`, DESPUÉS de que el servicio estatutario resuelva: `if (data.requestId) { await memberRequests.markAccepted({ requestId, memberId, decidedById: actorId, type }); await notifyRequestDecided({ memberId, type, accepted: true }); }` — best-effort respecto del redirect. Sumar `requestId` al `detail` del asiento.
- [ ] **Step 3: Precarga en `[accion]/page.tsx` (+ `action-form.tsx`).** La página hoy declara SOLO `params` (`[accion]/page.tsx:165-166`): agregarle `searchParams: Promise<{ solicitud?: string }>` y `await`-earlo (Next 16). Si `solicitud` es un id válido de solicitud `pending` del socio y del tipo de la acción: renderizar arriba del formulario un `FormMessage kind="neutral" box` con "Estás aplicando la solicitud N° {id} del {fecha}: " + el `text` (`whitespace-pre-line`). **La página NO arma un form por rama**: `screenFor()` devuelve una spec `Screen` y hay un solo `<ActionForm>` compartido (`:222-228`), así que la precarga va por el `initial` del `Field` kind `select` (`action-form.tsx:25,32`) — baja: `reason` con `initial: "resignation"`; categoría: `newCategory` con `initial: requestedCategory`. Para el `requestId` oculto, `ActionForm` hoy solo emite el hidden `memberId` (`action-form.tsx:56`): agregarle un prop opcional `hidden?: Record<string, string | number>` que el `<form>` renderice como `<input type="hidden">` — mínimo, sin tocar su estado ni `initialValues`. Si el id no corresponde, se ignora en silencio (la action revalida igual).
- [ ] **Step 4: Cablear el rechazo.** `rejectRequestAction` (Task 8) llama `notifyRequestDecided` con `accepted: false` y la nota, best-effort, después del reject exitoso.
- [ ] **Step 5: Circuito entero en navegador** (CA-5B-3): la solicitud de baja pendiente → pestaña De socios → Aplicar → flujo de baja precargado (motivo renuncia, el escrito visible) → acta → el socio queda `withdrawn` con motivo `resignation`, la solicitud `accepted` con `movementId`, el correo de decisión sale (allowlist local) y la resuelta muestra quién/cuándo/acta. **Restaurar al socio de prueba por SQL local** (documentar el comando en el informe; usar a Roberto Enrique 535 si se prefiere no tocar a Rodrigo). Suite + lint + build.
- [ ] **Step 6: Commit** `feat(m5b): request acceptance piggybacks the minute flows and notifies the member`

---

### Task 10: Actualizar el monto en MP al aceptar una recategorización

**Files:**
- Create: `src/lib/members/subscription-amount.ts`
- Modify: `src/app/admin/socios/[id]/actions.ts` (`changeCategoryAction`)
- Test: `tests/subscription-amount.test.ts`

**Interfaces:**
- Consumes: `canStillCharge` de `@/lib/mp/subscription-status`; `feeAmountFor` de `@/lib/treasury/rules`; `feeValueReader` de `@/lib/treasury/fee-values`; `mpGateway.updatePreapprovalAmount(id, amount)` y `mpErrorLog` — todos importados, ninguno modificado. Ojo: **`mpErrorLog(operation, ref, e)` devuelve un string, no loguea** — el patrón es `console.error("[prefijo] …", mpErrorLog("updatePreapprovalAmount", { memberId, preapprovalId }, e))` (medido en `mi/cuenta/actions.ts:59` y `admin/solicitudes/actions.ts:329-334`).
- Produces:

```ts
/** Qué suscripción hay que empujar a MP si el socio pasa a `newCategory`, o
 *  `null` si no corresponde tocar nada (sin sub viva, sin valor vigente,
 *  categoría sin cuota, o el monto no cambia). */
export function subscriptionAmountPlan(input: {
  subscriptions: Array<{ preapprovalId: string; status: string; amount: number | null }>;
  newCategory: MemberCategory;
  feeValue: FeeValueAmounts | null;
}): { preapprovalId: string; amount: number } | null;
```

Semántica (pura, con test tabla): la primera sub con `canStillCharge(status)`; si `feeValue === null` → `null` (**`feeAmountFor` NO acepta `null` en su segundo parámetro** — `rules.ts:10` — así que el corte va antes); si no, `const expected = feeAmountFor(newCategory, feeValue)` y `expected === null` (categoría sin cuota) → `null` (el hueco documentado del lote REG-34: ahí lo que corresponde es cancelar, decisión humana, no un monto nuevo); si `expected` coincide con `amount`, `null`; si no, `{ preapprovalId, amount: expected }`.

- [ ] **Step 1: Test tabla** (sin sub viva / sub cancelada / sin valor / categoría sin cuota / monto igual / monto distinto → plan). → FAIL → implementar → PASS.
- [ ] **Step 2: Cablear en `changeCategoryAction`** (decisión #11 de la spec, patrón medido de `recategorizeApplicationAction` en `src/app/admin/solicitudes/actions.ts:252-391` — leerlo entero antes; el bloque MP-antes-de-lo-local es `:296-339`, con el corte si MP falla en `:335-337` y los writes locales en `:341-371`): dentro del `run`, ANTES de llamar a `memberService.changeCategory`: cargar `mpSubscription.findMany({ where: { memberId }, select: { preapprovalId, status, amount } })` + `feeValueReader.current()`, calcular el plan; si hay plan → `await mpGateway.updatePreapprovalAmount(plan.preapprovalId, plan.amount)` — **si MP falla, se lanza** (el `runAction` descarta el acta recién creada y muestra el error; nada local se escribió: es el corte total que pide la spec). Tras el `changeCategory` exitoso, espejo local best-effort en su propio try: `mpSubscription.update({ where: { preapprovalId }, data: { amount: plan.amount.toFixed(2), lastSyncAt: new Date() } })` (si falla, la conciliación diaria corrige — mismo criterio que `withdraw-with-debits`). Sumar al `detail` del asiento: `{ subscriptionUpdated: !!plan, preapprovalId: plan?.preapprovalId, amount: plan?.amount }`. Si `changeCategory` fallara DESPUÉS del push a MP (carrera), compensar best-effort empujando el monto anterior si se conocía, y dejar `mpPushCompensated` en el error log — documentar en el comentario que la red de esto es la pantalla de divergencias REG-34.
- [ ] **Step 3: Suite + lint + build; Commit** `feat(m5b): category change pushes the new amount to MP before writing locally`

---

### Task 11: Referencia `socio:{id}` + regla anti-duplicación pura

**Files:**
- Modify: `src/lib/mp/references.ts` (SOLO agregados)
- Create: `src/lib/members/debit-adhesion.ts`
- Test: `tests/debit-adhesion.test.ts` (+ casos nuevos en `tests/mp-references.test.ts`, que existe)

**Interfaces:**
- Consumes: `categoryPaysFee` de `@/lib/treasury/rules`; `canStillCharge` de `@/lib/mp/subscription-status`; `currentPeriod`, `addMonths`, `periodYear`, `periodMonth` de `@/lib/treasury/periods` (verificar los nombres exportados reales antes de importar).
- Produces en `references.ts` (debajo de lo existente, mismo estilo):

```ts
/** Preapproval que SIGeV crea para un SOCIO existente desde su panel (M5B).
 *  El formato estaba reservado desde la 4B (docs/06 §2). Los cobros NO se
 *  resuelven por esta referencia —la fila local nace con memberId y la regla 3
 *  de resolve.ts ("la suscripción manda") los imputa sola—: la referencia es
 *  para el operador que mira MP o la bandeja, no para la imputación. */
export const MEMBER_SUBSCRIPTION_REF = /^socio:(\d+)$/;

export function memberSubscriptionReference(memberId: number): string {
  if (!Number.isInteger(memberId) || memberId <= 0) throw new Error("memberId inválido");
  return `socio:${memberId}`;
}

export function parseMemberSubscriptionReference(ref: string | null | undefined): number | null {
  const m = ref?.match(MEMBER_SUBSCRIPTION_REF);
  const id = m ? Number(m[1]) : null;
  return id && id > 0 ? id : null;
}
```

- Produces en `debit-adhesion.ts` (puro):

```ts
export const ADHESION_BLOCKING_TYPES: readonly PaymentType[] = ["debit", "link", "cash", "entry"];

export type AdhesionVerdict =
  | { ok: true }
  | { ok: false; reason: "category" | "active_subscription" | "no_email" }
  | { ok: false; reason: "paid_this_month"; availableFrom: Date };

export function adhesionVerdict(input: {
  category: MemberCategory;
  email: string | null;
  subscriptionStatuses: string[];
  paidThisMonth: boolean;   // el llamador cuenta pagos applied de ADHESION_BLOCKING_TYPES en el mes civil AR
  at: Date;
}): AdhesionVerdict;

/** El 1° del mes civil argentino siguiente, para el "podés adherirte desde el…". */
export function nextMonthStartAR(at: Date): Date;

export function adhesionBlockMessage(v: Exclude<AdhesionVerdict, { ok: true }>): string;
```

Orden de las guardas en `adhesionVerdict` (cada una con su porqué en prosa): (1) `!categoryPaysFee(category)` → `category`; (2) `subscriptionStatuses.some(canStillCharge)` → `active_subscription` (cierra para este camino el hueco del doble preapproval, `docs/06:469`); (3) `paidThisMonth` → `paid_this_month` con `availableFrom = nextMonthStartAR(at)` (la decisión #4/#15 del operador: pagó cuota — ingreso incluido — en el mes calendario → bloquea; la deuda NO bloquea: el primer débito la empieza a saldar); (4) `!email` → `no_email` (MP exige `payer_email`). `nextMonthStartAR`: derivar el período civil AR con las piezas de `periods.ts`; el instante devuelto es las 00:00 AR = 03:00Z del día 1 siguiente, mismo criterio que `monthBoundsAR` en `receipts-query.ts:35`. Mensajes (es-AR): `category` → "Tu categoría no paga cuota, así que no hay débito que adherir."; `active_subscription` → "Ya tenés un débito automático activo. Si querés cambiarlo, primero cancelalo."; `paid_this_month` → `` `Ya abonaste una cuota este mes. Podés adherirte desde el ${formatDateAR(v.availableFrom)}.` ``; `no_email` → "Para adherir el débito necesitás un email cargado en tu ficha. Cargalo en Mis datos.".

- [ ] **Step 1: Tests primero** — tabla de `adhesionVerdict` (vitalicio → category; sub `authorized`/`pending` → active_subscription; sub `cancelled` no bloquea; pagó este mes → paid_this_month con `availableFrom` = 1° del mes siguiente 03:00Z, probando también diciembre→enero; sin email → no_email; la deuda NO figura entre las entradas: la función ni la recibe), `nextMonthStartAR` (mes común + diciembre), referencias (`socio:298` parsea, `socio:0`/basura → null). → FAIL → implementar → PASS → **Commit** `feat(m5b): member subscription reference and pure adhesion verdict`

---

### Task 12: Servicio de adhesión y cancelación del débito

**Files:**
- Create: `src/lib/members/member-debit.ts`
- Test: `tests/member-debit.test.ts`

**Interfaces:**
- Consumes: `mpGateway` (`createPreapproval`, `getPreapproval`, `cancelPreapproval`) — inyectado como `MpGateway`-parcial; `subscriptionReason` de `@/lib/mp/reason`; `checkoutUrlFor` de `@/lib/mp/checkout`; `feeValueReader`/`feeAmountFor`; `adhesionVerdict`/`ADHESION_BLOCKING_TYPES`/`nextMonthStartAR` (Task 11); `memberSubscriptionReference`; `canStillCharge`, `isKnownDead`, `countChargeable` de `@/lib/mp/subscription-status` (`countChargeable` recibe `ReadonlyArray<{ status: string }>`); `upcomingPeriods` de `@/lib/treasury/upcoming`; el cálculo del mes civil AR (`Date.UTC(y, m-1, 1, 3)`) en un helper local comentado — `monthBoundsAR` es privada de `receipts-query.ts` y NO se exporta desde ahí.
- Produces: `makeMemberDebit(deps)` + singleton `memberDebit`:

```ts
start(input: { memberId: number }): Promise<
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string }>
preview(input: { memberId: number }): Promise<{ verdict: AdhesionVerdict; upcoming: Period[]; unit: number | null }>
syncStatus(input: { memberId: number }): Promise<{ status: string | null }>
cancel(input: { memberId: number; preapprovalId: string }): Promise<
  | { ok: true } | { ok: false; error: string }>
```

`deps`: `{ db: Pick<PrismaClient, "$transaction" | "member" | "mpSubscription" | "payment" | "fee" | "movement">, gateway: Pick<MpGateway, "createPreapproval" | "getPreapproval" | "cancelPreapproval">, feeValues: { current(at?: Date): Promise<FeeValueAmounts | null> }, baseUrl: () => string, now?: () => Date }` (`fee` y `movement` son para el `preview`). `preview` corre los pasos 1-4 de `start` sin tocar MP y devuelve el veredicto + `upcoming = upcomingPeriods(existingPeriods, member.joinedAt, readmittedAt)` — **tres parámetros en ese orden** (`upcoming.ts:23`) — con `existingPeriods` de `fee.findMany({ where: { memberId }, select: { period: true } })` y `readmittedAt` del `movement.findFirst({ where: { memberId, type: "readmission" }, orderBy: [{ date: "desc" }, { id: "desc" }], select: { date: true } })?.date ?? null` (calcado de `mi/cuenta/page.tsx:41-48`). Pantalla y action comparten el servicio: nunca divergen.

**`start`** (el corazón del CA-5B-1/2, calcando el rigor del wizard — `asociate/actions.ts:550-662`, leerlo antes):
1. Ficha viva: `member.findUniqueOrThrow({ select: { id, category, email, status } })`; `status !== "active"` → error genérico (defensa en profundidad: la action ya cortó al suspendido/cesante).
2. `paidThisMonth`: `payment.count({ where: { memberId, status: "applied", type: { in: ADHESION_BLOCKING_TYPES }, paidAt: { gte, lt } } }) > 0` con los límites del mes civil AR del helper local.
3. `subscriptionStatuses`: `mpSubscription.findMany({ where: { memberId }, select: { status: true } })`.
4. `adhesionVerdict(...)` — bloqueado → `{ ok: false, error: adhesionBlockMessage(v) }`.
5. `feeValues.current()` → sin valor → error "El valor de la cuota todavía no está publicado. Probá más tarde." (cortar ANTES de llamar a MP, patrón del wizard); `amount = feeAmountFor(category, value)`.
6. `gateway.createPreapproval({ reason: subscriptionReason(""), amount, payerEmail: member.email!, externalReference: memberSubscriptionReference(memberId), backUrl: `${baseUrl()}/mi/debito?volvio=1` })`.
7. `$transaction`: `mpSubscription.create({ preapprovalId: sub.id, memberId, planId: null, status: sub.status, payerEmail: member.email, amount: amount.toFixed(2), externalReference: memberSubscriptionReference(memberId), linkedManually: false, lastSyncAt: now() })` + `member.update({ data: { autoDebit: true } })` (porque `canStillCharge("pending")` — mismo criterio que `link-subscription.ts:75`). En el catch: `console.error` con el `preapprovalId` y el código (nunca el email) — la suscripción quedó viva en MP y sus cobros caerán a la bandeja por `no_subscription` (la red existente, spec §11) — y devolver error que NO invite a reintentar: "No pudimos registrar la adhesión. NO vuelvas a intentarlo: comunicate con la vecinal." (el reintento crearía un segundo preapproval).
8. `{ ok: true, checkoutUrl: checkoutUrlFor(sub.id) }`.

**`syncStatus`** (para la vuelta `?volvio=1`): la sub más nueva del socio (`findFirst orderBy { id: "desc" }` con `memberId`); si no hay → `{ status: null }`; `gateway.getPreapproval(preapprovalId)` fresco → `mpSubscription.update({ status: remote.status, lastSyncAt: now() })` → devolver el status. Errores de red → devolver el status local sin actualizar (best-effort; el checkout de suscripciones no usa `return-status.ts`, que es de Checkout Pro — spec §6.4).

**`cancel`**: la sub debe ser del socio (`findFirst({ where: { preapprovalId, memberId } })` — ajena → error genérico "La suscripción no existe.", sin oráculo); `isKnownDead(status)` → "Ese débito ya está cancelado."; `gateway.cancelPreapproval` (si tira → error "Mercado Pago no aceptó la cancelación. Probá más tarde o consultá en la sede." + `console.error("[mi/debito] cancelPreapproval —", mpErrorLog("cancelPreapproval", { memberId, preapprovalId }, e))` — `mpErrorLog` devuelve el string, no loguea); espejo local en su PROPIO try (patrón `withdraw-with-debits.ts:97`); `autoDebit: false` solo si `countChargeable(las demás subs del socio) === 0`.

- [ ] **Step 1: Tests con deps fakes** (patrón de inyección de `link-subscription`): bloqueo por sub viva no llama al gateway; bloqueo por pago del mes no llama al gateway; el happy path crea la fila con `memberId` puesto y `linkedManually: false` y prende `autoDebit`; el fallo de la transacción con preapproval ya creado devuelve el error de "no reintentar"; `cancel` ajeno no llama al gateway; `cancel` con espejo local fallando devuelve `ok: true` igual. → FAIL → implementar → PASS → suite entera.
- [ ] **Step 2: Commit** `feat(m5b): member debit service — adhesion, status sync and cancellation`

---

### Task 13: `/mi/debito` — pantalla, actions, pestaña condicionada e Inicio

**Files:**
- Create: `src/app/mi/debito/page.tsx`, `src/app/mi/debito/actions.ts`, `src/app/mi/debito/adhesion-form.tsx`, `src/app/mi/debito/cancelar/page.tsx`
- Modify: `src/lib/mi/nav.ts` (+pestaña con `paysFeeOnly`), `src/components/mi/mi-tabs.tsx` (+ícono `RefreshCw`), `src/app/mi/layout.tsx` (filtra la pestaña), `src/app/mi/page.tsx` (tarjeta de débito en el Inicio), `tests/mi-nav.test.ts`
- Test: `tests/mi-debito-actions.test.ts`

**Interfaces:**
- Consumes: `memberDebit` (Task 12 — la página pinta con `memberDebit.preview({ memberId })` y la action revalida adentro de `start`: pantalla y action nunca divergen porque comparten el servicio); `isNotCancelled`, `isCharging` de `@/lib/mp/subscription-status`; `cancelEffect`/`cancelEffectSentence` de `@/lib/mp/cancel-effect`; `describePeriods` de `@/lib/treasury/labels`; `memberPayLimiter` (cada intento llama a MP — mismo criterio que pagar); `formatARS`.
- Produces: `startDebitAction`, `cancelDebitAction` — `(prev, formData) => Promise<DebitState>` con `type DebitState = { error?: string; redirectUrl?: string; done?: boolean }`.

- [ ] **Step 1: Pestaña condicionada.** `MiTab` gana `paysFeeOnly?: boolean`; `MI_TABS` suma `{ href: "/mi/debito", label: "Débito automático", icon: "refresh-cw", paysFeeOnly: true }` entre "Mi cuenta" y "Mis datos"; helper puro `miTabsFor(paysFee: boolean): MiTab[]` que filtra; test de nav actualizado (vitalicio no ve la pestaña; activo sí). En `layout.tsx`: sumar una consulta `prisma.member.findUnique({ select: { category: true } })` y pasar `miTabsFor(categoryPaysFee(category))` a `MiTabs` (comentar que es display: la autorización real vive en página y actions). `mi-tabs.tsx` mapea `"refresh-cw": RefreshCw`.
- [ ] **Step 2: Tests de actions** (andamiaje de `mi-datos-actions.test.ts`, mockeando `@/lib/members/member-debit`): bloqueado/suspendido no llega al servicio (`requireMember` SIN `allowSuspended` — el suspendido no adhiere NI cancela); `memberId` del actor; `startDebitAction` devuelve `redirectUrl` del servicio; `cancelDebitAction` pasa `preapprovalId` del form + `memberId` del actor; audit sin URL en el detalle (aserción sobre el mock de audit). → FAIL.
- [ ] **Step 3: Actions.** `startDebitAction`: `requireMember()` → `memberPayLimiter.check` → `memberDebit.start({ memberId })` → si ok: audit `member_debit_adhesion` detail `{ memberId }` + IP (la URL del checkout NUNCA al asiento — precedente `payment_link_create`) → `{ redirectUrl: r.checkoutUrl }`. `cancelDebitAction`: zod `{ preapprovalId: z.string().regex(/^[A-Za-z0-9]{1,64}$/, "Suscripción inválida.") }` → `memberDebit.cancel({ memberId, preapprovalId })` → audit `member_debit_cancel` detail `{ preapprovalId }` → `revalidatePath("/mi/debito")` → `{ done: true }`. → PASS.
- [ ] **Step 4: Página `/mi/debito`.** Server, `requireMember({ allowSuspended: true })`, `dynamic = "force-dynamic"`, metadata "Débito automático — Vecinal Ciudadela". `canAct = actor.suspension === null`. Datos: ficha (`category`, `email`, `joinedAt`), subs (`findMany` con `isNotCancelled` para listar), `preview` del servicio, y si `?volvio=1` → `memberDebit.syncStatus` ANTES de leer las subs (comentar que el efecto en un GET es el mismo que hace la conciliación: sincronizar un espejo). Bloques con el lenguaje de la 5A (íconos, tarjetas): h1 + bajada; si `volvio`, `FormMessage` según el status fresco (`authorized` → success "¡Listo! Tu débito quedó autorizado."; `pending` → neutral "MP todavía está confirmando la autorización. Actualizá en un rato."; otro → warning); estado actual (Card por cada sub viva: badge `isCharging` → "Activo" success / si no "Pendiente" secondary, monto `formatARS`, y si `canAct` el link-botón a `/mi/debito/cancelar?preapproval={id}`; con 2+ vivas, `FormMessage kind="warning"`: "Tenés más de un débito vivo: consultá en la sede." — el sistema no crea el segundo, lo hereda); si NO hay viva: la tarjeta de adhesión — si el veredicto bloquea, `FormMessage` con `adhesionBlockMessage` (el de `paid_this_month` muestra la fecha); si pasa, `adhesion-form.tsx` (client, patrón `pay-form.tsx`): la "boleta previa" con `Cuota social · {formatARS(unit)} por mes`, la línea CLAVE de la spec §6.4 — "Tu primer débito cubre {describePeriods(upcoming.slice(0,1))}" (en contraste con el wizard, que dice "cuota de ingreso"; acá NUNCA es ingreso) —, aviso "Te lleva a Mercado Pago a autorizar el débito con tu tarjeta.", y botón `min-h-12` "Adherir el débito automático" con `useActionState` + `window.location.assign(state.redirectUrl)` (calcado de `pay-form.tsx:64-66`).
- [ ] **Step 5: `/mi/debito/cancelar`.** Página de confirmación: valida por querystring que el preapproval sea del socio (si no, `notFound()`); muestra la frase de efecto — **la firma real es `cancelEffectSentence({ effect, amountLabel, statusLabel })`** (`cancel-effect.ts:54`), no el `CancelEffect` suelto: calcar cómo la arma su llamador existente en `/admin/tesoreria/suscripciones/[preapprovalId]/cancelar` — + "Podés seguir pagando por link o en la sede, y volver a adherirte cuando quieras." + form con hidden `preapprovalId` y botón `variant="destructive"` "Cancelar el débito" con confirm (+ link "Volver"). El suspendido no llega a actuar (la action corta) y la página le esconde el botón (`canAct`).
- [ ] **Step 6: Inicio.** En `mi/page.tsx`, entre la tarjeta de cuenta y los QuickLinks, tarjeta "Débito automático" (solo si `paysFee`): consulta liviana de subs → "Activo" (success) / "Pendiente de autorización" / "No estás adherido" + link CTA `/mi/debito` ("Ver mi débito →" / "Adherirme →"). Reutilizar `LINK_CTA`.
- [ ] **Step 7: QA en navegador** (local): vitalicio no ve la pestaña (cambiar categoría de un socio de prueba por SQL y volver); Rodrigo (activo, sin subs, sin pagos del mes) ve la tarjeta de adhesión con "tu primer débito cubre septiembre 2026"; sembrar un pago `cash` de este mes por SQL → el botón se bloquea con "Podés adherirte desde el 01/09/2026" → limpiar. **El checkout real NO se prueba acá** (es la Task 14, en sandbox). Suite + lint + build.
- [ ] **Step 8: Commit** `feat(m5b): member debit screen — adhesion, status and cancellation`

---

### Task 14: Verificación final de la fase (CA-5B) + docs

**Files:** docs (`docs/06`, `docs/07`, spec §13, `CLAUDE.md`) + ledger. Sin código nuevo salvo fixes de QA.

- [ ] **Step 1: Suite, lint, build** — todo verde; el núcleo intocado: `git diff main..HEAD -- src/lib/treasury src/lib/mp/resolve.ts src/lib/mp/webhook-processor.ts src/lib/mp/gateway.ts src/components/admin/account-section.tsx tests/integration` → vacío; `references.ts` solo con agregados; `src/app/admin/solicitudes/actions.ts` con el diff acotado a lo que las Tasks 9-10 listan (nada de las tres actions de altas).
- [ ] **Step 2: CA-5B-1 en sandbox local (CON EL OPERADOR).** Requiere las credenciales de la cuenta de prueba de MP y el túnel de cloudflared (`docs/11` Parte J; actualizar `DEV_TUNNEL_ORIGINS` en `next.config.ts` con el dominio del túnel de la corrida). Con `.env` apuntando al token de sandbox: un socio de prueba se adhiere desde `/mi/debito`, autoriza en el checkout de MP con la tarjeta de prueba, y el débito entra SOLO por el webhook como cuota común (la más vieja pendiente o el mes siguiente), con recibo — verificar en la base que el `Payment` es `type: "debit"` y NUNCA `entry`, y que `MpSubscription` quedó `authorized` con `memberId`. **PAUSAR y pedir al operador** lo que falte (tarjeta de prueba, túnel).
- [ ] **Step 3: CA-5B-2**: con el pago del débito recién aplicado, `/mi/debito` bloquea por `active_subscription`; cancelar la sub de sandbox → ahora bloquea por `paid_this_month` con la fecha del mes próximo. Documentar con capturas.
- [ ] **Step 4: CA-5B-3 y CA-5B-4** ya verificados en las Tasks 9 y 10; re-correr el circuito de categoría con un socio CON sub de sandbox viva y monto distinto para ver el push a MP en vivo (o dejar constancia del test unitario + el log del gateway si el sandbox no lo permite).
- [ ] **Step 5: Docs.** `docs/06` §2: `socio:{id}` pasa de reservado a en uso (nota fechada). `docs/07`: fase 5B cerrada con su lista y CA (incluido el rediseño de la bandeja unificada y el ítem 8 cerrado con el chip de domicilio), estilo de las fases previas; Módulo 5 COMPLETO. Spec §13: enmiendas nuevas si las hubo. `CLAUDE.md`: prioridad actual → Módulo 6; sumar al bloque de patrones del M5 lo que estrenó la 5B (la adhesión que se apoya en la regla 3, el veredicto puro compartido pantalla/action, `member_requests` con mutex, la sección de solicitudes unificada). Actualizar el ledger.
- [ ] **Step 6: Commit final** `docs(m5b): phase 5B closed — self-service debit, member requests and unified inbox` y ofrecer el merge con `superpowers:finishing-a-development-branch`.

---

## Self-Review (aplicado, actualizado tras la enmienda del 24/08 a la noche)

- **Cobertura de spec 5B + enmienda**: §4.1 modelo (T2 ✔), §6.1-6.5 débito (T11-T13), §7.1 socio (T3-T5 ✔), §7.2 bandeja UNIFICADA + acta + MP (T6-T8 nuevas, T9, T10), §11 núcleo intocado (constraints + T14), CA-5B-1..4 (T14, T9, T10). Rediseño de Altas: decisiones del operador del 24/08 a la noche (pestañas Altas|De socios con contadores, tarjetas apiladas, Pendientes|Historial, barra de asiento fija, detalle con visor embebido, chip de domicilio — cierra docs/07 ítem 8). Contador también en el tablero sin tocar `dashboard-cards.ts` (estático y testeado).
- **Sin placeholders**: los pasos que dependen de archivos vivos nombran el archivo y el patrón exacto a calcar, con la regla de adaptación ("si la forma real difiere, gana la del archivo") que la 5A validó.
- **Consistencia de tipos**: `AdhesionVerdict` (T11) lo consumen T12/T13; `memberRequests` (T4 ✔) lo consumen T8/T9; `subscriptionAmountPlan` (T10) solo lo consume `changeCategoryAction`; `SolicitudesTabs` (T6) lo consume su layout; el mapeo badge/ícono de requests se comparte entre `/mi/solicitudes` y T8.
- **Riesgos señalados**: el rediseño de Altas es de presentación y la suite existente es el detector (T6 Step 7: si un test de applications falla, se corrige el rediseño, no el test); los names del form de asiento son el contrato con la action intacta (T6 Step 5); `/admin/solicitudes/socios` convive con `[id]` porque el segmento estático gana al dinámico en Next; el push a MP en T10 corre dentro de `run` (post-acta) con compensación best-effort; el GET con efecto de `syncStatus` en T13 está comentado y acotado al espejo.
