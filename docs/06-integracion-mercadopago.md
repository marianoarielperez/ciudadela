# 06 — Integración Mercado Pago

Cuenta institucional de la asociación (CUIT propio, IVA exento). SDK oficial
`mercadopago` para Node. Staging usa credenciales de **prueba** (sandbox completo,
tarjetas de test); producción, credenciales productivas. Verificar en el panel de
MP que la condición fiscal (exento) esté correctamente cargada.

## Piezas

### 1. Planes de suscripción (fuente de verdad de los montos)
Tres planes administrados desde el panel de MP por la CD:
- "Cuota Social ACTIVO" ($6.000/mes hoy)
- "Cuota Social ADHERENTE (voluntaria)" ($3.000/mes hoy)
- "Cuota Social COLABORADOR" ($3.000/mes hoy)

El sistema NO fija montos: los **lee por API** (`GET /preapproval_plan/search` +
get por id), cachea 24 h, y los muestra en el wizard. Cuando la CD actualiza un
plan, el cambio se propaga a las suscripciones asociadas por MP; el sync diario
detecta la divergencia con la tabla local `ValorCuota` y pide al admin registrar
el nuevo valor con su acta (REG-34).

### 2. Suscripciones (débito automático) creadas por el sistema
En el paso de pago del wizard: `POST /preapproval` asociada al plan de la categoría,
con:
- `external_reference` = `solicitud:{id}` (luego, para suscripciones de socios
  existentes: `socio:{id}`)
- `payer_email` = email declarado
- `back_url` = retorno al wizard

El usuario autoriza en el checkout de MP (dinero en cuenta o tarjeta).
La autorización y el primer cobro llegan por webhook.

### 3. Links de pago puntuales (Checkout Pro)
Para cuotas atrasadas, aportes voluntarios y pagos sueltos: `POST /checkout/preferences`
con `external_reference` = `pago:{socio_id}:{períodos}` y `notification_url`.
Se envía por email o se copia desde tesorería / panel de socio.

### 4. Webhooks (`/api/webhooks/mp`)
Configurar en el panel de MP los tópicos:
- `subscription_preapproval` (creación/actualización de suscripciones)
- `subscription_authorized_payment` (cobros recurrentes autorizados)
- `payments` (todos los pagos: recurrentes y Checkout Pro)

Procesamiento:
1. **Validar `x-Signature`** con `MP_WEBHOOK_SECRET` (rechazar si no valida).
2. Registrar crudo en `WebhookEvent` con idempotencia por id de evento.
3. Responder 200 inmediato; procesar async (o inline, la escala lo permite).
4. Según tópico:
   - `payments` → `GET /v1/payments/{id}` → si `status=approved`: crear Pago,
     aplicar a la cuota pendiente más antigua (o registrar como `ingreso`/`voluntaria`
     según `external_reference`/metadata), emitir Recibo, enviar por email.
     Si `rejected`: registrar y, si es de suscripción, notificar al socio
     ("no pudimos debitar tu cuota; MP reintentará") y marcar seguimiento de mora.
   - `subscription_preapproval` → actualizar SuscripcionMP.status
     (authorized → activa el flujo de solicitud; cancelled/paused → alerta admin).
   - `subscription_authorized_payment` → `GET /authorized_payments/{id}` para
     trazar el cobro recurrente con su `preapproval_id`.

### 5. Vinculación de suscripciones preexistentes (una sola vez)
Las suscripciones ya creadas desde el panel (ej. la "Cuota Social ACTIVO" activa hoy):
- Pantalla admin "Suscripciones sin vincular": lista `GET /preapproval/search`
  (status authorized) sin match en SuscripcionMP → sugiere socio por `payer_email` /
  apellido → el admin confirma el match → queda vinculada y sus cobros futuros
  concilian solos.
- El campo `debito_automatico='Si'` del padrón importado marca los candidatos.

### 6. Conciliación de respaldo (cron diario)
Script que consulta `GET /v1/payments/search` (rango: últimas 72 h) y
`GET /preapproval/search`, y compara contra Pagos y SuscripcionMP:
- Pago approved sin registro local → procesarlo igual que un webhook (webhook perdido).
- Suscripción cancelada/pausada sin reflejar → alerta admin.
- Divergencia de montos plan vs ValorCuota → alerta admin (REG-34).
Resultado del cron visible en `/admin/salud`.

### 7. Reembolsos y cancelaciones
- Rechazo de solicitud: `PUT /preapproval/{id}` con `status=cancelled` (la cuota
  de ingreso NO se reembolsa, REG-12.b).
- Baja/renuncia de socio con débito: cancelar la suscripción por API al confirmar
  la baja.
- Recategorización: actualizar la suscripción al plan/monto de la nueva categoría
  por API (si MP no permite mover de plan, cancelar y crear nueva con el mismo flujo,
  documentando el corte).
- Reembolsos manuales excepcionales: se hacen desde el panel de MP; el webhook de
  `payments` (status refunded) los registra y anula el recibo con nota.

## Matriz de conciliación

| Origen del dinero | Identificación | Registro |
|---|---|---|
| Débito de suscripción creada por SIGeV | `external_reference` | Automático |
| Débito de suscripción preexistente vinculada | `preapproval_id` | Automático |
| Link de pago generado por SIGeV | `external_reference` | Automático |
| Pago suelto / transferencia al CVU | — | Manual (bandeja "sin matching") |
| Efectivo en sede | Admin | Manual con recibo inmediato |

Política: empujar a todos hacia suscripción o link; las transferencias sueltas
quedan como excepción con matching manual.
