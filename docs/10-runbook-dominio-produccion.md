# 10 — Runbook: poner el sitio en `vecinalciudadela.ar`

Procedimiento para publicar SIGeV en el dominio productivo. Los comandos del VPS
los ejecuta Mariano a mano (SSH puerto **2222**, root, IP **167.86.71.102**); la
app vive en **`/root/dev/ciudadela`** y corre en el puerto **3006** bajo PM2 con
el nombre `sigev`.

> **Antes de empezar, decidir si corresponde.** `docs/07-plan-de-etapas.md` ata el
> lanzamiento público a la oficialización de la IGJ. Todo lo de este runbook se
> puede dejar preparado antes (el dominio puede apuntar y el sitio quedar
> accesible con ASOCIATE apagado), pero publicarlo es una decisión de la Comisión,
> no un paso técnico. Mientras tanto, el Módulo 2 se despliega a staging con el
> procedimiento de la sección 4.

---

## 0. Punto de partida (verificado por DNS el 20/08/2026)

Buena parte del trabajo ya está hecha. Lo que **ya funciona** y no hay que tocar:

| Ítem | Estado |
|---|---|
| Delegación en NIC.ar | ✅ `jocelyn.ns.cloudflare.com` / `logan.ns.cloudflare.com` |
| Zona en Cloudflare | ✅ activa y resolviendo |
| Brevo (correo saliente) | ✅ dominio autenticado, DKIM `b1`/`b2.vecinalciudadela-ar.dkim.brevo.com` resolviendo |
| SPF | ✅ `v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all` |
| DMARC y `brevo-code` | ✅ publicados |
| Envío real | ✅ verificado el 19/08/2026 desde `notificaciones@vecinalciudadela.ar` |

Lo que **falta**, y es todo lo que cubre este runbook:

1. El registro **A** de la raíz y de `www` — hoy el dominio **no resuelve a
   ninguna IP**, así que la web no apunta a ningún lado (sección 1).
2. La configuración de **SSL/TLS** y el **certificado de origen** (sección 1).
3. El **server block de Nginx** en el VPS (sección 2).
4. `AUTH_URL` y las credenciales productivas de MP en el `.env` del VPS, más el
   **re-build** que eso obliga (secciones 3 y 4).

---

## 1. Cloudflare

### 1.1 Registros DNS

La zona ya tiene 9 registros (correo). **Hay que agregar exactamente dos**, los
del web, en **DNS → Records → Add record**:

| Tipo | Nombre | Contenido | Proxy | TTL |
|---|---|---|---|---|
| A | `vecinalciudadela.ar` (o `@`) | `167.86.71.102` | **Proxied** 🟠 | Auto |
| A | `www` | `167.86.71.102` | **Proxied** 🟠 | Auto |

**No tocar los 9 que ya están** (los CNAME `brevo1`/`brevo2._domainkey`, los tres
MX de `route*.mx.cloudflare.net`, y los TXT de SPF, DMARC, `brevo-code` y
`cf2024-1._domainkey`): son los que sostienen el correo, que hoy funciona.

### Por qué proxied y no «DNS only», como cbinfraestructura.ar

`cbinfraestructura.ar` corre en el mismo VPS con la nube **gris**, y es una
configuración válida — pero SIGeV **no** debe copiarla, porque los dos sitios
resuelven el TLS de manera distinta:

| | cbinfraestructura.ar | SIGeV |
|---|---|---|
| Proxy | DNS only 🔘 | **Proxied 🟠** |
| Certificado | Let's Encrypt (Certbot) en el VPS | **Cloudflare Origin** |
| Quién termina el TLS público | el VPS | Cloudflare |

Tres razones por las que SIGeV va proxied:

1. **El certificado de origen de Cloudflare solo sirve proxied.** No lo valida
   ningún navegador: lo valida Cloudflare. Con la nube gris el visitante recibe
   un certificado no confiable. Si se prefiriera la nube gris, habría que usar
   Certbot como cbinfraestructura y saltear el paso 1.3.
2. **Staging ya funciona así** (`sigev.redaccion.ar`, con el Origin wildcard de
   `redaccion.ar`), y el server block de producción es el mismo patrón.
3. **HSTS la emite Cloudflare, no la app** — decisión tomada en el Módulo 2 y
   escrita en `next.config.ts`. Con la nube gris nadie la emite.

De yapa: el proxy oculta la IP del origen, que además hospeda otras cinco
aplicaciones.

> ⚠️ El proxy naranja **obliga** al bloque `set_real_ip_from` de la sección 2.
> Sin él, `$remote_addr` es el edge de Cloudflare, todos los visitantes comparten
> IP y el limitador de intentos del login deja afuera a cualquiera después de
> cinco fallos de otro. No es opcional.

`google-site-verification` no hace falta: es específico de cbinfraestructura.ar.

### 1.2 SSL/TLS

1. **SSL/TLS → Overview → Full (strict)**. No usar «Flexible»: rompe el circuito
   HTTPS y deja a Auth.js viendo las peticiones como HTTP.
2. **SSL/TLS → Edge Certificates**:
   - **Always Use HTTPS**: ON.
   - **HSTS**: ON (`max-age` 6 meses, incluir subdominios). La app **no** emite
     HSTS a propósito: la termina Cloudflare, que es quien ve el TLS.
   - **Minimum TLS Version**: 1.2.

### 1.3 Certificado de origen

**SSL/TLS → Origin Server → Create Certificate**, con los hostnames
`vecinalciudadela.ar` y `*.vecinalciudadela.ar`, validez 15 años. Cloudflare
muestra el certificado y la clave **una sola vez**: copiarlos ahora.

En el VPS:

```bash
mkdir -p /etc/ssl/cloudflare
nano /etc/ssl/cloudflare/vecinalciudadela.ar.pem   # pegar el Origin Certificate
nano /etc/ssl/cloudflare/vecinalciudadela.ar.key   # pegar la Private Key
chmod 600 /etc/ssl/cloudflare/vecinalciudadela.ar.key
```

---

## 2. Nginx en el VPS

Crear `/etc/nginx/sites-available/vecinalciudadela.ar`. Es el mismo patrón del
server block de staging, **con dos diferencias deliberadas**: el certificado
propio del dominio y **sin** la cabecera `X-Robots-Tag` (en producción el sitio
tiene que indexarse; el `robots.txt` que emite la app ya bloquea `/admin`, `/mi`
y `/api`).

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name vecinalciudadela.ar www.vecinalciudadela.ar;
    return 301 https://vecinalciudadela.ar$request_uri;
}

# www -> raíz, para no tener el sitio duplicado en dos direcciones.
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.vecinalciudadela.ar;

    ssl_certificate     /etc/ssl/cloudflare/vecinalciudadela.ar.pem;
    ssl_certificate_key /etc/ssl/cloudflare/vecinalciudadela.ar.key;

    return 301 https://vecinalciudadela.ar$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name vecinalciudadela.ar;

    ssl_certificate     /etc/ssl/cloudflare/vecinalciudadela.ar.pem;
    ssl_certificate_key /etc/ssl/cloudflare/vecinalciudadela.ar.key;

    client_max_body_size 15M;   # portadas de noticias, DNIs y anexos

    # Cloudflare real IP (https://www.cloudflare.com/ips/).
    # OBLIGATORIO con el proxy naranja: sin esto `$remote_addr` es el edge de
    # Cloudflare y TODOS los visitantes comparten IP, así que el rate limiter
    # del login no distingue a nadie — cinco intentos fallidos de cualquiera
    # dejan afuera al barrio entero. Va DENTRO del server block, no es global:
    # hay que repetirlo acá aunque staging ya lo tenga.
    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 131.0.72.0/22;
    set_real_ip_from 2400:cb00::/32;
    set_real_ip_from 2606:4700::/32;
    set_real_ip_from 2803:f800::/32;
    set_real_ip_from 2405:b500::/32;
    set_real_ip_from 2405:8100::/32;
    set_real_ip_from 2a06:98c0::/29;
    set_real_ip_from 2c0f:f248::/32;
    real_ip_header CF-Connecting-IP;

    location / {
        proxy_pass http://127.0.0.1:3006;
        proxy_http_version 1.1;
        # Se descarta la cabecera que mande el cliente: solo vale la que resolvió
        # el módulo realip a partir de las redes de Cloudflare de arriba.
        proxy_set_header CF-Connecting-IP "";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```

`X-Forwarded-Proto https` es **obligatorio**: sin él Auth.js detrás del proxy
cree que la petición es HTTP y rompe el circuito de sesión.

Activar:

```bash
ln -s /etc/nginx/sites-available/vecinalciudadela.ar /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx   # reload, NUNCA restart
```

---

## 3. Variables de entorno

Editar `/root/dev/ciudadela/.env`:

```bash
AUTH_URL=https://vecinalciudadela.ar
MP_ACCESS_TOKEN=<credenciales PRODUCTIVAS>
MP_WEBHOOK_SECRET=<productivo>
UPLOADS_DIR=/var/sigev/uploads
RECEIPTS_DIR=/var/sigev/recibos
MAIL_FROM="Asoc. Vecinal del Barrio Ciudadela <notificaciones@vecinalciudadela.ar>"
```

Cuatro cosas que no avisan si están mal:

- **`AUTH_URL` se hornea en el build.** De ahí salen `metadataBase`, las URLs
  canónicas, el `robots.txt` y el `sitemap.xml`. Cambiarla exige **re-buildear**;
  reiniciar PM2 no alcanza. Si el build sale con el dominio viejo, el sitio
  publica canonicals a otra dirección y se desindexa solo.
- **`ALLOW_LOCALHOST_BASE_URL` no puede estar activa.** Es una escotilla para el
  build local que desactiva la guarda que impide justamente ese error.
  `grep ALLOW_LOCALHOST_BASE_URL .env` no debe devolver ninguna línea sin `#`.
- **`UPLOADS_DIR` tiene que estar.** Si falta, la app cae en silencio a
  `./uploads` dentro del directorio del repo: las portadas de noticias se
  escriben ahí y se pierden en el próximo deploy, sin ningún error.
- **`RECEIPTS_DIR` tiene que estar** (fase 4A), por el mismo motivo y con la misma
  falla silenciosa: sin ella los PDFs de los recibos caen en `./recibos` dentro del
  repo, quedan fuera del backup y se pierden en el próximo deploy. El cobro no se
  pierde —el recibo vive en la base y el PDF es regenerable—, pero el archivo sí.

---

## 4. Despliegue en el VPS

### 4.0 Antes del PRIMER `deploy.sh` (una sola vez, obligatorio)

`deploy.sh` corre `npx prisma db seed` en cada despliegue. Antes de que eso pase
por primera vez sobre la base con los socios reales, verificá a mano que el
`.env` del VPS no pida las cuentas de prueba:

```bash
grep -n 'SEED_TEST_USERS\|SEED_ALLOW_TEST_USERS' /root/dev/ciudadela/.env
```

**Lo que tiene que devolver**: nada, o a lo sumo `SEED_TEST_USERS="false"`.
`SEED_ALLOW_TEST_USERS` no debe aparecer. Si aparece `SEED_TEST_USERS="true"`
—que es lo que dejó escrito el plan del Módulo 0 cuando se creó ese `.env`—,
borrá la línea o ponela en `"false"`.

Por qué importa: `admin.prueba@sigev.local` es una cuenta **con rol admin y
contraseña conocida** (`SEED_TEST_PASSWORD`). Sembrarla en producción es un
backdoor de administrador sobre el padrón real.

Hoy el código ya falla cerrado —las cuentas de prueba exigen el opt-in explícito
`SEED_ALLOW_TEST_USERS="true"` (`prisma/seed-guard.ts`) y `deploy.sh` además
corre el seed con `NODE_ENV=production`, que las prohíbe aunque el opt-in
estuviera—, así que el `grep` es la tercera capa, no la única. Se hace igual:
es un chequeo de diez segundos contra el peor resultado posible.

> Nota histórica: `docs/superpowers/plans/2026-08-17-modulo-0-base.md` (Step 4)
> escribió ese `.env` con `SEED_TEST_USERS="true"` y el comentario «en
> produccion DEBE ser "false" (el seed lo rechaza)». El rechazo **no ocurría**:
> se apoyaba en `NODE_ENV === "production"`, variable que `deploy.sh` nunca
> setea. Corregido el 21/08/2026.

### 4.1 El deploy

Además del `git pull`, el deploy completo es lo que hace `deploy.sh`:

```bash
cd /root/dev/ciudadela && bash deploy.sh
```

que equivale a:

```bash
git pull --ff-only
npm ci                      # sin --omit=dev: prisma y tsx son devDependencies
npx prisma migrate deploy   # el Módulo 2 trae 20260819185852_add_module_2_news_activities
NODE_ENV=production npx prisma db seed   # claves nuevas de `configuration`; ver 4.0
npm run build               # acá se hornea AUTH_URL
pm2 restart sigev --update-env
pm2 save
```

**Específico de este despliegue (Módulo 2):**

1. **Migración nueva**: `20260819185852_add_module_2_news_activities` crea las
   tablas `news` y `activities`. `migrate deploy` la aplica sola; no usar
   `db push`.
2. **Directorio de portadas**: la app lo crea al subir la primera imagen, pero
   conviene dejarlo con los permisos correctos de entrada:
   ```bash
   mkdir -p /var/sigev/uploads/news
   chmod 750 /var/sigev/uploads/news
   ```
3. **`sharp`** pasó a dependencia de producción (lo necesita `next/image` en
   runtime, no solo en build). `npm ci` lo instala; si el build se hiciera con un
   `node_modules` viejo, las imágenes fallan recién al servirse.
4. **Backup antes de migrar**, como siempre:
   ```bash
   mysqldump sigev > /root/backup-pre-m2-$(date +%F).sql
   ```

**Específico del Módulo 3 (ASOCIATE + Mercado Pago):**

1. **Migración**: `20260820174523_add_module_3_applications_mp` (tablas
   `applications`, `documents`, `mp_subscriptions`, `webhook_events` y las
   columnas nuevas de `action_tokens` y `notifications`). `migrate deploy` la
   aplica sola. Backup antes, como siempre.
2. **Variables nuevas en el `.env` del VPS**: `MP_ACCESS_TOKEN`,
   `MP_WEBHOOK_SECRET`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`,
   `CRON_SECRET` y —hasta el lanzamiento— `EMAIL_ALLOWLIST`. De dónde sale cada
   una: `docs/11`.
   **Las dos claves de Turnstile cierran el panel, no sólo el wizard.** Desde el
   commit `43d7150` el captcha gobierna también `/ingresar` y
   `/ingresar/recuperar`, además del paso 3 de `/asociate`:
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` **se hornea en el build** como `AUTH_URL`
     (cambiarla exige re-buildear; reiniciar PM2 no alcanza). Si falta, el
     widget no monta y el formulario no tiene token que mandar.
   - `TURNSTILE_SECRET_KEY` es de runtime y **falla cerrado**: sin secreto, la
     verificación devuelve `false` y el login se rechaza.

   Con cualquiera de las dos ausente, **todo admin y todo socio quedan afuera
   del panel**, y el recupero de contraseña también está bloqueado — no hay
   camino de vuelta desde el navegador, sólo por SSH.

   Por eso `npm run build` **falla a propósito** si falta cualquiera de las dos
   (guarda en `next.config.ts`, sólo en la fase de build): el deploy se corta
   antes del `pm2 restart` y la versión que ya está sirviendo no se toca. La
   guarda NO corre al arrancar —un crash-loop se llevaría puesto el sitio
   público y los webhooks de MP, más daño que el que evita—, así que un
   `pm2 restart` con el `.env` mutilado sigue siendo posible: verificá igual con
   `grep TURNSTILE /root/dev/ciudadela/.env` (dos líneas, con valor) y probá
   `/ingresar` en el post-deploy.
3. **Configuración desde el panel** (no es `.env`): cargar en
   `/admin/configuracion` los ids de los dos planes de MP (`mp_plan_active_id`,
   `mp_plan_shared_id`) y revisar los textos legales. Sin los ids, el paso 2 del
   wizard no muestra montos y no deja avanzar.
   Los textos legales (`terms_text`, `privacy_consent_text`) **llegan sembrados**
   —`deploy.sh` corre `npx prisma db seed`, que los crea con un BORRADOR y nunca
   los pisa en corridas posteriores—, así que el formulario aparece con texto
   para revisar, no vacío. Si igual faltaran, el servidor **rechaza** las
   solicitudes nuevas (`createApplicationAction`): no se graba una aceptación de
   términos que no existen.
4. **Webhooks de MP** apuntando a `https://vecinalciudadela.ar/api/webhooks/mp`
   con los tres tópicos (`payments`, `subscription_preapproval`,
   `subscription_authorized_payment`); el secreto que da el panel es
   `MP_WEBHOOK_SECRET`. Conviene además limitar por Nginx la tasa de esa ruta.
5. **Crontab** de `/api/cron/applications` (`docs/11`, Parte H). Sin él, las
   solicitudes abandonadas no expiran nunca y sus débitos no se cancelan.
6. **Directorio de documentos**: `mkdir -p /var/sigev/uploads/applications &&
   chmod 750 /var/sigev/uploads/applications`. La app lo crea sola, pero mejor con
   los permisos puestos de entrada. `client_max_body_size 15m` en Nginx ya está
   (uploads de DNI de hasta 10 MB).
7. **NO tocar `instances` de PM2.** El módulo asume un solo proceso: ver la
   advertencia de `docs/03` (mutex por DNI y rate limiters en memoria).

**Específico de la fase 4A del Módulo 4 (tesorería: cuenta corriente, efectivo,
recibos, deudores):**

Este despliegue tiene dos mitades muy distintas. La primera (pasos 1 a 5) es un
deploy normal y se puede repetir. La segunda (pasos 6 y 7) es la **carga
fundacional de datos**: corre **una sola vez**, borra fichas físicamente y crea
3080 cuotas que después se van a cobrar y a notificar de forma fehaciente. No hay
"des-importar". Leé los pasos 6 y 7 enteros antes de tipear nada.

#### 1. Backup, antes de todo

```bash
mysqldump sigev > /root/backup-pre-m4a-$(date +%F).sql
ls -lh /root/backup-pre-m4a-*.sql       # que NO diga 0 bytes
```

Si el archivo salió vacío o el `mysqldump` devolvió error, **frená acá**: el resto
de este procedimiento no tiene vuelta atrás sin él.

#### 2. `RECEIPTS_DIR` en el `.env` y el directorio, ANTES del deploy

Se hace antes para que el `pm2 restart --update-env` que ya trae `deploy.sh` la
tome, y no haya que reiniciar dos veces:

```bash
cd /root/dev/ciudadela
grep -q '^RECEIPTS_DIR=' .env || echo 'RECEIPTS_DIR=/var/sigev/recibos' >> .env
grep -n '^RECEIPTS_DIR=' .env           # tiene que devolver exactamente una línea

install -d -m 750 /var/sigev/recibos
ls -ld /var/sigev/recibos               # drwxr-x--- root root
```

`/var/sigev/recibos` **ya está cubierto por `scripts/backup.sh`** (el tar nocturno
empaqueta `uploads` y `recibos`), así que no hay que tocar el backup.

#### 3. El deploy

```bash
cd /root/dev/ciudadela && bash deploy.sh
```

Trae la migración `20260822125844_add_module_4_treasury` (tablas `fee_values`,
`fees`, `payments`, `receipts`, `receipt_sequences`, `mp_unmatched_payments`,
`cron_runs`, más el estado `failed` y la columna `error` de `notifications`).
`migrate deploy` la aplica sola: **nunca `db push`**.

El seed siembra el **valor de cuota inicial** ($ 6.000 activo / $ 3.000 compartido,
vigente desde el 01/08/2026) sólo si la tabla está vacía; si ya hay algún valor, no
toca nada. Lo imprime así:

```
new  valor de cuota inicial: activo 6000 / compartido 3000 (vigente 01/08/2026)
```

#### 4. Verificación de la app, antes de tocar datos

Entrá al panel y comprobá tres cosas:

- La lateral muestra **Tesorería** entre Socios y Actas, y la tarjeta del tablero
  ya no dice "Próximamente".
- `/admin/tesoreria/valores` muestra los dos montos y "Vigente desde 01/08/2026".
  Si dice "Todavía no rige ningún valor", el seed no corrió: **no sigas**, sin
  valor vigente el cobro en efectivo no puede calcular ningún total.
- Las cuatro pestañas (Deudores / Efectivo / Recibos / Valores) navegan.

#### 5. Un recibo de prueba (opcional, pero es la única forma de probar el disco)

Cobrá un aporte voluntario de $ 1 a un socio de prueba y abrí el PDF desde el
detalle del recibo. Es el único paso que ejercita `RECEIPTS_DIR` de verdad: si los
permisos están mal, la pantalla dice "el archivo no está disponible" y el PDF se
regenera al volver a pedirlo. Después anulá el recibo (el número queda quemado, que
es lo correcto: la serie no se renumera).

**No probar un cobro por Mercado Pago acá**: el dominio corre con credenciales
productivas desde el 22/08/2026 y eso sería plata de un vecino.

#### 6. Padrón definitivo — `--update-existing --prune --yes`

Este comando hace **dos cosas destructivas**. Antes de correrlo hay que decidir
sobre las dos.

**(a) `--update-existing` pisa las fichas con lo que dice el Excel, incluidos los
campos vacíos.** El Excel del padrón trae número, nombre, DNI, email, categoría,
estado y fechas, y **nada más**: domicilio, teléfono, fecha de nacimiento, estado
civil, nacionalidad y ocupación vienen vacíos en casi todas las filas. Cada ficha
que alguien haya completado a mano desde el panel **pierde esos datos**. Preguntá
antes: ¿alguien de la Comisión ya usó el modo carga de fichas? Si la respuesta es
sí, corré primero sin el flag (ver más abajo) y resolvé a mano.

El socio **306** —el piloto que se afilió por la web el 22/08/2026— está en el
Excel, así que no lo poda; pero **sí lo pisa**: la ficha que cargó él en el wizard
(domicilio, teléfono, fecha de nacimiento) queda en blanco. Si eso importa,
guardala antes o volvé a cargarla después.

**(b) `--prune --yes` borra FÍSICAMENTE los socios del libro que ya no están en el
Excel.** Son seis: **118, 141, 158, 239, 287, 288**, las fichas que la Comisión
sacó del libro en la carga definitiva del 21/08/2026. Pero el criterio del script
es "está en la base y no está en el Excel", no esa lista: **cualquier socio dado de
alta desde el M1 y que no figure en el archivo entra en la poda**. Si en el VPS se
dio de alta a alguien por acta o por el wizard después del import original, ese
socio no está en el Excel.

El script se defiende: si un socio a podar tiene **cuenta de acceso, solicitud,
suscripción de Mercado Pago, pago, cuota, membresía en otro libro o cualquier
movimiento cargado a mano**, aborta **sin borrar a nadie** y los lista uno por uno
con el motivo. Si eso pasa, la salida se ve así:

```
IMPORT ABORTADO — ERROR DE DATOS O DE USO: revisá datos/padron_socios.xlsx …
  No se puede podar: estos socios ya no están en el Excel pero tienen datos del sistema.
  No se borró a nadie. Resolvelos a mano desde el panel (o volvelos a poner en el Excel):
    socio 307: tiene cuenta de acceso, 1 solicitud(es)
```

Las dos salidas legítimas de ese aborto son: **ponerlo en el Excel** (si tiene que
seguir en el libro) o **resolverlo a mano desde el panel** (darlo de baja en vez de
borrarlo). Nunca forzar el borrado.

**La corrida de reconocimiento (recomendada).** Sin flags, el script sólo crea
socios nuevos y no toca ninguna ficha existente, pero igual imprime todos los
totales y todos los avisos:

```bash
cd /root/dev/ciudadela
npx tsx scripts/import-padron.ts
cat padron-import-report.txt
```

Mirá que diga `filas: 278 (esperado 278)`, `vigentes: 160 (esperado 160)` y
`huecos (28, esperado 28)`. **Si alguno no coincide, no sigas**: el archivo no es
el que este runbook describe.

**La corrida real:**

```bash
npx tsx scripts/import-padron.ts --update-existing --prune --yes
```

Cuando anda, el reporte —que también queda en `padron-import-report.txt`— se ve
como esta corrida real de local, del 22/08/2026:

```
Padron import — 2026-08-22T19:30:48.901Z
filas: 278 (esperado 278) | vigentes: 160 (esperado 160) | bajas: 118 (esperado 118)
numeracion: 1..306 | huecos (28, esperado 28): 21, 71, 72, 73, 93, 94, 95, 97, 118, …
modo: --update-existing (los existentes se pisan con el Excel)
creados: 1 | actualizados: 275 | sin cambios: 0 | NO actualizados por quedar sin email teniendo cuenta: 2
memberships creadas: 1 | movements de admision creados: 1
podados (6): 118, 141, 158, 239, 287, 288 | con ellos se borraron 6 movimientos, 0 notificaciones y 0 enlaces
en base: members 278 | memberships libro 1: 278 | movements admission libro 1: 278
avisos (9):
  - socio 5: baja sin fecha_egreso
  …
```

En el VPS los números de `creados` / `actualizados` van a ser otros (306 ya existe
allá, así que probablemente sea `creados: 0 | actualizados: 276`), pero las tres
líneas de control —278 filas, 160 vigentes, 28 huecos— y `en base: members 278`
tienen que dar exactamente eso.

**Los avisos que espera este archivo, y que NO son un problema:**

- `socio N: baja sin fecha_egreso` para **5, 10, 20, 31, 32, 99 y 282**. El libro
  de papel no la tiene. Los socios **31 y 32** además están de baja **sin motivo**:
  el Excel deja la celda vacía y quedan con motivo nulo. Los siete son datos que la
  Comisión tiene que completar desde el panel; ninguno frena nada.
- `socio N: el Excel no trae email y el socio ya tiene cuenta de acceso — la fila
  NO se actualizó`. Es una **protección, no un error**: dejar la ficha sin email
  dejaría a la cuenta ingresando con una dirección que ya no figura en ningún lado.
  Esa fila queda como estaba. Para que se actualice hay que cargarle la dirección
  en el Excel.

**Los avisos que SÍ hay que atender:**

- `el email del Excel ya pertenece a otra cuenta de acceso` → esa fila no se
  escribió; corregí la dirección en el Excel y volvé a correr.
- `el Excel le cambió el email y el socio ya tiene cuenta de acceso — ahora INGRESA
  con la dirección nueva y NO se le avisó por correo` → el import **no manda
  correos**; avisale por otro medio.

Si el script aborta, distingue las dos causas en la primera línea: **error de datos
o de uso** (el Excel o los argumentos: se corrige y se vuelve a correr, es
idempotente) contra **error de infraestructura** (la base). Los abortos por datos
más probables: el archivo abierto en Excel (queda un lock `~$padron_socios.xlsx`),
una hoja que no se llama `socios`, un encabezado renombrado o duplicado, una celda
`numero_socio` que no es un número, y —sólo con `--prune`— los totales de control
que no dan, que corta **antes de la primera escritura**.

#### 7. Deuda histórica — `scripts/import-deuda.ts`

Va **después** del padrón, siempre: necesita que cada socio del Excel de deuda
matchee por número **y** DNI contra el libro abierto.

```bash
npx tsx scripts/import-deuda.ts
```

Cuando anda:

```
Debt import — 2026-08-22T…
filas: 278 (esperado 278) | socios con deuda: 119 (esperado 119) | cuotas en el Excel: 3080 (esperado 3080)
importados: 119 | salteados (ya tenían deuda importada): 0 | sin cuotas nuevas (todo su plan ya estaba devengado): 0 | cuotas creadas: 3080
en base: cuotas origin=import del libro 1: 3080
avisos (2):
  - socio 217: la deuda arranca en 2023-10, antes de su ingreso (2023-11) — revisá la cantidad del primer año
  - socio 231: la deuda arranca en 2023-09, antes de su ingreso (2023-11) — revisá la cantidad del primer año
```

Los avisos de **217** y **231** son reales y esperados: en `deuda.xlsx` la cantidad
del primer año les da más cuotas de las que ese año pudo devengar. No se descarta
ninguna (la cantidad la puso el tesorero), pero conviene revisarlas con él.

Es **idempotente por socio**: correrlo de nuevo imprime `importados: 0 | salteados:
119 | cuotas creadas: 0`. Eso también significa que **corregir el Excel y
re-correr no arregla a quien ya se cargó mal**: hay que corregirlo desde el panel.

Guardas que abortan **sin escribir nada**:

- Los tres totales de control (278 filas / 119 deudores / 3080 cuotas). Si no dan,
  el archivo no es el que este runbook describe.
- Un socio del Excel que no está en el libro, o cuyo DNI no coincide con la ficha.
  Casi siempre significa que el padrón no se importó, o se importó otro.
  → "Corré `scripts/import-padron.ts` con el padrón definitivo antes de cargar la
  deuda."
- **El mes de baja del Excel de deuda distinto del de la ficha.** Es la guarda que
  más importa: el mes de la baja decide en qué meses cae la deuda del año de la
  baja, y con la celda en blanco las cuotas se imputarían a meses **posteriores** a
  la salida del socio. Emparejá los dos archivos —o corregí la ficha desde el
  panel— y volvé a correr.
- Ningún libro abierto, o más de uno.

Dos cosas del diseño que conviene saber antes de mirar los datos: la deuda del año
abierto se ancla a la **fecha de la foto** (21/08/2026) y no al reloj del servidor,
así que el resultado es el mismo se corra hoy o en noviembre; y las cuotas
importadas **no llevan monto** —se valúan al valor vigente el día que se cobran—,
así que en la cinta del socio se ven con el glifo `L`, distintas de las que devengó
el sistema.

#### 8. Verificación final de datos

```bash
mysql sigev -e "SELECT COUNT(*) members FROM members;
SELECT COUNT(*) fees_import FROM fees WHERE origin='import';
SELECT COUNT(DISTINCT member_id) deudores FROM fees WHERE status='pending';"
```

Esperado: `members = 278`, `deudores = 119` y `fees_import = 3080` — o 3080 menos
las cuotas que el sistema ya hubiera devengado por su cuenta para esos mismos meses,
que el import saltea y cuenta aparte en la línea `cuotas del Excel que ya existían
devengadas`. Hoy no hay cron de devengo, así que deberían ser 3080 clavadas.

En el panel: `/admin/tesoreria/deudores` lista a los socios vigentes con deuda
ordenados por monto, y la ficha de un socio con deuda muestra la cinta con las
cuotas importadas. Con eso el módulo está en pie.

#### 9. Lo que NO entra en este despliegue

La fase 4A **no** toca Mercado Pago: el webhook sigue registrando los pagos sin
aplicarlos a cuotas, no hay links de pago, no hay bandeja de sin conciliar y el
lote de REG-34 no existe. Tampoco hay crons de tesorería: **las cuotas del mes no
se devengan solas todavía** (eso es la fase 4C). Hasta entonces, el crontab del VPS
sigue siendo sólo el de `/api/cron/applications` (`docs/11`, Parte H).

Y sigue vigente: **NO tocar `instances` de PM2** (mutex por DNI y rate limiters en
memoria, `docs/03`).

### Verificación post-deploy

```bash
curl -sI https://vecinalciudadela.ar | grep -i 'content-security-policy'
curl -sI https://vecinalciudadela.ar | grep -i 'strict-transport-security'
curl -s  https://vecinalciudadela.ar/robots.txt | tail -2
```

- La CSP tiene que llegar entera (la emite Next y tiene que sobrevivir a Nginx y
  a Cloudflare).
- Si el HSTS vuelve vacío, falta prenderlo en Cloudflare (paso 1.2).
- La última línea del `robots.txt` es `Sitemap: https://…`: **si dice otro
  dominio, el build se hizo con el `AUTH_URL` equivocado** y hay que rehacerlo.

---

## 5. Correo: nada que hacer

El dominio autenticado en Brevo **es** `vecinalciudadela.ar`, el mismo del sitio,
así que sitio y remitente coinciden y no hay nada que migrar. Se dio de alta el
19/08/2026 y quedó verificado: DKIM, SPF y DMARC resolviendo, y envíos reales
confirmados a las dos casillas autorizadas con `messageId` firmado por el
dominio propio.

Lo único que cambia al pasar a producción es `MAIL_FROM` en el `.env` del VPS
(sección 3), que hoy puede seguir apuntando a la casilla de prueba.

> Para el futuro, si alguna vez hay que rehacer la autenticación: Brevo arma el
> host DKIM reemplazando los puntos del dominio por guiones. Si el valor que
> muestra no coincide con la zona donde estás publicando los registros, el
> dominio se cargó mal en Brevo y **no es un problema de propagación** — nunca va
> a verificar. La clave SMTP es de la cuenta, no del dominio: se reutiliza tal
> cual. Las dos cosas costaron un día la primera vez.
