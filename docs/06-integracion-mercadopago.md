# 06 — Integración Mercado Pago

Cuenta institucional de la asociación (CUIT propio, IVA exento). SDK oficial
`mercadopago` para Node. Desde el **22/08/2026** `vecinalciudadela.ar` corre con
credenciales **productivas** (piloto real: el socio 306 se afilió por la web y su
débito funcionó); el sandbox quedó para la máquina de desarrollo. **No se prueban
cobros contra el dominio**: ahí la plata es de un vecino. Verificar en el panel de
MP que la condición fiscal (exento) esté correctamente cargada.

Cómo se obtienen las credenciales de sandbox, se crean los planes y se configuran
los webhooks: `docs/11-preparacion-mp-sandbox-turnstile.md`.

## Piezas

**Estado al cerrar la fase 4B (23/08/2026): las siete están implementadas.** El
Módulo 3 dejó 1, 2, 4 y 7 (altas web); la fase 4A no tocó ninguna (su alcance fue
la cuenta corriente local y el efectivo); la fase 4B cerró 3, 5 y 6 —links de pago
puntuales, vinculación de suscripciones preexistentes y conciliación diaria— y
además convirtió el webhook de la pieza 4 en el que **aplica** el pago.

Lo que sigue está verificado contra la API real de Mercado Pago (sandbox aislado
con túnel, tres pasadas el 23/08/2026). Lo que se aprendió en esas pasadas —y lo
que **no** se pudo probar sin producción— está en `docs/11` Parte J.

### 1. Planes de suscripción — hoy son sólo REFERENCIA

> **Dejaron de ser la fuente de verdad de los montos (fase 4A) y dejaron de ser
> obligatorios (fase 4B).** La fuente es la tabla local `fee_values` (ver
> `docs/04`): de ahí salen el devengo, la deuda, el efectivo, el reingreso, el
> alta web, la recategorización y el lote REG-34. A Mercado Pago se le **empuja**
> el monto; nunca se le pregunta.

**Son DOS, no tres** (decisión de Mariano del 20/08/2026, implementada en el
Módulo 3):

| Plan en MP | Categorías que lo usan | Monto de referencia |
|---|---|---|
| `SOCIO ACTIVO` | activo | $6.000/mes (obligatoria) |
| `SOCIO ADHERENTE/COLABORADOR` | adherente y colaborador | $3.000/mes |

Adherente y colaborador **comparten un solo plan** porque comparten el monto: dos
planes idénticos en MP no aportaban nada y duplicaban el mantenimiento de la CD.
La distinción entre "voluntaria" (adherente) y "obligatoria" (colaborador) es
estatutaria y vive en SIGeV, no en Mercado Pago.

Los ids de plan **no se adivinan por nombre**: se cargan a mano, como claves de
`Configuration`, desde `/admin/configuracion` (solo superadmin):

- `mp_plan_active_id` → plan "SOCIO ACTIVO"
- `mp_plan_shared_id` → plan "SOCIO ADHERENTE/COLABORADOR"

Se descartó matchear contra `GET /preapproval_plan/search` por `reason`: un
renombre en el panel de MP habría dejado el wizard sin montos en silencio.

**Desde la fase 4B los dos ids son OPCIONALES.** El único consumidor que les queda
es el **aviso de divergencia plan-vs-valor vigente** del paso 5b de la conciliación
diaria (§6), que simplemente no corre si no están cargados. Sin ids, el sistema
cobra igual: el alta web, la recategorización y el lote REG-34 leen `fee_values`.

**La caché de montos ya no existe.** `src/lib/mp/plans.ts` —una caché de 24 h en
memoria del proceso, **stale-on-error**— se borró en la fase 4B. Servía en silencio
el último valor bueno cuando la lectura fallaba: para mostrar un monto estaba bien,
para **cobrarlo** era un débito equivocado que nadie veía fallar. Con `fee_values`
la lectura es local y no puede quedar vieja.

**Los planes no son un vínculo.** Las suscripciones de los vecinos se crean **sin
plan asociado** y **copian** el monto (§2), así que cambiar el plan en el panel de
MP **no mueve ninguna suscripción ya creada**. Corregido el 21/08/2026: la versión
anterior de este documento decía que "el cambio se propaga a las suscripciones
asociadas por MP", y eso nunca fue cierto para SIGeV porque el flujo con plan
asociado nunca funcionó (ver §2).

Consecuencia operativa de REG-34: cuando la CD actualiza el valor de la cuota, hay
que **empujarle el monto nuevo a cada suscripción viva** con
`PUT /preapproval/{id}`. Eso es el **lote de `/admin/tesoreria/valores`** (§7),
implementado en la fase 4B. Sin correrlo, las altas nuevas salen con el monto nuevo
y las viejas siguen debitando el anterior.

Efecto colateral bueno: la actualización queda atada al acta. En vez de "la CD toca
MP y SIGeV se entera después por un sync que detecta la divergencia", es "el
superadmin registra el valor nuevo con su acta y desde ahí se aplica".

### 2. Suscripciones (débito automático) creadas por el sistema

**SIN plan asociado.** En el paso de pago del wizard, `POST /preapproval` con el
monto **inline**, no con `preapproval_plan_id`:

```jsonc
POST https://api.mercadopago.com/preapproval
{
  "reason": "Cuota societaria Vecinal Ciudadela — SOCIO ACTIVO",
  "auto_recurring": {
    "frequency": 1,
    "frequency_type": "months",
    "transaction_amount": 6000,
    "currency_id": "ARS"
  },
  "payer_email": "vecina@ejemplo.com",
  "external_reference": "solicitud:123",
  "back_url": "https://vecinalciudadela.ar/asociate/retomar/{token}",
  "status": "pending"
}
```

- `reason` — lo que el vecino ve en el checkout y en el resumen de su tarjeta.
  Se arma con el nombre de la asociación + el `reason` del plan (que gobierna la
  CD desde el panel de MP). Obligatorio en las suscripciones sin plan.
- `auto_recurring.transaction_amount` — **el monto que MP le va a debitar**. Desde
  la fase 4B sale del **valor vigente de `fee_values`** (`feeValueReader.current()`),
  no de Mercado Pago. Si no hay valor vigente, el alta **corta antes** de llamar a
  MP y antes de escribir nada local.
- `external_reference` = `solicitud:{id}` (luego, para suscripciones de socios
  existentes: `socio:{id}`). **Obligatorio** en las suscripciones sin plan, y es
  lo que el webhook usa para encontrar la solicitud.
- `payer_email` = email declarado. Ojo: es el que declaró en el formulario, no
  necesariamente el de la cuenta de MP con la que se loguea en el checkout.
- `back_url` = retorno al wizard (`/asociate/retomar/{token}`).
- `status: "pending"` — es lo que hace que MP devuelva `init_point`.
- **NO lleva `notification_url`, y no es un olvido.** Medido contra la API el
  23/08/2026: MP **acepta** el `POST /preapproval` con ese campo y lo **descarta en
  silencio** (el recurso devuelto no lo trae). Un preapproval **no puede** ser
  autosuficiente en avisos.

> **Consecuencia que hay que tener presente en producción.** Como el preapproval no
> puede traer su propia `notification_url`, los avisos de suscripción dependen
> **enteramente** de la configuración de webhooks de la aplicación en el panel de
> MP (`docs/11` Parte D). Si esa configuración se borra, apunta a otro lado o queda
> en la solapa equivocada, **los débitos dejan de avisar sin ninguna señal**: nada
> falla, simplemente no llega nada. La única red es el paso 2 de la conciliación
> diaria (§6). Las preferencias de Checkout Pro sí mandan la suya, así que los
> pagos por link siguen llegando aunque el panel esté mal configurado — lo que
> vuelve el síntoma todavía más difícil de ver.

La respuesta trae `init_point` con la forma
`https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id={id}`,
que es exactamente la que reconstruye `src/lib/mp/checkout.ts`.

#### Por qué NO se usa el flujo con plan asociado (no "restaurarlo")

La versión anterior de este documento —escrita **antes** de programar— decía
`POST /preapproval` "asociada al plan de la categoría". **Es imposible.** Medido
contra la API real el 21/08/2026, ese cuerpo responde:

```json
{"message":"card_token_id is required","status":400}
```

La documentación de MP lo confirma: *"A Subscription with associated plan should
always be created with its `card_token_id` and in status `Authorized`"*
([Suscripciones con plan asociado](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-associated-plan)).
O sea, el flujo con plan es **Checkout API**: la tarjeta se tokeniza en el
navegador **en nuestro sitio** con el SDK JS de MP y la suscripción nace ya
autorizada. Dos motivos para descartarlo, cualquiera de ellos suficiente:

1. **No hay redirección.** No devuelve pantalla de autorización, así que no hay
   `init_point` al que mandar al vecino: se cae todo el paso de pago del wizard.
2. **Nos mete datos de tarjeta.** Aunque el número no toque nuestro servidor,
   entramos en alcance PCI SAQ A-EP; y además deja afuera "dinero en cuenta",
   que es un medio que el vecino va a querer usar.

Lo único que se pierde yendo sin plan es la sincronización automática del monto
plan→suscripción, que **nunca tuvimos** porque este flujo nunca funcionó. Su
reemplazo (empujar el monto por API) está descripto en §1 y su lote, en §7.

Tampoco sirve el link de checkout del propio plan
(`subscriptions/checkout?preapproval_plan_id=...`): no admite
`external_reference`, así que no sabríamos de quién es la suscripción; es un
link público que permitiría suscribirse sin pasar por el wizard (sin DNI, sin
domicilio, sin documentos); el `back_url` sería del plan y no de la solicitud; y
no habría `preapprovalId` que guardar antes de redirigir, con lo que se caen el
reintento idempotente y la cancelación del cron de vencimiento.

El usuario autoriza en el checkout de MP (dinero en cuenta o tarjeta).
La autorización y el primer cobro llegan por webhook: **el `back_url` nunca
acepta una solicitud**, solo muestra "estamos confirmando tu pago" y sondea el
estado. La suscripción se registra en `MpSubscription` con su `applicationId`,
y el `memberId` se completa recién al asentar el alta en acta.

`MpSubscription.planId` guarda el plan de **referencia**: de dónde salió el
monto, **no** el plan al que la suscripción está asociada en MP (no está asociada
a ninguno). Sirve para saber qué valor se le copió y para que la conciliación no lea
divergencias inventadas cuando la Comisión recategoriza.
Desde la fase 4B es **nullable**: una suscripción creada a mano desde el panel de
MP no tiene plan de referencia, y `""` como centinela queda prohibido.

Toda la API de MP se consume detrás de `src/lib/mp/gateway.ts`
(`makeMpGateway()`, sin argumentos: lee `MP_ACCESS_TOKEN` del entorno). El dominio
ve una interfaz propia de **once** métodos y los tests mockean esa interfaz, nunca
el SDK ni la red:

| Método | Para qué |
|---|---|
| `getPlan` | monto de referencia de un plan (§1; único consumidor: el aviso de divergencia del cron) |
| `createPreapproval` | alta web: crea la suscripción y devuelve `init_point` |
| `cancelPreapproval` | rechazo y expiración de solicitudes |
| `updatePreapprovalAmount` | recategorización y lote REG-34 |
| `getPreapproval` | estado y monto de una suscripción |
| `getPayment` | un pago (Checkout Pro, ingreso, débito) |
| `getAuthorizedPayment` | un cobro recurrente de una suscripción |
| `searchPreapprovals` | conciliación: suscripciones vivas y huérfanas; pantalla "Sin vincular" |
| `searchAuthorizedPayments` | conciliación paso 2 y "cobros previos" de la vinculación |
| `searchPayments` | conciliación paso 1: aprobados de las últimas 72 h |
| `createPreference` | Checkout Pro (§3) |

Dos trampas de paginación, medidas contra la API real (`docs/11` Parte J):
`/authorized_payments/search` **rechaza `limit`** por encima de ~15 —hay que
omitirlo—, mientras `/v1/payments/search` y `/preapproval/search` aceptan 100.

### 3. Links de pago puntuales (Checkout Pro) — fase 4B

`POST /checkout/preferences` con `external_reference = pago:{socio_id}:{n}` y
`notification_url` propia. Dos puertas, la misma pieza:

- **Admin**: `/admin/socios/[id]/link` (desde la cuenta corriente de la ficha).
  Genera el enlace, lo copia, y opcionalmente lo **manda por email** al socio.
- **Socio**: botón "Pagar ahora" en `/mi/cuenta`. No se le ofrece a las categorías
  que no pagan cuota.

Cuatro cosas que hay que leer bien:

1. **`n` es una CANTIDAD de cuotas, no una lista de períodos.** Qué cuotas se
   imputan lo decide `allocate` **cuando el pago llega**, y siempre son las **más
   viejas** pendientes. Si el socio pagó algo en el medio, el link sigue siendo
   válido: cobra `n` cuotas, las que correspondan en ese momento.
2. **La preferencia NO se persiste.** No hay tabla de links: el pago se reconoce
   por su `external_reference` cuando llega el webhook. Un link es un papelito, no
   un compromiso.
3. **Vence a las 72 horas** (`PAYMENT_LINK_TTL_HOURS`), con `expires: true` **y**
   `expiration_date_to` — uno sin el otro no hace nada. Sin vencimiento, el link
   congela el precio del día en que se generó, y un pago posterior a una
   actualización REG-34 se imputa igual dejando sólo un asiento
   `link_amount_mismatch`. 72 h cubre viernes-tarde → lunes y acota esa ventana
   de infinito a tres días. Desde la fase 4C **`/admin/salud` cuenta esos
   asientos** — como historia acumulada, no como cola de trabajo.
4. **El monto sale de `fee_values`**, y el importe que efectivamente pagó el vecino
   se compara al aplicar: si difiere, la cuota se imputa **igual** (la plata entró)
   y queda el asiento `link_amount_mismatch`.

**La vuelta del vecino.** Las tres `back_urls` (success, pending, failure) son la
misma URL nuestra, así que el desenlace se lee de la query. Parámetros reales que
manda MP, medidos el 23/08/2026:

```
?volvio=1&collection_id=…&collection_status=approved&payment_id=…&status=approved
&external_reference=pago%3A297%3A2&payment_type=account_money&merchant_order_id=…
&preference_id=…&site_id=MLA&processing_mode=aggregator&merchant_account_id=null
```

MP manda `collection_status` **y** `status`; se lee `collection_status` primero.
Sin referencia, `external_reference` llega como el **string** `"null"`. El
`?volvio=1` nuestro sobrevive: MP agrega los suyos al final.

> **Cuando la tarjeta rechaza, MP retiene al vecino en su propio checkout**
> ofreciéndole otro medio (la URL termina en `/challenge/`): **no** lo devuelve con
> `collection_status=rejected`. La pantalla "te rechazaron, probá de nuevo" es
> **defensiva** —cubre al que abandona el challenge—, no el camino habitual.

**La carrera con el webhook la gana casi siempre el webhook**, así que el vecino
suele volver y ver el recibo ya emitido. La pantalla decide con una función pura
(`returnView`): un pago **nuevo** detectado durante el sondeo confirma siempre; uno
anterior al inicio del trámite sólo confirma si MP dijo `approved`. Sin eso, quien
pagaba una cuota con tarjeta y sacaba un cupón por las otras leía "listo" con el
cupón sin pagar.

### 4. Webhooks (`/api/webhooks/mp`)

Configuración del panel (confirmada el 23/08/2026, ver `docs/11` Parte D): eventos
**"Planes y suscripciones" + "Pagos (legacy)"**. En una aplicación de tipo
Suscripciones el panel **no ofrece "Pagos" a secas**; "Pagos (legacy)" es el tópico
`payment` y manda el POST **moderno firmado**. El endpoint atiende exactamente tres
tópicos: `payment`, `subscription_preapproval`, `subscription_authorized_payment`.

**Por cada pago de Checkout Pro, MP manda CUATRO requests** a la
`notification_url`: la moderna firmada (`?data.id=X&type=payment`), la **IPN
legacy** (`?id=X&topic=payment`) y **dos** de `?id=Y&topic=merchant_order`. Las tres
últimas responden **200 `{"ignored":"legacy_ipn"}`** — recibido, **no** procesado:
no se persiste ni se aplica nada. Son notificaciones legítimas en un formato que no
implementamos, y un 4xx sostenido es algo que MP puede terminar deshabilitando, con
lo que se perdería también la buena. Un POST **sin** `topic=` sigue dando 400 y sin
auditar.

Procesamiento (inline: la escala lo permite):

1. **Validar `x-Signature`** (HMAC-SHA256 sobre `id` + `x-request-id` + `ts` con
   `MP_WEBHOOK_SECRET`, comparación timing-safe y tolerancia de reloj). Falla →
   **401 sin persistir el payload**; el secreto nunca se loguea. El `data.id` se
   normaliza a minúsculas y se valida contra `^[a-z0-9-]{1,64}$` **antes** de entrar
   al manifiesto: los `preapproval_id` son hex de 32 caracteres, así que filtrar por
   "solo dígitos" habría rechazado todos los webhooks de suscripción.
   *Verificado el 23/08/2026 contra firmas reales de MP; hasta entonces sólo se
   había probado contra firmas nuestras con la misma clave, que es consistente
   consigo mismo y no prueba nada.*
2. Registrar crudo en `WebhookEvent`, idempotente por `(origin, externalEventId)`.
   **El cuerpo de MP trae un `id` de evento** —distinto del id del pago; ejemplos
   reales `136606437047`, `136766467098`— y es ése el que se usa; el fallback
   `{tópico}:{data.id}:{action}` quedó para las notificaciones disparadas a mano.
   Evento ya procesado → 200 `ignored_duplicate`. Sin `processedAt` (un intento
   anterior falló) → se reprocesa sobre la misma fila.
3. Procesar según tópico y responder 200 con el `result` en la fila. **El procesador
   nunca falla por una regla de negocio**: todo lo que no se puede aplicar termina
   en la bandeja (`docs/05` §5), nunca en un 500 que haga reintentar a MP.
   - `payment` → `getPayment(id)` → `resolve` → `registerPayment`.
     - `pago:{socio}:{n}` → `link_applied`: pago, cuotas imputadas, recibo y email.
     - `solicitud:{id}` de una solicitud viva → cuota de **ingreso**
       (`application_approved`), la solicitud pasa a `approved_pending_minute` y
       sale el email de bienvenida. **Se escribe un `Payment` tipo `entry` con su
       `mpPaymentId`**: es lo que impide que ese mismo dinero se re-impute como
       cuota social después del acta (REG-14).
     - Cobro de una **suscripción vinculada** → `debit_applied`: una cuota, la más
       vieja. El preapproval viene en el propio pago, en
       `point_of_interaction.transaction_data.subscription_id`.
     - `rejected` → `payment_rejected_traced` (queda registrado; no crea nada, no
       consume número de recibo). `refunded` / `charged_back` → `payment_refunded`:
       **anula el recibo y devuelve las cuotas a pendientes**, y una segunda
       notificación del mismo reembolso da `refund_ignored`.
     - Nada de lo anterior → **bandeja**, con su motivo (`unmatched_no_reference`,
       `unmatched_no_subscription`, `unmatched_application_missing`,
       `unmatched_duplicate_entry`, `unmatched_withdrawn_no_pending`,
       `unmatched_treasury_rejected`).
   - `subscription_preapproval` → actualiza `MpSubscription.status`
     (`subscription_synced`, o `no_match` si no hay fila local).
   - `subscription_authorized_payment` → `getAuthorizedPayment(id)` → `getPayment` →
     mismo camino que arriba. **El mismo cobro llega por los dos tópicos**: la
     segunda notificación encuentra el pago ya registrado y devuelve
     `already_processed`. Un mutex por `mp:{paymentId}` serializa a los dos.
4. Cualquier excepción **técnica** del paso 3 se captura, deja `error` en la fila y
   responde **500 para que MP reintente**: como el evento quedó sin `processedAt`,
   el reintento lo reprocesa sin duplicar efectos.

**Idempotencia en dos capas, las dos verificadas contra MP real**: la **ruta**, por
`WebhookEvent` (mismo `body.id` → `ignored_duplicate`), y el **procesador**, por
`Payment.mpPaymentId` (mismo cobro llegando con otro id de evento →
`already_processed`). Después de las dos: un pago, un recibo, la serie intacta.

**Pago que llega después del vencimiento** (decisión de Mariano del 21/08/2026): el
cron expira las solicitudes a los 7 días, pero si el aviso del primer pago llega
tarde la solicitud **revive** a `approved_pending_minute` con `result =
application_approved_after_expiry`. El pago manda sobre el vencimiento: el vecino
autorizó el débito y MP le cobró, y esa plata no vuelve. Como al expirar el cron
canceló la suscripción, el caso queda **marcado en pantalla** (asiento estricto de
auditoría, aviso en el detalle y badge "Sin débito"): hay que rehacer la suscripción
a mano. Ver `docs/05` §3.

### 5. Vinculación de suscripciones preexistentes (una sola vez) — fase 4B

Pantalla `/admin/tesoreria/suscripciones`, dos bloques:

- **Sin vincular**: `GET /preapproval/search` sin fila local y **sin cancelar**
  (`isNotCancelled`, el mismo predicado con el que el cron cuenta `orphanPreapprovals`:
  si la pantalla mirara menos que el contador, `/admin/salud` avisaría de una huérfana
  que no se ve desde ningún lado — una pausada no genera débitos, así que tampoco cae
  en la bandeja). Cada ficha dice qué pasa si nadie hace nada, que **no** es siempre un
  cobro próximo: una pausada no cobra hasta que el vecino la reanude y una pendiente
  todavía no está autorizada. Con **sugerencia** de
  socio por `payer_email` o apellido. La sugerencia por email exige **exactamente
  un** candidato: `Member.email` no es único y un matrimonio con la misma casilla
  habría devuelto el primero por orden de PK, en silencio.
- **Vinculadas**: desde la base, con su monto y su última sincronización.

La vinculación va en **dos pasos** y la evidencia de la confirmación se resuelve en
el **servidor** (el nombre del socio no viaja en el POST): tres renglones —**Antes**,
**Ahora**, **De acá en más**— que dicen los cobros previos que quedan afuera (la
deuda histórica ya está cargada: no se importan), los pagos que están esperando en
la bandeja con fecha, monto e id, y qué va a pasar el mes que viene. Al confirmar,
**las filas `open` de la bandeja de esa suscripción se aplican solas** (pago, cuota,
recibo) y quedan `matched`.

Es acción de **superadmin**: crea un vínculo que después cobra solo. Si el socio ya
tiene otra suscripción viva, **avisa** (no bloquea): `mp_subscriptions.member_id` es
índice, no unique.

El campo `debito_automatico='Si'` del padrón importado marca los candidatos, pero
**no es prueba**: tiene tres escrituras y ninguna lo baja, así que la ficha lo trata
como una señal a contrastar, no como la verdad.

### 6. Conciliación de respaldo — `POST /api/cron/reconcile`, 03:00

La red de contención de la plata: si un webhook no llega, esto lo repara. Corre por
crontab (`docs/11` Parte H), escribe una fila en `cron_runs` y deja el asiento
`reconcile_cron`. Devuelve **200** si no hubo errores y **207** si corrió entera con
alguno — 207 no es "casi 200": es la única señal de que la red se rompió.

Cinco pasos, aislados entre sí (un fallo en uno no frena a los demás, y un ítem que
explota no frena al resto de su bucle):

1. **`GET /v1/payments/search`** por `date_approved` de las últimas 72 h → todo
   pago aprobado sin registro local se procesa **por el mismo camino que el
   webhook** (`processor.applyPayment`), así que el resultado es idéntico al del
   aviso perdido.
2. **`GET /authorized_payments/search` por CADA suscripción viva** → es lo **único**
   que encuentra los débitos recurrentes: la búsqueda de pagos por
   `external_reference` no los indexa. Saltea las filas que el operador ya resolvió
   o descartó en la bandeja, para no re-imputar lo que alguien decidió a mano.
3. **Estado de cada suscripción** contra MP → corrige el espejo local
   (`subscriptionsSynced`). `subscriptionsDrifted` cuenta las que **cambiaron** de
   estado hacia algo que no es `authorized`: un `pending` que sigue `pending` es un
   alta en vuelo —o una colgada por un `cancelPreapproval` que falló— y no derivó de
   nada. Es un **delta de la corrida**, no un stock: el stock se ve en la pantalla de
   Suscripciones, que es donde el operador puede hacer algo.
4. **Preapprovals huérfanos**: `external_reference = solicitud:{id}` sin fila
   `MpSubscription`. Las **canceladas se saltean**: no cobran nunca más, y contarlas
   dejaba un número que ninguna acción podía bajar. Es el único recupero posible si `createPreapproval` sale bien y
   la escritura local falla: sin esto, el vecino tiene un débito autorizado del que
   SIGeV no sabe nada.
5. **Divergencias de monto**: (a) `auto_recurring.transaction_amount` de cada
   suscripción viva contra el **valor vigente de `fee_values`** —la que importa, y
   que se corrige con el lote de §7—; (b) el plan de referencia contra ese mismo
   valor, que **sólo corre si los ids de plan están cargados** (§1).

El resumen lleva `paymentsRecovered/Inbox/Skipped`, `debitsRecovered/Inbox/Skipped`,
`subscriptionsSynced`, `subscriptionsDrifted`, `orphanCreated`, `orphanCancelled`,
`orphanPreapprovals`, `amountDivergent`, `planDivergent` y `errors` (tope 50, con
`errorsOmitted`). **La causa de cada error viaja entera** en `errors[]`: es el único
canal por el que alguien se entera de que la red se rompió.

Desde la fase 4C el resultado se lee en **`/admin/salud`** (superadmin), que muestra
la última corrida de cada cron con su resumen. La consulta SQL directa sigue
sirviendo y está en `docs/11` Parte H.

> **`amountDivergent` puede aparecer en 1 y bajar a 0 en la corrida siguiente sin
> que nadie toque nada**: la lista de suscripciones se junta antes del sync, así que
> una que MP ya dio de baja se marca divergente en el mismo run en que se aprende que
> está cancelada. Se corrige solo.

### 7. Aplicar el valor vigente a las suscripciones (lote REG-34) — fase 4B

En `/admin/tesoreria/valores`, para **superadmin** (un admin común ve la lista). Es
la operación que le toca la tarjeta a un vecino, así que:

- Lista las suscripciones **divergentes** contra el valor vigente, calculado sobre la
  categoría **viva** del socio (un recién recategorizado aparece).
- Corre en tandas de 25, en serie, con la cola manejada por el cliente y **una sola
  intentona por suscripción por corrida**: reintentar en bucle a las que fallan
  siempre golpea a MP sin fin. El reintento es un click.
- **Orden de escritura fijado por test: MP primero, espejo local después**, con
  `catch` separados. "Base sí, MP no" es imposible por construcción; "MP sí, base no"
  sale con código propio `MIRROR_FAILED`, va al asiento y la fila sigue divergente
  para el reintento. Nada queda cambiado en MP sin que alguien se entere.
- Si la suscripción es de alguien dado de **baja**, la confirmación lo dice: lo que
  corresponde es dar de baja la suscripción, no actualizarla.
- El asiento `fee_value_applied` lleva `{updated, failed:[preapprovalId/memberId/
  code], remaining}` y **ningún nombre ni email**.

**No alcanza a**: suscripciones que no están `authorized`, las no vinculadas, y las
tres categorías sin cuota (cadete, honorario, vitalicio).

### 8. Reembolsos y cancelaciones

- Rechazo de solicitud: `cancelPreapproval(id)` (la cuota de ingreso NO se
  reembolsa, REG-12.b, y el email de rechazo lo dice). Si MP falla, la pantalla
  avisa que la suscripción **quedó sin cancelar** y hay que hacerlo a mano: el
  rechazo no se deshace por un error de red, pero tampoco se calla.
- Expiración por falta de pago (cron de solicitudes): misma cancelación,
  best-effort; si falla queda contada en `errors` de la corrida.
- **Baja o renuncia de un socio con débito: se cancela la suscripción por API al
  confirmar la baja. HECHO en la fase 4C** (24/08/2026; se había reasignado a esa
  fase el 23/08 desde el "Módulo 5" que decía este documento). Vale para las **dos**
  bajas del panel —la individual por acta y el lote de cesantía por mora—, que
  comparten el mismo módulo de dominio (`src/lib/members/withdraw-with-debits.ts`).
  Tres precisiones que importan:
  - **La llamada a MP vive FUERA de la `$transaction` de la baja**, después del
    commit. Una llamada de red adentro sostiene el lock de las filas hasta el
    timeout de 5 s de Prisma — mismo corolario que el PDF del recibo (REG-33).
  - Es **best-effort con fallo visible**: la baja no se deshace por un error de red,
    pero la pantalla dice que la suscripción **quedó sin cancelar**, y el lote la
    cuenta en su tercer balde ("cesanteado pero el débito sigue vivo").
  - Se cancela por **lista negra**: todo lo que no esté ya cancelado, incluido un
    estado que MP no documente. No saber es peor que cancelar de más.
- **Lo que sigue sin cubrir**: el socio **vigente** con dos suscripciones vivas. El
  botón de cancelar de `/admin/tesoreria/suscripciones` está acotado a socios dados
  de baja (enmienda del operador), así que ahí hay que cancelar una desde el panel de
  Mercado Pago. `mp_subscriptions.member_id` es índice y no unique: nada lo impide.
- Recategorización de una solicitud: si el monto de la categoría nueva difiere, se
  actualiza la suscripción por API **antes** de tocar la fila local. Si MP falla, la
  acción se corta entera: al revés, la solicitud diría "activo" mientras el débito
  sigue saliendo por el monto de adherente y nadie lo compensaría. El monto sale de
  `fee_values`; si no hay valor vigente, **aborta antes de llamar a MP** y no escribe
  nada.
- Reembolsos manuales excepcionales: se hacen desde el panel de MP. El webhook
  (`payment` con status `refunded`) **anula el recibo con el motivo "Reembolso en
  Mercado Pago" y devuelve las cuotas a pendientes, solo**. Verificado de punta a
  punta el 23/08/2026. El número de recibo **no** se reutiliza (REG-33).
  Ojo con el sandbox: el reembolso **por API** está bloqueado para las cuentas de
  prueba (403 `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`); por el panel del vendedor
  anda.

### 9. Ingresos que no son de ningún socio

No toda la plata que entra es de cuotas: alquiler del salón, eventos, rifas,
donaciones. Un cobro de MP que no es de nadie se resuelve desde la bandeja como
**ingreso no societario**, con concepto en texto libre, y **no emite recibo**: la
serie numerada es de las cuotas sociales y está armada alrededor del socio (REG-33).
Ver `docs/04` (`other_incomes`) y `docs/05` §5. Es un **registro**, no contabilidad
general (`docs/01`).

## Matriz de conciliación

| Origen del dinero | Identificación | Registro |
|---|---|---|
| Débito de suscripción creada por SIGeV | `external_reference` | Automático |
| Débito de suscripción preexistente vinculada | `preapproval_id` | Automático (fase 4B) |
| Link de pago generado por SIGeV | `external_reference` | Automático |
| Pago suelto / transferencia al CVU | — | Manual (bandeja "Sin conciliar") |
| Efectivo en sede | Admin | Manual con recibo inmediato |
| Plata que no es de ningún socio | Admin | Ingreso no societario, sin recibo (§9) |

Política: empujar a todos hacia suscripción o link; las transferencias sueltas
quedan como excepción con matching manual.
