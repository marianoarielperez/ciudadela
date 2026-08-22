# Módulo 4 — Tesorería (spec de diseño)

Fecha: 2026-08-21 · Estado: aprobada por Mariano (entrevista de 4 rondas + diseño en 4 bloques)
Referencias: `docs/02-marco-estatutario.md` (REG-07, 14, 15, 16, 31, 33, 34),
`docs/04-modelo-de-datos.md`, `docs/05-flujos-funcionales.md` §5, `docs/06-integracion-mercadopago.md`
§3–§7, `docs/07-plan-de-etapas.md` (Módulo 4 + insumos del M3), `docs/08-seguridad-y-privacidad.md`,
`docs/11-preparacion-mp-sandbox-turnstile.md` Parte I.

## 1. Contexto y alcance

Al cerrar el Módulo 3 no existe una sola tabla de tesorería: la "deuda" es el booleano
`Member.debtAtWithdrawal` importado del Excel, el pago de ingreso vive en dos columnas de
`Application` y los cobros recurrentes de Mercado Pago se trazan (`authorized_payment_traced`)
sin aplicarse a nada. El Módulo 4 construye la cuenta corriente del socio y todo lo que
entra y sale de ella.

**Hechos nuevos que condicionan el diseño** (relevados el 21/08/2026):

- `vecinalciudadela.ar` corre con **credenciales productivas de MP** desde el piloto del
  22/08/2026 (socio 306, alta web con débito real). `EMAIL_ALLOWLIST` sigue definida.
  CLAUDE.md y `docs/07` todavía dicen "credenciales TEST hasta el lanzamiento": hay que
  corregirlo. Consecuencia: **nada del M4 se prueba con plata en producción**; el circuito
  se valida en sandbox local y el piloto productivo es el débito mensual real del 306.
- El padrón definitivo (`datos/padron_socios.xlsx`) tiene **278 filas** (no 283): se
  eliminaron 118, 141, 158, 239, 287 y 288 y se agregó el 306. 160 vigentes = **36 activos +
  124 adherentes** (ya no 55 + 105). 28 huecos de numeración (1–306).
- `datos/deuda.xlsx` (nuevo) trae la deuda **a agosto 2026** como **cantidad de cuotas
  impagas por año** (columnas `cuotas_deuda_2022…2026`), sin montos. 111 bajas con deuda
  congelada (todas `fecha_egreso` 31/08/2025, 8 cuotas de 2025), 8 vigentes con deuda,
  127 adherentes sin datos (cuota optativa). Join por `numero_socio` y DNI: 278/278.
- Las suscripciones se crean **sin plan** y copian el monto (docs/06 §2): cambiar el
  monto en el panel de MP no mueve ningún débito vivo.

**Entra:**

1. Modelo de datos de tesorería (migración nº 7): `FeeValue`, `Fee`, `Payment`, `Receipt`,
   `ReceiptSequence`, `MpUnmatchedPayment`, `CronRun` + retoques a `Notification` y
   `MpSubscription`.
2. Reglas puras: quién devenga, cómo se cuenta la deuda, cómo se imputa un pago, umbrales
   de mora (REG-15), deuda a valor vigente (REG-16), REG-07 con deuda real.
3. Scripts de datos: `import-padron.ts` con `--prune`, `import-deuda.ts` nuevo.
4. Valor de cuota configurable con historial (REG-34) como **única fuente** de montos.
5. Cuenta corriente del socio en la ficha (pestañas) y en `/mi/cuenta` (solo lectura).
6. Registro de efectivo con recibo PDF numerado `AAAA-NNNNN`, impresión y envío por email.
7. Deudores con propuesta de cesantía en lote (con acta).
8. Gateway de MP ampliado; webhook que crea `Payment`/`Receipt` y aplica a cuotas (ingreso,
   débito recurrente, link); links de Checkout Pro; bandeja sin conciliar; vinculación de
   suscripciones preexistentes; conciliación cron; lote REG-34.
9. Crons: devengo, conciliación, aviso del día 30, resumen diario a la Comisión; aviso
   "no pudimos debitar"; avisos fallidos con reintento; `/admin/salud`.
10. Export del padrón electoral (REG-31).
11. Actualización de docs (`04`, `05`, `06`, `07`, `11`, `CLAUDE.md`, `.env.example`).

**Fuera de alcance:**

- Panel de socio transaccional (pagar por link desde `/mi`, solicitar cambio de categoría,
  solicitar baja, adherir al débito) → Módulo 5. El M4 entrega solo la vista de lectura.
- Cancelar la suscripción de MP al dar de baja a un socio → Módulo 5 (docs/06 §7).
- Vitalicio automático (REG-06), feriados/días hábiles (REG-10), pantalla de auditoría,
  webhook de Brevo (estados `delivered`/`bounced`), balances contables (REG-33).
- Pagos parciales de una cuota y saldos a favor: un pago cubre cuotas enteras.
- Firma digitalizada, CUIT y domicilio en el recibo (decidido: solo nombre y logo).

## 2. Modelo de datos (migración nº 7, `add_module_4_treasury`)

Convenciones del repo: tablas `snake_case` con `@@map`, enums en inglés, `Decimal(10,2)`
para dinero, fechas en UTC, `Json?` nunca con `null` pelado.

### 2.1 `FeeValue` — `fee_values` (ValorCuota, REG-34)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | Int autoincrement | |
| `activeAmount` | Decimal(10,2) | cuota de `active` |
| `sharedAmount` | Decimal(10,2) | cuota de `adherent` y `collaborator` (siempre iguales) |
| `validFrom` | DateTime (civil, mediodía UTC) | vigencia |
| `minuteId` | Int? → `Minute` | acta que lo fijó; opcional al registrar, se completa después |
| `createdById` | Int? → `User` | |
| `createdAt` | | |

`@@index([validFrom])`. **El vigente** es la fila de mayor `validFrom ≤ hoy`. Seed inicial:
`6000 / 3000` vigente desde `2026-08-01`, sin acta (corregido el 22/08/2026: con vigencia 01/09 el sistema se quedaba sin monto con qué cobrar hasta septiembre). Función pura `feeAmountFor(category,
value)` → `active` → `activeAmount`; `adherent|collaborator` → `sharedAmount`;
`honorary|lifetime|cadet` → `null` (no pagan).

**Decisión**: esta tabla es la única fuente de montos. La usan el devengo, la valuación de
deuda, el wizard ASOCIATE (reemplaza `makeFeeAmountsReader` y la caché de 24 h, que se
elimina junto con su deuda de invalidación), el registro de efectivo, los links de pago
y el lote que empuja el monto a MP. Las claves `mp_plan_active_id` / `mp_plan_shared_id`
**dejan de ser necesarias**: se conservan en `Configuration` como referencia opcional para
la pantalla de divergencia, y `startPaymentAction` deja de exigirlas.

### 2.2 `Fee` — `fees` (Cuota devengada)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | Int | |
| `memberId` | Int → `Member` (Cascade) | |
| `period` | Char(7) `"YYYY-MM"` | |
| `status` | enum `FeeStatus` `pending \| paid \| exempt \| voided` | |
| `origin` | enum `FeeOrigin` `accrual \| import` | `import` = cuota sintética de `deuda.xlsx` |
| `paymentId` | Int? → `Payment` (SetNull) | el pago que la cubrió |
| `createdAt`, `updatedAt` | | |

`@@unique([memberId, period])` (idempotencia del devengo y del import),
`@@index([status])`, `@@index([memberId, status])`.

Sin columna de monto: la deuda se valúa **siempre a valor vigente al momento del pago**
(generalización de REG-16 acordada en la entrevista). `exempt` queda reservado para una
eximición puntual futura con acta; `voided` para una cuota devengada por error.

### 2.3 `Payment` — `payments`

| Campo | Tipo | Nota |
|---|---|---|
| `id` | Int | |
| `memberId` | Int? → `Member` (SetNull) | null solo para `entry` de una solicitud aún no asentada |
| `applicationId` | Int? → `Application` (SetNull) | |
| `type` | enum `PaymentType` `debit \| link \| cash \| voluntary \| entry \| extraordinary` | |
| `amount` | Decimal(10,2) | |
| `paidAt` | DateTime | fecha de MP (`date_approved`) o del registro en sede |
| `mpPaymentId` | String? VarChar(64) `@unique` | dedupe entre `payment` y `subscription_authorized_payment` |
| `preapprovalId` | String? VarChar(64) | |
| `registeredById` | Int? → `User` | admin que cargó el efectivo |
| `note` | String? VarChar(200) | |
| `status` | enum `PaymentStatus` `applied \| refunded` | |
| `createdAt` | | |

Relaciones: `fees Fee[]`, `receipt Receipt?`. `@@index([memberId, paidAt])`.

### 2.4 `Receipt` — `receipts` y `ReceiptSequence` — `receipt_sequences`

| Campo | Tipo | Nota |
|---|---|---|
| `id` | Int | |
| `number` | Char(10) `@unique` | `"2026-00001"` |
| `year` | SmallInt | |
| `seq` | Int | `@@unique([year, seq])` |
| `paymentId` | Int `@unique` → `Payment` | un recibo por pago |
| `pdfPath` | VarChar(255) | relativo a `RECEIPTS_DIR`: `2026/2026-00001.pdf` |
| `issuedAt` | DateTime | |
| `emailedAt` | DateTime? | |
| `voidedAt`, `voidReason` VarChar(200), `voidedById` | | anulación: nunca se borra ni se renumera |

`ReceiptSequence { year SmallInt @id, last Int }`. La numeración se toma **dentro de la
misma transacción** que crea `Payment` + `Receipt` + actualiza `Fee`:
`INSERT … ON DUPLICATE KEY UPDATE last = last + 1` y lectura de `last` en la misma
transacción (bloqueo de fila de InnoDB). Si la transacción falla, el número no se consumió.
Criterio de aceptación: 20 recibos concurrentes contra MariaDB (Docker) → `00001..00020`
sin huecos ni duplicados. El PDF se genera **después** del commit (el número ya es
definitivo); si la escritura del PDF falla, el recibo existe sin `pdfPath` y se regenera
bajo demanda.

### 2.5 `MpUnmatchedPayment` — `mp_unmatched_payments` (bandeja sin conciliar)

`id`, `mpPaymentId VarChar(64) @unique`, `amount Decimal`, `paidAt`, `payerEmail VarChar(191)?`,
`externalReference VarChar(128)?`, `description VarChar(200)?`, `status` enum `open | matched |
dismissed`, `paymentId Int?`, `resolvedById Int?`, `resolvedAt?`, `createdAt`. `@@index([status])`.
El `payerEmail` es dato personal: se muestra solo al admin y nunca va a la auditoría.

### 2.6 `CronRun` — `cron_runs`

`id BigInt`, `job VarChar(32)` (`fees | reconcile | arrears | digest | applications`),
`startedAt`, `finishedAt?`, `ok Boolean`, `summary Json?` (contadores, nunca datos
personales), `error VarChar(500)?`. `@@index([job, startedAt])`. Todos los endpoints de
cron, incluido el existente, escriben acá además de la auditoría.

### 2.7 Retoques

- `Notification`: `status` suma `failed`; columna `error VarChar(200)?`. `makeMailer`
  registra una fila `failed` cuando el transporte tira (best-effort, código del error sin
  dirección) — hoy un envío fallido no deja rastro consultable (docs/11 §11).
- `MpSubscription`: `amount Decimal(10,2)?` (último monto conocido/empujado),
  `externalReference VarChar(128)?`, `@@index([memberId])`, `@@index([status])`.
- `Member.debtAtWithdrawal` se conserva como dato histórico del Libro 1 pero **deja de
  leerse**: la elegibilidad (`applications/eligibility.ts`), el badge de la ficha y el
  export usan la cuenta corriente real.
- `NotificationType`: se usan `receipt`, `arrears_alert`, `fee_reminder` (ya existen) y se
  agrega `payment_rejected` y `board_digest`.
- `.env`: `RECEIPTS_DIR` (prod `/var/sigev/recibos`, dev `./recibos` gitignored).

## 3. Reglas de negocio puras (`src/lib/treasury/rules.ts`)

Sin Prisma; tabla de casos en `tests/treasury-rules.test.ts`.

- **`accrues(member, period)`**: devenga si `status ∈ {active, suspended}` y
  `category ∈ {active, collaborator}` y `period ≥ firstAccrualPeriod(joinedAt)` =
  **primer mes completo posterior al ingreso** (ingresó 21/08/2026 → primera cuota
  `2026-09`; la cuota de ingreso cubre el mes de alta, REG-14). Bajas no devengan: sus
  pendientes quedan congeladas. Suspendidos devengan (la suspensión es disciplinaria, no
  eximición). Adherentes, honorarios, vitalicios y cadetes no devengan.
- **`pendingCount(fees)`** y **`debtAmount(count, category, feeValue)`** = `count ×
  feeAmountFor(category)`. Para bajas y reingresos (REG-16) se usa la categoría con la que
  reingresa.
- **`arrearsLevel(count)`**: `0` al día · `1` una cuota · `2–3` "en mora" (alerta) ·
  `≥4` "candidato a cesantía" (REG-15: la declaración es humana, nunca automática).
- **`allocate(pendingFees, n, currentPeriod)`**: devuelve las `n` cuotas a marcar
  `paid`, las **más antiguas primero**; si faltan pendientes, completa creando la del
  período corriente y siguientes (un socio al día que paga por adelantado). Un **débito de
  suscripción = una cuota**, cualquiera sea el monto (cubre suscripciones preexistentes
  con monto viejo). Un **link** trae `n` en su `external_reference`. **Efectivo**: `n`
  elegido por el admin, monto = `n × valor vigente`. `voluntary` y `extraordinary` no se
  imputan a cuotas. `entry` no se imputa.
- **`canChangeCategory`** (`members/rules.ts`) suma `pendingCount === 0` (REG-07, cierra
  la deuda anotada). El bloqueo `debt` del wizard (`eligibility.ts`) pasa a
  `pendingCount > 0` para cualquier baja, no solo `arrears`.
- **`electoralRoll(members, electionDate)`** (REG-31): activos, honorarios, colaboradores,
  vitalicios y adherentes con ≥90 días a la fecha; activos y colaboradores además con 0
  pendientes.

## 4. Scripts de datos

### 4.1 `scripts/import-padron.ts`

- Constantes de control: `EXPECTED_ROWS = 278`, `EXPECTED_ACTIVE = 160`, `EXPECTED_GAPS`
  con los 28 huecos (22 históricos + 118, 141, 158, 239, 287, 288). Máximo 306.
- Nuevo modo **`--prune`** (exige también `--yes`): lista los `Membership` del Libro 1 cuyo
  `memberNumber` no está en el Excel y **borra físicamente** `Member` + `Membership` +
  `Movement` + `Notification` + `ActionToken`. **Aborta sin borrar nada** si alguno tiene
  `User`, `Application`, `MpSubscription`, `Payment` o `Fee` (ninguno de los 6 debería).
  Asiento `padron_prune` con los números borrados (no son dato personal).
- Se corre en producción **una sola vez** con `--update-existing --prune --yes` para
  aplicar los 21 cambios de categoría, el nombre del 99, el débito del 220 y la
  eliminación de los 6. El 306 ya existe (alta web): el import lo encuentra por
  `(bookId, 306)` y no lo toca.
- Datos a revisar por Mariano antes de correr (el script los lista como warnings, no
  aborta): socios 31 y 32 (`activo = No` sin fecha ni motivo de baja), socio 282
  (`Activo` en padrón, `Adherente` en deuda: manda el padrón).

### 4.2 `scripts/import-deuda.ts` (nuevo)

- Lee `datos/deuda.xlsx`, hoja `deuda`, columnas por nombre; ignora las tres columnas
  vacías. Aborta ante cualquier fila sin match **por número y por DNI** con la base.
- Por socio y por año con `N > 0`: crea `N` filas `Fee{ period, status: pending,
  origin: import }` en los **últimos `N` meses de ese año** (2025 = 8 → ene–ago; 2024 =
  12 → todo el año; 2023 = 11 → feb–dic). Blanco = no corresponde (no crea nada).
- Idempotente: si el socio ya tiene alguna `Fee` con `origin: import`, se saltea y cuenta
  como `unchanged`. Nunca toca cuotas `accrual`.
- Una transacción por socio. Reporte con totales (esperado: 3080 cuotas, 119 socios con
  deuda, 28 al día con datos, 131 sin datos) y asiento `debt_import` solo con contadores.

### 4.3 Seed

`prisma/seed.ts` siembra `FeeValue{6000, 3000, validFrom 2026-08-01}` con `upsert`
sobre `validFrom` (no pisa si ya existe) y crea `RECEIPTS_DIR` si falta.

## 5. Mercado Pago

### 5.1 Gateway (`src/lib/mp/gateway.ts`, misma factory, mismo mock de interfaz)

Cambios en los métodos existentes:

- `getPayment(id)` → `{ id, status, statusDetail, transactionAmount, externalReference,
  dateApproved: Date | null, paymentTypeId, payerEmail, description }`.
- `getAuthorizedPayment(id)` → `{ id, preapprovalId, status, paymentId: string | null,
  amount, dateCreated, externalReference }`.
- `getPreapproval(id)` → suma `amount` (`auto_recurring.transaction_amount`) y `reason`.

Nuevos:

- `searchPreapprovals({ status? })` → `GET /preapproval/search` paginado, devuelve
  `{ id, status, payerEmail, externalReference, amount, reason, dateCreated }[]`.
- `searchPayments({ since })` → `GET /v1/payments/search` (`range=date_approved`,
  últimas 72 h), mismo shape que `getPayment`.
- `searchAuthorizedPayments(preapprovalId)` → `GET /authorized_payments/search`
  (fetch directo, como `getAuthorizedPayment`): única forma de hallar los cobros de una
  suscripción (docs/11 §7).
- `createPreference({ title, amount, externalReference, backUrl, notificationUrl })` →
  `POST /checkout/preferences` (Checkout Pro) → `{ id, initPoint }`.

### 5.2 Convenciones de `external_reference`

| Referencia | Origen | Qué hace el webhook |
|---|---|---|
| `solicitud:{id}` | preapproval del wizard (ya existe) | ingreso o débito recurrente, ver 5.3 |
| `socio:{memberId}` | preapproval que SIGeV cree para un socio existente (M5). Las preexistentes vinculadas a mano **no** se retocan en MP: se resuelven por `preapprovalId` → `MpSubscription.memberId` | débito |
| `pago:{memberId}:{n}` | preferencia de Checkout Pro | link, aplica `n` cuotas |

### 5.3 Webhook (`src/lib/mp/webhook-processor.ts`)

Mismo endpoint, misma firma, misma idempotencia por `WebhookEvent`. Cambios:

- **`payment` approved, ref `solicitud:{id}`**:
  - la solicitud **no** tiene `mpPaymentIdEntry` → comportamiento actual **+** crea
    `Payment{ type: entry, applicationId, memberId: app.memberId ?? null, mpPaymentId }` +
    `Receipt` + email `receipt` con el PDF adjunto. Al asentar el alta, `record.ts` cuelga
    el `Payment.entry` del `Member` (como ya hace con `MpSubscription`).
  - la solicitud **ya** tiene `mpPaymentIdEntry` y es **otro** id → es un **débito
    recurrente** de la suscripción del socio vinculado (`MpSubscription.memberId`) →
    `Payment{ type: debit }` + `allocate(1)` + recibo + email. Si la solicitud no tiene
    `memberId` todavía (pagó dos veces antes del asiento) → `duplicate_entry_payment`:
    va a la bandeja sin conciliar. Cierra los insumos 3 y 4 del M3.
- **`payment` approved, ref `pago:{memberId}:{n}`** → `Payment{ type: link }` +
  `allocate(n)` + recibo + email. Monto distinto al esperado (`n × valor vigente` al
  emitir el link) → se aplica igual y se audita `link_amount_mismatch`.
- **`subscription_authorized_payment`** → `getAuthorizedPayment` → si `paymentId` ya
  existe como `Payment.mpPaymentId` → `already_processed`; si no → resuelve
  `MpSubscription.memberId` → `Payment{ type: debit }` + `allocate(1)` + recibo + email.
  Sin suscripción local → bandeja sin conciliar.
- **`payment` approved sin match** → `MpUnmatchedPayment{ open }`, resultado `no_match`
  (nunca error).
- **`payment` `refunded`/`charged_back`** con `Payment` local → `Payment.refunded`,
  recibo anulado con motivo `"Reembolso en Mercado Pago"`, cuotas vuelven a `pending`,
  asiento `payment_refunded`.
- **`payment` `rejected`** de una suscripción vinculada a un socio → email
  `payment_rejected` "No pudimos debitar tu cuota; Mercado Pago va a reintentar" (una vez
  por `mpPaymentId`; fase 4C).

Toda la escritura (pago + cuotas + número de recibo) va en **una transacción**; el PDF y
el email van después del commit y son best-effort con rastro (`Notification.failed`).

### 5.4 Conciliación (`POST /api/cron/reconcile`, diario 03:00)

1. `searchPayments({ since: 72 h })` approved sin `Payment.mpPaymentId` y sin
   `MpUnmatchedPayment` → se procesan con el mismo `webhookProcessor` (resultado idéntico
   al webhook perdido). CA: matar el webhook y correr el cron registra el pago igual.
2. `searchPreapprovals()` con ref `solicitud:{id}` sin `MpSubscription` → si la solicitud
   está viva o completada, crea la fila; si está `expired`/`rejected`, `cancelPreapproval`
   (insumo 1 del M3 y el residual de `startPaymentAction`).
3. Estado de cada `MpSubscription` viva ≠ MP → se sincroniza (`status`, `amount`,
   `lastSyncAt`); cancelada/pausada del lado de MP → contador `subscriptionsDrifted`.
4. Suscripciones vivas con `amount ≠ feeAmountFor(categoría del socio)` → contador
   `amountDivergent` + lista en `/admin/tesoreria/valores`.
5. Planes de referencia (si están configurados) con monto ≠ `FeeValue` → aviso
   informativo en `valores`.

Resumen en `CronRun.summary` y auditoría `reconcile_cron`. Lista de preapprovals
desalineados sin datos personales (solo `preapprovalId`, `memberId`, montos).

### 5.5 Lote REG-34 ("Aplicar el valor vigente a las suscripciones")

Server action en `/admin/tesoreria/valores` (superadmin): toma las `MpSubscription`
`authorized` cuyo `amount` ≠ valor vigente de la categoría del socio, las recorre **en
serie** con `updatePreapprovalAmount`, escribe `amount` + `lastSyncAt` por cada éxito, y
devuelve `{ updated, failed: [{ preapprovalId, memberId, code }] }`. La pantalla muestra
progreso por bloques (la acción procesa hasta 25 por llamada y el cliente la reinvoca
hasta vaciar), "quedaron N sin actualizar" con botón "Reintentar las que fallaron", y
asiento `fee_value_applied` por lote. Decenas a pocos cientos de llamadas, ≤4 veces al año.

### 5.6 Vinculación de suscripciones preexistentes

Pestaña `suscripciones`: `searchPreapprovals({ status: "authorized" })` menos las que ya
tienen fila local → por cada una, sugerencia de socio por `payerEmail` exacto y, si no,
por apellido del `reason`/payer; el admin elige el socio (combobox) y confirma →
`MpSubscription{ preapprovalId, memberId, linkedManually: true, status, amount, payerEmail,
planId: "" }` + `Member.autoDebit = true` + asiento `subscription_linked`. Sus cobros
futuros entran por `subscription_authorized_payment` y conciliación. Con el token
productivo la pantalla ya ve las suscripciones reales.

### 5.7 Links de pago (Checkout Pro)

Desde la cuenta corriente del socio (admin): "Generar link por N cuotas" →
`createPreference({ title: "Cuota Vecinal Ciudadela × N", amount: n × valor,
externalReference: "pago:{memberId}:{n}", backUrl: "{AUTH_URL}/mi/cuenta",
notificationUrl: "{AUTH_URL}/api/webhooks/mp" })` → se muestra el link para copiar y un
botón "Enviar por email" (`fee_reminder`). No se persiste la preferencia: el pago se
reconoce por la referencia.

## 6. Pantallas

Todas heredan el shell (`PageHeader`, `FormMessage`, `EmptyState`, `status-badges`,
`synced-fields`, `useFormResetSync`). Autorización en cada página y server action
(`requireAdmin`/`requireSuperadmin`/`requireMember`), no en el layout.

### 6.1 Navegación

- `nav.ts`: **Tesorería** (`/admin/tesoreria`, icono `wallet`) en Gestión, después de
  Socios; **Salud** (`/admin/salud`, icono `activity`, `superadminOnly`) en Sistema.
- `dashboard-cards.ts`: la tarjeta Tesorería recibe `href` (deja de ser "Próximamente");
  tarjeta Salud en Sistema.
- `status-badges.ts`: `feeStatusBadgeVariant`, `arrearsBadgeVariant(level)`,
  `receiptBadgeVariant(voided)`, `unmatchedBadgeVariant(status)`.

### 6.2 `/admin/tesoreria` — pestañas por URL

`src/app/admin/tesoreria/layout.tsx` renderiza el `PageHeader` "Tesorería" y una barra de
pestañas hecha con **links** (`aria-current="page"` en la activa, `min-h-11`, scroll
horizontal en móvil); cada pestaña es una ruta hija. `/admin/tesoreria` redirige a
`deudores`. Radix `Tabs` queda para la ficha del socio (no navega).

| Ruta | Contenido |
|---|---|
| `deudores` | Tabla: N°, socio, categoría, cuotas adeudadas (cifra en mono), deuda `$`, último pago, badge de nivel. Filtros `?nivel=2\|4` y `?q`. Tildado masivo (patrón `RecordForm`) + "Proponer cesantía" → pantalla de confirmación con `MinutePicker` y lista de los tildados → `memberService.withdraw` por cada uno con `reason: arrears` → `?declaradas=N`. Solo aparecen tildables los de nivel ≥4. |
| `efectivo` | Combobox de socio (busca por N°, apellido, DNI; patrón `street-autocomplete`, datos por `?q` server-side) → tarjeta con categoría, cuotas adeudadas, valor vigente → formulario: `concepto` (`Cuotas × N` / `Aporte voluntario` / `Aporte extraordinario`), `n` o `monto`, `nota` → "Registrar y emitir recibo" → redirige a `recibos/[id]` con `?emitido=1`. Adherentes: solo voluntaria/extraordinaria. Honorarios/vitalicios: solo extraordinaria. |
| `recibos` | Tabla: número, fecha, socio, concepto, medio, monto, estado (enviado/anulado). Filtros `?mes`, `?q`, `?medio`. Paginación 50 (`pageHref` se extrae a `src/lib/admin/pagination.ts` y lo reusan padrón y solicitudes). |
| `recibos/[id]` | Vista del recibo (mismos datos que el PDF) con acciones: **Imprimir** (abre el PDF), **Enviar por email** (si el socio tiene email; muestra `emailedAt`), **Anular** (detrás de `<details>`, con motivo obligatorio; superadmin o admin). |
| `sin-conciliar` | Tabla de `MpUnmatchedPayment{ open }`: fecha, monto, email del pagador, referencia, descripción → "Vincular a socio" (combobox + `n` cuotas o voluntaria) crea `Payment{ type: link\|voluntary }` + recibo; "Descartar" con motivo. Historial en `?estado=resueltos`. |
| `suscripciones` | Dos bloques: "Sin vincular" (5.6) y "Vinculadas" (socio, estado, monto, último sync, divergencia). |
| `valores` | Valor vigente (dos montos grandes, vigencia, acta), historial, estado de las suscripciones (N alineadas / N desalineadas) con el botón del lote (5.5), aviso de planes de referencia divergentes. El **alta de un valor nuevo** vive en `/admin/configuracion` (sección "Tesorería — valor de cuota": activo, adherente/colaborador, vigente desde, acta opcional via `MinutePicker`; superadmin; asiento `fee_value_create`). |

### 6.3 Ficha del socio con pestañas (`/admin/socios/[id]`)

La grilla de 5 cards pasa a `Tabs` (Radix, `variant="line"`) con `?tab=` para deep-link:
**Ficha** (datos personales + documentos) · **Cuenta corriente** · **Historial**
(movimientos + notificaciones) · **Acceso** (portal + verificación). El header conserva los
badges y suma **"Debe N cuotas"** (badge por nivel) cuando `pendingCount > 0`.

**Cuenta corriente** — la firma visual del módulo es la **cinta de períodos**: una fila
por año desde el primer período con datos, 12 celdas (E F M A M J J A S O N D) coloreadas
por estado (`paid` success · `pending` warning, `≥4` destructive · `import` pending con
trama · `exempt` muted · futuro/antes del ingreso vacío), cada celda con `title` y texto
`sr-only` ("Marzo 2025: pendiente"). Es un `<table>` semántico con `role="grid"`, no un
canvas: imprime y se lee con lector de pantalla. Encima, una línea resumen: "Debe **N
cuotas** · $ X a valor vigente · desde {período más viejo}". Debajo, el **libro de pagos**
(tabla: fecha, concepto, períodos, medio, monto en mono, recibo con link) y las acciones
admin: "Registrar efectivo" (link prellenado a `efectivo?socio=`), "Generar link de pago",
"Ver recibos".

Pantalla de **reingreso** (`[accion]=reingreso`): reemplaza el aviso "disponible con el
Módulo 4" por el cálculo real: "Debe N cuotas = $ X a valor vigente (REG-16). Registrá el
cobro en efectivo antes de confirmar" con link a `efectivo?socio=`; el botón se habilita
igual (decisión humana) y audita `pendingCount` al confirmar.

### 6.4 `/mi/cuenta` (socio, solo lectura)

Misma cinta de períodos y libro de pagos, en el `Shell` de `/mi`: "Hola {nombre}" → tarjeta
"Debés N cuotas ($ X)" o "Estás al día" → cinta → recibos con botón "Descargar" por
`/api/mi/recibos/[id]`. Adherentes: "Tu aporte es voluntario" + sus recibos. La tarjeta
"Mi cuenta" de `/mi` recibe `href`. Nada de pagar ni de cambiar categoría (M5).

### 6.5 Recibo PDF

`src/lib/treasury/receipt-pdf.ts` con **`pdf-lib`** (puro JS, sin binarios; fuentes
estándar embebidas, logo desde `assets/logo.png` en memoria). A4, una página: logo + nombre
de la asociación arriba; **número `2026-00001` grande** a la derecha; fecha; "Recibimos de
{socio} (N° {número})"; concepto con períodos ("Cuota social · marzo a mayo 2025 (3
cuotas)"); medio de pago; monto en letras y en cifras; leyenda "Comprobante interno de la
asociación"; "ANULADO — {motivo}" en diagonal si `voidedAt`. Se escribe en
`RECEIPTS_DIR/{año}/{número}.pdf` y se sirve por:

- `GET /api/admin/recibos/[id]` (`requireAdmin`, `no-store, private`, `nosniff`, asiento
  `receipt_view`).
- `GET /api/mi/recibos/[id]` (`requireMember`, solo si `payment.memberId === memberId`;
  sin asiento: el socio ve lo propio).

Si el archivo falta (restore parcial, fallo al emitir), se regenera desde la base al pedirlo.

### 6.6 `/admin/salud` (superadmin)

Tarjetas por cron (`fees`, `reconcile`, `arrears`, `digest`, `applications`): última
corrida, ok/fallo, resumen, "hace X horas" con badge `warning` si supera el doble del
intervalo; antigüedad del backup (lee `LAST_OK` en `BACKUP_DIR`, ya lo escribe
`backup.sh`); contadores: sin conciliar abiertos, suscripciones desalineadas, avisos
fallidos; tabla de **avisos que no salieron** (`Notification.failed`, últimos 50) con
"Reintentar" por fila (re-renderiza la plantilla desde su tipo + destino y vuelve a enviar;
asiento `notification_retry`).

### 6.7 Dirección visual

Se mantienen los tokens del shell (`--primary #0079BC`, `--success`, `--warning`, sidebar
`#003C5F`). Lo propio del módulo: **cifras en `font-mono` con `tabular-nums`** para
montos, cantidades de cuotas y números de recibo (Geist Mono ya está cargada); la cinta de
períodos como único elemento "de autor"; nada de gradientes ni iconografía decorativa.
Responsive: pestañas con scroll horizontal, tablas dentro de `overflow-x-auto`, cinta que
baja a 6 celdas por fila bajo `sm`. Foco visible en todo control (`focus-visible:ring`).
Copy: verbos que dicen lo que pasa ("Registrar y emitir recibo", "Anular recibo",
"Aplicar a 38 suscripciones"); el éxito repite el verbo ("Recibo 2026-00012 emitido").

## 7. Emails (plantillas nuevas en `templates.ts`)

| Plantilla | Tipo | Recibe | Cuándo |
|---|---|---|---|
| `receiptEmail` | `receipt` | `{ name, number, concept, amount }` + adjunto PDF | cada recibo emitido (efectivo con email, débito, link, ingreso) |
| `arrearsNoticeEmail` | `arrears_alert` | `{ name, count, amount, periods }` | día 30 (§8) — notificación fehaciente |
| `paymentRejectedEmail` | `payment_rejected` | `{ name }` | webhook `rejected` de suscripción vinculada |
| `paymentLinkEmail` | `fee_reminder` | `{ name, count, amount, url }` | "Enviar por email" de un link |
| `boardDigestEmail` | `board_digest` | `{ date, sections }` | 09:00 a admins (§8) |

`MailMessage` suma `attachments?: { filename, content: Buffer, contentType }[]`; el
transporte de consola los lista por nombre y tamaño. Todas llevan `text` y `html`. Por
privacidad: el digest **no** lleva DNIs ni emails de socios, solo nombres, números y
contadores.

## 8. Crons

Patrón del endpoint existente (`runtime nodejs`, `CRON_SECRET` timing-safe, 503/401/500,
asiento + `CronRun`). Crontab del VPS (hoy **vacío**, ni siquiera el del M3) con
`CRON_TZ=America/Argentina/Buenos_Aires` al tope del bloque:

| Crontab | Endpoint | Qué hace |
|---|---|---|
| `5 8 * * *` | `/api/cron/applications` | (existente) |
| `0 3 * * *` | `/api/cron/reconcile` | §5.4 |
| `0 6 * * *` | `/api/cron/fees` | crea la `Fee` del período corriente para cada socio que `accrues()` y no la tiene. Idempotente por el unique → corre **todos los días**: el día 1 devenga, los demás repara (socio reingresado, corrida perdida). Primer período: `2026-09`. |
| `0 9 * * *` | `/api/cron/digest` | arma el resumen del día anterior (00:00–24:00 AR): solicitudes nuevas / aceptadas por pago / asentadas / rechazadas, recategorizaciones, pagos recibidos por medio, recibos emitidos, sin conciliar nuevos, avisos fallidos. Si todo es 0 **no envía**. Destinatarios: `User` activos con rol `admin` o `superadmin`. |
| `0 20 28-31 * *` | `/api/cron/arrears` | solo actúa si hoy es el **día 30**, o el último día del mes cuando el mes no tiene 30 (febrero). A cada socio `active` con `pendingCount ≥ 1` y `email` (`declared` o `verified`) le envía `arrearsNoticeEmail`; una sola vez por mes por socio (chequea `Notification{ type: arrears_alert, sentAt en el mes }`). Bajas no reciben nada. |

`docs/11` Parte H se reescribe con el bloque completo. Todos devuelven contadores; ninguno
devuelve datos personales.

## 9. Seguridad y privacidad

- Rutas de recibos autenticadas con `no-store`, `nosniff`; vista admin auditada
  (`receipt_view`), vista del socio restringida a lo propio.
- `RECEIPTS_DIR` fuera del webroot, 750, ya incluido en `backup.sh`. Un recibo es
  registro institucional: no se borra a pedido (docs/08); se anula.
- Auditoría (`detail` solo con ids, códigos, contadores, montos): `cash_payment_create`,
  `receipt_void`, `receipt_email`, `receipt_view`, `payment_refunded`,
  `link_amount_mismatch`, `payment_link_create`, `unmatched_resolve`,
  `subscription_linked`, `fee_value_create`, `fee_value_applied`, `arrears_declared`
  (por socio, via `withdraw`), `fees_cron`, `reconcile_cron`, `arrears_cron`,
  `digest_cron`, `notification_retry`, `electoral_roll_export`, `padron_prune`,
  `debt_import`.
- Efectivo y anulación: rate limit no aplica (admin autenticado); sí un `keyed-mutex` por
  `memberId` alrededor de registrar pago / anular para que dos admins no imputen la misma
  cuota dos veces (la transacción y el unique lo impiden igual; el mutex evita el error
  feo).
- Mensajes de zod en castellano; `redirect` fuera de `try`.

## 10. Tests

- Puros (`tests/treasury-*.test.ts`): reglas (§3) con tabla de casos; `allocate`;
  `firstAccrualPeriod`; `arrearsLevel`; período del día 30 / febrero; `electoralRoll`;
  asignación de meses del import (`2023: 11 → feb–dic`); formato de número de recibo.
- Servicios con Prisma inyectado: `makeTreasuryService` (registrar efectivo, anular,
  aplicar webhook) con dobles; `makeFeesCron`, `makeReconcileCron`, `makeArrearsCron`,
  `makeDigestCron`.
- Webhook processor: casos nuevos (ingreso → Payment+Receipt; segundo pago de
  `solicitud:` → débito; `pago:` → link; sin match → bandeja; refunded → anulación;
  authorized_payment duplicado → `already_processed`).
- Gateway: cuerpo exacto de `createPreference` y parseo de los `search` con el SDK
  mockeado (`vi.hoisted`), como `mp-gateway.test.ts`.
- Rutas: los 4 endpoints de cron (503/401/200/500 + `CronRun`), `/api/admin/recibos/[id]`
  (auth + auditoría + 404 sin auditar), `/api/mi/recibos/[id]` (no sirve recibos ajenos).
- Actions: `*-actions-auth.test.ts` por dominio (rechazo no escribe, no audita, no
  redirige); anulación exige motivo; efectivo rechaza `n = 0`, adherente con "cuotas".
- **Integración con MariaDB en Docker** (`tests/integration/receipt-sequence.test.ts`,
  script `npm run test:integration`, se salta si no hay `DATABASE_URL_TEST`): 20 recibos
  en paralelo → sin huecos ni duplicados.
- Nav/dashboard/badges: los tests existentes se extienden con las rutas nuevas.
- Scripts: `padron-mapping` sigue puro; `import-deuda` expone `planImportRows(rows)` puro
  y se testea la asignación de meses y los abortos.

## 11. Actualización de documentación

- `CLAUDE.md`: conteos del padrón (278 / 160 = 36 + 124 / 28 huecos / 1–306), `deuda.xlsx`
  en "Datos incluidos", estado real de credenciales (productivas desde 22/08/2026,
  allowlist vigente), `RECEIPTS_DIR`, regla "la tabla local de valor de cuota es la única
  fuente de montos", patrón "pestañas por URL para secciones; Radix Tabs para vistas que
  no navegan".
- `docs/04`: entidades de tesorería tal como quedaron (sin monto en Cuota; `ReceiptSequence`;
  `MpUnmatchedPayment`; `CronRun`).
- `docs/05` §5: pantallas reales de Tesorería y la ficha con pestañas.
- `docs/06`: §1 (los planes dejan de gobernar nada), §3 (Checkout Pro implementado), §4
  (qué hace el webhook con cada caso), §5, §6 y §7 marcados implementados.
- `docs/07`: M4 cerrado por fases; insumos del M3 1–6 y 8 resueltos o reubicados; checklist
  de lanzamiento ajustado (los ids de plan dejan de ser obligatorios; crontab completo).
- `docs/11`: Parte H con el crontab completo y `CRON_TZ`; Parte I nota sobre el estado
  productivo.
- `.env.example`: `RECEIPTS_DIR`, `BACKUP_DIR`.

## 12. Fases y criterios de aceptación

Cada fase es un branch propio, se mergea a `main` con los tests en verde y se despliega
antes de empezar la siguiente.

**4A — Cuenta corriente y efectivo**
Migración 7, reglas, `FeeValue` + configuración, scripts de datos, ficha con pestañas y
cinta, `/mi/cuenta`, efectivo + recibos PDF + email + anulación, deudores + cesantía en
lote, REG-07/REG-16, `pagination.ts`, docs.
CA: en local con el padrón y la deuda importados, Skardius (144) muestra 23 cuotas
pendientes y $ 138.000; registrar 3 cuotas en efectivo emite `2026-00001`, marca pagas
oct–dic 2024 (las tres más viejas: su `2024 = 3` se importó como oct–dic), adjunta el PDF al email de prueba y la cinta lo
refleja; anularlo las devuelve a pendientes y el número no se reutiliza; 20 efectivos
concurrentes → `00002..00021`; en Deudores aparecen los 8 vigentes con deuda y solo los
de ≥4 son tildables; cambiar de categoría a un socio con deuda está bloqueado.

**4B — Mercado Pago**
Gateway ampliado, webhook que aplica, Checkout Pro, bandeja sin conciliar, vinculación,
conciliación cron, lote REG-34, eliminación de la caché de planes.
CA (sandbox local, notificaciones a mano): un `subscription_authorized_payment` de prueba
genera `Payment.debit` + cuota del período + recibo por email; un pago `pago:{id}:2` aplica
dos cuotas; un pago sin referencia cae en la bandeja y se vincula desde ahí; matar el
webhook y correr `reconcile` registra el pago igual; el lote actualiza el monto de una
suscripción de prueba y reporta la que falla.

**4C — Notificaciones y salud**
Crons `fees`, `arrears`, `digest`; `payment_rejected`; `Notification.failed` + reintento;
`/admin/salud`; padrón electoral; crontab documentado.
CA: correr `fees` dos veces el mismo día crea una sola cuota por socio; `arrears` en un día
que no es 30 no envía nada y el 30 envía a los 8 deudores de prueba una sola vez;
`digest` sin novedades no envía y con una solicitud nueva envía a los admins; un email
con el transporte roto queda `failed` y "Reintentar" lo saca; `/admin/salud` muestra las
cinco corridas y el backup.
