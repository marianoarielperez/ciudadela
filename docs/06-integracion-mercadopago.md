# 06 — Integración Mercado Pago

Cuenta institucional de la asociación (CUIT propio, IVA exento). SDK oficial
`mercadopago` para Node. Hasta el lanzamiento, `vecinalciudadela.ar` corre con
credenciales de **prueba** (sandbox completo, tarjetas de test); el cambio a
credenciales productivas es un paso del checklist de `docs/07`. Verificar en el
panel de MP que la condición fiscal (exento) esté correctamente cargada.

Cómo se obtienen las credenciales de sandbox, se crean los planes y se configuran
los webhooks: `docs/11-preparacion-mp-sandbox-turnstile.md`.

## Piezas

Estado al cerrar el Módulo 3: **1, 2, 4 y 7 están implementadas** (altas web).
Las piezas 3, 5 y 6 —links de pago puntuales, vinculación de suscripciones
preexistentes y conciliación de respaldo— son del **Módulo 4**.

### 1. Planes de suscripción (fuente de verdad de los montos)

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
Cargarlos a mano es explícito y determinista, y el instructivo de `docs/11`
explica de dónde salen.

El sistema NO fija montos: `src/lib/mp/plans.ts` los **lee por API** (get por id)
y los cachea **24 h**. La caché es una variable **en memoria del módulo** —no
`unstable_cache` ni ningún tag de Next—: vive dentro del proceso de Node, se
pierde en cada `pm2 restart` y **no se puede invalidar desde afuera**. Es
sostenible porque la app corre en **un solo proceso** (`docs/03`); con varias
instancias cada una tendría su propia copia y podrían mostrar montos distintos.
Además la caché es **stale-on-error**: si MP (o la lectura de configuración)
falla, se sigue sirviendo el último valor bueno en vez de romper el paso 2. Si la
API falla y **nunca** hubo un valor cacheado, el paso 2 del wizard muestra un
error y **no deja avanzar**: nunca se inventa un monto.

**Los planes son el REGISTRO del monto, no un vínculo.** Las suscripciones de los
vecinos se crean **sin plan asociado** y **copian** el monto (ver §2), así que
cambiar el plan en el panel de MP **no mueve ninguna suscripción ya creada**.
Corregido el 21/08/2026: la versión anterior de este documento decía que "el
cambio se propaga a las suscripciones asociadas por MP", y eso nunca fue cierto
para SIGeV porque el flujo con plan asociado nunca funcionó (ver §2).

Consecuencia operativa de REG-34: cuando la CD actualiza el valor de la cuota,
tocar el panel de MP **no alcanza**. El panel de MP pasa a ser el lugar donde se
declara el monto nuevo (y de donde el wizard lo lee para las altas siguientes);
para las suscripciones **ya vivas**, SIGeV tiene que empujar el monto nuevo a
cada una por API con `PUT /preapproval/{id}` — `updatePreapprovalAmount()` ya
está implementado y en uso en la recategorización, lo que falta es el **lote**.
Ese lote es alcance del **Módulo 4** (ver `docs/07`). **Hasta que exista, un
cambio de cuota en MP NO afecta a las suscripciones ya creadas**: las altas
nuevas salen con el monto nuevo y las viejas siguen debitando el anterior.

Efecto colateral bueno: la actualización queda atada al acta. En vez de "la CD
toca MP y SIGeV se entera después por un sync que detecta la divergencia", es "el
admin registra el nuevo valor con su acta y desde ahí se aplica".

> **La caché de montos es para MOSTRAR, no para COBRAR.** Como el monto que se
> manda a MP es el que se debita (§2), `startPaymentAction` lee el plan
> **fresco** con `getPlan`, sin pasar por la caché, y si esa lectura falla **no
> crea la suscripción**: devuelve "probá de nuevo en unos minutos". Es preferible
> no cobrar a debitarle a un socio un importe que la Comisión ya cambió. La caché
> sigue siendo la correcta para el paso 2 del wizard, que sólo muestra.

> Deuda anotada en el Módulo 3: cambiar los ids de plan en `/admin/configuracion`
> **no invalida** la caché de montos, así que el wizard puede mostrar hasta 24 h
> el monto del plan anterior. Y como la caché es de proceso, **no alcanza con un
> `updateTag`**: hoy la única forma de forzar la relectura es reiniciar la app
> (`pm2 restart sigev`). Se cierra en el Módulo 4 junto con la pantalla de
> valores de cuota.

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
- `auto_recurring.transaction_amount` — **el monto que MP le va a debitar**. Se
  lee del plan **fresco por API** en el momento de crear la suscripción (§1).
- `external_reference` = `solicitud:{id}` (luego, para suscripciones de socios
  existentes: `socio:{id}`). **Obligatorio** en las suscripciones sin plan, y es
  lo que el webhook usa para encontrar la solicitud.
- `payer_email` = email declarado. Ojo: es el que declaró en el formulario, no
  necesariamente el de la cuenta de MP con la que se loguea en el checkout.
- `back_url` = retorno al wizard (`/asociate/retomar/{token}`).
- `status: "pending"` — es lo que hace que MP devuelva `init_point`.

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
reemplazo (empujar el monto por API) está descripto en §1 y su lote es del M4.

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
a ninguno). Sirve para saber qué valor se le copió y para que la conciliación del
M4 no lea divergencias inventadas cuando la Comisión recategoriza.

Toda la API de MP se consume detrás de `src/lib/mp/gateway.ts`
(`makeMpGateway()`, sin argumentos: lee `MP_ACCESS_TOKEN` del entorno). El
dominio ve una interfaz propia de **siete** métodos —`getPlan`,
`createPreapproval`, `cancelPreapproval`, `updatePreapprovalAmount`
(el que usa la recategorización), `getPreapproval`, `getPayment` y
`getAuthorizedPayment`— y los tests mockean esa interfaz, nunca el SDK ni la red.

### 3. Links de pago puntuales (Checkout Pro) — Módulo 4
Para cuotas atrasadas, aportes voluntarios y pagos sueltos: `POST /checkout/preferences`
con `external_reference` = `pago:{socio_id}:{períodos}` y `notification_url`.
Se envía por email o se copia desde tesorería / panel de socio.

### 4. Webhooks (`/api/webhooks/mp`)
Configurar en el panel de MP los tópicos:
- `subscription_preapproval` (creación/actualización de suscripciones)
- `subscription_authorized_payment` (cobros recurrentes autorizados)
- `payments` (todos los pagos: recurrentes y Checkout Pro)

Procesamiento (implementado en el Módulo 3, **inline**: la escala lo permite):

1. **Validar `x-Signature`** (HMAC-SHA256 sobre `id` + `x-request-id` + `ts` con
   `MP_WEBHOOK_SECRET`, comparación timing-safe y tolerancia de reloj). Falla →
   **401 sin persistir el payload**; el secreto nunca se loguea. El `data.id`
   se normaliza a minúsculas y se valida contra `^[a-z0-9-]{1,64}$` **antes** de
   entrar al manifiesto de la firma: los `preapproval_id` de MP son hex de 32
   caracteres, así que filtrar por "solo dígitos" habría rechazado todos los
   webhooks de suscripción.
2. Registrar crudo en `WebhookEvent`, idempotente por `(origin, externalEventId)`.
   Si el evento ya existe **y tiene `processedAt`** → 200 con `ignored_duplicate`.
   Si existe sin `processedAt` (un intento anterior falló), se reprocesa sobre la
   misma fila.
3. Procesar según tópico y responder 200 con el `result` en la fila:
   - `payments` → `getPayment(id)`. Con `status=approved` y `external_reference`
     `solicitud:{id}`: se guardan `mpPaymentIdEntry` + `entryAmount`, la solicitud
     pasa a `approved_pending_minute` y sale el email de bienvenida
     (`application_approved`). Con `rejected` → `payment_rejected`: queda
     registrado y la solicitud sigue `pending_payment` (MP reintenta el débito
     solo). El Módulo 4 agrega la creación de Pago/Recibo, la aplicación a la
     cuota más antigua y el aviso al socio "no pudimos debitar tu cuota".
   - `subscription_preapproval` → actualiza `MpSubscription.status`
     (`subscription_synced`, o `no_match` si no hay fila local).
   - `subscription_authorized_payment` → `getAuthorizedPayment(id)` y se traza el
     cobro recurrente (`authorized_payment_traced`); la aplicación a cuotas es M4.
   - Sin match (`external_reference` desconocida, pago ajeno) → `no_match`, nunca
     error: el Módulo 4 los levanta en la bandeja sin-matching.
4. Cualquier excepción del paso 3 se captura, deja `error` en la fila y responde
   **500 para que MP reintente**: como el evento quedó sin `processedAt`, el
   reintento lo reprocesa sin duplicar efectos.

**Pago que llega después del vencimiento** (decisión de Mariano del 21/08/2026):
el cron expira las solicitudes a los 7 días, pero si el aviso del primer pago
llega tarde —MP demoró o reintentó— la solicitud **revive** a
`approved_pending_minute` y el evento queda con `result =
application_approved_after_expiry`. El pago manda sobre el vencimiento: el vecino
autorizó el débito y MP le cobró, y esa plata no vuelve. Como al expirar el cron
canceló la suscripción, el caso queda **marcado en pantalla** (asiento de
auditoría `application_approved_after_expiry`, aviso en el detalle y badge "Sin
débito" en la bandeja cuando la suscripción figura `cancelled`): hay que rehacer
la suscripción a mano. Ver `docs/05` §3.

### 5. Vinculación de suscripciones preexistentes (una sola vez) — Módulo 4
Las suscripciones ya creadas desde el panel (ej. la "Cuota Social ACTIVO" activa hoy):
- Pantalla admin "Suscripciones sin vincular": lista `GET /preapproval/search`
  (status authorized) sin match en `MpSubscription` → sugiere socio por `payer_email` /
  apellido → el admin confirma el match → queda vinculada y sus cobros futuros
  concilian solos.
- El campo `debito_automatico='Si'` del padrón importado marca los candidatos.

### 6. Conciliación de respaldo (cron diario) — Módulo 4
Script que consulta `GET /v1/payments/search` (rango: últimas 72 h) y
`GET /preapproval/search`, y compara contra Pagos y `MpSubscription`:
- Pago approved sin registro local → procesarlo igual que un webhook (webhook perdido).
- Suscripción cancelada/pausada sin reflejar → alerta admin.
- Divergencia de montos plan vs ValorCuota → alerta admin (REG-34).
- **Divergencia `auto_recurring.transaction_amount` de una suscripción viva vs. el
  monto de su plan de referencia (`MpSubscription.planId`) → alerta admin.** Es la
  divergencia que crea el diseño de §2 y que **nada más detecta**: como las
  suscripciones copian el monto y no siguen al plan, cualquier lote de
  actualización que quede a medias (REG-34, Módulo 4), toda alta anterior a un
  cambio de cuota y toda recategorización que no haya llegado a MP quedan
  debitando un importe distinto del vigente, sin ningún síntoma. La comparación
  plan vs. `ValorCuota` de arriba **no la ve**: mira el catálogo, no lo que se
  cobra. El resultado tiene que ser accionable: listado de preapprovals
  desalineados con su monto actual y el esperado, para reaplicar el lote.
- **Preapproval con `external_reference = solicitud:{id}` y sin fila
  `MpSubscription`** → es el único recupero posible de una suscripción huérfana:
  si `createPreapproval` sale bien y la escritura local falla, el vecino tiene un
  débito autorizado del que SIGeV no sabe nada. Hoy el único rastro es un
  `console.error` en el log de PM2, que rota. **Requisito del Módulo 3 para el
  barrido del Módulo 4.**

Resultado del cron visible en `/admin/salud`.

### 7. Reembolsos y cancelaciones
- Rechazo de solicitud: `cancelPreapproval(id)` (la cuota de ingreso NO se
  reembolsa, REG-12.b, y el email de rechazo lo dice). Si MP falla, la pantalla
  avisa que la suscripción **quedó sin cancelar** y hay que hacerlo a mano: el
  rechazo no se deshace por un error de red, pero tampoco se calla.
- Expiración por falta de pago (cron de solicitudes): misma cancelación,
  best-effort; si falla queda contada en `errors` de la corrida.
- Baja/renuncia de socio con débito: cancelar la suscripción por API al confirmar
  la baja (Módulo 5).
- Recategorización de una solicitud: si el monto de la categoría nueva difiere, se
  actualiza la suscripción por API **antes** de tocar la fila local. Si MP falla,
  la acción se corta entera: al revés, la solicitud diría "activo" mientras el
  débito sigue saliendo por el monto de adherente y nadie lo compensaría. El
  `planId` local se sincroniza con el plan nuevo en la misma operación.
  **De dónde sale el monto que se escribe**: de una lectura **fresca** del plan
  nuevo (`getPlan(planIdForCategory(categoría))`), nunca de la caché de 24 h de
  `plans.ts` — ese `PUT` fija el importe que MP debita todos los meses, y la caché
  es stale-on-error, o sea que una lectura fallida no falla: devuelve en silencio
  el último valor bueno y dejaría la suscripción cobrando un monto que la CD ya
  cambió. Si el plan de la categoría nueva **no está configurado**, o si la lectura
  del monto falla, la acción **aborta antes de llamar a MP** y no escribe nada
  (mismo criterio que `startPaymentAction`, §2: mejor no tocar el monto que
  tocarlo mal).
- Reembolsos manuales excepcionales: se hacen desde el panel de MP; el webhook de
  `payments` (status refunded) los registra y anula el recibo con nota (Módulo 4).

## Matriz de conciliación

| Origen del dinero | Identificación | Registro |
|---|---|---|
| Débito de suscripción creada por SIGeV | `external_reference` | Automático |
| Débito de suscripción preexistente vinculada | `preapproval_id` | Automático (M4) |
| Link de pago generado por SIGeV | `external_reference` | Automático |
| Pago suelto / transferencia al CVU | — | Manual (bandeja "sin matching") |
| Efectivo en sede | Admin | Manual con recibo inmediato |

Política: empujar a todos hacia suscripción o link; las transferencias sueltas
quedan como excepción con matching manual.
