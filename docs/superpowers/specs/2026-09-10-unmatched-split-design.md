# Reparto de un pago de Mercado Pago entre socios (bandeja Sin conciliar): diseño aprobado

**Fecha:** 10/09/2026 · **Estado:** aprobado por el operador (trece decisiones de producto + modelo + cuatro secciones)

El 08/09/2026 entró en producción un pago de Mercado Pago de $ 18.000 sin
referencia (transferencia, descripción "Varios", id de pago 177043986281) que
quedó en la bandeja Sin conciliar. Corresponde a tres cuotas de $ 6.000: dos del
socio N° 192 y una de la socia N° 193, matrimonio con la misma casilla. Hoy la
pantalla Resolver sólo sabe atribuir el cobro **entero a un socio**. Este módulo
le enseña a la bandeja a **repartir** un cobro de MP entre hasta cinco socios,
cada uno con su recibo numerado, en una sola transacción, sin tocar las barreras
de idempotencia del dinero de MP. De paso cierra tres huecos de la bandeja que
ninguna otra pantalla de cobro tiene y destraba el callejón de la fila reabierta.

---

## 1. Alcance

1. **Reparto en la bandeja.** Desde `/admin/tesoreria/sin-conciliar/[id]` un
   cobro abierto se asigna a 1..5 socios, cada uno con concepto (según su
   categoría), cantidad de cuotas e importe. La suma de las partes tiene que ser
   **exactamente** lo cobrado. Un solo socio es el caso particular de una parte.
2. **Un recibo por socio**, numerado sin huecos, emitido dentro de la misma
   transacción que asienta todas las partes. Cada recibo lleva la leyenda de pago
   compartido cuando su importe es menor al del cobro.
3. **Fila parcial.** Si una parte se anula, la fila vuelve a la bandeja como
   `partial` con el importe sin asignar, y ese resto se asigna a otro socio desde
   la misma pantalla. Si se anulan todas, la fila vuelve a `open` y **se puede
   volver a aplicar** (hoy no se puede).
4. **Reembolso o contracargo de MP** revierte todas las partes del cobro.
5. **Tres huecos cerrados:** la bandeja pasa a ofrecer los conceptos **por
   categoría** (la misma función que Efectivo), a respetar la **exención
   vigente** (la misma función que las otras cinco guardas) y a exigir que las
   partes sumen lo cobrado (hoy $ 18.000 se pueden asentar como una cuota sin
   aviso).
6. **Sugerencia por casilla:** los socios del libro abierto cuya casilla es la
   del pagador se ofrecen arriba del buscador.
7. **Etiqueta del medio:** el tipo `link` pasa a decir "Mercado Pago" en recibo,
   email y cuenta corriente (era "Link de pago", falso para una transferencia).

**Lo que NO cambia:** el webhook, la conciliación diaria, la vinculación de
suscripciones, Efectivo, el link de pago, `/mi/cuenta` y la cuota de ingreso
siguen llamando a `registerPayment` tal cual. La lista de la bandeja sólo aprende
a mostrar varios recibos por fila y el estado Parcial. **Fuera de alcance:** §12.

---

## 2. Decisiones del operador (10/09/2026)

| # | Decisión | Elección |
|---|---|---|
| 1 | Tope de socios por cobro | **5**. Cubre matrimonio, familia o un vecino que paga por varios; cinco recibos entran holgados en el timeout de 5 s de Prisma (se mide en integración, §10) |
| 2 | Importe de cada parte | **Cuotas por socio, importe editable, suma exacta.** Se prellena n × valor vigente de su categoría y se puede corregir; para confirmar, "Sin asignar" tiene que dar $ 0 |
| 3 | Anulación de una parte | **Se anula sola y el resto se reasigna desde la bandeja** (fila `partial`). Descartadas: anular todo y reabrir (deja el callejón de hoy), o no permitir anular partes |
| 4 | Leyenda en el recibo | **Sí**: "Parte de un pago de $ 18.000,00 cobrado por Mercado Pago el 08/09/2026." Sin contar socios, para que no envejezca (§7) |
| 5 | Conceptos por categoría | **Misma regla que Efectivo** (`cashConceptsFor`): un adherente no recibe cuotas sociales desde la bandeja |
| 6 | Exención vigente | **Se aplica**: un exento sólo puede recibir un aporte, nunca cuotas. Misma función `activeExemption` |
| 7 | Alcance visual | **Sólo Resolver y su vista de resuelto.** La lista sólo aprende varios recibos por fila y el estado Parcial |
| 8 | Sugerencia por casilla del pagador | **Sí**, arriba del buscador, como pista con un clic |
| 9 | Confirmación | **Dos pasos con el detalle resuelto en el servidor** (patrón del lote de cesantía): qué cuotas se imputan a cada socio, importes y total; Enter bloqueado en el panel |
| 10 | Etiqueta del medio | **`link` → "Mercado Pago"**. Descartado un tipo nuevo `transfer`: la app no puede saber el medio real (el gateway no lee `payment_type_id`) |
| 11 | Los $ 18.000 de producción | **Esperan el despliegue.** No hay forma correcta de repartirlos a mano: aplicarlos enteros a uno y cargar un efectivo al otro inventa caja que no entró |
| 12 | Verificación del reembolso | **Unitarios + integración contra MariaDB local.** El reparto nunca llama a MP; el aviso de refund ya está medido en la 4B |
| 13 | Modelo | **Portador + partes en una sola transacción** (§4). Descartados: N transacciones (una falla entre partes deja plata sin asentar) y pago padre sin recibo (una especie nueva que cada lector de `payments` tendría que aprender a saltear) |

---

## 3. Hallazgos que condicionan el diseño (medidos en el código el 10/09/2026)

- **Un cobro de MP = un `Payment` = un socio = un recibo**, por tres uniques
  (`payments.mp_payment_id`, `mp_unmatched_payments.mp_payment_id`,
  `other_incomes.mp_payment_id`) y un solo puntero `paymentId` en la fila de la
  bandeja. `Receipt.paymentId` es único. Nada de esto se toca.
- **`registerPayment` acepta un socio y un monto libre.** `amount` es "lo cobrado
  de verdad" y no se compara con `n` ni con el valor vigente; `n` lo tipea el
  operador. La bandeja reusa `type: "link"` con el monto entero de la fila.
- **El cierre de la fila ocurre DENTRO de la transacción del cobro** (entre las
  cuotas y el número) y **la reapertura al anular se acota por `paymentId`**. El
  sello `resolvedById` se escribe hoy fuera de la transacción (si falla, la
  pantalla dice "automático" sobre una resolución manual).
- **Anular no borra `mpPaymentId`**, y por eso una fila reabierta responde "ya
  está asentado" al volver a aplicarla: callejón anotado en `actions.ts` y en
  `docs/07`. Este diseño lo destraba sin tocar la barrera (§5.3).
- **`refundPayment` busca UN recibo por `payment.mpPaymentId` con `findFirst`**:
  determinístico hoy por el unique, arbitrario ante cualquier grupo.
- **Un pago sin referencia no escribe ninguna línea en PM2.** Su origen (webhook
  o conciliación) está en `webhook_events` y `cron_runs`; el medio de pago y el
  titular sólo están en el panel de MP. Nada de eso afecta el diseño.
- **La spec del M4 dejó fuera de alcance "pagos parciales y saldos a favor"**, y
  ninguna regla REG-* contempla que un socio pague por otro. La transferencia al
  CVU está prevista en `docs/06` como "matching manual" hacia un socio.
- **Tres huecos de la bandeja:** ofrece "Cuotas sociales" a cualquier categoría,
  no consulta `activeExemption` (es el sexto camino de cobro) y no asienta
  divergencia monto-vs-cuotas (`link_amount_mismatch` sólo existe en el webhook).
- **Ningún test lee el fuente de `sin-conciliar/**`.** Lo fijado es el contrato de
  las tres actions (`tests/unmatched-actions-auth.test.ts`), que se reescribe a
  propósito.

---

## 4. Modelo de datos

### 4.1 `payments.split_of_payment_id`

- `Payment.splitOfPaymentId Int? @map("split_of_payment_id")`, autorrelación
  `splitOf Payment?` / `splitParts Payment[]` (`onDelete: Restrict`), con
  `@@index([splitOfPaymentId])`.
- **Semántica:** "esta parte pertenece al dinero de MP que porta ese pago". El
  **portador** es el pago que lleva `mpPaymentId` (y `preapprovalId`); las partes
  llevan el puntero y `mpPaymentId` nulo. Nunca las dos cosas a la vez; lo
  garantiza el núcleo (no hay CHECK en MariaDB).
- Todo pago existente queda con la columna en null: sin backfill.

### 4.2 `UnmatchedStatus` suma `partial`

`open | partial | matched | dismissed | other_income`. `partial` = hay plata
asignada y plata sin asignar. Enum de SQL: va en la misma migración.

### 4.3 El grupo de un cobro

Definiciones que comparten el núcleo, la pantalla y la lista (una función, no
tres copias — la lección de `coverageFloor`):

- `portador(fila)` = `payments where mp_payment_id = fila.mp_payment_id`
  (unique; puede no existir, o existir anulado o reembolsado).
- `grupo(fila)` = portador + `payments where split_of_payment_id = portador.id`.
- `asignado(fila)` = Σ `amount` de los pagos del grupo con `status = applied`.
- `sinAsignar(fila)` = `fila.amount − asignado`. Invariante: `0 ≤ sinAsignar ≤
  fila.amount`, sostenida en escritura (§5.2 paso 4.2).
- **Estado de la fila derivado de esa cuenta**, siempre desde el núcleo:
  `open` ⇔ asignado = 0; `partial` ⇔ 0 < asignado < amount; `matched` ⇔ asignado
  = amount. `paymentId` = portador cuando la fila no está `open`; null cuando
  vuelve a `open` (como hoy).

Vive en `src/lib/treasury/split-group.ts`: `loadGroup(db, row)` y la aritmética
pura `groupTotals(payments, rowAmount)` (testeada sin Prisma).

### 4.4 Migración

Una sola: `ALTER TABLE payments ADD COLUMN split_of_payment_id INT NULL, ADD
INDEX, ADD CONSTRAINT FK`; `ALTER TABLE mp_unmatched_payments MODIFY status
ENUM(...)`. `deploy.sh` la aplica con `prisma migrate deploy`. Reversible: la
columna y el valor de enum se pueden quitar si no hay filas que los usen.

---

## 5. Núcleo de plata (`src/lib/treasury/service.ts`)

### 5.1 Refactor sin cambio de comportamiento

El cuerpo de `registerPaymentCore` se parte en tres funciones internas que el
cobro de siempre llama **en el mismo orden de hoy**:

1. `preparePart(input, { strictWithdrawn })` — todo lo que hoy corre antes de la
   transacción: validaciones de monto y de `n`, lectura del socio, cuotas y
   reingreso, recorte del cesante, `allocate` con `coverageFloor`, concepto
   congelado. Con `strictWithdrawn: false` (el camino de hoy) el cesante se
   recorta en silencio, como exige el webhook; con `true` (reparto) se rechaza
   con el mensaje de mostrador.
2. `writePaymentAndFees(tx, prepared, identity)` — `payment.create` +
   `fee.createMany` + `fee.updateMany` con el control de `count`. `identity` es
   `{ mpPaymentId, preapprovalId }` o `{ splitOfPaymentId }`.
3. `issueReceipt(tx, paymentId, prepared)` — `nextReceiptSeq` + `receipt.create`.

`registerPaymentCore` = prepare → tx { writePaymentAndFees → cierre de la fila
(`open → matched`, como hoy) → issueReceipt } → catch de siempre → PDF. **La
suite actual pasa sin tocar una aserción**: `tests/treasury-service.test.ts`
(orden `["start","update","end"]`, unique, reintento, número tarde) y
`tests/integration/mp-apply-concurrency.test.ts` son la red del refactor.

### 5.2 `registerSplitPayment`

```ts
type SplitPartInput = { memberId: number; concept: CashConcept; n: number; amount: number };
registerSplitPayment(input: { rowId: number; parts: SplitPartInput[]; actorId: number; note?: string | null }):
  | { kind: "registered"; rowStatus: "matched" | "partial";
      parts: { memberId; paymentId; receiptId; number; periods: Period[]; amount; pdfWritten }[] }
  | { kind: "already_processed"; paymentId: number }
```

Tipo por concepto (`INBOX_CONCEPT_TYPE`, distinto del `CONCEPT_TYPE` de
Efectivo): `fees → link`, `voluntary → voluntary`, `extraordinary →
extraordinary`. La plata entró por MP y el recibo lo dice.

**La bandeja lo llama SIEMPRE, también con una sola parte.** Una fila fresca con
una parte produce exactamente las filas de hoy (portador con `mpPaymentId`, fila
`matched`), y así el reparto, el resto de una fila parcial y la fila reabierta
tienen un único camino con las mismas guardas. `registerPayment` queda para los
otros cinco llamadores, intacto.

Secuencia:

1. **Validación de forma**, fuera de todo mutex: 1..5 partes
   (`MAX_SPLIT_PARTS = 5`), socios distintos, cada importe > 0 redondeado a
   centavos y ≤ `MAX_AMOUNT`, `n` entero en 1..60 para `fees` y 0 para el resto.
2. **Mutex**: `unmatched:{rowId}` afuera, y adentro los `member:{id}` de las
   partes **en orden ascendente** (claves distintas se anidan; el orden fijo evita
   que dos repartos cruzados se traben). `revertCore` y `refundPayment` toman un
   solo mutex de socio por vez y no anidan: no hay ciclo posible.
3. **Lectura y guardas por parte** (`preparePart` con `strictWithdrawn`): la fila
   existe y está `open` o `partial`; el socio existe; el concepto está en
   `cashConceptsFor(categoría)`; cesante → sólo `fees` y `n ≤ pendientes` (los
   dos mensajes de mostrador de `registerCashPayment`); `activeExemption` → sólo
   aportes, con `adminExemptionNotice` + "Sólo se le puede registrar un aporte".
   `paidAt` de todas las partes = `fila.paidAt`; año de la serie = `seriesYear`.
4. **Una transacción:**
   1. `SELECT id FROM mp_unmatched_payments WHERE id = ? FOR UPDATE` (raw, como
      `nextReceiptSeq`): serializa en la base a cualquier otro escritor de esa fila
      — el mutex es de proceso, el lock no.
   2. Releer la fila y el grupo **adentro**: estado sigue `open|partial`, y
      Σ partes = `sinAsignar` **exacto** a centavos. Si no: `TreasuryError` ("Este
      pago cambió mientras lo repartías…" o el mensaje de suma, §8.4) → rollback,
      **ningún número consumido**.
   3. Si no hay portador, la **primera parte se crea como portador** con
      `mpPaymentId` y `preapprovalId` de la fila, y es el **primer INSERT** de la
      transacción: si el unique choca, muere antes de pedir número (REG-33). Si
      ya hay portador (aplicado, anulado o reembolsado), todas las partes llevan
      `splitOfPaymentId = portador.id`.
   4. Por cada parte, `writePaymentAndFees`.
   5. **La fila**: `updateMany where { id, status in (open, partial) } data
      { status: asignado' = amount ? matched : partial, paymentId: portador.id,
      resolvedAt: now, resolvedById: actorId }`; `count !== 1` → throw. El sello
      `resolvedById` pasa a vivir **dentro** de la transacción.
   6. **Los números, al final**: por cada parte en orden, `issueReceipt`. El lock
      de la fila del año se sostiene lo mínimo, como hoy.
5. **Catch**: unique de `mp_payment_id` (sólo posible si no había portador y otro
   escritor lo creó en el medio: una fila `no_subscription` que vinculó el cron)
   → `already_processed` con el ganador; unique de `(member_id, period)` (carrera
   con el devengo) → se recalcula todo y se reintenta **una** vez; otro → throw.
6. **Después del commit**: PDF best-effort por parte. `pdfWritten` por parte.

### 5.3 Anulación por grupo (`revertCore`)

Después de marcar el pago `voided|refunded` y devolver sus cuotas, la
reapertura de la bandeja deja de ser "por `paymentId` → `open`" y pasa a ser
**por grupo**, dentro de la misma transacción:

- Portador = el pago si lleva `mpPaymentId`; si no, su `splitOf`; si no hay
  (efectivo de mostrador), se conserva **exactamente** el `updateMany` de hoy.
- Con portador: `asignado` = Σ `applied` del grupo (`aggregate` en `tx`). Cero →
  `open`, `paymentId: null`, `resolvedAt/By: null` (idéntico a hoy para un pago
  suelto). Mayor que cero → `partial` (el `paymentId` sigue apuntando al
  portador, aunque el portador esté anulado: la pantalla deriva las partes del
  grupo, no del puntero).
- `where: { mpPaymentId: portador.mpPaymentId, status in (matched, partial) }`.

**Esto destraba la fila reabierta**: cuando vuelve a `open`, el portador anulado
sigue existiendo por `mpPaymentId`, y `registerSplitPayment` cuelga las partes
nuevas de él (paso 4.3). La barrera contra el reenvío de MP no se toca: el
portador conserva su id, `resolve.ts` regla 1 y `reconcile.hasLocal` lo siguen
encontrando.

### 5.4 Reembolso por grupo (`refundPayment`)

```ts
refundPayment({ mpPaymentId, reason }):
  | { kind: "refunded"; paymentId; number; periodsReverted; parts: number }
  | { kind: "not_found" }
  | { kind: "already_reverted"; status }
```

Encuentra al portador por `mpPaymentId` con sus `splitParts` y sus recibos;
objetivos = los `applied` del grupo (portador primero, después las partes por
id); ninguno → `already_reverted` con el estado del portador; cada uno se
revierte con `revertCore` (su mutex, su transacción). **Idempotente por parte**:
si falla a mitad, el reintento de MP revierte lo que faltaba y devuelve
`already_reverted` cuando ya no queda nada. `paymentId`/`number` son los del
portador; `periodsReverted` es la suma. El asiento `payment_refunded` del webhook
suma `parts`.

### 5.5 Mensajes del dominio

Los textos salen de una constante exportada `SPLIT_GUARD_MESSAGES`
(lección de `GRANT_GUARD_MESSAGES`): la action pre-valida lo barato con los
mismos textos y el núcleo revalida todo. Lista en §8.4.

---

## 6. Lo que NO cambia del núcleo

- `RegisterPaymentInput`, `RegisterResult`, `registerPayment`,
  `registerCashPayment`, `voidReceipt`, `regenerateReceiptPdf`: mismas firmas.
- `allocate`, `coverageFloor`, `revertFees`, `feeValueReader`, `nextReceiptSeq`,
  `unique-violation.ts`: sin cambios.
- `src/lib/mp/*`: `resolve.ts`, `reconcile.ts`, `unmatched.ts`,
  `link-subscription.ts` sin cambios. `webhook-processor.ts` sólo agrega `parts`
  al detalle del asiento `payment_refunded` (el tipo del resultado cambia).
- Los tres uniques por `mpPaymentId` y `Receipt.paymentId @unique`.

---

## 7. Recibo, email y etiqueta del medio

- **`ReceiptPdfData.sharedPayment?: { total: number; paidAt: Date }`**, se OMITE
  cuando no aplica (mismo criterio que `admissionPending`: el dato del recibo de
  siempre sigue byte-idéntico). `pdfDataFor` lo arma cuando el pago pertenece a un
  grupo con fila de bandeja y `Number(payment.amount) < Number(fila.amount)`.
  Renglón bajo "Comprobante interno…": **"Parte de un pago de $ 18.000,00 cobrado
  por Mercado Pago el 08/09/2026."** Sin contar socios: una parte anulada y
  reasignada cambiaría la cuenta y el PDF ya emitido no se regenera.
- **Email**: `receiptEmail({ sharedPayment })` agrega la misma línea después del
  importe, en texto y HTML.
- **`PAYMENT_TYPE_LABELS.link = "Mercado Pago"`.** Recibo (`methodLabel` se rotula
  al render, así que los PDFs regenerados también), tabla de pagos de la cuenta
  corriente (admin y `/mi`), email. `debit` sigue "Débito automático".
- **Ficha del recibo** (`/admin/tesoreria/recibos/[id]`): si es parte de un
  reparto, una línea "Parte de un pago de $ 18.000,00 por Mercado Pago · Ver en la
  bandeja"; el formulario de anulación avisa "Anularlo deja $ 6.000,00 sin asignar
  en la bandeja Sin conciliar" (o "vuelve la fila a Pendiente" si es la última
  parte aplicada).

---

## 8. Bandeja

### 8.1 Pantalla Resolver (`sin-conciliar/[id]/page.tsx`, servidor)

Carga la fila y su grupo (`loadGroup`), calcula `asignado`/`sinAsignar`, y lee
los socios elegidos de `?socios=192,193` (enteros, sin repetidos, tope 5), como
hoy lee `?socio=`. Todo se resuelve en el servidor: sin fetch, deep-linkable.

- **Izquierda, "Pago de Mercado Pago"**: la evidencia de hoy. Cuando el grupo no
  está vacío, debajo una línea **"Asignado $ 12.000,00 · Sin asignar
  $ 6.000,00"** y la lista **Partes** (`<ul divide-y>`): socio (link a
  `?tab=cuenta`), concepto congelado, importe, recibo (link), badge
  Aplicado/Anulado/Reembolsado.
- **Derecha, "Reparto"** (fila `open` o `partial`):
  1. **Sugerencias por casilla**: si `row.payerEmail` coincide con la casilla de
     socios del libro abierto (`membersByEmail` en `member-search.ts`, hasta 5,
     excluidos los ya elegidos) → "Socios con la casilla del pagador" con una
     tarjeta por socio y botón **Agregar** (link a `?socios=…,id`).
  2. **Buscador** de siempre (`<form method="get">`, `searchMembers`), resultados
     con Agregar; sin Agregar cuando ya hay 5 o ya está.
  3. **Partes**, una por socio elegido (`SplitForm`, cliente): cabecera con nombre,
     N°, categoría, badge de estado y link **Quitar** (la URL sin ese id); campos
     en `grid gap-3 sm:grid-cols-3`: **Concepto** (`SelectField`, opciones de
     `cashConceptsFor` filtradas por cesante/exención, calculadas en el
     servidor), **Cuotas** (`TextField` `digitsOnly`, sólo para `fees`, hint "Debe
     N cuotas desde {mes}. Se imputan a las más antiguas primero." / "Está al día:
     se imputa a la primera cuota no cubierta."), **Importe** (`TextField`
     `inputMode="decimal"`, prellenado n × `feeAmount`, se recalcula al cambiar
     las cuotas, editable; mismo parseo que Otros ingresos). Avisos por parte
     con `FormMessage kind="warning" role="none"` (cesante: deuda congelada;
     exento: `adminExemptionNotice`).
  4. **Pie tipo boleta** (patrón `mi/cuenta/pay-form.tsx`): renglón por socio con
     su importe, **Total asignado**, y **Sin asignar** en `font-mono` — verde
     (`text-success`) en $ 0, ámbar (`text-warning`) si no. Una **Nota
     (opcional)** para todas las partes. Botón **"Revisar el reparto"**
     deshabilitado mientras Sin asignar ≠ $ 0 o no hay partes.
  5. **Confirmación** (`state.confirm`): panel `role="group" tabIndex={-1}` con
     foco al aparecer, borde `border-primary bg-primary/5`, un renglón por socio
     resuelto **en el servidor**: "Hugo Araoz (N° 192) · Cuota social · septiembre
     a octubre 2026 (2 cuotas) · $ 12.000,00", total = lo cobrado, y la leyenda
     "Se emiten N recibos, fechados el 08/09/2026, que es el día en que Mercado
     Pago lo cobró." Botones **"Confirmar y emitir N recibos"** (submit con
     `confirmar=1` + `confirmToken`) y **"Volver"**. Enter bloqueado mientras el
     panel está visible (`onKeyDown`, patrón `arrears-form`).
- **"Si no es de un socio"** (ingreso no societario, descartar): sólo con la fila
  `open`. Con `partial`, una línea neutra: "Este pago ya tiene una parte
  aplicada: el resto sólo puede asignarse a socios."
- **Fila resuelta** (`matched|dismissed|other_income`): la tarjeta de hoy, con
  la lista de Partes en lugar del "Socio:"/"Recibo:" únicos, y la leyenda "Si se
  anula una parte, la fila vuelve a Pendientes con lo que quede sin asignar."
- **Éxito** (`?emitidos=N&email=…`): `FormMessage kind="success"` arriba de la
  tarjeta: "Se emitieron 2 recibos: N° 2026-00031 (Hugo Araoz, enviado por
  email) · N° 2026-00032 (Mónica Maza, sin casilla)", cada número con link.

Bajo `md` las dos tarjetas se apilan (evidencia arriba, reparto abajo), las
partes son lista y no tabla, y los targets siguen en `min-h-11`. Íconos lucide
con moderación: `Users` en el título del reparto, `Plus` en Agregar, `X` en
Quitar, `Receipt` en cada recibo emitido.

### 8.2 Action `resolveUnmatchedAction`

`(prev: State, formData) → State`, `requireAdmin`. Schema: `rowId`, `note?`,
`confirmar?`, `confirmToken?`, y `parts[]` (1..5) con `memberId`, `concept`,
`count?`, `amount` (`z.coerce.number`, dos decimales). `State = { error?, kind?,
confirm?: { token, total, parts: { memberId, name, memberNumber, concept,
periods: string, amount }[] } }`.

1. Fila `open|partial`, si no "Esta fila ya fue resuelta." / "La fila ya no
   existe.". Grupo → `sinAsignar`.
2. **Pre-validación barata** con los textos de `SPLIT_GUARD_MESSAGES`: socios
   existentes, conceptos por categoría, cesante, exención, suma exacta.
3. **Vista previa** (`previewSplit`, `split-preview.ts`, con Prisma inyectado):
   por socio, `allocate` con `coverageFloor` y el reingreso → `describePeriods`;
   `paymentConcept`. Token = `splitConfirmToken(rowId, parts)` (pura:
   `rowId|memberId:concept:n:amount,…` ordenado por socio; no es una barrera de
   seguridad, es la guarda contra la deriva, como `arrearsConfirmToken`).
4. Sin `confirmar=1` o con token distinto → devuelve `confirm`. Con token igual →
   `treasuryService.registerSplitPayment(...)`; `already_processed` → el aviso
   de hoy con el recibo del ganador.
5. Por parte, `sendReceiptEmail` best-effort. Auditoría `unmatched_resolve`,
   `entity mp_unmatched_payment`, `detail: { action: "apply", rowStatus, total,
   parts: [{ memberId, paymentId, receiptId, concept, count, amount, emailed }] }`
   — ids y códigos, nunca la casilla (Ley 25.326). Del error sólo el código.
6. `redirect(${BASE}/${row.id}?emitidos=N&email=sent,no_email)`.

`dismissUnmatchedAction` y `registerAsOtherIncomeAction` no cambian (ya exigen
`status: "open"`).

### 8.3 Lista (`sin-conciliar/page.tsx`), salud y resumen

- **Pendientes** = `status in (open, partial)`, ordenadas por `paidAt`. Badge
  `partial` → "Parcial", variante `default` (relleno, como Pendiente: es trabajo
  pendiente; el rótulo los distingue). El total en pesos = Σ `open.amount` +
  Σ `partial.sinAsignar` (la consulta trae el grupo: `payment { amount, status,
  splitParts { amount, status } }`).
- **Resueltos** = `matched, dismissed, other_income` como hoy. "Aplicado a"
  nombra a cada socio con su recibo enlazado (hasta 5 por fila).
- **`/admin/salud`**: `inboxOpen` cuenta `open + partial`.
- **Resumen diario**: cuenta por `createdAt`; sin cambios.
- `UNMATCHED_STATUS_LABELS.partial = "Parcial"`; `unmatchedStatusBadgeVariant`
  no devuelve `ghost` (test de fuente).

### 8.4 Mensajes (`SPLIT_GUARD_MESSAGES`)

| Clave | Texto |
|---|---|
| `noParts` | Elegí al menos un socio. |
| `tooManyParts` | Como máximo 5 socios por pago. |
| `duplicateMember` | Un socio no puede aparecer dos veces en el reparto. |
| `rowGone` | La fila ya no existe. |
| `rowResolved` | Esta fila ya fue resuelta. |
| `memberGone` | El socio no existe. |
| `conceptCategory` | Ese concepto no corresponde a la categoría del socio. |
| `withdrawnConcept` | (el de `registerCashPayment`) El socio está dado de baja: sólo se le puede cobrar la deuda de cuotas… |
| `withdrawnCount` | (el de `registerCashPayment`) …tiene N cuotas pendientes y no devenga nuevas. |
| `exempt(e)` | `adminExemptionNotice(e)` + " Sólo se le puede registrar un aporte." |
| `sum(parts, unassigned)` | Las partes suman $ 17.000,00 y hay $ 18.000,00 sin asignar. |
| `amountZero` | El importe de cada parte tiene que ser mayor a cero. |
| `count` | La cantidad de cuotas tiene que estar entre 1 y 60. |
| `changed` | Este pago cambió mientras lo repartías. Revisá la fila y volvé a intentarlo. |

---

## 9. Bordes y lo que NO cambia

- **Un socio con fila fresca** → una parte = las filas de hoy. El contrato de la
  action cambia (siempre `registerSplitPayment`, siempre dos pasos, redirect a la
  fila): deliberado y fijado por el test nuevo.
- **Fila `partial` con el portador anulado y una parte aplicada**: `paymentId`
  sigue apuntando al portador; la pantalla y la lista leen el grupo.
- **Reembolso de MP sobre una fila `partial`** revierte lo aplicado y la fila
  vuelve a `open`; el operador la ve en Pendientes con el motivo original.
- **`link_amount_mismatch` no se replica en la bandeja**: la suma exacta lo hace
  innecesario.
- **`/mi/cuenta`** de cada socio muestra su parte, su recibo y "Mercado Pago" como
  medio; el PDF ajeno sigue dando 404.
- **`digest`** suma `applied` por tipo: partes = total del cobro, sin doble
  conteo (no hay pago padre).
- **`member-debit.ts`** (regla anti-duplicación mensual) cuenta pagos por socio:
  una parte cuenta como pago del mes de ese socio, que es lo correcto.
- **Un solo proceso**: los mutex nuevos viven en memoria como los demás; la
  garantía de base es el `FOR UPDATE` de la fila y los uniques.

---

## 10. Tests y verificación

**Unitarios** (doble de base que **honra el `where`** — lección del M6; las
guardas se verifican por mutación):

- `tests/treasury-split.test.ts`: forma (0, 6, repetidos); suma inexacta rechazada
  **antes** del primer INSERT y sin número; portador primero y sólo cuando no
  existe; partes con `splitOfPaymentId`; números al final y en orden; fila
  `matched` vs `partial` según la suma; `resolvedById` adentro; `already_processed`
  por el unique del portador; reintento por `(member_id, period)` una sola vez;
  guardas de categoría, cesante y exención; una parte en fila fresca ≡ las
  escrituras de `registerPayment` (misma secuencia de statements).
- `revertCore` por grupo: pago suelto → `open` (idéntico a hoy); una de dos partes
  → `partial`; la última → `open`; efectivo → el `updateMany` de hoy.
- `refundPayment` por grupo: revierte portador + partes; sólo las `applied`;
  idempotente; `not_found`; `already_reverted`.
- `split-group.test.ts` (`groupTotals` pura), `split-confirm.test.ts` (token y
  `previewSplit`), `member-search` (`membersByEmail` sólo libro abierto),
  `unmatched-labels`/`status-badges` (`partial`), `receipt-pdf` (leyenda presente
  sólo con `sharedPayment`; dato byte-idéntico sin él), `email` (línea y
  etiqueta "Mercado Pago"), `admin-health` (`open + partial`).
- `tests/unmatched-actions-auth.test.ts` **reescrito**: dos pasos, token, llamada
  exacta a `registerSplitPayment`, asiento sin casilla, redirect.
- **Sin tocar**: `tests/treasury-service.test.ts`,
  `tests/integration/mp-apply-concurrency.test.ts`,
  `tests/integration/receipt-sequence.test.ts`, `tests/mp-*.test.ts` (salvo el
  detalle `parts` del asiento de refund).

**Integración contra MariaDB real** (`tests/integration/unmatched-split.test.ts`,
Docker `sigev-db`): reparto en 2 → dos recibos consecutivos en una transacción;
dos repartos concurrentes de la misma fila → uno gana, el otro `changed`, serie
sin huecos; anular una parte → `partial` con el resto; reasignar → `matched`;
anular todo → `open` → volver a aplicar → funciona; reembolso → todas
revertidas; **5 partes: tiempo medido y anotado** contra los 5 s.

**Navegador** (local, fila sembrada con `unmatched.record` desde un script en
`scripts/dev/`): reparto 2+1, confirmación, recibos con leyenda, anulación de
una parte, reasignación, lista con Parcial, `/mi/cuenta` de cada socio, móvil.

**Cierre obligatorio**: suite entera con conteo contra `main`, `tsc --noEmit`,
lint, `npm run build`, `git diff --stat` contra la lista del plan (`src/lib/mp/*`
sólo `webhook-processor.ts` por el detalle del asiento; `prisma/` sólo el schema
y la migración), revisión por subagente e informe en `.superpowers/sdd/`.

---

## 11. Documentación a actualizar

- `docs/04`: `Payment.splitOfPaymentId`, portador/grupo, `UnmatchedStatus.partial`,
  la regla de reapertura por grupo (reemplaza "se reabre al anular").
- `docs/05`: flujo de Resolver con reparto, dos pasos, fila parcial.
- `docs/06` §4 y §9: la bandeja reparte; la matriz de conciliación ("Pago suelto /
  transferencia al CVU → manual, a uno o varios socios"); refund por grupo.
- `docs/07`: fase **4D — Reparto en la bandeja** con sus CA; CA5 de la 4B pasa a
  ✅ con este caso real; la deuda "reimputar un cobro anulado" se cierra.
- `docs/10` §4: despliegue con migración y el chequeo post-deploy (la fila de
  producción repartida 2+1).
- `CLAUDE.md`: viñeta de patrones (portador + partes; estado derivado del grupo;
  `FOR UPDATE` de la fila; etiqueta "Mercado Pago"; sexto camino con las guardas).

---

## 12. Fuera de alcance

- Reparto mixto (una parte a un socio, otra como ingreso no societario).
- Repartir un efectivo (se registran dos efectivos) o un débito de suscripción.
- Leer `payment_type_id` / titular de la cuenta origen desde MP.
- Sugerir el reparto por deuda (la pista es la casilla; el reparto lo decide el
  operador).
- Cambiar la barrera de idempotencia para un débito de suscripción anulado por
  mostrador: el reenvío de MP sigue respondiendo `already_processed`, como hoy.
- Locks distribuidos (premisa de un solo proceso, `docs/03`).

---

## 13. Criterios de aceptación

1. Fila de $ 18.000 sin referencia → 2 cuotas al socio A + 1 cuota a la socia B →
   dos recibos consecutivos, fila Aplicado, cada socio ve su recibo en
   `/mi/cuenta`, los dos PDFs con la leyenda y "Mercado Pago" como medio.
2. Suma inexacta → el botón no se habilita; un POST armado a mano se rechaza sin
   consumir número (`receipt_sequences.last` no cambia).
3. Anular el recibo de B → fila Parcial con $ 6.000 sin asignar en Pendientes y
   en el total; reasignar a C → Aplicado; el recibo de A intacto.
4. Anular las dos partes → fila Pendiente; volver a aplicarla **funciona** (el
   callejón de hoy desaparece); el portador anulado conserva `mpPaymentId`.
5. `refunded` de MP → las dos partes `refunded`, cuotas pendientes, fila
   Pendiente; el reenvío del aviso → `refund_ignored`.
6. Dos repartos concurrentes de la misma fila → uno gana; el otro lee "cambió
   mientras lo repartías"; serie sin huecos.
7. Adherente en el reparto → sin "Cuotas sociales"; exento → sólo aportes con el
   aviso del acta; cesante → sólo deuda y no más cuotas que las pendientes.
8. Una parte sola en fila fresca → filas idénticas a las de hoy.
9. Cinco partes contra MariaDB real: bajo 5 s, tiempo anotado en el informe.
10. Suite verde **sin tocar aserciones** de `tests/treasury-service.test.ts` ni de
    `tests/integration/mp-apply-concurrency.test.ts`; `tsc`, lint y build en verde.
