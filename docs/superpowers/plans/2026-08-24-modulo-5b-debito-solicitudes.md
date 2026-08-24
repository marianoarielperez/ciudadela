# Módulo 5 — Fase 5B: Débito automático autogestionado y solicitudes de socios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El socio se adhiere y cancela su débito automático desde `/mi/debito` (con la regla anti-duplicación mensual), y pide su baja (REG-19) o su cambio de categoría (REG-07) desde `/mi/solicitudes`; la CD decide desde una bandeja nueva del panel admin que desemboca precargada en los flujos con acta existentes, actualizando el monto en Mercado Pago en el acto cuando corresponde.

**Architecture:** Tabla nueva `member_requests` + servicio con mutex por socio; la adhesión crea el preapproval con la fila `MpSubscription` naciendo con `memberId` puesto, así los cobros entran por la **regla 3 existente** de `resolve.ts` sin tocarla; la aceptación admin reutiliza `runAction`/`withdrawWithDebits`/`changeCategory` con un `requestId` opcional. Reglas de negocio como funciones puras testeadas aparte (`debit-adhesion`, `member-requests/rules`).

**Tech Stack:** Next.js 16 App Router, React 19 (`useActionState`), Prisma 7 + MariaDB, `mpGateway` existente (`createPreapproval`/`cancelPreapproval`/`getPreapproval`/`updatePreapprovalAmount`), vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-modulo-5-panel-socio-design.md` §4, §6, §7 y §12 (CA-5B). Ledger de la 5A: `.superpowers/sdd/progress.md`.

## Global Constraints

- UI en **es-AR con "vos"**; código, variables y commits en **inglés**. Commits terminan con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (línea en blanco antes).
- **Núcleo de dinero intocable**: `src/lib/treasury/*`, `src/lib/mp/resolve.ts`, `src/lib/mp/webhook-processor.ts`, `src/lib/mp/gateway.ts`, `src/lib/mp/payment-link*.ts`, `src/lib/mp/reconcile.ts`, `src/lib/mp/link-subscription.ts`, `src/components/admin/account-section.tsx` y `tests/integration/*` NO se modifican — solo se importan. Excepción acotada: `src/lib/mp/references.ts` admite **agregados aditivos** (el formato `socio:{id}` que `docs/06:112` dejó reservado); las regex y funciones existentes no se tocan.
- **El `memberId` de toda action de socio sale de `requireMember()`, nunca del formulario.** El `requestId`/`preapprovalId` que sí viajan en formularios se revalidan contra la base ANTES de actuar (pertenencia + estado).
- Matriz del suspendido (spec §5): páginas de `/mi` con `{ allowSuspended: true }`; **ninguna** action nueva de esta fase la pasa — el suspendido no adhiere, no cancela, no solicita ni retira. El cesante bloqueado en todo, como siempre.
- Auditoría y logs: ids, códigos y flags — **nunca** DNI, email, teléfono, domicilio ni la URL de un checkout (Ley 25.326). Los `preapprovalId` sí pueden ir al asiento (id de MP, no dato personal — precedente en `withdrawAction`).
- Targets ≥48px (`min-h-12`) en `/mi`; foco `outline-hidden` + `focus-visible:ring-2 focus-visible:ring-ring`; colores solo por tokens; prohibidos `--sidebar-*` y verde/ámbar crudo. Light-only.
- Migraciones con `npx prisma migrate dev` — nunca `db push`.
- **Nunca probar cobros en producción.** El circuito MP se prueba en sandbox local con túnel (`docs/11` Parte J); el CA-5B-1 se cierra ahí con ayuda del operador.
- **El resumen diario NO informa hoy nada de `member_requests`** (`src/lib/admin/digest.ts:60-72`: sus renglones son pagos, `Application` del wizard, bandeja sin conciliar, notificaciones fallidas, crons y webhooks). Esta fase NO modifica el digest: el canal real de aviso a la CD es la bandeja `/admin/solicitudes-socios` + su tarjeta del panel (enmienda a la spec §7.2, que suponía el digest).
- Tests: `npx vitest run` (suite), `npm run lint`, `npm run build` antes de cada commit de tarea.
- Rama de trabajo: `m5b-debit-requests` creada desde `main`.

---

### Task 1: Herencias de la 5A (targets táctiles y dos minors)

**Files:**
- Modify: `src/app/mi/datos/contact-form.tsx`, `src/app/mi/datos/address-form.tsx`, `src/app/mi/datos/email-form.tsx`, `src/app/mi/not-found.tsx`, `src/app/admin/socios/[id]/actions.ts` (solo `confirmAddressAction`)

**Interfaces:** nada nuevo — cierra hallazgos de la revisión final de la 5A.

- [ ] **Step 1: Inputs de `/mi/datos` a 48px.** `TextField` reenvía `className` al `Input` (`src/components/admin/synced-fields.tsx`). En los tres formularios, cada `TextField` gana `className="h-12"` (Teléfono, Altura, Barrio, Email nuevo). El `StreetAutocomplete` es componente compartido del admin y NO se toca: en `address-form.tsx` envolvelo así, con el porqué comentado:

```tsx
      {/* El autocompletado es del panel admin (32px, mouse); acá se opera con el
          pulgar. Las variantes arbitrarias suben input y opciones a 48px sin
          tocar el componente compartido. */}
      <div className="[&_input]:h-12 [&_input]:text-base [&_li>button]:min-h-12">
        <StreetAutocomplete
          streets={props.streets}
          defaultStreetId={props.streetId}
          defaultStreetText={props.streetText}
        />
      </div>
```

- [ ] **Step 2: `not-found.tsx` dice la verdad.** Agregar al tope del archivo:

```tsx
// Frontera preparada para la 5B (/mi/solicitudes/[id] y /mi/debito llaman
// notFound() sobre ids ajenos). Una URL sin ruta la atiende el not-found RAÍZ,
// no éste: esta frontera solo se activa con un notFound() explícito del segmento.
```

- [ ] **Step 3: `confirmAddressAction` no explota con un POST fabricado.** El `prisma.member.update` va en `try/catch` que ignora el P2025 (ficha inexistente: solo alcanzable fabricando el POST; no merece pantalla de error):

```ts
  try {
    await prisma.member.update({ where: { id: memberId }, data: { addressPendingReview: false } });
  } catch {
    return; // ficha inexistente: solo un POST fabricado llega acá
  }
```

- [ ] **Step 4: Verificar y commitear**

Run: `npx vitest run` → PASS (2349); `npm run lint` limpio; en el navegador, los cuatro campos de `/mi/datos` y las opciones del autocompletado miden ≥48px.

```bash
git add src/app/mi src/app/admin/socios
git commit -m "fix(m5b): 48px touch targets on member data inputs and 5A review leftovers"
```

---

### Task 2: Modelo `member_requests` + tipos de notificación

**Files:**
- Modify: `prisma/schema.prisma` (dos enums + un modelo + dos valores de `NotificationType` + relaciones inversas en `Member`, `User` y `Movement`), `src/lib/members/labels.ts`
- Create: migración `member_requests`
- Test: la suite entera compilando (los `Record<NotificationType, string>` exhaustivos rompen sin las etiquetas nuevas)

**Interfaces:**
- Produces: modelo `MemberRequest` con enums `MemberRequestType` (`withdrawal | category_change`) y `MemberRequestStatus` (`pending | accepted | rejected | cancelled`); `NotificationType` gana `request_accepted` y `request_rejected`; `REQUEST_TYPE_LABELS` y `REQUEST_STATUS_LABELS` en labels.

- [ ] **Step 1: Schema.** Junto a los otros enums de socios:

```prisma
enum MemberRequestType {
  withdrawal
  category_change
}

enum MemberRequestStatus {
  pending
  accepted
  rejected
  cancelled
}
```

En `enum NotificationType`, después de `payment_rejected`:

```prisma
  request_accepted
  request_rejected
```

Modelo nuevo (después de `Movement`), espejo de la spec §4.1:

```prisma
// Solicitudes que el socio presenta desde su panel (M5B): baja (REG-19) y
// cambio de categoría (REG-07). La CD las decide con acta desde la bandeja;
// `text` conserva el escrito de la renuncia con su timestamp, que es lo que
// REG-19 exige que quede. "Una pendiente por tipo por socio" se garantiza en
// la transacción de creación (MariaDB no tiene unique parcial).
model MemberRequest {
  id                Int                  @id @default(autoincrement())
  memberId          Int                  @map("member_id")
  member            Member               @relation(fields: [memberId], references: [id], onDelete: Cascade)
  type              MemberRequestType
  status            MemberRequestStatus  @default(pending)
  requestedCategory MemberCategory?      @map("requested_category")
  message           String?              @db.VarChar(500)
  text              String               @db.VarChar(2000)
  createdAt         DateTime             @default(now()) @map("created_at")
  decidedAt         DateTime?            @map("decided_at")
  decidedById       Int?                 @map("decided_by_id")
  decidedBy         User?                @relation("MemberRequestDecider", fields: [decidedById], references: [id], onDelete: SetNull)
  decisionNote      String?              @map("decision_note") @db.VarChar(500)
  cancelledAt       DateTime?            @map("cancelled_at")
  movementId        Int?                 @map("movement_id")
  movement          Movement?            @relation(fields: [movementId], references: [id], onDelete: SetNull)

  @@index([memberId, status])
  @@index([status, type])
  @@map("member_requests")
}
```

Agregar las relaciones inversas: `memberRequests MemberRequest[]` en `Member`, `decidedRequests MemberRequest[] @relation("MemberRequestDecider")` en `User`, `memberRequests MemberRequest[]` en `Movement`.

- [ ] **Step 2: Migrar.** `npx prisma migrate dev --name member_requests` (Docker arriba). Verificar el SQL generado: tabla nueva + los dos valores de enum — nada más.

- [ ] **Step 3: Etiquetas.** En `src/lib/members/labels.ts`: a `NOTIFICATION_TYPE_LABELS` sumarle `request_accepted: "Solicitud aceptada", request_rejected: "Solicitud rechazada",` y agregar:

```ts
export const REQUEST_TYPE_LABELS: Record<MemberRequestType, string> = {
  withdrawal: "Baja por renuncia", category_change: "Cambio de categoría",
};
export const REQUEST_STATUS_LABELS: Record<MemberRequestStatus, string> = {
  pending: "Pendiente", accepted: "Aceptada", rejected: "Rechazada", cancelled: "Retirada",
};
```

(importando los dos tipos nuevos). Correr `npx vitest run` y `npm run build`: si algún otro `Record<NotificationType, …>` exhaustivo existe en el repo (grep `Record<NotificationType`), completarlo — es el único cambio permitido fuera de los archivos listados.

- [ ] **Step 4: Commit**

```bash
git add prisma src/lib/members/labels.ts
git commit -m "feat(m5b): member_requests model and request notification types"
```

---

### Task 3: Reglas puras de solicitudes

**Files:**
- Create: `src/lib/members/member-requests/rules.ts`
- Test: `tests/member-requests-rules.test.ts`

**Interfaces:**
- Consumes: `RuleResult` (mismo shape `{ ok: true } | { ok: false; error: string }` que `src/lib/members/rules.ts` — leelo y reutilizá el tipo si está exportado; si no, redeclaralo estructural).
- Produces:

```ts
export const REQUESTABLE_CATEGORIES: readonly MemberCategory[] = ["active", "adherent", "collaborator"];

export function canCreateRequest(input: {
  type: MemberRequestType;
  member: { status: MemberStatus; category: MemberCategory };
  requestedCategory: MemberCategory | null;   // solo category_change
  electionsOngoing: boolean;                  // solo category_change
  pendingFees: number;                        // solo category_change (REG-07)
  hasPendingOfType: boolean;
}): RuleResult;

export function renderWithdrawalText(input: {
  fullName: string;
  memberNumber: number | null;
  date: Date;            // se formatea con formatDateAR
  message: string | null;
}): string;
```

Semántica de `canCreateRequest`, en orden: (1) `status !== "active"` → "Solo un socio vigente puede presentar solicitudes." (el suspendido no opera — REG-20 — y el cesante no llega); (2) `hasPendingOfType` → "Ya tenés una solicitud pendiente de este tipo. Podés retirarla desde tu panel."; para `category_change` además: (3) `requestedCategory` nulo o fuera de `REQUESTABLE_CATEGORIES` → "Elegí la categoría nueva."; (4) igual a la actual → "Esa ya es tu categoría."; (5) `electionsOngoing` → el mismo motivo del Art. 5° ter que usa `canChangeCategory` (leé `src/lib/members/rules.ts` y usá un texto consistente); (6) `pendingFees > 0` → "Registrás N cuotas pendientes: tenés que saldarlas antes de pedir el cambio (Art. 5° ter).". Para `withdrawal` no hay más guardas: renunciar con deuda es un derecho — la deuda queda asentada al aceptar la baja (flujo existente).

`renderWithdrawalText` produce el escrito formal (texto plano, es-AR, sin HTML — la CSP no ataja XSS almacenado y este texto se renderiza siempre como texto):

```
Comodoro Rivadavia, {DD/MM/AAAA}.
A la Comisión Directiva de la Asociación Vecinal del Barrio Ciudadela:
Por la presente, {fullName} (socio N° {memberNumber ?? "s/n"}) solicita la baja
por renuncia de su condición de socio, conforme al estatuto.
{message ? `Motivo declarado: ${message}` : ""}
Presentada electrónicamente desde el panel de socio.
```

- [ ] **Step 1: Test primero** (`tests/member-requests-rules.test.ts`) — tabla de casos: vigente puede pedir baja; suspendido no; pendiente duplicada bloquea (por tipo: una baja pendiente NO bloquea un cambio de categoría); cambio a la misma categoría bloquea; a `cadet` bloquea; con elecciones bloquea; con 2 cuotas pendientes bloquea con el número en el mensaje; adherente→activo con deuda 0 pasa; el texto de la renuncia contiene nombre, `N° 15`, la fecha formateada y el motivo cuando hay, y `"s/n"` cuando no hay número.
- [ ] **Step 2: FAIL** → **Step 3: implementar** (módulo puro, sin Prisma; comentario de cabecera con el porqué de cada guarda en prosa) → **Step 4: PASS** → **Step 5: Commit** `feat(m5b): pure rules for member requests`

---

### Task 4: Servicio de solicitudes (con mutex por socio)

**Files:**
- Create: `src/lib/members/member-requests/service.ts`
- Test: `tests/member-requests-service.test.ts`

**Interfaces:**
- Consumes: `canCreateRequest`, `renderWithdrawalText` (Task 3); `createKeyedMutex` de `@/lib/keyed-mutex`; `electionsOngoing(prisma)` de `@/lib/members/service` (solo en el singleton ligado — el factory lo recibe inyectado).
- Produces: `makeMemberRequests(deps)` y singleton `memberRequests`, con:

```ts
create(input: { memberId: number; type: MemberRequestType; requestedCategory?: MemberCategory | null; message?: string | null })
  : Promise<{ ok: true; requestId: number } | { ok: false; error: string }>
cancel(input: { memberId: number; requestId: number })
  : Promise<{ ok: true } | { ok: false; error: string }>
markAccepted(input: { requestId: number; memberId: number; decidedById: number; type: MemberRequestType }): Promise<void>
reject(input: { requestId: number; decidedById: number; note?: string | null })
  : Promise<{ ok: true; memberId: number; type: MemberRequestType } | { ok: false; error: string }>
```

Puntos duros:
- `deps`: `{ db: Pick<PrismaClient, "$transaction" | "memberRequest" | "member" | "fee" | "movement">, electionsOngoing: () => Promise<boolean>, now?: () => Date }` — inyectado para testear con fakes, patrón `makeSubscriptionLinker`.
- `create` corre BAJO un mutex propio por socio (`createKeyedMutex()` a nivel módulo, clave `request:{memberId}`) y DENTRO de una `$transaction`: relee la ficha viva, cuenta `memberRequest.count({ where: { memberId, type, status: "pending" } })` y `fee.count({ where: { memberId, status: "pending" } })`, corre `canCreateRequest`, y recién ahí crea la fila (para `withdrawal`, `text = renderWithdrawalText(...)` con el número del libro abierto — traer `memberships` como hace `mi/page.tsx`; para `category_change`, `text` describe el pedido: `"Solicita el cambio de categoría de {actual} a {pedida}."` con las etiquetas de `CATEGORY_LABELS`). El mutex + la cuenta dentro de la transacción son la garantía "una pendiente por tipo" (spec §4.1).
- `cancel`: `updateMany({ where: { id, memberId, status: "pending" }, data: { status: "cancelled", cancelledAt: now } })`; `count === 0` → `{ ok: false, error: "La solicitud ya fue resuelta o no existe." }` (el `memberId` en el where es la guarda de pertenencia: nunca se cancela la solicitud de otro).
- `markAccepted`: `update` a `accepted` + `decidedAt/decidedById` + `movementId` = el `Movement` más nuevo del socio cuyo `type` corresponda (`withdrawal` → `"withdrawal"`, `category_change` → `"category_change"`; `findFirst orderBy [{date:"desc"},{id:"desc"}]`) — se llama DESPUÉS de que el servicio estatutario commiteó, así que ese movimiento existe.
- `reject`: solo sobre `pending`; devuelve `memberId` y `type` para que el llamador notifique.

- [ ] **Step 1: Tests primero** con un fake de `db` (objetos con `vi.fn`): una pendiente por tipo (dos `create` seguidos del mismo tipo → el segundo falla; de tipos distintos → ambos pasan); `cancel` ajeno no cancela; `markAccepted` toma el movimiento más nuevo del tipo correcto; `create` de baja guarda el texto con el nombre. → **Step 2: FAIL** → **Step 3: implementar** → **Step 4: PASS + suite entera** → **Step 5: Commit** `feat(m5b): member requests service with per-member mutex`

---

### Task 5: `/mi/solicitudes` — página, formularios y actions del socio

**Files:**
- Create: `src/app/mi/solicitudes/page.tsx`, `src/app/mi/solicitudes/actions.ts`, `src/app/mi/solicitudes/request-forms.tsx`
- Modify: `src/lib/mi/nav.ts` (+pestaña), `src/components/mi/mi-tabs.tsx` (+ícono `FileText`), `tests/mi-nav.test.ts`
- Test: `tests/mi-solicitudes-actions.test.ts`

**Interfaces:**
- Consumes: `memberRequests` (Task 4); `requireMember` (páginas con `allowSuspended`, actions SIN); `memberEditLimiter`; `parseForm`; `audit`; `REQUEST_TYPE_LABELS`/`REQUEST_STATUS_LABELS`/`CATEGORY_LABELS`; `REQUESTABLE_CATEGORIES` (Task 3); `formatDateTimeAR` de `@/lib/format`; `FormMessage`, `EmptyState`, `Card*`, `Badge`, `Button`.
- Produces: `createWithdrawalRequestAction`, `createCategoryRequestAction`, `cancelRequestAction` — firma `(prev: RequestState, formData: FormData) => Promise<RequestState>` con `type RequestState = { error?: string; done?: boolean; message?: string }`.

- [ ] **Step 1: Pestaña.** En `MI_TABS` (entre "Mis datos" y "Estatuto"): `{ href: "/mi/solicitudes", label: "Solicitudes", icon: "file-text" }`; `MiTabIcon` gana `"file-text"`; `ICONS` de `mi-tabs.tsx` gana `"file-text": FileText`. Test de nav: actualizar el conteo/orden si asevera.

- [ ] **Step 2: Tests de actions primero** (`tests/mi-solicitudes-actions.test.ts`, mismo andamiaje de mocks que `tests/mi-datos-actions.test.ts` — mockear `@/lib/members/member-requests/service` con `create`/`cancel` `vi.fn`): (a) actor bloqueado no llega al servicio; (b) `requireMember` llamado SIN `allowSuspended` en las tres; (c) el `memberId` sale del actor aunque el form traiga otro; (d) `cancelRequestAction` pasa `requestId` del form + `memberId` del actor; (e) categoría fuera de `REQUESTABLE_CATEGORIES` → error sin tocar el servicio. → FAIL.

- [ ] **Step 3: Actions.**

```ts
// src/app/mi/solicitudes/actions.ts
"use server";
// Solicitudes del socio (M5B, spec §7.1). El memberId sale de requireMember(),
// nunca del formulario; el suspendido no presenta ni retira (REG-20). La regla
// "una pendiente por tipo" vive en el SERVICIO, bajo su mutex — acá solo se
// parsea, se llama y se audita (ids y flags, nunca el texto del socio).
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { memberEditLimiter } from "@/lib/auth/rate-limiter";
import { requireMember } from "@/lib/auth/require-member";
import { parseForm } from "@/lib/forms";
import { REQUESTABLE_CATEGORIES } from "@/lib/members/member-requests/rules";
import { memberRequests } from "@/lib/members/member-requests/service";

export type RequestState = { error?: string; done?: boolean; message?: string };

const RATE_MSG = "Demasiados intentos seguidos. Esperá un minuto y volvé a probar.";

async function auditRequest(userId: number, memberId: number, action: string, detail: Record<string, unknown>) {
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({ userId, action, entity: "member", entityId: memberId, detail, ip });
}
```

`createWithdrawalRequestAction`: schema `{ message: z.string().max(500, "El motivo no puede superar los 500 caracteres").optional() }` → `memberRequests.create({ memberId: actor.memberId, type: "withdrawal", message })` → audit `member_request_create` detail `{ type: "withdrawal", requestId }` → `revalidatePath("/mi/solicitudes")` → `{ done: true, message: "Tu solicitud de baja quedó presentada. Es efectiva cuando la Comisión la acepte con acta; mientras tanto podés retirarla." }`.
`createCategoryRequestAction`: schema `{ requestedCategory: z.enum(["active","adherent","collaborator"], { error: "Elegí la categoría nueva." }), message: … }` → `create({ …, type: "category_change", requestedCategory })` → mismo esquema de audit/revalidate/mensaje.
`cancelRequestAction`: schema `{ requestId: z.coerce.number().int().positive() }` → `memberRequests.cancel({ memberId: actor.memberId, requestId })` → audit `member_request_cancel` `{ requestId }` → revalidate → `{ done: true, message: "Solicitud retirada." }`.
Las tres: `requireMember()` estricto + `memberEditLimiter.check(String(actor.memberId))`.

- [ ] **Step 4: PASS los tests.**

- [ ] **Step 5: Página + formularios.** `page.tsx` (server): `requireMember({ allowSuspended: true })`; `canAct = actor.suspension === null`; carga en paralelo la ficha (`category`, para el `ChoiceCard` de categorías) y `prisma.memberRequest.findMany({ where: { memberId }, orderBy: { id: "desc" }, take: 20 })`. Estructura: h1 "Solicitudes" + bajada; lista de solicitudes como `Card`s (tipo con `REQUEST_TYPE_LABELS`, badge de estado — `pending` → `default`, `accepted` → `success`, `rejected` → `destructive`, `cancelled` → `secondary` —, `formatDateTimeAR(createdAt)`, el `text` en `<p className="whitespace-pre-line text-sm">`, `decisionNote` si hay, y para las `pending` con `canAct` el form de retiro con confirmación nativa del botón); `EmptyState` si no hay ninguna; abajo, si `canAct`, las dos tarjetas de creación (`request-forms.tsx`, client): la de baja (textarea motivo opcional + aviso "la baja es efectiva cuando la Comisión la acepte con acta") y la de categoría (radios estilo `ChoiceCard` simple con las opciones de `REQUESTABLE_CATEGORIES` menos la actual, con `CATEGORY_LABELS`). Botones `min-h-12`; `useActionState`; `FormMessage` para error/éxito. Suspendido: ve la lista, sin formularios.

- [ ] **Step 6: Verificar en navegador** (socio Rodrigo local): crear una solicitud de categoría, verla pendiente, retirarla; crear una de baja y DEJARLA pendiente (la usa la Task 7). Suite + lint + build.

- [ ] **Step 7: Commit** `feat(m5b): member-facing requests screen and actions`

---

### Task 6: Bandeja admin "Solicitudes de socios"

**Files:**
- Create: `src/app/admin/solicitudes-socios/page.tsx`, `src/app/admin/solicitudes-socios/actions.ts`
- Modify: `src/lib/admin/nav.ts`, `src/components/admin/admin-nav-list.tsx` (ícono), `src/lib/admin/dashboard-cards.ts`
- Test: los existentes `tests/admin-nav.test.ts` / `tests/dashboard-cards.test.ts` siguen verdes (verifican la correspondencia nav↔tarjetas)

**Interfaces:**
- Consumes: `requireAdmin`; `memberRequests.reject` (Task 4); labels (Task 2); `PageHeader`, `EmptyState`, `Badge`, `FormMessage`, `Button`; `formatDateTimeAR`.
- Produces: ruta `/admin/solicitudes-socios` (href SIN el prefijo `/admin/socios` a propósito: `isNavItemActive` marca por prefijo y `/admin/socios/...` encendería dos ítems a la vez); `rejectRequestAction`.

- [ ] **Step 1: Nav + tarjeta.** En `ADMIN_NAV`, grupo Gestión, entre Socios y Tesorería: `{ href: "/admin/solicitudes-socios", label: "Solicitudes de socios", icon: "user-check" }` (`AdminNavIcon` gana `"user-check"`; en `admin-nav-list.tsx` importar `UserCheck` de lucide y mapearlo). En `DASHBOARD_GROUPS`, tarjeta con `title: "Solicitudes de socios"` (idéntico al label — lo verifica el test), `description: "Bajas y cambios de categoría pedidos por los socios desde su panel."`, `href`, `cta: "Ver los pedidos"`. Correr los dos tests de sincronía.

- [ ] **Step 2: Página.** `requireAdmin()` (admin común — la bandeja es trabajo diario, no de superadmin). `PageHeader title="Solicitudes de socios"` con miga `[{ label: "Solicitudes de socios" }]`. Filtro por estado vía querystring (`?estado=pendientes|resueltas`, default pendientes — links tipo chip, patrón de filtros existente en Deudores). Consulta con `include: { member: { select: { id, fullName, category, memberships: { select: { memberNumber, book: { select: { status } } } } } } }`, orden `{ id: "desc" }`. Cada fila (Card): socio (link a la ficha `/admin/socios/{id}`), N° del libro abierto, tipo, fecha, el `text` completo (`whitespace-pre-line`), y para las `pending` dos salidas: **Aplicar** (link-botón al flujo con acta precargado — baja: `/admin/socios/{memberId}/baja?solicitud={id}`; categoría: `/admin/socios/{memberId}/categoria?solicitud={id}`) y **Rechazar** (form inline con `decisionNote` opcional, max 500, y botón `variant="outline"`). `EmptyState size="list"` si la vista queda vacía.

- [ ] **Step 3: `rejectRequestAction`** (en `actions.ts` nuevo): `requireAdmin` → zod `{ requestId, note? }` → `memberRequests.reject({ requestId, decidedById: actor.actorId, note })` → si ok: notificar al socio (best-effort — ver el bloque de notificación de la Task 7, que esta action reutiliza importándolo) → audit `member_request_reject` detail `{ requestId, type }` + IP → `revalidatePath("/admin/solicitudes-socios")`. (Mirar cómo `confirmAddressAction` obtiene el actor y audita en `socios/[id]/actions.ts` y copiar la forma exacta.)

- [ ] **Step 4: Verificar en navegador** (sesión admin local): la bandeja lista la solicitud de baja pendiente de la Task 5; rechazarla con nota la mueve a resueltas y el socio la ve "Rechazada" con la nota en `/mi/solicitudes`. Volver a crear una pendiente para la Task 7. Suite + lint + build.

- [ ] **Step 5: Commit** `feat(m5b): admin inbox for member requests with reject flow`

---

### Task 7: Aceptación precargada en los flujos con acta + aviso al socio

**Files:**
- Create: `src/lib/members/member-requests/notify.ts`, plantilla en `src/lib/email/templates.ts` (agregado al final, mismo estilo de las existentes)
- Modify: `src/app/admin/socios/[id]/actions.ts` (`withdrawAction` y `changeCategoryAction`: `requestId` opcional), `src/app/admin/socios/[id]/[accion]/page.tsx` (precarga), `src/app/admin/socios/[id]/action-form.tsx` (prop `hidden` — ver Step 3)
- Test: `tests/member-requests-notify.test.ts` (la plantilla es pura)

**Interfaces:**
- Consumes: `runAction` (leer entero antes de tocar: el `extraSchema`, el `guard(member, data)` y el `run(ctx, member, data)` son los puntos de extensión; NO cambiar su estructura); `memberRequests.markAccepted`; `mailer.sendToMember` — **firma real en `src/lib/email/index.ts:83-92`**: `{ memberId: number | null; to: string; type: NotificationType; message: Omit<MailMessage, "to">; summary: string; period?: string | null }`. Acepta cualquier `NotificationType`, así que `request_accepted`/`request_rejected` entran sin tocar el mailer. (La copia de `account-email-notice.ts:116-123` está estrechada a `email_verification` y NO sirve de referencia acá.) La allowlist y el ledger `Notification` los pone el transporte/mailer — no reimplementar.
- Produces: `notifyRequestDecided({ memberId, type, accepted, note? }): Promise<void>` (best-effort: lee el email utilizable de la ficha — `email && emailStatus !== "bounced"` —, arma la plantilla y manda con `type: accepted ? "request_accepted" : "request_rejected"`; cualquier fallo se loguea con código y NO propaga); plantilla `memberRequestDecided({ type, accepted, note }): { message, summary }` en `templates.ts` (es-AR, "vos", texto plano + html simple como las vecinas; la de baja aceptada dice que la baja quedó asentada con acta; la de categoría aceptada, que ya rige; las rechazadas incluyen la nota si hay).

- [ ] **Step 1: Test de la plantilla** (pura): las cuatro variantes contienen las palabras clave ("baja", "categoría", "aceptada"/"rechazada") y la nota cuando se pasa. → FAIL → implementar plantilla + `notify.ts` → PASS.

- [ ] **Step 2: `requestId` en las dos actions.** En `withdrawAction` y `changeCategoryAction`, el `extraSchema` gana `requestId: z.coerce.number().int().positive().optional()`. En cada `guard`, si vino `requestId`: cargar la solicitud y validar que exista, esté `pending`, sea del `memberId` del form y del tipo correcto — y en categoría, que `requestedCategory === data.newCategory`; cualquier mismatch → `{ ok: false, error: "La solicitud no corresponde a esta operación. Volvé a la bandeja." }`. En cada `run`, DESPUÉS de que el servicio estatutario resuelva: `if (data.requestId) { await memberRequests.markAccepted({ requestId, memberId, decidedById: actorId, type }); await notifyRequestDecided({ memberId, type, accepted: true }); }` — los dos best-effort respecto del redirect (el asiento del `runAction` ya registra `requestId` sumándolo al `detail`: `detail: (m, data) => ({ …existente, requestId: data.requestId ?? undefined })`).

- [ ] **Step 3: Precarga en `[accion]/page.tsx` (+ `action-form.tsx`, sumarlo a los Files).** La página hoy declara SOLO `params` (`[accion]/page.tsx:165-166`): agregarle `searchParams: Promise<{ solicitud?: string }>` y `await`-earlo (Next 16). Si `solicitud` es un id válido de solicitud `pending` del socio y del tipo de la acción: renderizar arriba del formulario un `FormMessage kind="neutral" box` con "Estás aplicando la solicitud N° {id} del {fecha}: " + el `text` (`whitespace-pre-line`). **La página NO arma un form por rama**: `screenFor()` devuelve una spec `Screen` y hay un solo `<ActionForm>` compartido (`:222-228`), así que la precarga va por el `initial` del `Field` kind `select` (`action-form.tsx:25,32`) — baja: `reason` con `initial: "resignation"`; categoría: `newCategory` con `initial: requestedCategory`. Para el `requestId` oculto, `ActionForm` hoy solo emite el hidden `memberId` (`action-form.tsx:56`): agregarle un prop opcional `hidden?: Record<string, string | number>` que el `<form>` renderice como `<input type="hidden">` — mínimo, sin tocar su estado ni `initialValues`. Si el id de solicitud no corresponde, se ignora en silencio (la action revalida igual).

- [ ] **Step 4: `rejectRequestAction` (Task 6) importa `notifyRequestDecided`** con `accepted: false` y la nota — verificar que quedó cableado.

- [ ] **Step 5: Circuito entero en navegador** (CA-5B-3): la solicitud de baja pendiente → bandeja → Aplicar → flujo de baja precargado (motivo renuncia, aviso con el escrito) → acta → el socio queda `withdrawn` con motivo `resignation`, la solicitud `accepted` con `movementId`, y el correo de decisión sale (allowlist local). Verificar en la base `member_requests` y `notifications`. **Restaurar al socio de prueba** (reingreso por el flujo admin o UPDATE local a `active` + borrar el movement de prueba… más simple: usar a Roberto Enrique 535 para la baja y restaurarlo por SQL local documentando el comando en el informe). Suite + lint + build.

- [ ] **Step 6: Commit** `feat(m5b): request acceptance piggybacks the minute flows and notifies the member`

---

### Task 8: Actualizar el monto en MP al aceptar una recategorización

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

### Task 9: Referencia `socio:{id}` + regla anti-duplicación pura

**Files:**
- Modify: `src/lib/mp/references.ts` (SOLO agregados)
- Create: `src/lib/members/debit-adhesion.ts`
- Test: `tests/debit-adhesion.test.ts` (+ casos nuevos en `tests/mp-references.test.ts` si existe — grep)

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

Orden de las guardas en `adhesionVerdict` (cada una con su porqué en prosa): (1) `!categoryPaysFee(category)` → `category`; (2) `subscriptionStatuses.some(canStillCharge)` → `active_subscription` (cierra para este camino el hueco del doble preapproval, `docs/06:469`); (3) `paidThisMonth` → `paid_this_month` con `availableFrom = nextMonthStartAR(at)` (la decisión #4/#15 del operador: pagó cuota — ingreso incluido — en el mes calendario → bloquea; la deuda NO bloquea: el primer débito la empieza a saldar); (4) `!email` → `no_email` (MP exige `payer_email`). `nextMonthStartAR`: derivar el período de `at` con `currentPeriod`-style civil AR (usar las piezas de `periods.ts`; el instante devuelto es las 00:00 AR = 03:00Z del día 1 siguiente, mismo criterio que `monthBoundsAR` en `receipts-query.ts:35`). Mensajes (es-AR): `category` → "Tu categoría no paga cuota, así que no hay débito que adherir."; `active_subscription` → "Ya tenés un débito automático activo. Si querés cambiarlo, primero cancelalo."; `paid_this_month` → `` `Ya abonaste una cuota este mes. Podés adherirte desde el ${formatDateAR(v.availableFrom)}.` ``; `no_email` → "Para adherir el débito necesitás un email cargado en tu ficha. Cargalo en Mis datos.".

- [ ] **Step 1: Tests primero** — tabla de `adhesionVerdict` (vitalicio → category; sub `authorized`/`pending` → active_subscription; sub `cancelled` no bloquea; pagó este mes → paid_this_month con `availableFrom` = 1° del mes siguiente 03:00Z, probando también diciembre→enero; sin email → no_email; deuda NO figura entre las entradas: la función ni la recibe), `nextMonthStartAR` (mes común + diciembre), referencias (`socio:298` parsea, `socio:0`/basura → null). → FAIL → implementar → PASS → **Commit** `feat(m5b): member subscription reference and pure adhesion verdict`

---

### Task 10: Servicio de adhesión y cancelación del débito

**Files:**
- Create: `src/lib/members/member-debit.ts`
- Test: `tests/member-debit.test.ts`

**Interfaces:**
- Consumes: `mpGateway` (`createPreapproval`, `getPreapproval`, `cancelPreapproval`) — inyectado como `MpGateway`-parcial; `subscriptionReason` de `@/lib/mp/reason`; `checkoutUrlFor` de `@/lib/mp/checkout`; `feeValueReader`/`feeAmountFor`; `adhesionVerdict`/`ADHESION_BLOCKING_TYPES`/`nextMonthStartAR` (Task 9); `memberSubscriptionReference`; `canStillCharge`, `isKnownDead`, `countChargeable` de `@/lib/mp/subscription-status`; `monthBounds` del mes civil AR (replicar el cálculo de `monthBoundsAR` — es una función privada de `receipts-query.ts`; NO exportarla desde ahí: copiar las cuatro líneas con la cita, o mejor, calcular con `Date.UTC(y, m-1, 1, 3)` en un helper local comentado).
- Produces: `makeMemberDebit(deps)` + singleton `memberDebit`:

```ts
start(input: { memberId: number }): Promise<
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string }>
syncStatus(input: { memberId: number }): Promise<{ status: string | null }>
cancel(input: { memberId: number; preapprovalId: string }): Promise<
  | { ok: true } | { ok: false; error: string }>
```

`deps`: `{ db: Pick<PrismaClient, "$transaction" | "member" | "mpSubscription" | "payment" | "fee" | "movement">, gateway: Pick<MpGateway, "createPreapproval" | "getPreapproval" | "cancelPreapproval">, feeValues: { current(at?: Date): Promise<FeeValueAmounts | null> }, baseUrl: () => string, now?: () => Date }` (`fee` y `movement` son para el `preview` — ver abajo). Además de `start`/`syncStatus`/`cancel`, el servicio expone `preview({ memberId })`: corre los pasos 1-4 de `start` sin tocar MP y devuelve `{ verdict: AdhesionVerdict; upcoming: Period[]; unit: number | null }`, donde `upcoming = upcomingPeriods(existingPeriods, member.joinedAt, readmittedAt)` — **tres parámetros en ese orden** (`upcoming.ts:23`) — con `existingPeriods` de `fee.findMany({ where: { memberId }, select: { period: true } })` y `readmittedAt` del `movement.findFirst({ where: { memberId, type: "readmission" }, orderBy: [{ date: "desc" }, { id: "desc" }], select: { date: true } })?.date ?? null` (calcado de `mi/cuenta/page.tsx:41-48`). Pantalla y action comparten el servicio: nunca divergen.

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

### Task 11: `/mi/debito` — pantalla, actions, pestaña condicionada e Inicio

**Files:**
- Create: `src/app/mi/debito/page.tsx`, `src/app/mi/debito/actions.ts`, `src/app/mi/debito/adhesion-form.tsx`, `src/app/mi/debito/cancelar/page.tsx`
- Modify: `src/lib/mi/nav.ts` (+pestaña con `paysFeeOnly`), `src/components/mi/mi-tabs.tsx` (+ícono `RefreshCw`), `src/app/mi/layout.tsx` (filtra la pestaña), `src/app/mi/page.tsx` (tarjeta de débito en el Inicio), `tests/mi-nav.test.ts`
- Test: `tests/mi-debito-actions.test.ts`

**Interfaces:**
- Consumes: `memberDebit` (Task 10); `adhesionVerdict`-relacionados vía el servicio (la página muestra el motivo del bloqueo llamando al servicio NO — la página pinta con `memberDebit.preview({ memberId })` — definido en la Task 10 — y la action revalida adentro de `start`: pantalla y action nunca divergen porque comparten el servicio); `isNotCancelled`, `isCharging` de `@/lib/mp/subscription-status`; `cancelEffect`/`cancelEffectSentence` de `@/lib/mp/cancel-effect`; `upcomingPeriods` de `@/lib/treasury/upcoming` + `describePeriods` de `@/lib/treasury/labels`; `memberPayLimiter` (cada intento llama a MP — mismo criterio que pagar); `formatARS`.
- Produces: `startDebitAction`, `cancelDebitAction` — `(prev, formData) => Promise<DebitState>` con `type DebitState = { error?: string; redirectUrl?: string; done?: boolean }`.

- [ ] **Step 1: Pestaña condicionada.** `MiTab` gana `paysFeeOnly?: boolean`; `MI_TABS` suma `{ href: "/mi/debito", label: "Débito automático", icon: "refresh-cw", paysFeeOnly: true }` entre "Mi cuenta" y "Mis datos"; helper puro `miTabsFor(paysFee: boolean): MiTab[]` que filtra; test de nav actualizado (vitalicio no ve la pestaña; activo sí). En `layout.tsx`: el actor ya trae `memberId` — sumar una consulta `prisma.member.findUnique({ select: { category: true } })` y pasar `miTabsFor(categoryPaysFee(category))` a `MiTabs` (comentar que es display: la autorización real vive en página y actions). `mi-tabs.tsx` mapea `"refresh-cw": RefreshCw`.

- [ ] **Step 2: Tests de actions** (andamiaje de `mi-datos-actions.test.ts`, mockeando `@/lib/members/member-debit`): bloqueado/suspendido no llega al servicio (`requireMember` SIN `allowSuspended` — el suspendido no adhiere NI cancela); `memberId` del actor; `startDebitAction` devuelve `redirectUrl` del servicio; `cancelDebitAction` pasa `preapprovalId` del form + `memberId` del actor; audit con `channel: "member"` sin URL. → FAIL.

- [ ] **Step 3: Actions.** `startDebitAction`: `requireMember()` → `memberPayLimiter.check` → `memberDebit.start({ memberId })` → si ok: audit `member_debit_adhesion` detail `{ memberId }` + IP (la URL del checkout NUNCA al asiento — precedente `payment_link_create`) → `{ redirectUrl: r.checkoutUrl }`. `cancelDebitAction`: zod `{ preapprovalId: z.string().regex(/^[A-Za-z0-9]{1,64}$/, "Suscripción inválida.") }` → `memberDebit.cancel({ memberId, preapprovalId })` → audit `member_debit_cancel` detail `{ preapprovalId }` → `revalidatePath("/mi/debito")` → `{ done: true }`. → PASS.

- [ ] **Step 4: Página `/mi/debito`.** Server, `requireMember({ allowSuspended: true })`, `dynamic = "force-dynamic"`, metadata "Débito automático — Vecinal Ciudadela". `canAct = actor.suspension === null`. Datos: ficha (`category`, `email`, `joinedAt`), subs (`findMany` con `isNotCancelled` para listar), `preview` del servicio, y si `?volvio=1` → `memberDebit.syncStatus` ANTES de leer las subs (así la vuelta del checkout pinta el estado fresco; comentar que el efecto en un GET es el mismo que hace la conciliación: sincronizar un espejo). Bloques: h1 + bajada; si `volvio`, `FormMessage` según el status fresco (`authorized` → success "¡Listo! Tu débito quedó autorizado."; `pending` → neutral "MP todavía está confirmando la autorización. Actualizá en un rato."; otro → warning); estado actual (Card por cada sub viva: badge `isCharging` → "Activo" success / si no "Pendiente" secondary, monto `formatARS`, y si `canAct` el link-botón a `/mi/debito/cancelar?preapproval={id}`; con 2+ vivas, `FormMessage kind="warning"`: "Tenés más de un débito vivo: consultá en la sede." — el sistema no crea el segundo, lo hereda); si NO hay viva: la tarjeta de adhesión — si el veredicto bloquea, `EmptyState`/`FormMessage` con `adhesionBlockMessage` (el de `paid_this_month` muestra la fecha); si pasa, `adhesion-form.tsx` (client, patrón `pay-form.tsx`): la "boleta previa" con `Cuota social · {formatARS(unit)} por mes`, la línea CLAVE de la spec §6.4 — "Tu primer débito cubre {describePeriods(upcoming.slice(0,1))}" (en contraste con el wizard, que dice "cuota de ingreso"; acá NUNCA es ingreso) —, aviso "Te lleva a Mercado Pago a autorizar el débito con tu tarjeta.", y botón `min-h-12` "Adherir el débito automático" con `useActionState` + `window.location.assign(state.redirectUrl)` (calcado de `pay-form.tsx:64-66`).

- [ ] **Step 5: `/mi/debito/cancelar`.** Página de confirmación: valida por querystring que el preapproval sea del socio (si no, `notFound()`); muestra la frase de efecto — **la firma real es `cancelEffectSentence({ effect, amountLabel, statusLabel })`** (`cancel-effect.ts:54`), no el `CancelEffect` suelto: `cancelEffectSentence({ effect: cancelEffect(sub.status), amountLabel: sub.amount ? formatARS(Number(sub.amount)) : null, statusLabel: sub.status })` (leer el archivo para el shape exacto de `statusLabel` y calcar cómo lo arma su llamador existente en `/admin/tesoreria/suscripciones/[preapprovalId]/cancelar`) — + "Podés seguir pagando por link o en la sede, y volver a adherirte cuando quieras." + form con hidden `preapprovalId` y botón `variant="destructive"` "Cancelar el débito" (+ link "Volver"). El suspendido no llega a actuar (la action corta) y la página le esconde el botón (`canAct`).

- [ ] **Step 6: Inicio.** En `mi/page.tsx`, entre la tarjeta de cuenta y los QuickLinks, tarjeta "Débito automático" (solo si `paysFee`): consulta liviana de subs → "Activo" (success) / "Pendiente de autorización" / "No estás adherido" + link CTA `/mi/debito` ("Ver mi débito →" / "Adherirme →"). Reutilizar `LINK_CTA`.

- [ ] **Step 7: QA en navegador** (local): vitalicio no ve la pestaña (cambiar categoría de un socio de prueba por SQL y volver); Rodrigo (activo, sin subs, sin pagos del mes) ve la tarjeta de adhesión con "tu primer débito cubre septiembre 2026"; sembrar un pago `cash` de este mes por SQL → el botón se bloquea con "Podés adherirte desde el 01/09/2026" → limpiar. **El checkout real NO se prueba acá** (es la Task 12, en sandbox). Suite + lint + build.

- [ ] **Step 8: Commit** `feat(m5b): member debit screen — adhesion, status and cancellation`

---

### Task 12: Verificación final de la fase (CA-5B) + docs

**Files:** docs (`docs/06`, `docs/07`, spec §13, `CLAUDE.md`) + ledger. Sin código nuevo salvo fixes de QA.

- [ ] **Step 1: Suite, lint, build** — todo verde; `git log --stat` confirma el núcleo intocado (`git diff main..HEAD -- src/lib/treasury src/lib/mp/resolve.ts src/lib/mp/webhook-processor.ts src/lib/mp/gateway.ts src/components/admin/account-section.tsx tests/integration` → vacío; `references.ts` solo con agregados).
- [ ] **Step 2: CA-5B-1 en sandbox local (CON EL OPERADOR).** Requiere las credenciales de la cuenta de prueba de MP y el túnel de cloudflared (`docs/11` Parte J; actualizar `DEV_TUNNEL_ORIGINS` en `next.config.ts` con el dominio del túnel de la corrida). Con `.env` apuntando al token de sandbox: un socio de prueba se adhiere desde `/mi/debito`, autoriza en el checkout de MP con la tarjeta de prueba, y el débito entra SOLO por el webhook como cuota común (la más vieja pendiente o el mes siguiente), con recibo — verificar en la base que el `Payment` es `type: "debit"` y NUNCA `entry`, y que `MpSubscription` quedó `authorized` con `memberId`. **PAUSAR y pedir al operador** lo que falte (tarjeta de prueba, túnel).
- [ ] **Step 3: CA-5B-2**: con el pago del débito recién aplicado, `/mi/debito`… ya hay sub viva → bloquea por `active_subscription`; cancelar la sub de sandbox → ahora bloquea por `paid_this_month` con la fecha del mes próximo. Documentar con capturas.
- [ ] **Step 4: CA-5B-3 y CA-5B-4** ya verificados en las Tasks 7 y 8; re-correr el circuito de categoría con un socio CON sub de sandbox viva y monto distinto para ver el push a MP en vivo (o dejar constancia del test unitario + el log del gateway si el sandbox no lo permite).
- [ ] **Step 5: Docs.** `docs/06` §2: `socio:{id}` pasa de reservado a en uso (nota fechada). `docs/07`: fase 5B cerrada con su lista y CA, estilo de las fases previas; Módulo 5 COMPLETO. Spec §13: enmiendas nuevas si las hubo. `CLAUDE.md`: prioridad actual → Módulo 6; sumar al bloque de patrones del M5 lo que estrenó la 5B (la adhesión que se apoya en la regla 3, el veredicto puro compartido pantalla/action, `member_requests` con mutex). Actualizar el ledger.
- [ ] **Step 6: Commit final** `docs(m5b): phase 5B closed — self-service debit and member requests` y ofrecer el merge con `superpowers:finishing-a-development-branch`.

---

## Self-Review (aplicado)

- **Cobertura de spec 5B**: §4.1 modelo (T2), §6.1-6.5 débito (T9-T11), §7.1 socio (T3-T5), §7.2 bandeja+acta+MP (T6-T8), §11 núcleo intocado (constraints + T12), CA-5B-1..4 (T12, T7, T8). Notificaciones de decisión (§7.2) en T7. La regla anti-duplicación con `entry` incluido (decisiones #4/#15) en T9.
- **Sin placeholders**: los pasos que dependen de archivos vivos nombran el archivo y el patrón exacto a calcar, con la regla de adaptación ("si la forma real difiere, gana la del archivo") que la 5A validó.
- **Consistencia de tipos**: `AdhesionVerdict` (T9) es lo que consumen T10/T11; `memberRequests` (T4) lo consumen T5/T6/T7; `RequestState`/`DebitState` definidos una vez; `subscriptionAmountPlan` (T8) solo lo consume `changeCategoryAction`.
- **Riesgos señalados**: el push a MP en T8 corre dentro de `run` (post-acta) con compensación best-effort documentada; el GET con efecto de `syncStatus` en T11 está comentado y acotado al espejo; el error de "no reintentar" en T10 calca el `blocked` del wizard.
