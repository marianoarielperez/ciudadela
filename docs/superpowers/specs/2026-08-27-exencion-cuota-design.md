# Exención de cuota mensual (Art. 7 inc. a.4): diseño aprobado

**Fecha:** 27/08/2026 · **Estado:** aprobado por el operador (dos rondas de decisiones + definiciones base)

Este documento es la spec del módulo de exención de cuota. El Art. 7 inc. a.4 del
estatuto permite eximir a un socio ACTIVO del pago de la cuota mensual por hasta
veinticuatro (24) meses, mediante aporte económico equivalente o contribución en
especie valuada por la Comisión Directiva, con aprobación por mayoría de 2/3.

---

## 1. Alcance

1. **Registro de exenciones** con acta obligatoria: quién, desde qué mes, por
   cuántos meses, con qué acta, y —si se anula— cuándo y con qué acta.
2. **Materialización de las cuotas exentas**: al asentar, se crean las filas de
   cuota de los N meses en estado `exempt`. El devengo, la deuda, el
   recordatorio y las pantallas existentes ya las tratan bien sin tocarse
   (verificado camino por camino en el análisis del 27/08).
3. **Bloqueo total de pagos del eximido** mientras dura la exención, en la capa
   de pantallas y acciones: mostrador, links de pago, pago desde el panel del
   socio y adhesión al débito.
4. **Pantalla nueva en Tesorería** (pestaña "Exenciones": vigentes + historial +
   alta + anulación), aviso y acceso desde la ficha del socio, y aviso en el
   panel del socio.

**El módulo no registra plata**: el aporte equivalente o la contribución en
especie constan en el acta de la Comisión, no en tesorería (decisión del
operador). **Fuera de alcance:** ver §10.

---

## 2. Decisiones del operador (27/08/2026)

| # | Decisión | Elección |
|---|---|---|
| 1 | Plata durante la exención | **No entra ni un peso**: ni cuota, ni aporte voluntario, ni extraordinario. El aporte del Art. 7 consta en el acta, no en el sistema |
| 2 | Alcance por categoría | **Solo socios ACTIVOS** (letra del artículo) |
| 3 | Ubicación | **Tesorería** (pestaña propia) + aviso y botón en la **ficha del socio** |
| 4 | Acta | **Obligatoria** al asentar (existente o nueva); la mayoría de 2/3 va en el TEXTO del acta, sin campos de votación |
| 5 | Renovación | **Nunca automática**: vencida la exención, se asienta una nueva con su acta |
| 6 | Deuda previa | **Debe estar al día**: cuotas pendientes bloquean el asiento, con el camino para resolverlas a la vista |
| 7 | Duración | **Hasta 24 meses, elige la CD** (1..24, 24 precargado) |
| 8 | Bloqueo de pagos | **Bloquear todo** activamente (los cinco caminos), no solo dejar de ofrecer |
| 9 | Anulación anticipada | **Sí, con acta**: los meses transcurridos y el corriente quedan exentos; los futuros vuelven a devengar |
| 10 | Inicio | **Elegible, sugerido el mes siguiente**; nunca hacia atrás (mínimo: el período corriente) |
| 11 | Mes del rango ya pago | **Queda pago y se avisa** con todas las letras en la confirmación; el rango calendario del acta no se corre |
| 12 | Roles | **Como Valores de cuota**: el admin ve todo; asentar y anular es de superadmin, revalidado en cada action |

---

## 3. Modelo de datos

Una tabla nueva y tres retoques aditivos de enum. Todo por `prisma migrate`.

### 3.1 `fee_exemptions` (`FeeExemption`)

```prisma
model FeeExemption {
  id             Int       @id @default(autoincrement())
  memberId       Int       @map("member_id")
  member         Member    @relation(fields: [memberId], references: [id], onDelete: Restrict)
  fromPeriod     String    @map("from_period") @db.Char(7)  // "YYYY-MM", primer mes eximido
  toPeriod       String    @map("to_period") @db.Char(7)    // último mes eximido, inclusive
  months         Int                                         // 1..24, redundante a propósito (el acta habla en meses)
  minuteId       Int       @map("minute_id")
  minute         Minute    @relation("FeeExemptionMinute", fields: [minuteId], references: [id], onDelete: Restrict)
  note           String?   @db.VarChar(300)                  // "contribución en especie: pintura de la sede"
  createdById    Int?      @map("created_by_id")
  createdBy      User?     @relation(fields: [createdById], references: [id], onDelete: SetNull)
  revokedAt      DateTime? @map("revoked_at")
  revokeMinuteId Int?      @map("revoke_minute_id")
  revokeMinute   Minute?   @relation("FeeExemptionRevokeMinute", fields: [revokeMinuteId], references: [id], onDelete: Restrict)
  createdAt      DateTime  @default(now()) @map("created_at")

  @@index([memberId])
  @@map("fee_exemptions")
}
```

- Las dos FKs a `Minute` son **`Restrict`**: un acta que respalda una exención no
  puede borrarse. Además `discardUnusedMinute` suma `feeExemption` como **sexto
  referente** (su comentario normativo exige que la lista crezca con el schema),
  y la guarda de poda del import (`padron/prune.ts`) suma `feeExemptions` a su
  enumeración para abortar nombrando el motivo en vez de reventar por FK.
- **Vigente** = `revokedAt IS NULL` y `toPeriod ≥ período corriente` — o sea, en
  curso **o por comenzar**: una exención asentada hoy que arranca el mes que
  viene ya bloquea pagos desde el asiento (el "no entra ni un peso" rige desde
  que la Comisión decidió, no desde el primer mes eximido) y figura entre las
  vigentes con el rótulo "comienza en {mes}". `Char(7)` con formato `YYYY-MM`
  compara bien lexicográficamente (el criterio ya usado por `Fee.period`).
- **Una sola vigente por socio**: garantía de aplicación (MySQL no tiene unique
  parcial; mismo criterio que `member_requests`), verificada dentro de la
  transacción del asiento.

### 3.2 Retoques de enum (aditivos)

- `FeeOrigin` gana **`exemption`**: las cuotas exentas se distinguen de las de
  devengo e import, y la anulación puede borrarlas con precisión quirúrgica.
- `MovementType` gana **`fee_exemption`** y **`fee_exemption_revoked`** (el par
  calca `suspension`/`suspension_end`): el asiento y la anulación aparecen en la
  pestaña Historial de la ficha, cada uno con su acta. Etiquetas es-AR en
  `MOVEMENT_LABELS` ("Exención de cuota" / "Exención anulada").

### 3.3 Las cuotas exentas

En la transacción del asiento se crean las filas
`{ memberId, period, status: "exempt", origin: "exemption", paymentId: null }`
para cada mes del rango **que no tenga fila** (lectura previa, no
`skipDuplicates`: los meses ya pagos se detectan, se informan y quedan pagos —
decisión 11; pendientes no puede haber por la guarda de al día). La anulación
borra `{ origin: "exemption", status: "exempt", period > período corriente }`
del rango: el devengo repuebla los futuros solo, sin tocarlo.

---

## 4. Dominio: `src/lib/treasury/exemptions.ts` (archivo NUEVO)

El módulo vive en el directorio de tesorería porque es dominio de cuotas, pero es
un **archivo nuevo**: ningún archivo existente del núcleo se modifica. Cliente de
Prisma **inyectado** (`makeExemptions(deps)` + singleton), reglas puras
testeables sin base.

- **`activeExemption(db, memberId, at?)`** — LA función compartida: devuelve la
  exención vigente o `null`. La consultan las cinco guardas de bloqueo y las
  tres pantallas. Una sola definición (la lección de `coverageFloor`).
- **`grant(input)`** — transacción: revalida las guardas del §5, crea la fila de
  `FeeExemption`, las cuotas exentas (§3.3) y el `Movement` con el acta.
  Devuelve el detalle (meses eximidos, meses salteados por estar pagos).
- **`revoke(input)`** — transacción: `revokedAt` + `revokeMinuteId` (cerrojo
  `updateMany` con `revokedAt: null`: dos operadores no anulan dos veces), borra
  las exentas futuras y asienta el `Movement` de anulación.
- **`listActive(db)` / `history(db)`** — para la pestaña.
- Reglas puras: `exemptionPeriods(from, months)` (el rango), `monthsLeft`,
  validación de entrada (1..24, `fromPeriod ≥ período corriente`).

---

## 5. Guardas del asiento

En orden, pre-validadas en la pantalla y **revalidadas dentro de la
transacción** (patrón `runAction`):

1. El socio existe y es **categoría `active`** con **estado vigente**
   (`active`; un suspendido no se exime — la suspensión es disciplinaria).
2. **Al día**: `fee.count({ status: "pending" }) === 0`. Si no, la pantalla
   muestra cuántas debe y los caminos (cobrar en mostrador / que la CD las trate).
3. **Sin débito automático cobrable**: ninguna `MpSubscription` del socio con
   `canStillCharge(status)` (importado de `mp/subscription-status`, el mismo
   predicado de siempre). El aviso explica que el débito de un socio vigente lo
   cancela él desde su panel (`/mi/debito/cancelar`) — no existe cancelación
   admin de un vigente, a propósito.
4. **Sin otra exención vigente** (decisión 5: renovar = nueva, después de vencida).
5. Rango válido: meses 1..24, inicio ≥ período corriente (decisión 10).
6. **Acta obligatoria** (`MinutePicker`, existente o nueva; patrón acta-huérfana
   con `discardUnusedMinute` si el asiento falla).

---

## 6. Bloqueo de pagos (decisión 8): "no entra ni un peso"

Todo en la capa tocable (pantallas y actions); el núcleo (`registerPayment`,
`registerCashPayment`, `resolve.ts`, `webhook-processor`) **no se toca**. Los
cinco caminos consultan `activeExemption`:

| Camino | Dónde se corta | Comportamiento |
|---|---|---|
| Mostrador | `admin/tesoreria/efectivo` (pantalla + action) | Con exención vigente: ningún concepto disponible (ni cuotas, ni voluntario, ni extraordinario), con "El socio está eximido de la cuota hasta {mes} (acta N° X)". Mismo patrón con que esa pantalla ya recorta conceptos al cesante |
| Link de pago admin | `admin/socios/[id]/link` (pantalla + action) | No se genera; mismo aviso |
| Pagar del socio | `/mi/cuenta` (pantalla + `startMemberPaymentAction`) | La tarjeta "Pagar ahora" se reemplaza por el aviso de exención; la action corta igual (defensa en profundidad) |
| Adhesión al débito | `adhesionVerdict` (`members/debit-adhesion.ts`, input **aditivo**) | Guarda nueva `exempted` → `{ ok: false, reason: "exempted", until }` con mensaje "Estás eximido de la cuota hasta {mes}: no hay nada que debitar". Pantalla y action comparten el veredicto, como siempre |
| Débito ya vivo | La guarda 3 del asiento | No puede existir un eximido con débito: se verifica antes de eximir |

Residuales documentados (no bloquean, quedan escritos): un pago de MP que llegara
igual (un link generado antes del asiento y pagado después — los links vencen a
las 72 h, ventana mínima) se imputa al primer mes posterior a la exención, que es
el comportamiento correcto del núcleo; y la vinculación manual de una suscripción
por el admin no consulta exenciones (acto consciente de operador, anotado).

---

## 7. Pantallas

### 7.1 Tesorería → pestaña "Exenciones"

Un elemento más en `TREASURY_TABS` (al final, después de Valores de cuota; el
test de sincronía obliga a que la ruta exista). Molde: **Otros ingresos**
(listado + alta en la misma pantalla). `requireAdmin` propio en la página;
**las actions revalidan `requireSuperadmin`** y la pantalla usa el doble nivel de
Valores (`Promise.all([requireAdmin(), requireSuperadmin()])`, el segundo solo
para decidir qué se dibuja).

- **Vigentes**: tarjetas (patrón `RequestCard`) — socio (link a la ficha, N° del
  libro), rango ("septiembre 2026 → agosto 2028"), meses restantes en
  `font-mono tabular-nums`, acta (link), nota, y la acción **Anular** (solo
  superadmin, con confirmación propia + `MinutePicker` para el acta de
  anulación).
- **Historial**: vencidas y anuladas, compactas, con sus dos actas.
- **Alta** (tarjeta "Eximir de cuota"): buscador de socio (reutiliza
  `member-search` importado; solo un activo al día pasa las guardas), meses
  (1..24, 24 precargado), inicio (mes, sugerido el siguiente), `MinutePicker`
  (obligatoria), nota opcional. **El resumen previo nombra el acta y los meses
  exactos** —incluidos los ya pagos que quedarán pagos— antes del botón (la
  lección del cierre de libro: confirmar sin ver el acta es imposible;
  `describeMinuteChoice` ya existe para esto).
- Éxito por querystring con aviso (patrón Otros ingresos).

### 7.2 Ficha del socio (`/admin/socios/[id]`)

- **Badge "Eximido"** (variante `success`) en la fila de badges del encabezado.
- **Aviso** `FormMessage kind="neutral" box`: "Exención de cuota vigente hasta
  {mes} — acta N° X", en el bloque donde hoy va el de baja recurrible.
- **Botón "Eximir de cuota"** en las acciones del `PageHeader` (visible para
  `status === "active"` sin exención vigente; display para superadmin, como el
  precedente de Valores), que navega a la pestaña de Tesorería con
  `?socio={id}` precargado en el buscador.
- La pestaña Cuenta corriente no cambia: `AccountSection` es intocable y la
  cinta ya dibuja las "E".

### 7.3 Panel del socio (`/mi/cuenta` y `/mi/debito`)

- `/mi/cuenta`: banner "Tenés una exención de cuota vigente hasta {mes}" (arriba
  de la cuenta; `AccountSection` no se toca) y la tarjeta "Pagar ahora" no se
  ofrece mientras dure.
- `/mi/debito`: la adhesión bloqueada con el mensaje del veredicto (§6).

---

## 8. Auditoría

`fee_exemption_create` y `fee_exemption_revoke` (`entity: "member"`), con
`{ exemptionId, fromPeriod, toPeriod, months, minuteId, skippedPaid }` /
`{ exemptionId, revokeMinuteId, removedFuture }` — ids, períodos y conteos,
nunca datos personales. La IP la escribe la action, como siempre.

---

## 9. Invariantes de pagos (verificadas en el análisis del 27/08)

1. **Ningún archivo existente de `src/lib/treasury/` ni `src/lib/mp/` se
   modifica** (el módulo nuevo es un archivo nuevo; `member-search`,
   `subscription-status`, `periods` y `labels` se importan). `AccountSection`
   intocable. La única excepción aditiva fuera de tesorería:
   `members/debit-adhesion.ts` gana un input opcional.
2. El devengo saltea las exentas por construcción (`existing` incluye todos los
   estados); el recordatorio ya trata `exempt` como cubierto (con test previo);
   deudores, cesantía por mora, cambio de categoría y padrón electoral cuentan
   solo `pending` — el eximido está al día, puede cambiar de categoría y vota.
3. La anulación de recibos no puede tocar una exenta (sus escrituras exigen
   `paymentId` del recibo; la exenta tiene `paymentId: null`).
4. La baja de un eximido no toca sus cuotas (las exentas quedan; si reingresa,
   siguen salteándose). La exención NO se anula sola con la baja — queda vigente
   en el registro y sin efecto práctico; anotarla es decisión de la CD.
5. Ninguna llamada de red en las transacciones del módulo (no hay ninguna: la
   exención no habla con Mercado Pago — la guarda 3 garantiza que no haya débito
   que cancelar).

---

## 10. Fuera de alcance (a propósito)

- Registro de votos o quórum de la Comisión (el 2/3 va en el texto del acta).
- Registro del aporte económico o la contribución en especie (constan en el
  acta; a tesorería no entra nada).
- Renovación automática o aviso de vencimiento (la CD asienta una nueva cuando
  decide; si algún día hace falta un recordatorio, es otra tarea).
- Exención de adherentes o colaboradores (el artículo es de activos; además el
  adherente no devenga).
- Cancelación admin del débito de un socio vigente (decisión previa del sistema
  que este módulo respeta: lo cancela el socio).
- Cambios en `/admin/salud` (un eximido sin suscripción no aparece en ningún
  contador; el falso positivo de una suscripción no-cobrable de un vigente ya
  está documentado y no lo introduce este módulo).

---

## 11. Verificación

- **Módulos puros y servicio con base inyectada**: tabla de casos de las guardas
  (las seis del §5), del rango, y de la anulación (borra solo futuras del
  origen `exemption`); los dobles honran el `where` literal y las guardas se
  verifican **por mutación** (la lección repetida de la rama del M6).
- **Tests de pantalla** (`renderToStaticMarkup`) para la pestaña y los avisos.
- **CA en vivo, en local**: eximir a un socio activo de prueba → el devengo no
  le crea cuotas del rango; mostrador, link y adhesión bloqueados con sus
  mensajes; `/mi/cuenta` muestra el banner sin tarjeta de pago; figura "al día"
  y vota en el padrón electoral; un mes ya pago del rango queda pago y la
  confirmación lo dijo; **anular** → las exentas futuras desaparecen y el
  devengo siguiente le crea `pending` normalmente; el historial de la ficha
  muestra los dos movimientos con sus actas.
