# 11 — Preparación de Mercado Pago (sandbox) y Cloudflare Turnstile

Instructivo operativo para Mariano. Al terminar vas a tener los **7 valores**
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

Desde una terminal (PowerShell o Git Bash), reemplazando `TU_ACCESS_TOKEN`
por el de la Parte B:

```bash
curl -X POST https://api.mercadopago.com/preapproval_plan -H "Authorization: Bearer TU_ACCESS_TOKEN" -H "Content-Type: application/json" -d "{\"reason\":\"SOCIO ACTIVO\",\"auto_recurring\":{\"frequency\":1,\"frequency_type\":\"months\",\"transaction_amount\":6000,\"currency_id\":\"ARS\"},\"back_url\":\"https://vecinalciudadela.ar/asociate\"}"
```

```bash
curl -X POST https://api.mercadopago.com/preapproval_plan -H "Authorization: Bearer TU_ACCESS_TOKEN" -H "Content-Type: application/json" -d "{\"reason\":\"SOCIO ADHERENTE/COLABORADOR\",\"auto_recurring\":{\"frequency\":1,\"frequency_type\":\"months\",\"transaction_amount\":3000,\"currency_id\":\"ARS\"},\"back_url\":\"https://vecinalciudadela.ar/asociate\"}"
```

Cada respuesta es un JSON largo; lo único que necesitamos es el campo **`"id"`**
del principio (un string tipo `2c93808491...`):

- id del primer curl → `mp_plan_active_id`
- id del segundo curl → `mp_plan_shared_id`

Estos dos ids **no van al `.env`**: se cargan desde
`/admin/configuracion` cuando la pantalla nueva esté desplegada (o me los
pasás y los dejo anotados para ese momento).

Si un curl falla con 401, el token está mal copiado; con 400, revisá que las
comillas escapadas (`\"`) hayan llegado enteras (en PowerShell conviene
pegarlo tal cual, en una sola línea).

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
   - **Site Key** → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
   - **Secret Key** → `TURNSTILE_SECRET_KEY`

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
| `mp_plan_active_id` | Parte C, primer curl | `/admin/configuracion` |
| `mp_plan_shared_id` | Parte C, segundo curl | `/admin/configuracion` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Parte E (o dummy en local) | `.env` local y del VPS |
| `TURNSTILE_SECRET_KEY` | Parte E (o dummy en local) | `.env` local y del VPS |
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

Junto con el deploy del módulo, agregar al crontab de root (SSH puerto 2222):

```
5 8 * * * curl -s -X POST -H "Authorization: Bearer CRON_SECRET_REAL" https://vecinalciudadela.ar/api/cron/applications >> /var/log/sigev-cron.log 2>&1
```

reemplazando `CRON_SECRET_REAL` por el valor de `CRON_SECRET` del `.env` del
VPS (definilo ahí si todavía no existe: cualquier string largo aleatorio,
p. ej. la salida de `openssl rand -hex 32`).
