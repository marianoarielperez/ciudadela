# 11 — Preparación de Mercado Pago (sandbox) y Cloudflare Turnstile

Instructivo operativo para Mariano. Al terminar vas a tener los **8 valores**
de la tabla final para pegar en el `.env` local y en el del VPS. Nada de esto
toca la cuenta real ni mueve plata: todo es en modo prueba.

> **Entorno**: desde el 20/08/2026 hay un solo sitio desplegado,
> `vecinalciudadela.ar` (el staging `sigev.redaccion.ar` se dio de baja). Hasta
> el lanzamiento ese dominio corre con estas credenciales **de prueba** y con
> `EMAIL_ALLOWLIST` puesta: el sitio ya está publicado pero todavía no se
> difundió, y el botón ASOCIATE está apagado. Dos pasos quedan pendientes para
> el día del lanzamiento y están en el checklist de `docs/07`: **cambiar a las
> credenciales productivas de MP** y **borrar `EMAIL_ALLOWLIST`**.
>
> Tiempo estimado: 30–40 minutos. Necesitás: un navegador (y una ventana de
> incógnito), y acceso a una cuenta de Mercado Pago cualquiera para entrar al
> panel de developers (puede ser tu cuenta personal; la institucional recién
> hace falta para producción).

---

## Parte A — Cuentas de prueba de Mercado Pago

Las suscripciones se prueban con **cuentas de test**: una hace de VENDEDOR
(la "vecinal de prueba") y otra de COMPRADOR (el "vecino de prueba").

1. Entrá a https://www.mercadopago.com.ar/developers/panel/app con tu cuenta.
2. Si no tenés ninguna aplicación, creá una cualquiera (nombre "SIGeV dev",
   tipo de solución: **Suscripciones**). Solo la necesitamos para habilitar la
   sección de cuentas de prueba.
3. En el menú de la izquierda → **Cuentas de prueba** → **Crear cuenta de prueba**:
   - Cuenta 1: descripción `SIGEV-VENDEDOR`, país **Argentina**, dinero
     disponible: `50000`.
   - Cuenta 2: descripción `SIGEV-COMPRADOR`, país **Argentina**, dinero
     disponible: `50000`.
4. Anotá el **usuario** (formato `TESTUSER...`) y la **contraseña** de cada una.

## Parte B — La aplicación del vendedor de prueba (acá salen las credenciales)

1. Abrí una **ventana de incógnito** y entrá a
   https://www.mercadopago.com.ar **con la cuenta VENDEDOR de prueba**
   (`TESTUSER...` de la Parte A).
2. En esa misma ventana andá a
   https://www.mercadopago.com.ar/developers/panel/app y **creá una
   aplicación**: nombre `SIGeV pruebas`, solución **Suscripciones** (pagos
   recurrentes), sin plataforma de e-commerce.
3. Entrá a la aplicación → **Credenciales de producción** (así se llaman
   aunque la cuenta sea de prueba: como el dueño es un usuario de test, TODO
   lo que se haga con ellas es sandbox). Copiá:
   - **Access Token** (empieza con `APP_USR-...`) → va a ser tu `MP_ACCESS_TOKEN`.

> ⚠️ No uses las "credenciales de prueba" de tu cuenta real: las suscripciones
> con planes funcionan mejor con el esquema cuenta-de-prueba + credenciales
> propias. Este es el camino que recomienda la documentación de MP para
> Suscripciones.

## Parte C — Crear los 2 planes de suscripción

Son **dos** (decisión del 20/08/2026): "SOCIO ACTIVO" ($6.000/mes) y
"SOCIO ADHERENTE/COLABORADOR" ($3.000/mes, compartido).

Se corre **desde tu máquina** (no hace falta entrar al VPS: es una llamada a la
API de Mercado Pago por internet).

> ⚠️ **No uses `curl` en PowerShell.** En Windows PowerShell 5.1 `curl` es un
> alias de `Invoke-WebRequest`, que espera los encabezados como diccionario:
> falla con *"No se puede enlazar el parámetro 'Headers'"* antes de salir a
> internet. Usá los bloques de abajo, que son nativos de PowerShell.

Primero la sesión y el Access Token de la Parte B (`Tls12` porque PowerShell 5.1
todavía negocia TLS viejo por defecto y la API de MP lo rechaza):

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$MP_TOKEN = "APP_USR-...tu Access Token de la cuenta de prueba VENDEDORA..."
```

Plan de ACTIVO:

```powershell
$body = @{ reason = "SOCIO ACTIVO"; auto_recurring = @{ frequency = 1; frequency_type = "months"; transaction_amount = 6000; currency_id = "ARS" }; back_url = "https://vecinalciudadela.ar/asociate" } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "https://api.mercadopago.com/preapproval_plan" -Headers @{ Authorization = "Bearer $MP_TOKEN" } -ContentType "application/json" -Body $body | Select-Object id, reason, status
```

Plan compartido ADHERENTE/COLABORADOR (mismo bloque, cambia nombre y monto):

```powershell
$body = @{ reason = "SOCIO ADHERENTE/COLABORADOR"; auto_recurring = @{ frequency = 1; frequency_type = "months"; transaction_amount = 3000; currency_id = "ARS" }; back_url = "https://vecinalciudadela.ar/asociate" } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "https://api.mercadopago.com/preapproval_plan" -Headers @{ Authorization = "Bearer $MP_TOKEN" } -ContentType "application/json" -Body $body | Select-Object id, reason, status
```

En Git Bash / Linux, el equivalente con `curl` (comillas simples, sin escapes):

```bash
curl -sX POST https://api.mercadopago.com/preapproval_plan -H "Authorization: Bearer $MP_TOKEN" -H 'Content-Type: application/json' -d '{"reason":"SOCIO ACTIVO","auto_recurring":{"frequency":1,"frequency_type":"months","transaction_amount":6000,"currency_id":"ARS"},"back_url":"https://vecinalciudadela.ar/asociate"}'
```

Cada llamada devuelve el **`id`** del plan creado (un string tipo
`2c93808491...`), su nombre y su estado:

- id del primer bloque → `mp_plan_active_id`
- id del segundo bloque → `mp_plan_shared_id`

Estos dos ids **no van al `.env`**: se cargan a mano en `/admin/configuracion`
(solo superadmin; la pantalla existe desde el Módulo 3). No se buscan por nombre
a propósito: un renombre del plan en el panel de MP dejaría el wizard sin montos
en silencio.

> **Ya hecho (20/08/2026).** Los dos planes de sandbox están creados y sus ids
> anotados en el registro del módulo. Al desplegar el M3 hay que **pegarlos en
> `/admin/configuracion`** — ese paso todavía no se hizo. Si alguna vez hay que
> rehacerlos (cuenta de prueba nueva, token regenerado), los bloques de arriba
> siguen sirviendo tal cual.
>
> Para producción son **otros dos planes**, creados con las credenciales
> productivas y con los montos que apruebe la CD: recargar los ids es un paso del
> checklist de lanzamiento de `docs/07`.

Si falla con **401**, el token está mal copiado o incompleto; con **400**,
revisá el monto y que no falte ningún campo del `auto_recurring`.

> ⚠️ Usá el Access Token de la **cuenta de prueba vendedora** (Parte B). Con el
> de tu cuenta real estarías creando planes de suscripción verdaderos.

## Parte D — Webhooks (cuando el M3 esté desplegado)

Esto se puede hacer al final, cuando el código esté desplegado en
`vecinalciudadela.ar` — sin endpoint vivo no hay nada que configurar. Queda
anotado para ese momento:

1. En la aplicación de la Parte B → **Webhooks** → **Modo productivo**
   (recordá: cuenta de prueba ⇒ es sandbox igual):
   - URL: `https://vecinalciudadela.ar/api/webhooks/mp`
   - Eventos: **Pagos** (`payments`), **Planes y suscripciones**
     (`subscription_preapproval` y `subscription_authorized_payment`).
2. Al guardar, el panel muestra una **clave secreta** → es tu
   `MP_WEBHOOK_SECRET`.
3. El botón "Simular notificación" del panel sirve para la primera prueba de
   humo del endpoint.

## Parte E — Cloudflare Turnstile

1. Entrá a https://dash.cloudflare.com → menú **Turnstile** → **Add widget**.
2. Nombre: `SIGeV`. Hostnames: agregá `vecinalciudadela.ar` **y**
   `localhost`. Modo: **Managed** (recomendado).
3. Al crear te da dos claves:
   - **Site Key** → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Es **pública**: viaja en el
     HTML de la página, así que no hace falta cuidarla.
   - **Secret Key** → `TURNSTILE_SECRET_KEY`. Esta sí es secreta y va **solo** al
     `.env` del VPS.

> **Ya hecho (20/08/2026).** El widget está creado y la site key cargada. La
> secret key se rotó después de haberse expuesto en el chat y vive únicamente en
> el `.env` del VPS: si alguna vez falta, se regenera desde el panel de Turnstile,
> no se busca en ningún documento.

Para desarrollo local ni siquiera hacen falta: existen las claves dummy
oficiales que aprueban siempre (ya documentadas en `.env.example`):

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

## Parte F — Tabla final de valores

| Variable / dato | De dónde sale | Dónde va |
|---|---|---|
| `MP_ACCESS_TOKEN` | Parte B (Access Token `APP_USR-...` del vendedor de prueba) | `.env` local y del VPS |
| `MP_WEBHOOK_SECRET` | Parte D (clave secreta del panel de webhooks) | `.env` del VPS (local no recibe webhooks) |
| `mp_plan_active_id` | Parte C, `id` que devuelve el bloque del plan "SOCIO ACTIVO" | `/admin/configuracion` |
| `mp_plan_shared_id` | Parte C, `id` que devuelve el bloque del plan "SOCIO ADHERENTE/COLABORADOR" | `/admin/configuracion` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Parte E (o dummy en local) | `.env` local y del VPS |
| `TURNSTILE_SECRET_KEY` | Parte E (o dummy en local) | `.env` local y del VPS |
| `CRON_SECRET` | lo generás vos: `openssl rand -hex 32` (cualquier cadena larga y aleatoria sirve) | `.env` del VPS **y** el crontab de la Parte H — los dos tienen que decir lo mismo |
| `EMAIL_ALLOWLIST` | tus dos casillas de prueba, separadas por coma | `.env` del VPS (se BORRA en el lanzamiento) |

`EMAIL_ALLOWLIST` mientras dure la etapa de pruebas:

```
EMAIL_ALLOWLIST=marianoaperez@yahoo.com.ar,perezmarianoariel@gmail.com
```

## Parte G — Cómo probar un débito aprobado (para los CA del módulo)

1. Recorré el wizard en `vecinalciudadela.ar` eligiendo ACTIVO. Al llegar al checkout de MP,
   **iniciá sesión con la cuenta COMPRADOR de prueba** (`TESTUSER...`).
2. Pagá con tarjeta de prueba:
   - Mastercard `5031 7557 3453 0604` — CVV `123` — vencimiento `11/30`
   - Visa `4509 9535 6623 3704` — CVV `123` — vencimiento `11/30`
   - **Nombre del titular: `APRO`** (así se simula el pago APROBADO;
     con `OTHE` se simula rechazado). DNI: `12345678`.
3. La autorización y el primer cobro llegan por webhook: la solicitud debe
   pasar sola a "Aceptada — pendiente de acta" y el email de bienvenida debe
   llegar a la casilla de la allowlist que hayas declarado en el wizard.

## Parte H — Crontab del VPS (al desplegar el M3)

El endpoint `/api/cron/applications` manda el recordatorio de pago a las solicitudes
creadas hace 3 días o más, y expira las creadas hace 7 días o más (el corte va por
fecha de creación, no por última actividad), cancelando la suscripción en MP. Sin
crontab **no corre solo**: las solicitudes abandonadas se quedan vivas para
siempre y el débito de una que nadie completó nunca se cancela.

Junto con el deploy del módulo, agregar al crontab de root (SSH puerto 2222,
`crontab -e`):

```
# SIGeV — mantenimiento diario de solicitudes (08:05 hora local)
5 8 * * * curl -s --max-time 900 -X POST -H "Authorization: Bearer CRON_SECRET_REAL" https://vecinalciudadela.ar/api/cron/applications >> /var/log/sigev-cron.log 2>&1
```

reemplazando `CRON_SECRET_REAL` por el valor de `CRON_SECRET` del `.env` del
VPS (definilo ahí si todavía no existe: cualquier string largo aleatorio,
p. ej. la salida de `openssl rand -hex 32`). Si preferís no dejar el secreto a la
vista en el crontab, guardalo en un archivo con permisos `600` y leelo:

```
5 8 * * * curl -s --max-time 900 -X POST -H "Authorization: Bearer $(cat /root/.sigev-cron-secret)" https://vecinalciudadela.ar/api/cron/applications >> /var/log/sigev-cron.log 2>&1
```

> **Por qué `--max-time 900` y no el default.** La **primera** corrida arrastra el
> backlog acumulado desde el despliegue: cada solicitud vencida con suscripción
> dispara un `cancelPreapproval` contra Mercado Pago, y van **en serie**. Quince
> minutos es holgado a propósito.
>
> Y si aun así se corta por tiempo, **eso no es un fallo**: lo que la corrida
> alcanzó a hacer quedó hecho y asentado en la auditoría, y la corrida del día
> siguiente termina el resto. No la relances a mano en bucle.

Cómo saber que anduvo:

```bash
tail -5 /var/log/sigev-cron.log     # cada corrida deja {"reminded":N,"expired":N,"errors":N}
```

Un `401` en el log significa que el `CRON_SECRET` del crontab no coincide con el
del `.env`; un `503`, que la variable no está definida en el `.env` del VPS.

---

## Parte I — Lo que se aprendió probando de verdad (21/08/2026)

Esta parte NO es teoría: son los tropiezos reales de la primera prueba de punta
a punta, en el orden en que aparecieron. Está acá para que la próxima vez
—producción— no se repitan.

### 1. Las dos puntas tienen que ser del mismo mundo

El error que más tiempo costó. Se usaron las **credenciales de prueba de la
cuenta REAL** (`TEST-...` de `av.ciudadela@gmail.com`), que es justo lo que la
Parte B advierte que no hay que hacer. Con eso, el que cobra es una cuenta real
y ninguna cuenta de prueba puede pagarle:

> *Algo salió mal… Una de las partes con la que intentás hacer el pago es de prueba.*

Y no alcanza con que el comprador sea de prueba: **el `payer_email` que viaja en
la suscripción también cuenta**. Poner ahí un correo real con un vendedor de
prueba da, en la creación:

```
status=400 message="Both payer and collector must be real or test users"
```

Regla: vendedor de prueba ⇒ el correo del postulante en el formulario tiene que
ser el de la **cuenta de prueba compradora**. Consecuencia práctica: en sandbox
**no se puede verificar el circuito de correo**, porque esas casillas no reciben.
Se verifica aparte, con una dirección de la allowlist y sin pago.

### 2. Los planes pertenecen a la cuenta que los creó

Cambiar el `MP_ACCESS_TOKEN` invalida los ids de `mp_plan_active_id` /
`mp_plan_shared_id`: hay que **rehacer los dos planes** con el token nuevo y
recargar los ids en `/admin/configuracion`. Lo mismo vale para la clave del
webhook, que es por aplicación.

Corolario para el lanzamiento: el trabajo de sandbox es descartable. Al pasar a
producción se repite entero — planes, ids y webhook.

### 3. Mercado Pago corta el `reason` en 60 caracteres

No en 255, como decía el código. Pasarse no recorta: **rechaza el pedido entero**
con `{"message":"reason has more than 60 characters","status":400}`, y el vecino
ve "no pudimos iniciar el pago". Lo aplica `src/lib/mp/reason.ts`, con tope en
caracteres y en bytes.

También: **MP se come la barra** `/`. `SOCIO ADHERENTE/COLABORADOR` se muestra
`SOCIO ADHERENTECOLABORADOR` en el resumen de la tarjeta. Por eso el plan pasó a
llamarse `SOCIO ADHERENTE - COLABORADOR`.

### 4. El `back_url` tiene que ser público

`http://localhost:3000` devuelve
`{"message":"Invalid value for back_url, must be a valid URL","status":400}`.
Sale de `AUTH_URL`, que se lee **al ejecutar**, no al compilar.

### 5. Autorizar no es cobrar

El evento `subscription_preapproval` sincroniza la suscripción a `authorized`
pero **deja la solicitud en `pending_payment`**. La que la acepta es la
notificación de **`payment`** (`application_approved`). Son dos eventos
distintos y hacen falta los dos.

### 6. El simulador del panel siempre va a fallar

Manda `data.id: 123456`, que no existe. La respuesta correcta es 500 con
`The preapproval with id 123456 does not exist`. Lo que ese simulador prueba es
que la URL responde y que **la firma valida** (si no, sería 401). No prueba el
procesamiento.

### 7. Cómo disparar una notificación firmada a mano

Sirve cuando MP no entrega (ver el punto 8). Reemplazá `DATA_ID` y el `type`
(`payment` o `subscription_preapproval`):

```bash
cd /root/dev/ciudadela && SECRET=$(grep -E '^MP_WEBHOOK_SECRET=' .env | cut -d= -f2- | tr -d '"'"'" ) && DATA_ID=PEGAR_ID && REQ_ID="manual-$(date +%s)" && TS=$(date +%s) && V1=$(printf '%s' "id:${DATA_ID};request-id:${REQ_ID};ts:${TS};" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}') && curl -sS -X POST "https://vecinalciudadela.ar/api/webhooks/mp?data.id=${DATA_ID}&type=payment" -H "Content-Type: application/json" -H "x-request-id: ${REQ_ID}" -H "x-signature: ts=${TS},v1=${V1}" -d "{\"type\":\"payment\",\"action\":\"payment.updated\",\"data\":{\"id\":\"${DATA_ID}\"}}" -w '\nHTTP %{http_code}\n'
```

Para encontrar el id del cobro de una suscripción (la búsqueda de pagos por
`external_reference` NO lo encuentra: MP no indexa así los de suscripción):

```bash
curl -sS "https://api.mercadopago.com/authorized_payments/search?preapproval_id=PEGAR_PREAPPROVAL" -H "Authorization: Bearer $MP_TOKEN"
```

Devuelve `payment.id`, que es el que va como `DATA_ID` con `type=payment`.

### 8. RESUELTO: en sandbox MP no entrega notificaciones; en producción sí

En la prueba del 21/08/2026 el pago se acreditó y la suscripción quedó
`authorized` **del lado de MP**, pero no llegó ninguna notificación a
`/api/webhooks/mp`. Las dos que sí llegaron fueron disparadas a mano con el
bloque del punto 7, y el sistema las procesó correcto
(`subscription_synced`, `application_approved`).

**Contestado el 22/08/2026 a las 00:53 con un piloto real en producción.** Un
vecino se asoció con credenciales productivas y Mercado Pago **entregó las tres
notificaciones por su cuenta** (`subscription_preapproval`, `payment`,
`subscription_preapproval`), sin ningún disparo manual: la solicitud pasó sola a
`approved_pending_minute`.

Era la causa 1 — limitación del sandbox con cuentas de prueba. No hay nada que
arreglar en el código.

Consecuencia práctica: **el circuito automático no se puede validar en sandbox**.
Ahí hay que disparar las notificaciones a mano con el bloque del punto 7, y eso
prueba el procesamiento pero no la entrega. La entrega solo se comprueba en
producción.

### 9. Diagnóstico: leer el mensaje, no suponer

El kit de MP hace `throw` del cuerpo crudo de la respuesta, que **no es un
`Error`**: los helpers que leen `.code` devuelven `unknown`. `mpErrorLog`
(`src/lib/mp/error-log.ts`) lo desarma y deja una línea con operación, HTTP,
mensaje y causa, con el correo enmascarado. Antes de tenerlo se quemaron tres
hipótesis equivocadas seguidas; con él, el motivo apareció en la primera línea.

```bash
pm2 flush sigev   # el log de PM2 NO se vacía al reiniciar: sin esto se mezcla lo viejo
pm2 logs sigev --lines 30 --nostream --raw | grep -i "mp:" | tail -3
```
