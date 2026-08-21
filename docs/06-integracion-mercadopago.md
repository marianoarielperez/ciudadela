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
y cachea **24 h** (`unstable_cache`, tag `mp-plans`). Si la API falla y no hay
caché, el paso 2 del wizard muestra un error y **no deja avanzar**: nunca se
inventa un monto. Cuando la CD actualiza un plan, el cambio se propaga a las
suscripciones asociadas por MP; el sync diario del Módulo 4 detecta la
divergencia con la tabla local `ValorCuota` y pide al admin registrar el nuevo
valor con su acta (REG-34).

> Deuda anotada en el Módulo 3: cambiar los ids de plan en `/admin/configuracion`
> **no invalida** la caché de montos, así que el wizard puede mostrar hasta 24 h
> el monto del plan anterior. Se cierra en el Módulo 4 junto con la pantalla de
> valores de cuota.

### 2. Suscripciones (débito automático) creadas por el sistema
En el paso de pago del wizard: `POST /preapproval` asociada al plan de la categoría,
con:
- `external_reference` = `solicitud:{id}` (luego, para suscripciones de socios
  existentes: `socio:{id}`)
- `payer_email` = email declarado
- `back_url` = retorno al wizard (`/asociate/retomar/{token}`)

El usuario autoriza en el checkout de MP (dinero en cuenta o tarjeta).
La autorización y el primer cobro llegan por webhook: **el `back_url` nunca
acepta una solicitud**, solo muestra "estamos confirmando tu pago" y sondea el
estado. La suscripción se registra en `MpSubscription` con su `applicationId`,
y el `memberId` se completa recién al asentar el alta en acta.

Toda la API de MP se consume detrás de `src/lib/mp/gateway.ts`
(`makeMpGateway(deps)`): el dominio ve una interfaz propia —`getPlan`,
`createPreapproval`, `cancelPreapproval`, `getPayment`, `getAuthorizedPayment`—
y los tests mockean esa interfaz, nunca el SDK ni la red.

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
