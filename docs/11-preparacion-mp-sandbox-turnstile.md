# 11 — Preparación de Mercado Pago (sandbox) y Cloudflare Turnstile

Instructivo operativo para Mariano. Al terminar vas a tener los **8 valores**
de la tabla final para pegar en el `.env` **local**. Nada de esto toca la cuenta
real ni mueve plata: todo es en modo prueba.

> **Entorno (actualizado el 22/08/2026)**: desde el 20/08/2026 hay un solo sitio
> desplegado, `vecinalciudadela.ar` (el staging `sigev.redaccion.ar` se dio de
> baja), y desde el **22/08/2026 ese dominio corre con credenciales PRODUCTIVAS
> de Mercado Pago**: se hizo un piloto real y el socio 306 se afilió por la web
> con su débito funcionando. `EMAIL_ALLOWLIST` **sigue puesta** y el botón
> ASOCIATE sigue apagado; borrar la allowlist es lo único de este tema que queda
> en el checklist de `docs/07`.
>
> **Consecuencia para todo lo que sigue en este documento: el sandbox es cosa de
> LOCAL.** Las credenciales de prueba y los planes de prueba van al `.env` de la
> máquina de desarrollo, nunca al del VPS. **No se prueban cobros en producción**:
> ahí la plata es de un vecino. Lo único productivo es el piloto controlado (el
> débito mensual del 306 y algún efectivo cargado por Mariano).
>
> **Actualizado el 23/08/2026 (fase 4B):** el sandbox local **sí recibe
> notificaciones de Mercado Pago** —entrega siempre— y el circuito completo se
> validó ahí, sin disparar nada a mano. Cómo se arma ese entorno y qué se aprendió:
> **Parte J**. Lo que decía la Parte I §8 sobre que "en sandbox MP no entrega" era
> falso y ya está corregido.
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

## Parte D — Webhooks

**Confirmado el 23/08/2026 contra el panel real** (batería de la fase 4B, Parte J).
Antes esta parte era una previsión; ahora es lo que hay que tildar.

1. En la aplicación de la Parte B → **Webhooks**. El panel tiene dos solapas:
   **Modo productivo** y **Modo de prueba**. La configuración es por solapa: la
   URL del túnel de desarrollo va en *Modo de prueba* y la del dominio en
   *Modo productivo*, y cada una tiene **su propia clave secreta**.
   - URL productiva: `https://vecinalciudadela.ar/api/webhooks/mp`
   - URL de sandbox: la del túnel del día (ver Parte J). **Matiz medido el
     25/08/2026**: el token `APP_USR-…` de una aplicación de **cuenta de
     prueba** dispara por la solapa *Modo productivo*, así que en sandbox hay
     que configurar **las dos solapas** con la URL del túnel y la misma clave
     (J.1 paso 4 y J.6).
2. **Eventos a tildar: "Planes y suscripciones" + "Pagos (legacy)". Ningún otro.**
   En una aplicación de tipo **Suscripciones**, el panel **no ofrece "Pagos" a
   secas**: el evento del tópico `payment` aparece listado como **"Pagos
   (legacy)"** y —pese al nombre— manda el **POST moderno firmado**
   (`?data.id=X&type=payment`), no sólo la IPN vieja. Tildarlo es obligatorio: es
   por ahí que llegan los pagos de Checkout Pro y la cuota de ingreso del wizard.
   "Planes y suscripciones" cubre `subscription_preapproval` y
   `subscription_authorized_payment`.
   El endpoint atiende **exactamente esos tres tópicos**; cualquier otro evento
   del panel no aplica y sólo genera ruido.
3. Al guardar, el panel muestra una **clave secreta** → es tu
   `MP_WEBHOOK_SECRET`. **Tiene que ser la de la solapa que estás usando.** Si no
   coincide, MP entrega igual y **todas** las notificaciones mueren en 401 sin que
   nada lo cante en pantalla: ver el diagnóstico de la Parte I §8.
4. El botón "Simular notificación" del panel sirve para la primera prueba de
   humo del endpoint (ver Parte I §6: siempre "falla", y eso está bien).

> **Los preapprovals no traen `notification_url` propio.** Medido contra la API el
> 23/08/2026: MP **acepta** el `POST /preapproval` con ese campo y lo **descarta en
> silencio** (el recurso devuelto no lo trae). O sea que los avisos de suscripción
> dependen **enteramente** de esta configuración del panel: si se borra, apunta a
> otro lado o queda en la solapa equivocada, **los débitos dejan de avisar sin
> ninguna señal**. La única red es el paso 2 de la conciliación diaria
> (`/api/cron/reconcile`, Parte H). Las preferencias de Checkout Pro sí mandan el
> suyo, así que un pago por link sigue llegando aunque en el panel estén mal la
> **URL, la solapa o los eventos**. Lo que **no** salva es la clave: si
> `MP_WEBHOOK_SECRET` no coincide con la de la solapa, también los pagos por link
> mueren en 401 (Parte I §8). Una cosa es el ruteo del aviso y otra su firma.

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
| `MP_WEBHOOK_SECRET` | Parte D (clave secreta del panel de webhooks, **la de la solapa que uses**) | `.env` del VPS **y el local**: con un túnel, el sandbox recibe webhooks igual (Parte J) |
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

> **Esto se hace en el sandbox local, NUNCA contra `vecinalciudadela.ar`.** Ahí la
> plata es de un vecino y las credenciales son productivas: una tarjeta de prueba en
> el checkout productivo no es "una prueba", es un cobro real fallado. El armado del
> sandbox —cuenta TESTUSER propia, su aplicación, túnel y `AUTH_URL`— está en la
> **Parte J**.

1. Con el sandbox armado (Parte J), recorré el wizard en **`http://localhost:3000`**
   —o en la URL del túnel, que es lo que hace falta para que MP entregue los
   webhooks— eligiendo ACTIVO. Al llegar al checkout de MP, **iniciá sesión con la
   cuenta COMPRADOR de prueba** (`TESTUSER...`).
2. Pagá con tarjeta de prueba:
   - Mastercard `5031 7557 3453 0604` — CVV `123` — vencimiento `11/30`
   - Visa `4509 9535 6623 3704` — CVV `123` — vencimiento `11/30`
   - **Nombre del titular: `APRO`** (así se simula el pago APROBADO;
     con `OTHE` se simula rechazado). DNI: `12345678`.
3. La autorización y el primer cobro llegan por webhook: la solicitud debe
   pasar sola a "Aceptada — pendiente de acta" y el email de bienvenida debe
   llegar a la casilla de la allowlist que hayas declarado en el wizard.

**Verificado el 23/08/2026** (batería de la fase 4B, en sandbox), aunque **cada
titular se midió sobre un flujo distinto** — no son las dos rutas del mismo wizard:

- **`APRO`** — el **alta web** completa terminó en `Payment.entry`, recibo
  `2026-00007` y solicitud en `approved_pending_minute`. El ledger no anota con cuál
  de las dos tarjetas.
- **`OTHE`** — el rechazo se midió sobre un **link de Checkout Pro**, con la
  Mastercard `5031 7557 3453 0604`: el webhook dejó `payment_rejected_traced` y
  **no** creó pago, ni recibo, ni cuota, ni consumió número de recibo (la serie pasó
  de 5 a 6, no a 7). El reintento con `APRO` sobre el mismo link aplicó 5 cuotas y
  emitió el `2026-00006`.

Que el titular decida el resultado está verificado. Que se comporte igual en el
**otro** flujo es razonable esperarlo, pero no está medido.

> **Cuando la tarjeta rechaza, MP no devuelve al vecino.** Lo **retiene en su
> propio checkout** ofreciéndole otro medio de pago (la URL termina en
> `/challenge/`): no vuelve al `back_url` con `collection_status=rejected`. O sea
> que la pantalla "te rechazaron, probá de nuevo" de la vuelta de Checkout Pro es
> **defensiva** —cubre al que abandona el challenge—, no el camino habitual.
> En sandbox, además, el **primer cobro de un preapproval tarda unos 20 segundos**
> en aparecer después de autorizar: no es instantáneo, no lo des por perdido.

## Parte H — Crontab del VPS

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

### Segunda línea: conciliación diaria con Mercado Pago (fase 4B)

`/api/cron/reconcile` es **la red de contención de la plata**: recupera los pagos
y los débitos cuyo webhook no llegó, sincroniza el estado de las suscripciones
contra MP y avisa de divergencias de monto. Sin esta línea, un aviso perdido de
Mercado Pago no lo repara nada — y el caso concreto que existe para atajar es el
débito mensual del socio 14.

```
# SIGeV — conciliación diaria con Mercado Pago (03:17 hora local)
17 3 * * * curl -sS --max-time 900 -X POST -H "Authorization: Bearer $(cat /root/.sigev-cron-secret)" https://vecinalciudadela.ar/api/cron/reconcile >> /var/log/sigev-cron.log 2>&1
```

Con `crontab -e` esa línea se pega y listo. Si preferís agregarla desde la shell,
usá el bloque **idempotente** de `docs/10` §4.4: `(crontab -l; echo …) | crontab -`
a secas **duplica la línea** si lo corrés dos veces. Y antes de cualquiera de las
dos, comprobá que el archivo del secreto exista —`test -s /root/.sigev-cron-secret`—:
si no está, el cron manda un `Bearer` vacío y todas las corridas mueren en 401.

Mismo esquema que la línea de solicitudes: `CRON_SECRET` del `.env` del VPS, y
`--max-time 900` porque el paso 2 recorre **una búsqueda por cada suscripción
viva** contra la API de MP, en serie.

> **`--max-time 900` no manda solo.** El dominio está **proxied por Cloudflare**,
> que corta la conexión al origen a los ~100 s y devuelve **524**. Hoy da igual —con
> dos suscripciones vivas la corrida termina en segundos—, pero el día que sean
> cientos el `curl` va a volver con 524 **mientras la corrida sigue del lado del
> servidor**. Un 524 en el log no significa que no haya corrido: lo que pasó de
> verdad está en `cron_runs`, y ahí hay que mirarlo antes de relanzar nada.

De madrugada y no a las 08:05 por dos razones: es el hueco más tranquilo (el
backup nocturno ya terminó) y deja cinco horas de margen antes de que corra el
mantenimiento de solicitudes, que también habla con Mercado Pago. Y al minuto
**17, no en punto**: la cuota que corta el 429 `local_rate_limited` es
**compartida** entre clientes de MP (lo dice su propia FAQ), y a las horas
redondas se amontonan los crons de todo el mundo — las corridas del 24/08 y del
30/08/2026 se comieron 429 con menos de diez llamadas. Correr a un minuto
"feo" esquiva esa estampida; el reintento con jitter de `src/lib/mp/retry.ts`
es la otra mitad del mismo arreglo.

Cómo leer el resultado:

```bash
tail -3 /var/log/sigev-cron.log
mysql sigev -e "SELECT id, started_at, ok, summary FROM cron_runs WHERE job='reconcile' ORDER BY id DESC LIMIT 1\G"
```

- **HTTP 200** = corrida sin errores. **HTTP 207** = corrió entera pero algún paso
  falló, y los motivos están en `errors[]` del cuerpo y de `cron_runs.summary`.
  **207 no es "casi 200": es la única señal de que la red se rompió.**
- Cada corrida escribe una fila en `cron_runs` con el resumen completo
  (`paymentsRecovered`, `debitsRecovered`, `subscriptionsSynced`,
  `amountDivergent`, `errors`…). Hasta que exista `/admin/salud` (fase 4C), esa
  tabla y el asiento de auditoría `reconcile_cron` son el único lugar donde mirar.
- Un `401` sigue significando secreto que no coincide; un `503`, `CRON_SECRET`
  sin definir en el `.env`.

### El crontab final: seis líneas (fase 4C, 24/08/2026)

Cinco endpoints de la app más el backup. Este es el estado **completo y
definitivo** del crontab de root del VPS:

| Hora | Qué | Cadencia real |
|---|---|---|
| `17 3 * * *` | `/api/cron/reconcile` | todos los días, actúa todos los días |
| `0 4 * * *` | `backup.sh` | todos los días (**no** es un endpoint) |
| `5 8 * * *` | `/api/cron/applications` | todos los días, actúa todos los días |
| `30 0 * * *` | `/api/cron/accrual` | todos los días, **actúa el día 1** |
| `30 7 * * *` | `/api/cron/digest` | todos los días, **sin novedades no envía** |
| `0 10 * * *` | `/api/cron/reminder` | todos los días, **actúa el último día del mes** |

Bloque copiable para dejarlo así. Es **idempotente**: se puede correr más de una
vez sin duplicar ninguna línea.

```bash
# La línea del secreto tiene que existir ANTES: sin ella el cron manda un Bearer
# vacío y todas las corridas mueren en 401.
test -s /root/.sigev-cron-secret || echo 'FALTA /root/.sigev-cron-secret — pará acá'

crontab -l > /root/crontab.bak

export CRON_URL=https://vecinalciudadela.ar/api/cron
add_cron() {  # $1 = expresión horaria, $2 = job
  local line="$1 curl -sS --max-time 900 -X POST -H \"Authorization: Bearer \$(cat /root/.sigev-cron-secret)\" $CRON_URL/$2 >> /var/log/sigev-cron.log 2>&1"
  crontab -l 2>/dev/null | grep -qF "/api/cron/$2" || (crontab -l 2>/dev/null; echo "$line") | crontab -
}
add_cron "17 3 * * *" reconcile     # conciliación con Mercado Pago (al 17: esquiva la estampida de la hora en punto)
add_cron "5 8 * * *"  applications  # mantenimiento de solicitudes
add_cron "30 0 * * *" accrual       # devengo — corre a diario, ACTÚA el día 1
add_cron "30 7 * * *" digest        # resumen diario — sin novedades no envía
add_cron "0 10 * * *" reminder      # recordatorio — ACTÚA el último día del mes

crontab -l | grep -E 'backup|api/cron'   # verificación: 5 de app + el backup
```

El `grep -qF` es lo que lo hace idempotente. La versión sin guarda
—`(crontab -l; echo …) | crontab -` a secas— **duplica la línea** en el segundo
intento.

**La sexta línea es la del backup**, a las 04:00 (`scripts/backup.sh:3` dice esa
hora), y **no** es un endpoint: es el script de shell que deja el sello `LAST_OK`
que `/admin/salud` lee. Por eso el bloque de arriba no la agrega, sólo la verifica
—la ruta con la que quedó instalada en el VPS la dice el propio `crontab -l`, este
documento no la fija—. Si nunca se instaló, el panel va a decir **"Sin rastro"**
—que es distinto de "Atrasado"— y hay que instalarla antes de creerle a esa
tarjeta.

**Los tres crons nuevos corren todos los días y deciden adentro** si actúan:

- `accrual` responde `{"skipped":"not_first_day"}` los días 2 a 31,
- `reminder` responde `{"skipped":"not_last_day"}` salvo el último día del mes,
- `digest` responde `{"skipped":"no_news"}` los días sin novedades.

Ninguna de esas respuestas escribe una fila en `cron_runs`, y eso es a propósito:
`/admin/salud` muestra la última corrida **efectiva**, y 29 filas vacías por mes
taparían la única que importa. **Un `skipped` en `/var/log/sigev-cron.log` es una
corrida sana.**

Por eso la pantalla tampoco los mide a los cinco con la misma vara: `reconcile` y
`applications` se esperan cada 24 h, `accrual` y `reminder` **cada 31 días**, y
`digest` cada 7 (con 160 vigentes y el débito concentrado alrededor del 10, el día
sin novedades va a ser la regla, no la excepción).

**El 524 de Cloudflare sigue valiendo**: un corte a los ~100 s no significa que el
cron no haya corrido — la verdad está en `cron_runs`, que desde la 4C se lee desde
`/admin/salud` en vez de por SQL. El devengo no corre ese riesgo (segundos, sin
red); los de email sí el día que sean cientos de envíos, y para eso está
`MAIL_BATCH_CAP`.

Y **200 / 207 / 401 / 503 significan lo mismo en los cinco**: 207 es "corrió entera
pero algo falló"; 401 es que el secreto del crontab no coincide con el `.env`; 503
es que `CRON_SECRET` no está definida en el `.env` del VPS.

### Las dos escotillas: volver a disparar el devengo y el recordatorio

`accrual` y `reminder` **actúan un solo día del mes**. Si esa corrida se pierde —el
VPS caído, un hipo de la base—, sin escotilla el devengo recién se recuperaba el
mes siguiente y el aviso de ese mes no salía nunca. Las dos escotillas viajan
detrás del **mismo `CRON_SECRET`**: no hay barrera nueva.

```bash
export S=$(cat /root/.sigev-cron-secret)
export URL=https://vecinalciudadela.ar/api/cron
```

**Devengo** — `?force=1` saltea la guarda del día 1; `?upTo=AAAA-MM` elige hasta
qué mes devengar (opcional: sin él usa el mes vencido).

```bash
curl -sS -X POST -H "Authorization: Bearer $S" "$URL/accrual?force=1" -w '\nHTTP %{http_code}\n'
curl -sS -X POST -H "Authorization: Bearer $S" "$URL/accrual?force=1&upTo=2026-09" -w '\nHTTP %{http_code}\n'
```

- **Qué esperar**: el summary de la corrida con `"forced":true`, y una fila nueva en
  `cron_runs` visible en `/admin/salud` (una corrida forzada **es** una corrida).
- **Volver a correrlo no duplica nada**: `feesCreated` da 0 la segunda vez.
- **`upTo` tiene rango**: piso `IMPORT_COVERAGE_FLOOR`, techo el mes vencido. Fuera
  de rango es **400 con el rango en el cuerpo**, no un 500 ni un silencio. **Hasta
  el 01/10/2026 todo `upTo` explícito da 400**, porque el piso queda por encima del
  techo: es correcto, la ventana se abre sola.
- Ojo con las mayúsculas: `?FORCE=1` y `?upto=` **se ignoran en silencio**.

**Recordatorio** — `?force=1` saltea la guarda del último día del mes.

```bash
curl -sS -X POST -H "Authorization: Bearer $S" "$URL/reminder?force=1" -w '\nHTTP %{http_code}\n'
```

- **Qué esperar**: el summary con `"forced":true`, y el **texto del correo adaptado
  por calendario**: forzado el mismo último día sale "vence mañana"; forzado
  después, **"tu cuota de septiembre venció y quedó impaga"**. El aviso sigue
  sirviendo y no le miente al vecino sobre la fecha.
- **Alcance de un mes**: el recordatorio avisa por el período que corresponde **al
  día en que se lo corre**. Si el aviso se pierde el 30/09 y se fuerza el 31/10,
  avisa **octubre** — septiembre queda irrecuperable por esta vía.
- Corrido dos veces, la dedupe corta: en la segunda corrida `sent` queda en 0 y los
  mismos socios se cuentan en `alreadyNotified`.

**`digest` no tiene escotilla**, a propósito: corre todos los días y su ventana es
el día civil anterior, así que "forzarlo" sería volver a mandar el resumen de ayer.

En los dos, `?force=` sólo acepta `1` o `true`; cualquier otro valor es un **400**,
y la validación corre **antes** de tocar la base y antes de abrir el `CronRun`.

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

**Ya casi nunca hace falta** (ver el punto 8: MP entrega siempre, también en
sandbox). Queda para reprocesar un cobro puntual a mano, para probar el endpoint
contra `localhost` sin túnel, y para el caso raro de un evento que MP ya dio por
entregado y no va a reenviar.

Todo lo variable va **arriba**, en su propia línea. El mismo bloque sirve en local y
en el VPS, pero el **default es local**: pegado tal cual, este bloque no le habla a
producción. Para apuntar al VPS hay que escribir el dominio a propósito, que es la
única forma de que nadie lo haga sin querer — el bloque se copia justo cuando algo
falló y se lee poco.

```bash
cd /root/dev/ciudadela
URL=${URL:-http://localhost:3000}         # contra el VPS: URL=https://vecinalciudadela.ar
TYPE=payment                              # o subscription_authorized_payment, o subscription_preapproval
DATA_ID=PEGAR_ID                          # id del pago, del authorized_payment o del preapproval

SECRET=$(grep -E '^MP_WEBHOOK_SECRET=' .env | cut -d= -f2- | tr -d '"'"'" )
REQ_ID="manual-$(date +%s)"
TS=$(date +%s)
V1=$(printf '%s' "id:${DATA_ID};request-id:${REQ_ID};ts:${TS};" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')

curl -sS -X POST "${URL}/api/webhooks/mp?data.id=${DATA_ID}&type=${TYPE}" -H "Content-Type: application/json" -H "x-request-id: ${REQ_ID}" -H "x-signature: ts=${TS},v1=${V1}" -d "{\"type\":\"${TYPE}\",\"data\":{\"id\":\"${DATA_ID}\"}}" -w '\nHTTP %{http_code}\n'
```

(Las tres primeras líneas son lo único que se cambia. El bloque va entero: las
variables viven en la sesión, no entre invocaciones.)

Ejemplo con el cobro de una suscripción (lo que dispara el débito → cuota →
recibo):

```bash
TYPE=subscription_authorized_payment
DATA_ID=<el id que devuelve /authorized_payments/search>
```

Para encontrar el id del cobro de una suscripción (la búsqueda de pagos por
`external_reference` NO lo encuentra: MP no indexa así los de suscripción):

```bash
curl -sS "https://api.mercadopago.com/authorized_payments/search?preapproval_id=PEGAR_PREAPPROVAL" -H "Authorization: Bearer $MP_TOKEN"
```

Devuelve el `id` del *authorized payment* (que va con
`type=subscription_authorized_payment`) y su `payment.id` (que va con
`type=payment`). **No mandes `limit` acá**: ese endpoint rechaza cualquier valor
por encima de ~15 con `{"message":"Invalid value for limit","status":400}` — ver
la Parte J.

> **Ojo con la idempotencia cuando disparás a mano.** Una notificación real de MP
> trae un `id` de **evento** en el cuerpo (distinto del id del pago) y es esa la
> clave que impide procesar dos veces. El bloque de arriba no lo manda, así que la
> ruta cae al fallback `{tópico}:{data.id}:{action}`: dos disparos manuales
> seguidos con el mismo `TYPE` y el mismo `DATA_ID` cuentan como **el mismo**
> evento y el segundo devuelve `ignored_duplicate`. Si querés forzar el
> reprocesamiento, cambiá el `action` del cuerpo. La segunda barrera —la del
> procesador, por `mpPaymentId`— sigue en pie igual: nunca se cobra dos veces.

### 8. En sandbox MP sí entrega: los `payment`, siempre; los de suscripción, sólo si el panel los rutea

**Corregido el 23/08/2026.** Este punto decía, con el título "RESUELTO", que en
sandbox Mercado Pago no entrega notificaciones y que *"el circuito automático no se
puede validar en sandbox"*. **Es falso**, y salió caro: por esa frase se dispararon
a mano **dos baterías enteras** de pruebas, dando por perdida la entrega
automática que en realidad estaba pasando.

Pero el reemplazo tampoco es "MP entrega siempre" a secas: eso sería cambiar un
absoluto por otro. Lo medido, que es lo único que se afirma acá:

- Las de **`payment`** llegaron en las tres pasadas, todas las veces: las
  preferencias de Checkout Pro mandan su propio `notification_url`.
- Las de **suscripción** (`subscription_preapproval`,
  `subscription_authorized_payment`) llegan **sólo si la configuración de webhooks
  de la aplicación las rutea**, porque un preapproval no puede llevar
  `notification_url` propio y MP lo descarta en silencio (Parte D). En la tercera
  pasada **no llegaron**, con el preapproval `authorized` y el pago `approved` del
  lado de MP, mientras los `payment` entraban normalmente (Parte J.3).

O sea que la diferencia no es sandbox contra producción: es de dónde sale el ruteo.
**Vale igual en producción**, y por eso la conciliación diaria (Parte H) no es
opcional.

Lo que fallaba era otra cosa: **`MP_WEBHOOK_SECRET` no coincidía con la clave de la
aplicación**. Había un valor inventado en el `.env`, así que MP entregaba, la
validación de firma rechazaba, y **todas** las notificaciones reales morían en
**401** sin que ninguna pantalla lo dijera. Con la clave correcta —la que da la
solapa *Modo de prueba* del panel, Parte D— el circuito de la fase 4B corrió entero
**sin disparar nada a mano**: alta web, débito de suscripción, Checkout Pro,
reembolso y rechazo.

**Cómo se diagnostica** (dos minutos, y evita perder un día):

```bash
# 1. ¿Está llegando algo? Un 401 en el access log es entrega OK + firma mal.
grep 'api/webhooks/mp' /var/log/nginx/access.log | tail -20

# 2. Del lado de la app: el asiento del rechazo de firma.
mysql sigev -e "SELECT created_at, action, detail FROM audit_log
                WHERE action IN ('webhook_rejected_signature','webhook_legacy_ipn')
                ORDER BY id DESC LIMIT 10;"
```

- Filas de `webhook_rejected_signature` **sin `detail`** (o con un `detail` que no
  dice `malformed_data_id`) = **la clave no coincide**. No es un ataque: es el
  `.env` contra el panel. Comparalos.
- Filas de `webhook_legacy_ipn` = MP notificando en formato viejo. Es lo NORMAL y
  son muchas (cuatro requests por cada pago de Checkout Pro, tres de ellas
  descartables): no hay nada que hacer. Hasta el 24/08/2026 caían bajo el mismo
  action que la firma inválida y `/admin/salud` las contaba como rechazos.
- **Ninguna fila y ningún request en el access log** = MP no está entregando, y ahí
  sí el problema es la configuración de la Parte D (URL, solapa o eventos).
- Requests que llegan y quedan en `webhook_events` con `processed_at` puesto =
  todo bien, mirá el `result` de la fila.

Lo que sigue siendo cierto del episodio del 21/08: el pago se acreditó y la
suscripción quedó `authorized` del lado de MP. Lo que no era cierto es la
explicación.

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

### 10. La allowlist tapaba que el SMTP nunca se había probado

El 22/08/2026, apenas el primer correo real intentó salir del VPS, Brevo
respondió `535 5.7.8 Authentication failed`. La causa: `BREVO_SMTP_KEY` estaba
guardada **entre signos de mayor y menor** (`<xsmtpsib-...>`), como se copia de
un instructivo — 92 caracteres en vez de 90.

Lo importante no es el error, es por qué tardó tanto en aparecer: hasta ese día
**`EMAIL_ALLOWLIST` frenaba todos los envíos antes de llegar al servidor de
correo**, así que la autenticación nunca se había ejercitado. La guarda que
protege a los vecinos durante las pruebas también esconde que el transporte
puede estar roto.

Al preparar producción, verificar el envío **con una dirección de la allowlist**
antes de dar por buena la configuración:

```bash
awk -F= '/^BREVO_SMTP_KEY=/{v=substr($0,index($0,"=")+1); printf "largo=%d primero=[%s] ultimo=[%s]\n", length(v), substr(v,1,1), substr(v,length(v),1)}' .env
```

Tiene que dar largo **90** y empezar con `x`. Después, un pedido real de
restablecimiento de contraseña: el sistema **no registra los envíos exitosos**,
sólo los fallidos, así que un log vacío es la señal buena y la casilla es la
prueba.

### 11. Lo que este episodio dejó como entrada del Módulo 4

El sistema aceptó una solicitud, cobró la cuota de ingreso y **no pudo avisarle
al vecino** — y nadie se habría enterado salvo por ir a mirar el log a mano. El
fallo queda registrado, o sea que la información existe; lo que falta es que
alguien la vea.

Hace falta una pantalla en el panel con los avisos que no salieron y un botón
para reintentar. Va junto con el barrido de conciliación de suscripciones: son
la misma clase de red de contención, y las dos existen porque un aviso perdido
deja a un vecino que pagó sin ninguna noticia.

> **Dónde quedó (22/08/2026).** La fase 4A dejó el estado `failed` y la columna
> `error` en la tabla de notificaciones, pero **todavía no los escribe nadie**: la
> pantalla y el reintento son alcance de la **fase 4C**, y el barrido de
> conciliación, de la **4B**. Ver `docs/07`.

---

## Parte J — Sandbox local de la fase 4B (23/08/2026)

Tres pasadas contra Mercado Pago **real** (cuenta de prueba aislada + túnel), de
las que salieron **cinco arreglos de código** —uno por commit: `9935c1a`,
`03a1e2d`, `49d06e1`, `82918fb` y `903d69d`; la lista está en `docs/07`—, una
**trampa de entorno** que no es un defecto del sistema (`allowedDevOrigins`, J.1) y
los hechos de acá abajo. Todo lo que dice esta parte está **medido**, no supuesto.

### J.1 Cómo se arma

1. **Cuenta de prueba propia, y una aplicación DENTRO de ella.** Las "credenciales
   de prueba" de la aplicación productiva **no** son un sandbox: el token empieza
   con `TEST-` pero `GET /users/me` devuelve la cuenta real, y opera sobre ella.
   El 23/08/2026 eso hizo que la pantalla de Suscripciones listara las **dos
   suscripciones vivas de producción**; el paso siguiente del plan era el lote
   REG-34, que **les habría cambiado el monto del débito a dos vecinos de verdad**.
   Sólo hubo lecturas, pero la trampa es exactamente la que advierte la Parte B.
   Lo correcto: entrar en incógnito con el usuario `TESTUSER…` vendedor, crear
   **ahí** una aplicación y usar **su** access token (empieza con `APP_USR-`).
   Verificación de un renglón, antes de tocar nada:

   ```bash
   curl -sS https://api.mercadopago.com/users/me -H "Authorization: Bearer $MP_ACCESS_TOKEN"
   ```

   Tiene que devolver el `id` del `TESTUSER…`, no el de la cuenta de la vecinal.
2. **Túnel público.** MP rechaza `localhost` en `back_url` y en `notification_url`.
   Con `cloudflared` alcanza. El dominio **cambia en cada corrida**, y hay dos
   lugares que hay que actualizar cada vez: `allowedDevOrigins` en
   `next.config.ts` y la URL del webhook en el panel de MP.
3. **`allowedDevOrigins` no es opcional.** Entrando por el túnel, `next dev`
   bloquea sus propios chunks de `/_next/static` y la página llega **sin
   JavaScript**: Turnstile no se monta, el formulario manda el captcha vacío y
   `/ingresar` responde "credenciales inválidas". El síntoma no dice nada de la
   causa — se pierde un rato creyendo que es la contraseña.
4. **Webhook en LAS DOS solapas del panel** (Parte D), con la URL del túnel y la
   **misma clave** en las dos, y **`MP_WEBHOOK_SECRET` = esa clave**. Este paso
   decía "solapa *Modo de prueba*" y estaba **incompleto**: el 25/08/2026 se
   midió que el token `APP_USR-…` de una aplicación de cuenta de prueba dispara
   los webhooks por la solapa **Modo productivo**, no por la de prueba — con
   sólo la solapa de prueba configurada el silencio es total (ver J.6). Lo que
   funcionó fue configurar **las dos solapas con la misma URL y clave**. Y si la
   clave no coincide, MP entrega y todo muere en 401 (Parte I §8).
5. **`AUTH_URL` al túnel mientras dure la prueba**, y de vuelta a
   `http://localhost:3000` al terminar. Es fácil olvidarlo.

### J.2 Qué NO hacer

- **No probar cobros contra `vecinalciudadela.ar`**: ahí la plata es de un vecino.
- **No mezclar mundos**: comprador de prueba con vendedor de prueba. Un email real
  en el checkout de sandbox hace fallar la autorización.
- **No usar los ids de plan productivos con un token de sandbox.** Los planes
  pertenecen a la cuenta que los creó (Parte I §2): con el token de la cuenta de
  prueba, `getPlan()` de esos ids devuelve "resource not found". Desde la fase 4B
  los ids de plan son **opcionales** y el monto sale de `fee_values`, así que en
  sandbox lo más simple es dejarlos **vacíos**: el alta web, la recategorización y
  el lote REG-34 andan igual.
- **No dejar datos de prueba vivos.** Al terminar: cancelar la suscripción de
  prueba en MP, borrar el `FeeValue` de prueba y restaurar el valor vigente.

### J.3 Hechos verificados contra la API

- **Por cada pago de Checkout Pro, MP manda CUATRO requests** a
  `notification_url`: la moderna firmada (`?data.id=X&type=payment`) —la única que
  procesamos—, la **IPN legacy** (`?id=X&topic=payment`) y **dos** de
  `?id=Y&topic=merchant_order`. Las tres últimas responden **200
  `{"ignored":"legacy_ipn"}`**: son notificaciones legítimas en un formato que no
  implementamos, no errores, y un 4xx sostenido es algo que MP puede terminar
  deshabilitando —y ahí se perdería también la buena—. "Recibido, no procesado":
  no se persiste ni se aplica nada. Un POST **sin** `topic=` sigue dando 400 y sin
  auditar, para que los escáneres no inflen `audit_log`.
- **El cuerpo de MP trae `id` de evento** (pregunta abierta desde el Módulo 3).
  Ejemplos reales: `136606437047`, `136766467098`, `136606437087`. Es **distinto**
  del id del pago: la idempotencia de la ruta usa el id de evento real, no el
  fallback.
- **La validación de firma acepta una firma real de MP.** Hasta esta batería sólo
  se había probado contra firmas generadas por nosotros con la misma clave:
  consistente consigo mismo, sin probar nada.
- **Un cobro de suscripción trae su preapproval en el propio pago**, en
  `point_of_interaction.transaction_data.subscription_id`. Sin leer ese campo, la
  notificación `payment` de un débito no resolvía nunca —ni con la suscripción ya
  vinculada— y caía en la bandeja a esperar el `subscription_authorized_payment`.
- **Parámetros reales de la vuelta de Checkout Pro**, textuales:

  ```
  ?volvio=1&collection_id=…&collection_status=approved&payment_id=…&status=approved
  &external_reference=pago%3A297%3A2&payment_type=account_money&merchant_order_id=…
  &preference_id=…&site_id=MLA&processing_mode=aggregator&merchant_account_id=null
  ```

  MP manda `collection_status` **y** `status`. Sin referencia, `external_reference`
  llega como el **string** `"null"`, no ausente. Y el `?volvio=1` nuestro
  **sobrevive**: MP agrega sus parámetros al final.
- **`/authorized_payments/search` rechaza `limit`** por encima de ~15
  (`{"message":"Invalid value for limit","status":400}`). Mandarle `limit=100`
  hacía que devolviera **400 siempre**, en silencio: con eso, el **paso 2 de la
  conciliación** —el que recupera un débito cuyo webhook no llegó— **nunca
  funcionó**, y la pantalla de vinculación decía siempre "Cobros previos: no
  disponible". Ese endpoint pagina de a 12 por su cuenta; hay que **omitir**
  `limit`. `/v1/payments/search` y `/preapproval/search` sí aceptan 100.
- **Un preapproval ignora `notification_url`**: MP acepta la request con ese campo
  y lo descarta en silencio (ver el recuadro de la Parte D). Queda comentado en
  `createPreapproval` para que nadie vuelva a intentar el mismo "arreglo".
- **Y por eso se vio faltar un aviso de suscripción con los pagos llegando bien.**
  En la tercera pasada el preapproval quedó `authorized` y el pago `approved` del
  lado de MP sin que llegara ni `subscription_preapproval` ni
  `subscription_authorized_payment`, mientras los `payment` de Checkout Pro entraban
  todos. **No es un límite del sandbox**: la causa es el punto de arriba —la
  preferencia manda su propio `notification_url` y el preapproval no puede—, así que
  los avisos de suscripción dependen **enteramente** de la configuración de webhooks
  del panel. **Es un riesgo de producción**: si esa configuración se borra, apunta a
  otro lado o queda en la solapa equivocada, los débitos dejan de avisar **sin
  ninguna señal**, y la única red es el paso 2 de la conciliación diaria (Parte H).
- **Tarjetas de prueba**: titular `APRO` aprueba, `OTHE` rechaza. Verificadas las
  dos (Parte G).

### J.4 Límites del sandbox (no son bugs)

- **`/v1/payments/search` NO INDEXA**: devuelve `total=0` aun **sin** filtros, con
  el pago existiendo y aprobado. Sólo lo encuentra `?id=`. Consecuencia: el
  **paso 1 de la conciliación** (recuperar pagos de Checkout Pro perdidos) **no se
  puede validar en sandbox**; se apoya en los tests unitarios y en que la consulta
  responde 200 bien formada. **Confirmar en producción.**
- **El reembolso por API está bloqueado** para la cuenta de prueba:
  `POST /v1/payments/{id}/refunds` → 403 `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`.
  Se probó por la rama real: devolver la plata **desde el panel del vendedor**, que
  dispara el webhook y anula el recibo solo.
- **El primer cobro de un preapproval tarda ~20 s** en aparecer tras autorizar.

> Lo que **no** está en esta lista, a propósito: que en la tercera pasada no
> llegaran los avisos de suscripción. Eso **no es un límite del sandbox** —es la
> consecuencia de que un preapproval no pueda llevar `notification_url`, y pasa
> igual en producción—, así que vive en **J.3**, junto a su causa.

### J.5 Cancelar un preapproval (fase 4C, 24/08/2026)

Medido con la misma cuenta de prueba de la Parte J, verificando el dueño del
token antes de la primera llamada (`GET /users/me` → `3630717510 /
TESTUSER4538145150963760837`, nunca la real).

- **MP acepta el salto `pending` → `cancelled`.** Era la pregunta abierta que
  dejó anotada la fase 4C: una suscripción que el vecino **nunca autorizó** ¿se
  puede cancelar, o hay que esperar a que caduque? Se puede:

  ```
  create: 201  status = pending
  cancel: 200  786 ms  -> {"status":"cancelled"}
  after : 200  status = cancelled
  ```

  Consecuencia de producto: la lista NEGRA de un solo valor (`isKnownDead`,
  `src/lib/mp/subscription-status.ts`) alcanza también para este caso —el botón
  «Cancelar el débito» se ofrece sobre una `pending` y funciona—, y la baja de un
  socio con una `pending` **no** deja ninguna advertencia: la cancela bien.
- **Cancelar es rápido**: 786 ms medidos, contra los ~1,2 s de una cancelación
  dentro de una baja. Es el número del que sale el tope de 25 socios por lote de
  cesantía (`ARREARS_BATCH_MAX`, `src/lib/treasury/rules.ts`).
- **TRAMPA: el `payer_email` de un usuario de prueba se arma con el número del
  NICKNAME, no con el user id.** Costó dos intentos y el mensaje de MP no dice
  nada:

  ```
  nickname TESTUSER7256755581100616192
        -> test_user_7256755581100616192@testuser.com   ✅ 201
  user id 7256755581100616192 (u otro número)
        -> 400 {"message":"User bad request"}  · sin `cause`, sin campo, sin pista
  ```

  El `payer_email` de un preapproval tiene que ser un usuario **real del sitio**
  (Parte I §1), y en sandbox eso significa el comprador de prueba. Es el mismo
  género de diagnóstico que la Parte I §9: leer el mensaje textual antes de
  hipotetizar — salvo que acá el mensaje no alcanza y hay que saber esto.

### J.6 Sandbox de la fase 5B (25/08/2026)

Batería de cierre de la fase 5B (débito autogestionado desde `/mi/debito`),
misma cuenta de prueba y mismo túnel de siempre. Como todo lo de esta parte:
**medido, no supuesto**.

- **El panel de webhooks tiene DOS solapas, y el token `APP_USR-…` de una
  aplicación de CUENTA DE PRUEBA dispara por "Modo productivo"**, no por "Modo
  de prueba". Con sólo la solapa de prueba configurada el resultado es
  **silencio total**: no se entrega nada y no queda nada encolado para
  reintentar. Costó **dos adhesiones** descubrirlo — la de Rodrigo (socio 298)
  quedó `authorized` en MP sin que llegara ningún aviso, y hasta ese momento el
  panel decía estar configurado. Lo que funcionó: **las dos solapas con la misma
  URL y la misma clave** (J.1 paso 4 quedó corregido con esto). Es la versión
  concreta de la advertencia de la Parte D: "la solapa equivocada" no avisa por
  ningún lado.
- **Al configurar la solapa productiva, MP entregó AL INSTANTE lo que tenía
  pendiente**: la notificación del pago de Roberto (socio 535) llegó en segundos
  (21:39:42, `subscription_authorized_payment`), sin re-disparar nada del lado
  nuestro.
- **El checkout de suscripciones NO redirige solo al sitio**: el vecino tiene
  que apretar "Volver al sitio del vendedor". Consecuencia de producto: el
  `?volvio=1` de la vuelta puede **no ejecutarse nunca**, así que la pantalla
  de `/mi/debito` muestra el estado del espejo local y la conciliación lo
  sincroniza igual — no hay nada colgado de esa vuelta.
- **Reconfirmados en esta batería** los dos hechos de J.4/J.3 que gobiernan la
  red de seguridad: `/v1/payments/search` sigue devolviendo **0** en sandbox, y
  `/authorized_payments/search` **sí encuentra el débito** — es el camino por el
  que la conciliación recupera un cobro cuyo webhook no llegó.

**La evidencia del circuito completo (CA-5B-1, por los DOS caminos):**

- **Rodrigo (socio 298), el camino de la red**: adhesión desde `/mi/debito` →
  preapproval `authorized` en MP → el webhook **no llegó** (la solapa productiva
  estaba vacía, primer punto de arriba) → la **conciliación lo recuperó en su
  primera corrida** (`debitsRecovered: 1`): Payment `type: debit` de $ 6.000,
  cuota 2026-09 paga, recibo **2026-00008**. Operación MP `175616110782`.
- **Roberto (socio 535), el camino directo**: ya con las dos solapas
  configuradas, `subscription_authorized_payment` → `debit_applied` por
  **webhook directo**: cuota 2026-09, recibo **2026-00009**. Operación MP
  `175619922862`.
- Ninguno de los dos cobros fue jamás `entry`: los dos entraron como cuota común
  por la regla 3 de `resolve.ts`, sin tocarla (la fila local nace con
  `memberId`; la referencia `socio:{id}` es para el operador, `docs/06` §2).

**Y la cancelación (CA-5B-2)**: Roberto canceló **desde nuestra pantalla**
(`/mi/debito/cancelar`) → MP respondió 200 → llegó el webhook
`subscription_preapproval` → el espejo local quedó sincronizado y `autoDebit`
bajó solo. La re-adhesión quedó bloqueada por la regla anti-duplicación mensual:
"Ya abonaste una cuota este mes. Podés adherirte desde el 01/09/2026" (capturas
del operador). La pantalla post-cancelación dice "Ese débito ya está cancelado".

- **Tercer circuito (mismo día): el push de monto al recategorizar, medido.** Un
  adherente se adhirió (preapproval nacido cobrando **$3.000**, primer débito
  aplicado por webhook, recibo `2026-00010`), pidió el pase a activo desde su
  panel, y la aceptación con acta empujó el monto **antes** de escribir lo
  local: MP quedó cobrando **$6.000** (`preapproval 5d5ff26…`, verificado por
  API), el espejo local sincronizado y el asiento con
  `{subscriptionUpdated: true, amount: 6000, requestId}`. Es el CA-5B-4 del
  Módulo 5, medido y no supuesto. En la misma corrida se vio la idempotencia
  del webhook trabajando: las notificaciones duplicadas de
  `subscription_authorized_payment` respondieron `already_processed` sin tocar
  nada.
