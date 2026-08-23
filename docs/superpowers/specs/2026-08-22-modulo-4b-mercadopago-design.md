# Módulo 4 — Fase 4B: Mercado Pago (spec de diseño)

Fecha: 2026-08-22 · Estado: aprobada por Mariano (3 rondas de preguntas + diseño en 3 secciones)
Refina y reemplaza, donde difieren, las secciones §5, §6.2, §6.4, §7 y §12 (4B) de
`docs/superpowers/specs/2026-08-21-modulo-4-tesoreria-design.md` ("spec M4").
Referencias: `docs/02` (REG-07, 12.b, 14, 15, 16, 20, 33, 34), `docs/06`, `docs/07`,
`docs/08`, `docs/11` §7 (notificaciones firmadas a mano), `.superpowers/sdd/progress.md`
(deudas que 4A dejó a 4B).

## 1. Contexto, objetivo y alcance

La fase 4A cerró la cuenta corriente: cuotas, efectivo, recibos numerados, deudores. Lo que
entra por Mercado Pago todavía **no se aplica a nada**: el webhook guarda el evento crudo,
`subscription_authorized_payment` se "traza" y un `payment` cuya referencia no sea
`solicitud:{id}` muere en `no_match` sin dejar rastro fuera de `webhook_events`.

**Objetivo duro**: el débito mensual de Mariano (socio 14, preapproval
`a69d4b7c9e65472bb46c0489897880af`, $6.000, cobra el día 10, próximo **10/09/2026**) y el
de Martín (socio 306, `fa4a1ba0102c4c0d9fc772920154ed5c`, $3.000, próximo 21/09/2026)
quedan registrados por el sistema como pago + cuota + recibo, sin intervención manual.

**Hechos que condicionan el diseño** (relevados el 22/08/2026):

- Producción corre con credenciales **productivas**; la base se reconstruyó desde cero el
  22/08 y **no tiene ninguna `MpSubscription`**: las dos suscripciones vivas hay que
  **vincularlas** desde una pantalla nueva.
- La suscripción del 14 se creó **a mano** desde el panel de MP (plan viejo
  `2c93808491b45c310191d38769ba0a47`, `reason` sin el prefijo del sistema, sin
  `external_reference` útil). La del 306 la creó el wizard con `external_reference =
  solicitud:9`, pero **esa solicitud ya no existe** (la tabla `applications` se vació al
  reconstruir). Con el código actual, su débito cae en `already_processed`, silencioso.
- El 306 es **adherente**. La spec M4 dice que los adherentes no devengan cuota y a la vez
  que "un débito = una cuota". Decisión de esta spec: **gana la segunda** (§3).
- `EMAIL_ALLOWLIST` sigue definida en producción: el recibo por email del 306 **no sale**
  hasta el lanzamiento; el del 14 sí (está en la lista). Aceptado.
- `docs/11` §7: la búsqueda de pagos por `external_reference` **no** encuentra los cobros de
  suscripción; `authorized_payments/search?preapproval_id=` sí. Condiciona la conciliación.
- Nunca se prueba con plata en producción: sandbox local (Mariano genera credenciales de
  prueba cuando la tarea lo pida) + notificaciones firmadas a mano.

**Entra (una sola entrega, decisión de Mariano):**

1. Gateway ampliado (§4).
2. Núcleo genérico `registerPayment` + `refundPayment` en el servicio de tesorería (§3).
3. Resolución de un pago de MP a su destino (§5) y webhook que aplica (§6).
4. Bandeja sin conciliar con motivo y regla de reapertura (§7).
5. Vinculación de suscripciones preexistentes (§8).
6. Conciliación diaria `POST /api/cron/reconcile` con `CronRun` (§9).
7. Lote REG-34 en Valores (§10).
8. Wizard ASOCIATE leyendo `fee_values`; eliminación de la caché de planes; ids de plan
   opcionales (§11).
9. Checkout Pro: link desde la cuenta corriente (admin) y "Pagar ahora" en `/mi/cuenta`
   (socio) (§12).
10. Pago de ingreso del wizard como `Payment.entry` + recibo (§6.4).
11. Reembolsos y contracargos (§6.5).
12. Emails `receipt` (débito, link, ingreso) y `paymentLinkEmail` (§13).
13. Migración nº 8 (§2), auditoría (§14), tests (§15), docs y despliegue (§16, §17).

**No entra** (queda en 4C o M5): email `payment_rejected`, cron de devengo, aviso de mora
del día 30, digest, `/admin/salud`, reintento de `Notification.failed`, padrón electoral,
cancelar el débito al dar de baja, desvincular una suscripción desde el panel, importar
cobros históricos de una suscripción al vincularla.

> **Enmiendas al cerrar la fase (23/08/2026).**
> 1. **Entró de más**: los **ingresos no societarios** (alquiler del salón, eventos,
>    rifas) — decisión del cliente del 23/08. Tabla `other_incomes`, tercera salida en
>    la bandeja, opción en Efectivo y pestaña propia con ejercicio anual. No emite
>    recibo y no toca el núcleo de plata. Ver `docs/01`, `docs/04` y `docs/05` §5.
> 2. **Cancelar el débito al dar de baja** decía "(M5)" y `docs/07` no se lo asignaba a
>    ninguna fase. **Queda asignado a la fase 4C**: las bajas del panel —cesantía por
>    mora y baja por acta— ya existen y ya corren, así que el agujero está abierto hoy
>    y no depende del panel del socio. `docs/06` §8 y `docs/07` quedaron alineados.

## 2. Modelo de datos (migración nº 8, `add_module_4b_mercadopago`)

Cambios mínimos; casi todo ya lo dejó la migración nº 7.

- `mp_subscriptions.plan_id` → **nullable**. Una suscripción creada a mano no tiene plan de
  referencia; `""` como centinela queda prohibido. `payer_email` → **nullable**:
  `GET /preapproval/{id}` puede no traerlo.
- `mp_unmatched_payments` suma `preapproval_id VarChar(64)?` (índice) y
  `reason VarChar(32)` NOT NULL con valores cerrados en código (`UnmatchedReason`, §7).
- Sin cambios: `payments.mp_payment_id @unique`, `payments.preapproval_id`, `cron_runs`,
  `PaymentStatus.refunded`, `Notification.failed/error`, `mp_subscriptions.amount /
  external_reference / linked_manually`.
- Seed local (`prisma/seed.ts`): una `MpSubscription` vinculada a un socio de prueba y una
  fila de bandeja `open`, para ver las pantallas sin MP.

## 3. Núcleo de tesorería: `registerPayment` y `refundPayment`

Enfoque elegido: **extraer** la transacción de `registerCashPayment` a un núcleo agnóstico
del origen y que Efectivo lo llame. Las cuatro invariantes de plata (número pedido tarde y
dentro de la transacción, chequeo de `count` antes de pedirlo, PDF fuera de la transacción,
concepto congelado) viven en un solo lugar. Descartados: duplicar la transacción en un módulo
de MP (dos lugares donde romper REG-33) y "el webhook solo encola" (el débito no se vería
hasta que corriera otra cosa).

```ts
registerPayment(input: {
  memberId: number;
  type: PaymentType;            // debit | link | cash | voluntary | entry | extraordinary
  n: number;                    // cuotas a imputar; 0 para voluntary/extraordinary/entry
  amount: number;               // lo que se cobró de verdad (MP) o n × vigente (efectivo)
  paidAt: Date;                 // date_approved de MP, o ahora
  mpPaymentId?: string;
  preapprovalId?: string;
  applicationId?: number;
  actorId: number | null;       // null = automático (webhook, cron)
  note?: string;
}): Promise<RegisterResult>

type RegisterResult =
  | { kind: "registered"; paymentId; receiptId; number; periods; amount; pdfWritten }
  | { kind: "already_processed"; paymentId }          // mpPaymentId ya existía
  | { kind: "no_pending_withdrawn" }                  // cesante sin cuotas pendientes
```

Reglas:

- **Una cuota por unidad de `n`, cualquiera sea la categoría y el monto.** Un débito es
  `n = 1`; un link `pago:{id}:{n}` son `n`; `entry` no imputa. Vale para adherentes (el
  306), suspendidos (devengan; REG-20 solo corta el panel) y categorías sin valor de cuota.
  `allocate` sigue imputando las pendientes más viejas y creando el período corriente y
  siguientes si faltan (con eso el CA "cuota del período" se cumple sin el cron de devengo).
- **Cesante** (`withdrawn`): `n` se acota a las pendientes; sin pendientes devuelve
  `no_pending_withdrawn` en vez de tirar, y el llamador decide (el webhook lo manda a la
  bandeja). Coherente con Efectivo: se le cobra deuda congelada, nunca se le crean cuotas.
- **Idempotencia doble**: dentro del mutex del socio, antes de la transacción, se consulta
  `Payment.mpPaymentId`; si existe → `already_processed`. Si aun así el `create` choca
  (`P2002`, dos eventos del mismo cobro en paralelo), se devuelve `already_processed` y la
  transacción se revierte **sin haber pedido número** (el `create` del pago va antes del
  `nextReceiptSeq`, que ya era el orden de 4A).
- **Fechas**: `paidAt` e `issuedAt` = `input.paidAt`; la serie del recibo es
  `seriesYear(paidAt)` (día civil argentino). Un cobro del 31/12 recuperado por el cron el
  2/1 lleva número del año viejo.
- `Receipt.concept = fitConcept(paymentConcept(type, periods))` — ya soporta los seis tipos.
- `Payment.amount` = `amount.toFixed(2)`; techo `MAX_AMOUNT`; montos con centavos se
  aceptan (MP los manda) y `amountInWords` los escribe.
- Mutex, PDF post-commit best-effort y `regenerateReceiptPdf` sin cambios.
- `registerCashPayment` conserva su firma y sus mensajes de mostrador; por dentro valida y
  llama a `registerPayment` con `type = CONCEPT_TYPE[concept]`, `paidAt = now()`,
  `amount = unit × count`.

`refundPayment({ mpPaymentId, reason: "Reembolso en Mercado Pago" })`: mismo cuerpo que
`voidReceipt` (mutex por socio, relectura dentro, `revertFees`, scope por `paymentId`), pero
`Payment.status = refunded`, `Receipt.voidedById = null`, y **reabre** las filas de la
bandeja que ese pago resolvió (§7). `voidReceipt` también reabre. Idempotente: un pago ya
`refunded`/`voided` devuelve `already_refunded`.

## 4. Gateway (`src/lib/mp/gateway.ts`)

Misma factory, misma interfaz mockeable. El dominio sigue sin ver el SDK.

Métodos existentes que cambian de forma (los llamadores actuales se adaptan):

- `getPayment(id)` → `{ id, status, statusDetail, transactionAmount, externalReference,
  dateApproved: Date | null, payerEmail: string | null, description: string | null }`.
- `getAuthorizedPayment(id)` → `{ id, preapprovalId, status, paymentId: string | null,
  amount: number | null, dateCreated: Date | null, externalReference }`.
- `getPreapproval(id)` → suma `amount: number | null`, `reason`, `nextPaymentDate: Date |
  null`, `dateCreated`.

Nuevos:

- `searchPreapprovals({ status? })` → `GET /preapproval/search`, paginado de a 100 hasta
  agotar; devuelve `{ id, status, reason, amount, payerEmail, externalReference,
  dateCreated, nextPaymentDate }[]`.
- `searchAuthorizedPayments(preapprovalId)` → `GET /authorized_payments/search` con `fetch`
  directo (no está en el SDK); devuelve `{ id, status, paymentId, amount, dateCreated }[]`.
- `searchPayments({ since })` → `GET /v1/payments/search` con `range=date_approved`,
  `status=approved`, paginado; devuelve el shape de `getPayment`.
- `createPreference({ title, amount, externalReference, backUrl, notificationUrl })` →
  `{ id, initPoint }`. `back_urls.success/pending/failure` = `backUrl`;
  `auto_return = "approved"`.

Montos: MP devuelve pesos con decimales (`number`); se pasan a `Decimal` vía `toFixed(2)`,
nunca a float. Fechas: los strings ISO con offset de MP se parsean a `Date` UTC en el
gateway; `civilDayOf`/`currentPeriod` hacen el resto.

## 5. Resolución de un pago de MP (`src/lib/mp/resolve.ts`, pura)

Entrada: lo que se sabe del cobro (`mpPaymentId`, `preapprovalId?`, `externalReference?`)
y lo que la base ya cargó (pago local por `mpPaymentId`, suscripción por `preapprovalId`,
suscripción por `externalReference`, solicitud por id). Salida: una decisión.

| # | Condición | Decisión |
|---|---|---|
| 1 | `mpPaymentId` ya es `Payment` | `already_processed` |
| 2 | `preapprovalId` con `MpSubscription.memberId` | `debit` al socio, `n = 1` |
| 3 | `preapprovalId` con `MpSubscription` sin `memberId` (solicitud viva, sin acta) | si la solicitud no tiene `mpPaymentIdEntry` → caso 4; si ya lo tiene → bandeja `duplicate_entry` |
| 4 | `external_reference = pago:{memberId}:{n}` y el socio existe | `link`, `n` cuotas; monto ≠ `n × vigente` → se aplica igual + asiento `link_amount_mismatch` |
| 5 | `solicitud:{id}`, solicitud viva sin `mpPaymentIdEntry` | `entry` (§6.4) |
| 6 | `solicitud:{id}` en cualquier otro caso | si hay `MpSubscription` con ese `externalReference` y `memberId` → `debit`; si no → bandeja `application_missing` |
| 7 | `preapprovalId` sin suscripción local | bandeja `no_subscription` (con `preapprovalId`) |
| 8 | Nada de lo anterior | bandeja `no_reference` |

**La suscripción manda sobre la referencia** (2 y 3 antes que 4–6): el `preapprovalId` es
el dato más confiable y resuelve los dos casos reales. Se prueba con una tabla de casos
sin Prisma.

## 6. Webhook (`src/lib/mp/webhook-processor.ts`)

Mismo endpoint, misma firma HMAC, misma idempotencia por `WebhookEvent`. Cambia el
procesador, que recibe `treasury` (el servicio de §3) y `unmatched` (§7) como deps.

### 6.1 Principio

**El procesador nunca falla por una regla de negocio.** Toda situación de negocio termina
en un `result` (aplicado, bandeja, ignorado, ya procesado). Solo un fallo técnico (MP no
responde, base caída) lanza, devuelve 500 y deja que MP reintente. Un cesante sin cuotas, un
monto raro o una referencia rota **nunca** producen un bucle de reintentos.

### 6.2 `subscription_authorized_payment`

`getAuthorizedPayment(dataId)` → si `paymentId` es null o `status` no es `processed` →
`authorized_payment_traced` (el cobro todavía no existe o falló). Si no →
`getPayment(paymentId)` → si `approved` → resolver (§5) con `preapprovalId` del
authorized_payment → aplicar.

### 6.3 `payment`

`getPayment(dataId)`:

- `approved` → resolver (§5) → aplicar. Para un cobro de suscripción el objeto `payment`
  puede no traer el `preapprovalId`; se resuelve por referencia (caso 6) y, si no alcanza,
  va a la bandeja: el evento `subscription_authorized_payment` del mismo cobro, o la
  conciliación, lo aplican después y la fila de la bandeja se cierra sola (§7).
- `refunded` / `charged_back` → `refundPayment` si hay `Payment` local; si no, `ignored`.
- `rejected` → `payment_rejected_traced` (el email es 4C).
- `in_process`, `pending`, `cancelled` → `payment_ignored`.

### 6.4 Pago de ingreso (`entry`)

Caso 5 de §5: además del comportamiento actual (solicitud → `approved_pending_minute`,
`mpPaymentIdEntry`, `entryAmount`, email de bienvenida), crea
`Payment{ type: entry, applicationId, memberId: null, mpPaymentId, preapprovalId, amount,
paidAt: dateApproved }` + recibo ("Cuota de ingreso") + email `receipt` con PDF a la
solicitud. Al asentar el acta, `record.ts` escribe `Payment.memberId` junto con
`MpSubscription.memberId`. El recibo se emite con `memberNumber` vacío y el nombre de la
solicitud.

### 6.5 Aplicar

"Aplicar" = `registerPayment` con `actorId: null` y `paidAt = dateApproved`, bajo un mutex
adicional `mp:{mpPaymentId}` que envuelve resolver + aplicar, para que `payment` y
`subscription_authorized_payment` del mismo cobro no corran a la vez. Luego: email
`receipt` best-effort (`sendReceiptEmail`), asiento `payment_applied` (`paymentId`,
`memberId`, `type`, `amount`, `mpPaymentId`; nunca email ni nombre).
`no_pending_withdrawn` → bandeja `withdrawn_no_pending`.

### 6.6 `subscription_preapproval`

`getPreapproval` → `updateMany` por `preapprovalId` con `status`, `amount`,
`payerEmail`, `externalReference`, `lastSyncAt` (hoy solo `status`).

## 7. Bandeja sin conciliar

`UnmatchedReason = no_reference | no_subscription | application_missing |
duplicate_entry | withdrawn_no_pending`. La fila guarda `mpPaymentId` (unique), `amount`,
`paidAt` (= `dateApproved`), `payerEmail`, `externalReference`, `description`,
`preapprovalId`, `reason`. Si ya existe (unique) no se duplica: `no_match` igual.

**Cierre automático**: cuando un pago se aplica por cualquier vía (otro evento, conciliación,
vinculación), la fila con ese `mpPaymentId` pasa a `matched` con `paymentId` y
`resolvedById = null`.

**Reapertura** (regla pendiente desde 4A): anular o reembolsar el pago que resolvió una
fila la devuelve a `open` (`paymentId = null`, `resolvedAt = null`), dentro de la misma
transacción de `voidReceipt`/`refundPayment`. Una fila nunca apunta a un pago anulado.

Pantalla `/admin/tesoreria/sin-conciliar` (admin): tabla de `open` con fecha, monto, email
del pagador, referencia, descripción, motivo (badge, helper en `status-badges.ts`). Por
fila:

- **Vincular a socio**: buscador (`member-search`, `?q=`), concepto "N cuotas" (por defecto
  1; cesante acotado a pendientes) o "Aporte voluntario"; confirmación con los datos del
  socio resueltos en el servidor (patrón `arrears-confirm`); crea el pago con
  `registerPayment({ type: link | voluntary, mpPaymentId, paidAt: fila.paidAt, actorId })`
  → recibo + email; fila `matched`.
- **Descartar** con motivo (≤200): fila `dismissed`, sin pago.
- `?estado=resueltos` lista `matched`/`dismissed` con quién y cuándo.

Asiento `unmatched_resolve` (id de fila, acción, `memberId`, `paymentId`). `EmptyState` con
"No hay pagos sin conciliar" cuando está vacía. `payerEmail` nunca sale a auditoría ni logs.

## 8. Vinculación de suscripciones preexistentes

Pestaña `/admin/tesoreria/suscripciones` (ver: admin; vincular: superadmin).

**Sin vincular**: `searchPreapprovals({ status: "authorized" })` menos las que tienen fila
local. Columnas: `reason`, monto, email del pagador, alta, próximo cobro, **sugerencia** de
socio (email exacto contra el padrón; si no, apellido del padrón contenido en el `reason`;
si no, vacío). Si MP no responde, `FormMessage kind="warning"` y el bloque "Vinculadas"
igual se muestra.

**Vincular** (dos pasos, resolución server-side):

1. Ruta `suscripciones/[preapprovalId]/vincular?q=`: buscador de socio; elegir uno lleva
   al paso 2.
2. Confirmación, todo leído en el servidor: socio (nº, nombre, categoría, estado —un
   cesante se puede vincular, con aviso—), suscripción (`getPreapproval` fresco: estado,
   monto vs. `feeAmountFor(categoría)` con aviso si difieren, `reason`), cobros que MP
   registra para ese preapproval (`searchAuthorizedPayments`: cantidad y último —
   **informativo, no se importan**: la deuda histórica ya vino de `deuda.xlsx`), y las
   filas de la bandeja con ese `preapprovalId` que se van a aplicar. Token de confirmación
   determinístico (`preapprovalId|memberId`).
3. Confirmar: transacción `MpSubscription.create({ preapprovalId, memberId,
   linkedManually: true, status, amount, payerEmail, externalReference, planId: null,
   lastSyncAt })` + `Member.autoDebit = true`; fuera de ella, por cada fila de bandeja
   `open` con ese `preapprovalId` **o** con `externalReference` igual al de la suscripción
   (una fila `application_missing` puede no traer el preapproval),
   `registerPayment({ type: debit, n: 1, paidAt: fila.paidAt,
   actorId })` → recibo + email; asiento `subscription_linked` (`preapprovalId`,
   `memberId`, `amount`, filas aplicadas). Si la suscripción ya está vinculada (carrera),
   error claro.

**Vinculadas**: socio (link a la ficha `?tab=cuenta`), estado MP (badge), monto, último
sync, badge "divergente" si `amount ≠ feeAmountFor(categoría)`, "vinculada a mano".

Ficha del socio: en la pestaña Cuenta, una línea "Débito automático: suscripción
`{id corto}` · {estado} · $X · próximo cobro" o "Sin débito automático" con link a
Suscripciones. `AUTO_DEBIT_WARNINGS` se reescriben: en baja, "el débito sigue vivo en MP y
sus cobros se imputarán a la deuda pendiente; cancelarlo desde MP"; en cambio de categoría,
"el monto se actualiza con el lote de Valores".

## 9. Conciliación: `POST /api/cron/reconcile` (03:00)

Patrón del cron existente (`runtime nodejs`, `CRON_SECRET` timing-safe, 503/401/500) y
estrena `CronRun` (`job = "reconcile"`, `startedAt`, `finishedAt`, `ok`, `summary`,
`error`). Factory `makeReconcile(deps)` con `db`, `gateway`, `processor`, `now`.

Pasos, cada uno aislado (un fallo se cuenta en `errors[]` y no frena a los demás):

1. **Pagos perdidos**: `searchPayments({ since: 72 h })` → cada `approved` sin `Payment`
   local ni fila de bandeja → `processor.applyPayment(payment)` (el mismo camino del
   webhook). Contador `paymentsRecovered`.
2. **Débitos perdidos**: por cada `MpSubscription` viva (`authorized`/`paused`) con
   `memberId`, `searchAuthorizedPayments(preapprovalId)` → cada `processed` con
   `paymentId` sin `Payment` local → `getPayment` → aplicar. Es la fuente que sí encuentra
   los cobros de suscripción. Contador `debitsRecovered`.
3. **Estado**: por cada `MpSubscription` viva, `getPreapproval` → sincroniza `status`,
   `amount`, `lastSyncAt`; pasó a `cancelled`/`paused` → `subscriptionsDrifted`.
4. **Huérfanas del wizard**: `searchPreapprovals()` con `solicitud:{id}` sin fila local →
   solicitud viva o completada: crea la fila (`amount`, `externalReference`);
   `expired`/`rejected`: `cancelPreapproval`; sin solicitud: `orphanPreapprovals`
   (aparecen en "Sin vincular").
5. **Divergencias**: `amountDivergent` (suscripciones vivas con `amount ≠ feeAmountFor`);
   si hay ids de plan cargados, `planDivergent` (plan vs. `fee_values`).

`summary` = contadores + `errors` (códigos, sin datos personales). Asiento `reconcile_cron`.
Ventana de 72 h para el paso 1; el paso 2 no tiene ventana (mira la suscripción entera,
filtrando por `Payment.preapprovalId` local para no repetir `getPayment`). Se instala en el
crontab del VPS en el despliegue de 4B (`docs/11` Parte H).

## 10. Lote REG-34 en `/admin/tesoreria/valores` (superadmin)

Debajo del historial: bloque **"Suscripciones con monto distinto al vigente"** — tabla
socio / categoría / monto actual → nuevo (todas las `authorized` con `amount ≠
feeAmountFor`, **incluidas las vinculadas a mano**). Botón "Aplicar valor vigente" →
confirmación (lista lo que va a tocar) → server action `applyFeeValueBatchAction`:

- procesa **hasta 25 en serie** por llamada: `updatePreapprovalAmount(id, nuevo)` → éxito:
  `amount` + `lastSyncAt`; fallo: `{ preapprovalId, memberId, code }` (código del SDK vía
  `mpErrorLog`, sin email);
- devuelve `{ updated, failed, remaining }`; el cliente reinvoca mientras `remaining > 0`,
  con progreso "N de M";
- al terminar: "Actualizadas N" o "Quedaron N sin actualizar" con la lista (socio + motivo)
  y "Reintentar las que fallaron";
- asiento `fee_value_applied` por tanda (`updated`, `failed` ids).

Al registrar un valor nuevo en `/admin/configuracion`, el mensaje de éxito dice "Hay N
suscripciones para actualizar" con link a Valores. El texto "La aplicación del valor…
llega con la siguiente fase" se elimina.

## 11. Wizard ASOCIATE y planes

- `startPaymentAction` lee el monto de `feeValueReader.current()` por categoría; sin valor
  vigente → error de formulario claro (no llama a MP). Escribe `MpSubscription.amount` y
  `externalReference` al crear.
- El paso 2 muestra el valor de `fee_values` (ya no `getFeeAmounts`).
- Se eliminan `src/lib/mp/plans.ts` (caché 24 h, `makeFeeAmountsReader`) y sus tests;
  `planIdForCategory` deja de existir.
- `mp_plan_active_id` / `mp_plan_shared_id` quedan **opcionales** en Configuración (texto
  de ayuda: "solo para el aviso de divergencia en Valores"). La recategorización de una
  solicitud (`admin/solicitudes/actions.ts`) pasa a `updatePreapprovalAmount` con el valor
  de `fee_values` y ya no escribe `planId`.

## 12. Checkout Pro

`external_reference = pago:{memberId}:{n}`; la preferencia **no se persiste**.
`title = "Cuota Vecinal Ciudadela × N"`, `amount = n × feeAmountFor(categoría)`; categoría
sin valor → no se puede generar link ("Esta categoría no paga cuota"). `n`: mín. 1, máx.
`MAX_FEES_PER_PAYMENT` (60). `backUrl` y `notificationUrl` salen de `AUTH_URL`.

**Admin** — en la cuenta corriente del socio (`AccountSection`, junto a "Registrar
efectivo"): "Generar link de pago" → `n` (por defecto pendientes, o 1 si está al día) →
action crea la preferencia y muestra el link (input de solo lectura + botón "Copiar") y
"Enviar por email" (si el socio tiene email; si no, el botón explica por qué). Email
`paymentLinkEmail` (tipo `fee_reminder`): "Tenés N cuotas pendientes por $X. Pagalas acá".
Asiento `payment_link_create` (`memberId`, `n`, `amount`; nunca el link).

**Socio** — `/mi/cuenta`, bloque "Pagar ahora" (`id="pagar"`), visible si la categoría
tiene valor: `n` (por defecto pendientes, o 1), monto en vivo, botón "Pagar con Mercado
Pago" → action `requireMember` + rate limit por socio (5/min) → `createPreference` →
`window.location.assign(initPoint)` (patrón del wizard; `leaving` deshabilita el botón).
Vuelta con `?volvio=1`: `FormMessage kind="neutral" role="status"` "Si el pago salió bien,
el recibo aparece acá en unos segundos" + sondeo liviano (`router.refresh()` cada 5 s, 2
min, solo con pestaña visible) + link "Volver a consultar". `/mi` cambia la tarjeta
"Pagar" a link `/mi/cuenta#pagar`; se reescriben "Para pagar, acercate a la sede…" y
"Todavía estamos terminando esta parte". Socio suspendido o de baja no llega (ya lo corta
`requireMember`).

## 13. Emails

Todos por el transporte con `EMAIL_ALLOWLIST`; cada envío deja `Notification` (y
`failed`/`error` cuando el transporte lanza, con `code: "EMAIL_ALLOWLIST"` como motivo
cuando corresponde — la pantalla y el reintento siguen siendo 4C).

| Plantilla | Tipo | Cuándo |
|---|---|---|
| `receiptEmail` (existe) | `receipt` | cada recibo: efectivo, **débito, link, ingreso**, bandeja resuelta |
| `paymentLinkEmail` (nueva) | `fee_reminder` | "Enviar por email" de un link |

Sin email cargado: no se envía y el resultado lo dice (`no_email`).

## 14. Seguridad, privacidad y auditoría

- Webhook: sin cambios de superficie. Cron: `CRON_SECRET`. Pantallas: `requireAdmin` /
  `requireSuperadmin` en cada page y action; `/mi/cuenta` con `requireMember`.
- `payerEmail` y `description` de MP: solo en la bandeja (admin), nunca en auditoría ni
  logs (`maskEmails`).
- Asientos nuevos: `payment_applied`, `payment_refunded`, `link_amount_mismatch`,
  `payment_link_create`, `unmatched_resolve`, `subscription_linked`, `fee_value_applied`,
  `reconcile_cron`. Detalle con ids, códigos y montos.
- Premisa de un solo proceso: mutex `member:{id}`, `mp:{paymentId}` y rate limiters en
  memoria (`instances: 1` en PM2).

## 15. Tests

- **Puros**: `resolve.ts` tabla completa de §5; `UnmatchedReason`; sugerencia de socio de
  §8; parseo de `pago:{id}:{n}` (rechaza `n` fuera de rango, ids no enteros).
- **Servicio con Prisma mockeado**: `registerPayment` (adherente crea cuota; cesante acota y
  `no_pending_withdrawn`; `already_processed` por consulta y por `P2002` sin consumir
  número; serie por `paidAt`; `entry` con `n = 0`); `refundPayment` (reabre bandeja;
  idempotente); `registerCashPayment` sigue pasando los tests de 4A.
- **Webhook**: cada rama de §6 con gateway mockeado; los dos eventos del mismo cobro → un
  solo `Payment`; fallo técnico → 500; fallo de negocio → 200 con `result`; `refunded`.
- **Reconcile**: cada paso aislado falla sin frenar a los demás; `CronRun` escrito; el CA
  "matar el webhook y correr reconcile" como test del procesador invocado desde el cron.
- **Lote**: tanda parcial, `remaining`, reintento de fallidas.
- **Actions**: autorización (patrón `*-actions-auth.test.ts`) para vincular, bandeja, lote,
  link admin, pagar socio.
- **Integración MariaDB real** (como en 4A): 20 aplicaciones concurrentes del mismo
  `mpPaymentId` → un solo pago, un solo recibo, serie sin huecos.
- **Manual en sandbox local**: Checkout Pro de punta a punta (socio y admin), lote contra
  una suscripción de prueba, notificaciones firmadas a mano (`docs/11` §7 apuntando a
  `localhost:3000`) para `subscription_authorized_payment`, `payment` sin referencia
  (bandeja) y `refunded`.

## 16. Documentación

`docs/06` §3 (`pago:{id}:{n}`), §5 (vinculación real), §6 (divergencia contra
`fee_values`, dos fuentes del cron) y §7; `docs/07` (4B cerrada, CA cumplidos, checklist de
lanzamiento: "suscripciones vinculadas" hecho); `docs/11` (línea del crontab, sandbox
local con token de prueba, bloque §7 con URL parametrizada); `docs/10` §4 reescrito con el
procedimiento real de despliegue (base desde cero, `SET @var` en vez de placeholders);
`docs/04` (`planId` nullable, columnas nuevas de la bandeja); `CLAUDE.md` (patrones 4B,
prioridad → 4C); `.env.example` (nada nuevo).

## 17. Despliegue y calendario

Objetivo: producción **antes del 10/09/2026**.

1. Push → pull en el VPS → `prisma migrate deploy` → build → `pm2 restart`.
2. Instalar `0 3 * * *` `/api/cron/reconcile` en el crontab (bloque copiable en `docs/11`).
3. Mariano vincula las dos suscripciones desde `/admin/tesoreria/suscripciones`.
   Verificación: "Vinculadas" muestra 14 ($6.000) y 306 ($3.000), sin badge divergente.
4. 10/09: el débito del 14 entra por webhook → `Payment.debit` + cuota 2026-09 + recibo
   2026-0000N + email a Mariano. Si el webhook no llega, el reconcile del 11/09 03:00 lo
   registra igual. 21/09: ídem el 306 (sin email por la allowlist).

## 18. Criterios de aceptación de 4B

Sandbox local con notificaciones firmadas a mano salvo donde se indica:

1. Un `subscription_authorized_payment` de una suscripción vinculada genera
   `Payment.debit` + cuota del período + recibo por email; el mismo cobro llegando también
   como `payment` no genera un segundo pago.
2. Un `subscription_authorized_payment` de una suscripción **no** vinculada cae en la
   bandeja con `no_subscription`; vincular la suscripción desde la pestaña aplica esa fila
   sola (pago, cuota, recibo) y la marca `matched`.
3. Un `payment` con `solicitud:{id}` de una solicitud inexistente y suscripción vinculada
   con ese `externalReference` se aplica como débito (el caso del 306).
4. Un `payment` `pago:{id}:2` aplica dos cuotas (las más viejas); con monto distinto se
   aplica igual y queda `link_amount_mismatch`.
5. Un `payment` sin referencia cae en la bandeja y se vincula desde ahí a un socio con N
   cuotas o como voluntario; anular ese recibo reabre la fila.
6. Un `payment` `refunded` de un pago local lo marca `refunded`, anula el recibo y devuelve
   las cuotas a pendientes.
7. Un débito de un cesante se imputa a su deuda congelada; sin pendientes, va a la bandeja.
8. Un débito de un adherente crea y paga la cuota del período.
9. Con el webhook apagado, correr `reconcile` registra el pago igual (por las dos fuentes) y
   deja `CronRun` con el resumen.
10. El lote actualiza el monto de una suscripción de prueba y reporta la que falla, con
    reintento.
11. ASOCIATE paso 2 muestra y cobra el valor de `fee_values` sin ids de plan cargados.
12. Desde `/mi/cuenta` un socio genera un pago de Checkout Pro (sandbox) y, al volver, ve el
    recibo cuando llega la notificación; desde la ficha, el admin genera el link y lo envía
    por email.
13. En producción: las dos suscripciones vinculadas; el débito del 10/09 registrado (por
    webhook o por reconcile).
