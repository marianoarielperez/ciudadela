# 10 — Runbook: poner el sitio en `vecinalciudadela.ar`

Procedimiento para publicar SIGeV en el dominio productivo. Los comandos del VPS
los ejecuta Mariano a mano (SSH puerto **2222**, root, IP **167.86.71.102**); la
app vive en **`/root/dev/ciudadela`** y corre en el puerto **3006** bajo PM2 con
el nombre `sigev`.

> **Antes de empezar, decidir si corresponde.** `docs/07-plan-de-etapas.md` ata el
> lanzamiento público a la oficialización de la IGJ. Todo lo de este runbook se
> puede dejar preparado antes (el dominio puede apuntar y el sitio quedar
> accesible con ASOCIATE apagado), pero publicarlo es una decisión de la Comisión,
> no un paso técnico. Todo despliegue —éste y los que sigan— va a
> `vecinalciudadela.ar` con el procedimiento de la sección 4: **el staging
> `sigev.redaccion.ar` se dio de baja el 20/08/2026** y hay un solo entorno.

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
2. **El staging funcionaba así** (`sigev.redaccion.ar`, con el Origin wildcard de
   `redaccion.ar`), y el server block de producción es el mismo patrón. Ese entorno
   se dio de baja el 20/08/2026; queda como referencia de la configuración, no como
   un lugar al que desplegar.
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

Este despliegue tiene tres tramos muy distintos. El primero (pasos 1 a 5) es un
deploy normal y se puede repetir. El segundo (paso 6) **borra los datos de prueba**
que hoy tiene el VPS: es destructivo pero acotado, y quien lo cubre es el **backup B
del paso 4 bis** (el del paso 1 quedó del otro lado de la migración: ver el paso 1).
El tercero (pasos 7 y 8) es la **carga fundacional de datos**: corre **una sola
vez**, borra fichas físicamente y crea 3080 cuotas que después se van a cobrar y a
notificar de forma fehaciente. No hay "des-importar". Leé los pasos 6, 7 y 8 enteros
antes de tipear nada.

Los archivos que borra el paso 6 —las fotos de DNI— no los cubre ningún backup del
VPS salvo el tar del paso 1.3, que hay que tomar a mano.

#### 1. Dos backups **cifrados**, y para qué sirve cada uno

Este despliegue necesita **dos** fotos de la base, y no son intercambiables:

| | Cuándo se toma | Qué esquema tiene | Qué falla repara |
|---|---|---|---|
| **A — pre-deploy** | acá, antes de `deploy.sh` | el de hoy (**M3**) | el deploy mismo: pasos 3 y 4 |
| **B — post-migración** | paso **4 bis**, con la app ya verificada | **M4** | la limpieza y los imports: pasos 5 a 8 |

El motivo es de orden: `deploy.sh` corre `prisma migrate deploy` en el paso 3, y
**todos** los pasos irreversibles (6, 7 y 8) ocurren después. El backup A queda del
otro lado de esa migración, así que **no sirve para volver del paso 6**: restaurarlo
con `mysql sigev` a secas después del paso 3 no deja la base "como estaba antes de
la limpieza", deja **producción rota**, y por tres motivos a la vez:

- `mysqldump sigev` (sin `--databases`) emite `DROP TABLE IF EXISTS` + `CREATE TABLE`
  **sólo de las tablas que existían cuando se tomó el dump**. Restaurarlo devuelve
  `notifications` y `mp_subscriptions` a su DDL pre-M4: desaparecen
  `notifications.error` y `mp_subscriptions.amount` / `external_reference`, y los
  enums de `notifications` pierden `receipt`, `payment_rejected` y `failed`. El
  build M4 que está sirviendo **selecciona esas columnas**: empieza a tirar
  `Unknown column` en la primera pantalla que las toque.
- `fees`, `payments`, `receipts`, `receipt_sequences`, `mp_unmatched_payments` y
  `cron_runs` **no están en ese dump**, así que sobreviven al restore tal como
  estaban — justo los datos que se querían deshacer.
- `_prisma_migrations` **sí** está, y vuelve a su estado pre-M4: la migración
  `20260822125844_add_module_4_treasury` pasa a leerse como *no aplicada* mientras
  sus tablas siguen existiendo. El siguiente `migrate deploy` muere en
  `CREATE TABLE fees` y no hay deploy que avance.

Por eso A se restaura **entero** (base + código) y B se restaura **plano**. Cuál usar:

- **Falló el deploy** (la migración quedó a medias, el build no compila, PM2 no
  levanta, `/admin/tesoreria/valores` no existe): **A**, y se vuelve también el
  código al commit anterior. Es el único caso en que A se usa.
- **Falló la limpieza o un import** (se borró de más en el paso 6, el padrón entró
  mal, la deuda entró mal): **B**. El esquema está bien; lo que hay que rebobinar
  son los datos.

##### 1.1 La passphrase

Es el mismo cifrado que usa `scripts/backup.sh` (AES256 simétrico con la passphrase
de `/root/.sigev_backup_pass`), pero a mano: al día de hoy **ese script todavía no
está instalado en el VPS** —no hay crontab y `rclone` no está, `docs/09`—, así que
no hay un backup nocturno del que colgarse.

Si `/root/.sigev_backup_pass` no existiera todavía, creala **antes** —y anotá la
passphrase fuera del VPS, que es la mitad que importa: sin ella el `.gpg` no se
restaura desde ningún lado—:

```bash
umask 077 && printf '%s' 'UNA-PASSPHRASE-LARGA' > /root/.sigev_backup_pass
```

Si el archivo ya existe, **no lo pises**: los backups viejos se descifran con la
que está adentro.

Si ya instalaste `backup.sh`, corré `bash scripts/backup.sh` **además** de lo de
abajo: sube una copia al Drive, y una copia en el mismo disco que la base no es un
backup. Lo que no hay que hacer es correr `backup.sh` **de nuevo el mismo día,
después del import**: el nombre lleva `$(date +%F)` y pisaría la foto previa con la
posterior.

##### 1.2 Backup A — la base, antes del deploy

El dump lleva 278 DNIs, así que no puede quedar en claro en `/root` esperando a que
alguien se acuerde de borrarlo: `docs/08` no admite excepciones —los backups viajan
y descansan cifrados, siempre—.

Va con `--databases --add-drop-database` a propósito, y no como el dump de
`backup.sh`: A tiene que poder recrear una base **cuyo esquema ya avanzó**, y eso
sólo se consigue tirando la base entera y volviéndola a crear. Con un dump sin
`--databases`, el restore es el desastre de tres puntas que describe el cuadro de
arriba.

```bash
# El commit al que se vuelve si hay que usar A. Anotalo fuera del VPS.
git -C /root/dev/ciudadela rev-parse --short HEAD

mysqldump --single-transaction --routines --databases --add-drop-database sigev \
  | gzip \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file /root/.sigev_backup_pass \
        -o /root/backup-pre-m4a-$(date +%F).sql.gz.gpg
```

**La verificación no es mirar el tamaño.** En `mysqldump | gzip | gpg` el shell
devuelve el estado de **gpg**, que cifra feliz lo que le llegue aunque `mysqldump`
haya muerto a la mitad; y un flujo gzip vacío envuelto en gpg pesa 60–100 bytes, así
que "que no diga 0 bytes" le da el visto bueno igual a un backup truncado. La única
comprobación que sirve es abrir el archivo y mirar la última línea:

```bash
gpg --batch --quiet --decrypt --passphrase-file /root/.sigev_backup_pass \
    /root/backup-pre-m4a-$(date +%F).sql.gz.gpg \
  | gunzip | tail -1
```

Tiene que imprimir `-- Dump completed on AAAA-MM-DD …`, que es la última línea que
`mysqldump` escribe **cuando terminó bien**. De paso prueba la otra mitad que hay
que saber antes de necesitarla: que la passphrase del archivo descifra lo que acaba
de cifrar. Si no aparece esa línea —o gpg falla, o la salida viene cortada—
**frená acá**: el resto de este procedimiento no tiene vuelta atrás sin backup.

##### 1.3 Backup A — los archivos (uploads y recibos)

**El paso 6 borra archivos, y de esos archivos no hay ninguna otra copia.** Corre
`rm -rf /var/sigev/uploads/applications/*`, y ahí adentro están las **fotos de DNI**
de las solicitudes, que el modelo marca como *Conservación PERMANENTE (decisión
institucional)* (`prisma/schema.prisma`, `model Document`). El único script que
empaqueta esos directorios es `scripts/backup.sh`, y **no está instalado**: sin este
tar, el `rm -rf` del paso 6 no tiene vuelta atrás.

```bash
# `recibos` todavía puede no existir (lo crea el paso 2) y el tar lo exige.
mkdir -p /var/sigev/uploads /var/sigev/recibos

tar -czf - -C /var/sigev uploads recibos \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file /root/.sigev_backup_pass \
        -o /root/backup-pre-m4a-files-$(date +%F).tar.gz.gpg

# Verificación: tiene que listar los archivos y terminar sin error. Se cuenta en
# vez de mostrar con `head`: cortar el pipe con `head` hace que gzip y gpg se quejen
# de "Broken pipe" aunque el backup esté perfecto, y ese ruido se lee como un fallo.
gpg --batch --quiet --decrypt --passphrase-file /root/.sigev_backup_pass \
    /root/backup-pre-m4a-files-$(date +%F).tar.gz.gpg \
  | tar -tzf - | wc -l
# tiene que dar un número mayor a 0 (la cantidad de archivos del tar)
```

Este tar **sirve para A y para B por igual**: entre el paso 1 y el paso 6, lo único
que se escribe en esos directorios es el PDF del recibo de prueba del paso 5, que el
propio paso 6 borra. Restaurar archivos es, en cualquiera de los dos casos:

```bash
gpg --batch --quiet --decrypt --passphrase-file /root/.sigev_backup_pass \
    /root/backup-pre-m4a-files-AAAA-MM-DD.tar.gz.gpg \
  | tar -xzf - -C /var/sigev
```

##### 1.4 Restaurar A — rollback completo (base + código)

Se usa **sólo** si el deploy en sí falló. Son cuatro cosas, en este orden:

```bash
# 1. La base: el dump trae DROP DATABASE + CREATE DATABASE + USE adentro, así que
#    NO se le pasa el nombre de la base al cliente.
gpg --batch --quiet --decrypt --passphrase-file /root/.sigev_backup_pass \
    /root/backup-pre-m4a-AAAA-MM-DD.sql.gz.gpg \
  | gunzip \
  | mysql

# 2. Los archivos, si el paso 6 llegó a correr (ver 1.3).

# 3. El código, al commit anotado en 1.2.
cd /root/dev/ciudadela
git checkout <sha-anotado>
npm ci && npm run build

# 4. El proceso.
pm2 restart sigev --update-env && pm2 save
```

**Para volver a desplegar después de un rollback A**, primero `git checkout main`.
El `git checkout <sha>` deja el repo en HEAD suelto (detached), y `deploy.sh` arranca
con `git pull --ff-only`, que en ese estado aborta con "You are not currently on a
branch" — un error de git que no tiene nada que ver con lo que fuiste a arreglar.
El rollback en sí anda perfecto en HEAD suelto; lo que no anda es el siguiente deploy.

Si después del restore la app no conecta a la base, mirá los permisos del usuario de
la aplicación (`SHOW GRANTS FOR 'sigev'@'localhost';`): la base se recreó desde cero.
Y ojo con el `.env`: `RECEIPTS_DIR` (paso 2) queda escrito y a la versión vieja no le
molesta, pero el `git checkout` a un commit anterior **no** deshace nada del `.env`.

##### Cuándo se borran los backups

Cuando el paso 9 haya dado los tres números esperados y alguien haya mirado el panel.
Ahí sí, todos:

```bash
shred -u /root/backup-pre-m4a-*.sql.gz.gpg \
         /root/backup-pre-m4a-files-*.tar.gz.gpg \
         /root/backup-post-migracion-*.sql.gz.gpg
```

Cifrados o no, ahí adentro están el padrón entero y las fotos de DNI, y `/root` no es
donde tienen que vivir.

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

`/var/sigev/recibos` **ya está contemplado en `scripts/backup.sh`** (el tar empaqueta
`uploads` y `recibos`), así que cuando ese script se instale no hay que tocarlo.

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

#### 4 bis. Backup B — la foto que necesitan los pasos 6, 7 y 8

Ahora sí: el esquema ya es el de M4, la app anda y **todavía no se tocó ningún
dato**. Ésta es la única foto desde la que se puede volver de la limpieza y de los
imports, y es la que hay que tomar antes de seguir.

```bash
mysqldump --single-transaction --routines sigev \
  | gzip \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file /root/.sigev_backup_pass \
        -o /root/backup-post-migracion-$(date +%F).sql.gz.gpg

gpg --batch --quiet --decrypt --passphrase-file /root/.sigev_backup_pass \
    /root/backup-post-migracion-$(date +%F).sql.gz.gpg \
  | gunzip | tail -1
```

Misma verificación que en 1.2: tiene que terminar en `-- Dump completed on …`.
Si no, **no sigas** — a partir del paso 6 no hay vuelta atrás sin este archivo.

Acá sí alcanza el `mysqldump` común, **sin `--databases`**: el esquema del dump y el
esquema de la base van a ser el mismo cuando toque restaurar (entre este punto y el
paso 9 no corre ninguna migración más), así que el `DROP TABLE IF EXISTS` +
`CREATE TABLE` de cada tabla las repone todas, incluidas las siete que estrenó M4, y
`_prisma_migrations` vuelve con la fila de M4 puesta.

**Restaurar B** — el restore es plano, sobre la base migrada, y no hay que tocar el
código ni volver a buildear:

```bash
gpg --batch --quiet --decrypt --passphrase-file /root/.sigev_backup_pass \
    /root/backup-post-migracion-AAAA-MM-DD.sql.gz.gpg \
  | gunzip \
  | mysql sigev
```

(El dump abre con `FOREIGN_KEY_CHECKS=0`, así que el orden en que caen y se recrean
las tablas no importa.) Si el paso 6 ya había borrado archivos, restaurá también el
tar de 1.3. Después del restore, `pm2 restart sigev` por las dudas y volvé a mirar
`/admin/tesoreria`.

**OJO: el restore de B vuelve a prender ASOCIATE.** `asociate_activo` vive en la tabla
`configuration`, y B se tomó en 4 bis, ANTES de apagarlo en 6.0. Un restore plano
deja la clave como estaba entonces: prendida, sin ningún aviso en el panel. Es justo
la ventana que 6.0 existe para cerrar, y se reabre en el momento en que más probable
es que estés por repetir los `DELETE` de 6.2 y 6.3. **Volvé a hacer 6.0 después de
cada restore de B, antes de tipear otro `DELETE`.** Lo mismo vale para cualquier otra
clave de `configuration` que hayas tocado después de 4 bis.

Otra cosa que B deshace y no se ve: los `webhook_events` que Mercado Pago haya
mandado después de 4 bis, y con ellos el `status`/`last_sync_at` de la suscripción
del piloto. MP no reenvía notificaciones que ya respondimos con 2xx. No es grave —el
preapproval en MP no cambia— pero un `status` viejo en la fila del piloto después de
un restore no es un problema, es el restore.

Lo que B deshace es **todo** lo posterior al paso 4: el recibo de prueba del paso 5,
la limpieza del paso 6 y los dos imports. Por eso el runbook junta lo irreversible al
final y pide no usar el panel mientras dure — un cobro en efectivo o una noticia
publicada entre medio también se irían.

#### 5. Un recibo de prueba, sobre el socio 306

Es el único paso que ejercita `RECEIPTS_DIR` de verdad, así que conviene hacerlo.
Cobrale **$ 1 de aporte voluntario al socio 306** —el piloto— y abrí el PDF desde el
detalle del recibo: si los permisos están mal, la pantalla dice "el archivo no está
disponible" y el PDF se regenera al volver a pedirlo. **Dejá sin marcar "enviar el
recibo por email"**: la casilla que cargó el piloto en el wizard es de prueba.

Dos razones para que sea el 306 y no cualquiera:

- Es **adherente**, y a un adherente la pantalla de Efectivo sólo le ofrece aporte
  voluntario y extraordinario (`cashConceptsFor`). Es lo que hay que cobrarle igual.
- Está en el Excel, así que **la poda del paso 7 no lo mira**. Cobrarle a un socio
  que la poda tiene que borrar le crea un pago, y un pago es uno de los motivos por
  los que la poda aborta — y **ninguna acción del panel borra un pago**.

No hace falta anular el recibo: el paso 6 borra el recibo y el pago junto con el
resto de los datos de prueba, y repone el contador de la serie para que el primer
recibo de verdad de la asociación sea el `AAAA-00001`. (Si querés ver la anulación
funcionando, anulalo igual: se borra lo mismo.)

**Cuota no crea ninguna.** Sólo el concepto `fees` imputa períodos y devenga filas de
`fees` (`registerCashPayment` → `allocate`, `src/lib/treasury/service.ts`); el aporte
voluntario y el extraordinario no imputan nada, así que este cobro deja exactamente
un `Payment` y un `Receipt`, y la tabla `fees` sigue vacía hasta el paso 8.

**No probar un cobro por Mercado Pago acá**: el dominio corre con credenciales
productivas desde el 22/08/2026 y eso sería plata de un vecino.

#### 6. Limpieza de los datos de prueba

Lo que hay hoy en el VPS son datos que Mariano cargó él mismo probando el panel y el
wizard: **el padrón definitivo es el Excel** (decisión del 21/08/2026, confirmada el
22/08/2026). Este paso saca las **solicitudes**, la **tesorería de prueba** y los
**socios que no figuran en el padrón**; las fichas que sí figuran se emparejan con
el Excel en el paso 7, que es el que las pisa. Del piloto se conserva **la ficha del
socio 306 y su suscripción de Mercado Pago**; su solicitud y todo lo que colgaba de
ella se borran, porque los datos que tipeó en el wizard son ficticios.

Este paso va **antes** del import por una razón concreta: la poda del paso 7 se
niega a borrar un socio que todavía tenga solicitud, cuenta, suscripción, pago,
cuota o un movimiento cargado a mano, y en el VPS hay socios nacidos de solicitudes
de prueba que no están en el Excel. Si no se limpia primero, el import aborta sin
escribir nada y hay que volver acá igual.

##### 6.0 Cerrar el sistema — antes de tipear el primer `DELETE`

**ASOCIATE está prendido y el sitio es público.** Una solicitud que entre en el medio
de esta limpieza es un vecino de verdad, y las consultas de acá abajo la van a barrer
como si fuera de prueba. El caso concreto: si alguien completa el wizard entre 6.2 y
6.3, queda un `Application` nuevo y una `MpSubscription` con `member_id IS NULL`
—porque el `member_id` se escribe recién al asentar el alta—, o sea **exactamente**
el criterio que borra el `DELETE` de 6.3. Y borrar esa fila **no cancela nada en
Mercado Pago**: se pierde el `preapproval_id` mientras la tarjeta del vecino sigue
debitando todos los meses, sin nadie que sepa a quién devolverle la plata.

1. En `/admin/configuracion`, **destildá el interruptor de ASOCIATE** y guardá. La
   guarda no es cosmética: `createApplicationAction` lee la clave `asociate_activo`
   **sin caché** y rechaza las altas nuevas (`src/app/(public)/asociate/actions.ts`).
2. **Ojo con las solicitudes ya empezadas**: apagar el interruptor cierra las altas
   nuevas, pero **no** frena los pasos 4 y 5 de un wizard en curso, que operan con el
   token de retome sobre una solicitud que ya existe (`docs/05` §2). O sea que una
   solicitud viva todavía puede crear una suscripción de MP mientras hacés esto. Por
   eso la consulta 6.1 **(a)** es un pre-vuelo y no un trámite: si aparece alguna
   solicitud que no sea de prueba, **frená** y resolvela antes de seguir.
3. **Nadie usa el panel** desde acá hasta que el paso 9 dé bien: ni cobros en
   efectivo, ni altas, ni noticias. Todo lo que se cargue en el medio se lo lleva
   puesto el restore del backup B si algo sale mal.
4. **ASOCIATE se vuelve a prender recién después del paso 9.** Anotalo: es fácil
   dejarlo apagado y enterarse por un vecino.

Abrí **una sesión interactiva** y hacé todo desde ahí: las variables de usuario
(`@…`) viven en la conexión y se pierden entre invocaciones de `mysql -e`.

```bash
mysql sigev
```

```sql
-- `SELECT … INTO` con CERO filas deja la variable como estaba y sólo emite un
-- warning (MySQL 1329): se inicializan en NULL para que un número mal tipeado se
-- vea como NULL y no como el valor de la consulta anterior.
SET @libro1 = NULL;
SET @socio306 = NULL;
SELECT id INTO @libro1 FROM books WHERE `number` = 1;
SELECT member_id INTO @socio306 FROM memberships WHERE book_id = @libro1 AND member_number = 306;
SELECT @libro1 AS libro, @socio306 AS ficha_del_306;
```

Las dos tienen que dar un número. Si `ficha_del_306` viene `NULL`, el piloto no está
en la base y este runbook no describe lo que tenés delante: **frená y averiguá por
qué** antes de borrar nada.

Las consultas de abajo nombran **números de socio e ids**, nunca nombres ni DNIs: la
salida de una sesión así termina pegada en un chat (Ley 25.326, `docs/08`). La única
excepción es la vista previa de 6.5, que sí muestra el nombre —es la que decide un
borrado físico y no hay otra forma de distinguir una ficha de prueba de un vecino de
verdad—: esa salida no se pega en ningún lado.

##### 6.1 Inventario — mirar antes de borrar

**(a) Las solicitudes.**

```sql
SELECT a.id, a.status, a.requested_category, a.wants_debit,
       ms.member_number AS socio, a.preapproval_id,
       a.mp_payment_id_entry, a.entry_amount, a.created_at
FROM applications a
LEFT JOIN memberships ms ON ms.member_id = a.member_id AND ms.book_id = @libro1
ORDER BY a.id;
```

⚠️ **Copiá esta salida y guardala en el legajo del piloto antes de seguir.** En la
fase 4A `mp_payment_id_entry` y `entry_amount` **son** el registro de la cuota de
ingreso: `Payment` y `Receipt` no existían cuando se cobró, así que no hay una fila
de pago que sobreviva a la solicitud. Después del `DELETE`, ese cobro vive en el
panel de Mercado Pago y en el payload crudo de `webhook_events` (que no se borra), y
en ningún otro lado de SIGeV.

**(b) Las suscripciones de Mercado Pago.**

```sql
SELECT s.id, s.preapproval_id, s.status, s.amount, s.plan_id,
       s.application_id, s.member_id, ms.member_number AS socio, s.created_at
FROM mp_subscriptions s
LEFT JOIN memberships ms ON ms.member_id = s.member_id AND ms.book_id = @libro1
ORDER BY s.id;
```

La del piloto es la que tiene `member_id = @socio306`.

**(c) La tesorería cargada a mano.**

```sql
SELECT (SELECT COUNT(*) FROM fees)                   AS cuotas,
       (SELECT COUNT(*) FROM payments)               AS pagos,
       (SELECT COUNT(*) FROM receipts)               AS recibos,
       (SELECT COUNT(*) FROM mp_unmatched_payments)  AS sin_conciliar,
       (SELECT GROUP_CONCAT(CONCAT(`year`, ':', `last`)) FROM receipt_sequences) AS serie;
```

Antes del import de deuda **no puede haber ninguna cuota legítima**: no hay cron de
devengo (es la fase 4C) y la deuda histórica todavía no se cargó. Todo lo que
aparezca acá es el recibo del paso 5 o una prueba anterior.

**(c bis) La corrida de reconocimiento, ANTES de mirar la lista de huecos.**

La consulta (d) tiene la lista de huecos del Excel **escrita a mano**, y ese es su
punto débil: si el archivo que está en el VPS no es el que describe este runbook, la
consulta mira el conjunto equivocado y la poda del paso 7 borra otra cosa. Validalo
contra el Excel real antes de seguir. Salí un momento del `mysql` (o abrí otra
terminal) y corré la versión **sin flags**, que sólo crea los socios que falten y no
toca ninguna ficha existente:

```bash
cd /root/dev/ciudadela
npx tsx scripts/import-padron.ts
cat padron-import-report.txt
```

Tiene que decir `filas: 278 (esperado 278)`, `vigentes: 160 (esperado 160)` y
`huecos (28, esperado 28): 21, 71, 72, 73, 93, 94, 95, 97, 118, …`. **Si alguno de
los tres no coincide, o si la lista de huecos no es la del `IN (…)` de abajo, no
sigas**: el archivo no es el que este runbook describe. Lo que esa corrida **no**
puede decirte está explicado en el paso 7 (ni los avisos de email ni la poda se
calculan sin flags); acá se usa sólo para confirmar el archivo.

**(d) Los socios que la poda va a mirar** — los que están en el libro y **no** en el
Excel, con los mismos siete motivos por los que el script se niega a borrarlos. El
Excel llega hasta el 306 y tiene 28 huecos, así que el conjunto se escribe exacto:

```sql
SELECT ms.member_number AS socio,
       (m.user_id IS NOT NULL)                                            AS cuenta,
       (SELECT COUNT(*) FROM applications     a  WHERE a.member_id  = m.id) AS solicitudes,
       (SELECT COUNT(*) FROM mp_subscriptions s  WHERE s.member_id  = m.id) AS suscripciones,
       (SELECT COUNT(*) FROM payments         p  WHERE p.member_id  = m.id) AS pagos,
       (SELECT COUNT(*) FROM fees             f  WHERE f.member_id  = m.id) AS cuotas,
       (SELECT COUNT(*) FROM memberships      x  WHERE x.member_id  = m.id) AS libros,
       (SELECT COUNT(*) FROM movements        mv WHERE mv.member_id = m.id
          AND NOT (mv.type = 'admission'
                   AND mv.detail = 'import Libro 1 (acta física no digitalizada)')) AS mov_a_mano
FROM memberships ms
JOIN members m ON m.id = ms.member_id
WHERE ms.book_id = @libro1
  AND (ms.member_number > 306
       OR ms.member_number IN (21,71,72,73,93,94,95,97,118,125,132,141,147,158,
                               199,208,214,221,222,223,224,238,239,245,254,263,
                               287,288))
ORDER BY ms.member_number;
```

**Lo esperado son seis filas** —118, 141, 158, 239, 287, 288— con todas las columnas
en `0` salvo `libros = 1`. Ésas son las fichas que la Comisión sacó del libro y las
que la poda borra sin chistar. Cualquier fila de más es un socio de prueba, y
cualquier columna distinta de `0` en cualquier fila hace **abortar** el import:
las dos cosas se resuelven en el paso 6.5.

**(e) Lo que el import va a pisar.**

```sql
SELECT ms.member_number AS socio, m.street_id, m.street_text, m.street_number,
       m.phone, m.birth_date, m.civil_status, m.nationality, m.occupation,
       m.email_status
FROM members m
JOIN memberships ms ON ms.member_id = m.id AND ms.book_id = @libro1
WHERE m.street_text IS NOT NULL OR m.street_number IS NOT NULL OR m.phone IS NOT NULL
   OR m.birth_date IS NOT NULL OR m.civil_status IS NOT NULL
   OR m.nationality IS NOT NULL OR m.occupation IS NOT NULL
ORDER BY ms.member_number;
```

Estas son las fichas con datos que el Excel no trae. **Que se pisen es lo que se
busca** (ver el paso 7), pero la decisión tiene que ser mirada: si alguna fila
resultara ser trabajo bueno de la Comisión y no una prueba, guardala ahora.

**(f) Quiénes pueden producir los avisos de email del import.**

```sql
SELECT ms.member_number AS socio, m.user_id, (m.email IS NOT NULL) AS ficha_con_email
FROM members m
JOIN memberships ms ON ms.member_id = m.id AND ms.book_id = @libro1
WHERE m.user_id IS NOT NULL
ORDER BY ms.member_number;
```

Los tres avisos de email del import (conflicto, "quedaría sin email", "se le mudó la
dirección de ingreso") **sólo pueden salir de un socio con cuenta de acceso**. Ésta
es la lista completa de candidatos, y hoy tiene que ser cortita.

##### 6.2 Las solicitudes de prueba

Qué cuelga de cada una:

```sql
SELECT a.id, a.status,
       (SELECT COUNT(*) FROM documents       d WHERE d.owner_type='application' AND d.owner_id=a.id) AS documentos,
       (SELECT COUNT(*) FROM notifications   n WHERE n.application_id = a.id) AS notificaciones,
       (SELECT COUNT(*) FROM action_tokens   t WHERE t.application_id = a.id) AS enlaces,
       (SELECT COUNT(*) FROM mp_subscriptions s WHERE s.application_id = a.id) AS suscripciones,
       (SELECT COUNT(*) FROM payments        p WHERE p.application_id = a.id) AS pagos
FROM applications a
ORDER BY a.id;

-- Los archivos NO tienen FK: hay que borrarlos del disco a mano.
SELECT d.id, d.owner_id AS solicitud, d.type, d.path
FROM documents d WHERE d.owner_type = 'application' ORDER BY d.owner_id, d.id;
```

Si en la primera lista hubiera alguna solicitud que **no** sea de prueba, no corras
el borrado en bloque: borrá por `id`.

⚠️ **Las notificaciones de la solicitud del piloto son correos que salieron a una
persona real.** Cada fila de `notifications` con `application_id` es la acreditación
del envío exigida por el Art. 5° quater (por eso el modelo guarda el destinatario en
`application_id` cuando el destinatario todavía no era socio). Borrarlas es asumir
que el ingreso del 306 —verificación de email, resultado de la solicitud— deja de
tener constancia en SIGeV. Es la misma pérdida que la de `mp_payment_id_entry` de
más arriba: se acepta porque el alta es de prueba y el legajo queda en la copia de
la consulta 6.1 **(a)**, no porque no importe. Si querés conservarla, copiá también
la salida de `SELECT id, type, via, status, sent_at, application_id FROM
notifications WHERE application_id IS NOT NULL;` antes del `DELETE`.

```sql
START TRANSACTION;
-- Una notificación de solicitud tiene `member_id` NULL (el destinatario todavía no
-- era socio). El FK `ON DELETE SET NULL` le dejaría también `application_id` en
-- NULL: una fila sin dueño, invisible desde cualquier pantalla. Se borran a mano.
DELETE FROM notifications WHERE application_id IS NOT NULL;
DELETE FROM documents     WHERE owner_type = 'application';
DELETE FROM applications;
COMMIT;
```

Los `action_tokens` de la solicitud se van solos (`ON DELETE CASCADE`).

**La suscripción del piloto sobrevive, y no es una casualidad.** El vínculo de
`MpSubscription` con el socio **no pasa por la solicitud**: al asentar el alta, el
sistema le escribe `member_id` a la suscripción (`src/lib/applications/record.ts`),
y el vínculo con Mercado Pago es el `preapproval_id`, que vive en esa misma fila.
El FK `mp_subscriptions.application_id` es `ON DELETE SET NULL`, así que borrar la
solicitud sólo le pone ese puntero en NULL. Verificalo:

```sql
SELECT id, preapproval_id, status, member_id, application_id FROM mp_subscriptions;
```

`member_id` tiene que seguir siendo el del 306 y `application_id` ahora `NULL`.

Lo que **también** sobrevive, y está bien que sobreviva: el movimiento de admisión
del 306 (`Alta vía solicitud web #N`) con su acta, y los asientos de auditoría del
alta. Son el registro institucional del ingreso; que el `#N` que nombran ya no
exista como fila es prolijidad perdida, no un dato perdido.

Y los archivos:

```bash
ls -R /var/sigev/uploads/applications
rm -rf /var/sigev/uploads/applications/*
```

##### 6.3 Las suscripciones que no son la del piloto

⚠️ **Borrar la fila no cancela nada en Mercado Pago.** Desde el 22/08/2026 las
credenciales son productivas: un `preapproval` en estado `authorized` o `pending`
sigue cobrando aunque acá no quede rastro, y sin la fila te quedás sin el
`preapproval_id` para cancelarlo. Copiá los ids de la consulta 6.1 **(b)**, cancelá
en el panel de MP los que estén vivos, y recién entonces:

```sql
SELECT id, preapproval_id, status, member_id FROM mp_subscriptions
WHERE member_id IS NULL OR member_id <> @socio306;

DELETE FROM mp_subscriptions WHERE member_id IS NULL OR member_id <> @socio306;
```

##### 6.4 La tesorería de prueba

Una fila a la vista por cada tabla que se va a vaciar — ninguna se borra a ciegas:

```sql
SELECT r.id, r.number, r.payment_id, r.issued_at, r.voided_at, r.pdf_path FROM receipts ORDER BY r.id;
SELECT p.id, p.type, p.amount, p.paid_at, p.member_id, p.status  FROM payments ORDER BY p.id;
SELECT f.member_id, f.period, f.status, f.origin                 FROM fees ORDER BY f.member_id, f.period;
SELECT u.id, u.mp_payment_id, u.amount, u.paid_at, u.status, u.payment_id
  FROM mp_unmatched_payments u ORDER BY u.id;
SELECT `year`, `last` FROM receipt_sequences ORDER BY `year`;
```

Las dos últimas tienen que estar vacías o traer sólo el rastro del paso 5.
`mp_unmatched_payments` es la bandeja de la conciliación de MP y en la fase 4A
**ningún código la escribe** (grep: sólo la toca el cliente generado de Prisma), así
que tiene que venir vacía. `receipt_sequences` puede tener a lo sumo una fila, la
del año en curso, con `last` igual a la cantidad de recibos que emitiste en el paso 5
—normalmente `1`—. **Cualquier otra cosa es un dato que este runbook no previó: pará
y miralo antes de borrar.**

El orden del borrado no es negociable: `receipts.payment_id` es `ON DELETE
RESTRICT`, así que un pago con recibo no se borra hasta que el recibo no esté.

```sql
START TRANSACTION;
DELETE FROM receipts;
DELETE FROM fees;
DELETE FROM mp_unmatched_payments;
DELETE FROM payments;
-- El contador vuelve a cero para que el PRIMER recibo real sea el AAAA-00001.
-- La serie no se renumera nunca (REG-33) una vez que empezó a emitir recibos de
-- verdad; todavía no empezó, y ésta es la única ventana en que reponerla es
-- correcto. La fila la recrea sola el próximo recibo
-- (`INSERT … ON DUPLICATE KEY UPDATE`, `src/lib/treasury/receipt-number.ts`).
DELETE FROM receipt_sequences;
COMMIT;
```

Los PDFs que quedaron en disco:

```bash
ls -R /var/sigev/recibos
rm -rf /var/sigev/recibos/*
```

##### 6.5 Los socios de prueba que no están en el Excel

Volvé a correr la consulta 6.1 **(d)**. Si ahora da exactamente las seis filas
esperadas con todo en `0`, ya está: pasá al paso 7. Si queda alguna fila de más —un
socio nacido de una solicitud de prueba, o dado de alta por acta— hay que borrarla a
mano, porque **la poda no puede**: ese socio tiene un `Movement` de admisión con
detalle `Alta vía solicitud web #N`, que no es el que escribió el import, y
probablemente una cuenta de acceso. Los dos son motivos de aborto.

Para cada número `N` que sobre, uno por vez:

```sql
-- Reemplazá `N` por el número de socio de la fila que sobra.
--
-- Los NULL primero, y no son decorativos: `SELECT … INTO` con CERO filas no falla
-- ni corta la sesión, sólo deja un warning (MySQL 1329) y **conserva el valor
-- anterior** de la variable. Como este bloque se corre una vez por socio que sobra,
-- un número mal tipeado en la segunda vuelta dejaría @vict apuntando al socio que ya
-- borraste, y las vistas previas —que hasta ahora imprimían `id`, no `member_number`—
-- no lo delataban. Inicializadas en NULL, un número que no existe se ve como NULL.
SET @vict = NULL;
SET @cuenta = NULL;
SELECT member_id INTO @vict FROM memberships WHERE book_id = @libro1 AND member_number = N;
SELECT @vict AS ficha;   -- si viene NULL, ese número no está en el libro: revisá el número
-- Cerrojo contra el dedazo más caro de esta sección: el piloto. Si esta línea dice
-- "ES EL PILOTO", no sigas — la vista previa de abajo mostraría su nombre, pero esto
-- no depende de que alguien lo lea.
SELECT IF(@vict = @socio306, 'ES EL PILOTO: NO SIGAS', 'ok') AS guarda_piloto;

-- La vista previa dice el NÚMERO DE SOCIO, el NOMBRE y los ROLES de la cuenta.
-- El número, para que se vea que es el que tipeaste. El nombre, porque acá se borra
-- físicamente y es lo único que distingue una ficha de prueba de un vecino de
-- verdad (es la excepción a la regla de no mostrar datos personales en esta sesión:
-- no pegues esta salida en ningún lado). Los roles, por lo que dice abajo.
SELECT ms.member_number AS socio, m.full_name AS nombre,
       m.id, m.user_id, m.status, m.category, m.joined_at, m.created_at,
       (SELECT GROUP_CONCAT(r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = m.user_id) AS roles_de_la_cuenta
FROM members m
JOIN memberships ms ON ms.member_id = m.id AND ms.book_id = @libro1
WHERE m.id = @vict;

SELECT id, type, date, detail   FROM movements     WHERE member_id = @vict;
SELECT id, purpose              FROM action_tokens WHERE member_id = @vict;
SELECT id, type, sent_at        FROM notifications WHERE member_id = @vict;
SELECT id, status, created_at   FROM applications  WHERE member_id = @vict;
SELECT id, book_id, member_number FROM memberships WHERE member_id = @vict;
```

Miralo antes de borrar: si esa ficha resultara ser un socio de verdad que la
Comisión dio de alta y se olvidó de poner en el Excel, la salida correcta es la 2 o
la 3 del paso 7, no ésta.

⚠️ **Si `roles_de_la_cuenta` dice `admin` o `superadmin`, no borres nada.** Los roles
en este proyecto son **acumulables**: una cuenta puede ser `socio` y `admin` a la
vez, y en un VPS que se usó para probar el panel es perfectamente posible que la
cuenta de gestión de alguien haya quedado colgada de una ficha de prueba. Es la misma
regla que 6.6 (*"las de `admin` y `superadmin` no las toques"*), y acá importa más,
porque el `DELETE FROM users` de abajo se lleva la cuenta entera con sus roles por
CASCADE. Si aparece una así: desenganchá primero la cuenta de la ficha
(`UPDATE members SET user_id = NULL WHERE id = @vict;`, y `SET @cuenta = NULL;` para
que el borrado no la toque), y recién entonces borrá la ficha.

Y si la lista de `applications` no vino vacía, es porque en 6.2 tomaste la rama
"borrá por `id`": el FK `applications.member_id` es `ON DELETE SET NULL`, así que
borrar la ficha **no** se lleva la solicitud, la deja huérfana —y el paso 9 te la va
a contar en `solicitudes`—. El bloque de abajo la borra; si preferís no pensar en
esto, la salida más simple es haber usado la forma en bloque de 6.2.

```sql
SELECT user_id INTO @cuenta FROM members WHERE id = @vict;
SELECT @cuenta AS cuenta_a_borrar;   -- NULL si la ficha no tenía cuenta: está bien

START TRANSACTION;
-- La solicitud del socio, si sobrevivió a 6.2 (rama "por id"). Va primero porque
-- sus notificaciones y sus documentos cuelgan de ella, no de la ficha.
DELETE FROM notifications WHERE application_id IN (SELECT id FROM applications WHERE member_id = @vict);
DELETE FROM documents     WHERE owner_type = 'application'
                            AND owner_id IN (SELECT id FROM applications WHERE member_id = @vict);
DELETE FROM applications  WHERE member_id = @vict;   -- sus action_tokens caen por CASCADE
DELETE FROM notifications WHERE member_id = @vict;
DELETE FROM action_tokens WHERE member_id = @vict;
DELETE FROM movements     WHERE member_id = @vict;   -- FK RESTRICT: van antes que la ficha
DELETE FROM memberships   WHERE member_id = @vict;   -- idem
DELETE FROM members       WHERE id = @vict;
-- La cuenta NO se va con la ficha: el FK vive en `members.user_id`, así que borrar
-- el socio deja el `User` intacto —con su contraseña y su rol `socio`— apuntando a
-- la nada. `user_roles` sí cae por CASCADE cuando se borra el usuario.
DELETE FROM users         WHERE id = @cuenta;   -- si no tenía cuenta, @cuenta es NULL y no borra nada
COMMIT;
```

Si esa solicitud tenía documentos, los archivos del disco los borra el `rm -rf` de
6.2 (que vacía `/var/sigev/uploads/applications` entero). Si en 6.2 borraste por
`id` y no corriste ese `rm`, borralos por la ruta que te dio el `SELECT … FROM
documents` de 6.2: en `documents` no hay FK contra el disco.

(Las cuotas y los pagos de esa ficha ya no existen: los borró el paso 6.4. Si por
alguna razón quedaran, `fees` cae por CASCADE y `payments` queda con `member_id`
NULL — un pago cobrado no desaparece porque la ficha salga del libro.)

Hoy la app sólo guarda documentos de **solicitud** (`owner_type = 'application'`),
así que no hay nada que borrar en `documents` por el lado del socio.

##### 6.6 Cuentas de acceso huérfanas

```sql
SELECT u.id, u.active, u.last_login_at,
       (SELECT GROUP_CONCAT(r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = u.id) AS roles
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id);
```

Las que digan sólo `socio` son restos de las pruebas: borralas por `id`
(`DELETE FROM users WHERE id = …`; `user_roles` cae por CASCADE). **Las de `admin` y
`superadmin` no tienen ficha por diseño: no las toques.**

#### 7. Padrón definitivo — `--update-existing --prune --yes`

Con el paso 6 hecho, este comando hace dos cosas destructivas, y las dos son las que
se quieren.

**(a) `--update-existing` pisa las fichas con lo que dice el Excel, incluidos los
campos vacíos — y eso es el objetivo, no un riesgo a esquivar.** Lo que hay hoy en
las fichas del VPS son datos de prueba; el padrón definitivo es el Excel. La corrida
es lo que los limpia.

Medido sobre `datos/padron_socios.xlsx`, esto es lo que el Excel tiene para escribir
en las 278 fichas:

| Columnas | Filas que las traen |
|---|---|
| `dni`, `barrio`, `debito_automatico` | las 278 |
| `deuda_tesoreria` | 116 |
| `email` | 37 |
| `calle`, `altura`, `fecha_nacimiento`, `estado_civil`, `ocupacion` | **3** (socios 14, 15 y 274) |
| `nacionalidad`, `telefono` | **ninguna** |

O sea: nacionalidad y teléfono quedan en blanco en todas las fichas, y domicilio,
fecha de nacimiento, estado civil y ocupación quedan en blanco en todas menos esas
tres. Dos precisiones que la tabla no muestra:

- **`street_id` no está entre las columnas que escribe el import** (`mapPadronRow`
  produce `streetText`, no `streetId`): un domicilio elegido del autocompletado
  sobrevive; el texto libre y la altura, no.
- **`email_status` vuelve a `declarado`** en toda ficha a la que el Excel le traiga
  dirección, mientras que `email_verified_at` no se toca — quedan diciendo cosas
  distintas. Al socio **306**, que confirmó su casilla en el wizard, le pasa esto.
  Se repone mandándole de nuevo el enlace de verificación desde su ficha.

La consulta 6.1 **(e)** ya te mostró, fila por fila, qué hay hoy en esas columnas.

El **email es la única columna con protección**, y sólo a medias: si el Excel no
trae dirección **y el socio ya tiene cuenta de acceso**, la fila entera **no se
actualiza** (dejarlo sin email le dejaría a la cuenta ingresando con una dirección
que ya no figura en ningún lado), y el reporte las cuenta aparte. En una ficha
**sin** cuenta, el email se borra como cualquier otra columna.

**(b) `--prune --yes` borra FÍSICAMENTE los socios del libro que ya no están en el
Excel.** Son seis: **118, 141, 158, 239, 287, 288**, las fichas que la Comisión sacó
del libro en la carga definitiva del 21/08/2026. Pero el criterio del script es
"está en la base y no está en el Excel", no esa lista: **cualquier socio dado de alta
en el VPS y ausente del archivo entra en la poda**. La consulta 6.1 **(d)** es
exactamente ese criterio, y por eso va antes.

El script se defiende: si un socio a podar tiene **cuenta de acceso, solicitud,
suscripción de Mercado Pago, pago, cuota, membresía en otro libro o cualquier
movimiento cargado a mano**, aborta **sin borrar a nadie** y los lista uno por uno
con el motivo. "Sin borrar a nadie" es literal y también es incompleto: la
verificación de la poda corre **después** del loop de actualización, así que para
cuando aborta las 278 fichas ya se pisaron con el Excel y esas escrituras están
commiteadas (ver más abajo, "Si el import aborta"). Si eso pasa, la salida se ve así:

```
IMPORT ABORTADO — ERROR DE DATOS O DE USO: revisá datos/padron_socios.xlsx …
  No se puede podar: estos socios ya no están en el Excel pero tienen datos del sistema.
  No se borró a nadie. Resolvelos a mano desde el panel (o volvelos a poner en el Excel):
    socio 307: tiene cuenta de acceso, 1 solicitud(es)
```

**Las salidas de ese aborto son tres, y "darlo de baja desde el panel" no es
ninguna.** La baja **no** saca la fila de `memberships`: el socio sigue estando en la
base y no en el Excel, así que la corrida siguiente lo vuelve a listar — y encima le
escribe un `Movement` de tipo `withdrawal`, que es justamente uno de los motivos por
los que el script se niega. Lo que sí funciona:

1. **Sacarle los datos del sistema y volver a correr.** Es el paso 6.5, aplicado a
   ese socio.
2. **Volver a ponerlo en el Excel.** Ojo: agregar una fila cambia los totales de
   control (279 ≠ 278) y `--prune` aborta **antes de escribir nada**. Hay que
   actualizar además `EXPECTED_ROWS` / `EXPECTED_ACTIVE` / `EXPECTED_GAPS` en
   `scripts/import-padron.ts`, commitear y desplegar: no es una corrección que se
   haga en el VPS.
3. **Correr sin `--prune`**, sólo con `--update-existing`. El padrón queda al día y
   el socio de más queda en el libro para resolverlo después. La poda no es
   condición para que la tesorería funcione: el import de deuda matchea por número y
   DNI, y un socio de más no le molesta a nadie.

Nunca forzar el borrado por SQL saltando las guardas del script.

**La corrida de reconocimiento, y lo que NO te va a decir.** Es la del paso 6.1
**(c bis)**, que ya corriste antes de mirar la lista de huecos: sin flags el script
sólo crea los socios que falten y no toca ninguna ficha existente.

```bash
cd /root/dev/ciudadela
npx tsx scripts/import-padron.ts
cat padron-import-report.txt
```

Mirá que diga `filas: 278 (esperado 278)`, `vigentes: 160 (esperado 160)` y
`huecos (28, esperado 28)`. **Si alguno no coincide, no sigas**: el archivo no es el
que este runbook describe.

Lo que esa corrida **no** puede mostrarte —y por eso no alcanza como visto bueno—:

- **Los tres avisos de email no salen.** Sin `--update-existing`, el loop hace
  `unchanged++; continue;` sobre cada socio que ya existe y nunca llega a
  `memberWriter.updateMember`, que es quien produce "el email ya pertenece a otra
  cuenta", "el Excel no trae email y el socio ya tiene cuenta" y "se le mudó la
  dirección de ingreso". Los avisos que sí imprime son los del parseo del Excel
  (en este archivo, sólo `baja sin fecha_egreso`; los otros dos de esa familia son
  `sin DNI` y `motivo_baja no mapeado`), que se calculan sobre el archivo y no
  dependen de la base. **Un reconocimiento sin avisos de email
  no significa que no haya conflictos.** El pre-vuelo de eso es la consulta 6.1
  **(f)**: esos avisos sólo pueden salir de un socio con cuenta de acceso.
- **La poda no se calcula.** Sin `--prune` el script ni mira qué socios sobran; la
  línea del reporte dice `poda: no se pidio`. El pre-vuelo de eso es la consulta 6.1
  **(d)**.

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

- `socio N: baja sin fecha_egreso` para **5, 10, 20, 31, 32, 99 y 282**. El libro de
  papel no la tiene. Tres de los siete arrastran algo más:
  - **31 y 32** están de baja **sin motivo**: el Excel deja la celda vacía y quedan
    con motivo nulo.
  - **282** es la ficha más contradictoria del archivo: categoría **Activo**,
    `activo = No`, motivo **Fallecido** y **sin `fecha_egreso`**. Y es además el
    **único de los 278 cuya categoría no coincide entre los dos libros de trabajo**:
    `padron_socios.xlsx` dice Activo y `deuda.xlsx` dice Adherente. No frena nada
    —282 no tiene deuda, y el import de deuda matchea por número y DNI, no por
    categoría—, pero es una contradicción del papel que la Comisión tiene que
    resolver. Mientras tanto manda el padrón, que es el que escribe la ficha.

  Los siete son datos que la Comisión tiene que completar desde el panel; ninguno
  frena nada.
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

**Si el import aborta en la poda, leé la CONSOLA y no el archivo del reporte.**

El aborto por socios no podables (el de más arriba) es el único que ocurre **con
escrituras ya hechas**, y eso cambia qué hay que mirar:

- **Las 278 fichas ya se actualizaron.** El loop commitea socio por socio y la
  verificación de la poda corre después. Volver a correr el import corregido es
  seguro —es idempotente—, pero el padrón ya está pisado desde el primer intento.
- **`padron-import-report.txt` quedó VIEJO.** El `writeFileSync` del reporte está
  después de la poda: en un aborto nunca se ejecuta, así que el archivo sigue siendo
  el de la corrida de reconocimiento del paso 6.1 **(c bis)**. Leerlo y creer que
  describe lo que acaba de pasar es el error fácil de cometer acá. **`cat` de ese
  archivo no sirve después de un aborto.**
- **Lo único que hay es la salida de consola**, y es un resumen: la línea
  `progreso antes de abortar: creados …, actualizados …, sin cambios …, salteados …`.
  Copiala. Los avisos individuales de esa corrida —los que se acumulan en memoria
  para el reporte— **se pierden con el aborto**: no van a la consola ni al archivo.
- **El que más duele perder es `el Excel le cambió el email y el socio ya tiene
  cuenta de acceso — ahora INGRESA con la dirección nueva`.** Ese aviso es de **una
  sola vez**: en la corrida siguiente la ficha ya tiene el email del Excel, el writer
  ve las dos direcciones iguales y no lo vuelve a emitir (`syncAccountEmail` sale por
  `sameAddress`, `src/lib/members/write.ts`). O sea: si se perdió en el aborto, nadie
  se entera nunca de que a ese socio le cambió el nombre de usuario, y hay que
  avisarle por otro medio.
- **El pre-vuelo que lo cubre es la consulta 6.1 (f)**, la lista de socios con cuenta
  de acceso: si la tenés copiada de antes del import, podés comparar la dirección de
  cada uno contra la del Excel y reconstruir a mano a quién se le movió el ingreso.
  Ésa es la razón por la que 6.1 **(f)** se corre y se guarda, y no se mira de paso.

#### 8. Deuda histórica — `scripts/import-deuda.ts`

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
119 | cuotas creadas: 0`. Eso también significa que **corregir el Excel y re-correr
no arregla a quien ya se cargó mal**: hay que corregirlo desde el panel.

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

#### 9. Verificación final de datos

```bash
mysql sigev -e "SELECT COUNT(*) members FROM members;
SELECT COUNT(*) fees_import FROM fees WHERE origin='import';
SELECT COUNT(DISTINCT member_id) deudores FROM fees WHERE status='pending';
SELECT COUNT(*) recibos FROM receipts;
SELECT COUNT(*) solicitudes FROM applications;
SELECT s.id, s.preapproval_id, s.status, s.member_id, x.member_number, s.application_id
  FROM mp_subscriptions s
  LEFT JOIN memberships x ON x.member_id = s.member_id;"
```

Esperado: `members = 278`, `deudores = 119` y `fees_import = 3080` — o 3080 menos
las cuotas que el sistema ya hubiera devengado por su cuenta para esos mismos meses,
que el import saltea y cuenta aparte en la línea `cuotas del Excel que ya existían
devengadas`. Hoy no hay cron de devengo, así que deberían ser 3080 clavadas. Y del
paso 6: `recibos = 0`, `solicitudes = 0` y **una sola fila** de suscripción — la del
piloto, con `member_number = 306`, `status = authorized` y `application_id` en NULL.
La consulta la muestra en vez de contarla a propósito: es la fila que todo este
runbook existe para no romper, y un `COUNT = 1` no dice de quién es.

En el panel: `/admin/tesoreria/deudores` lista a los socios vigentes con deuda
ordenados por monto, y la ficha de un socio con deuda muestra la cinta con las
cuotas importadas. Con eso el módulo está en pie.

Con los números dados y el panel mirado, **volvé a prender ASOCIATE** en
`/admin/configuracion` (lo apagaste en 6.0) y confirmá en la home pública que el
botón volvió. Mientras esté apagado, ningún vecino puede asociarse y nada avisa.

Recién ahora se borran los backups: el A y el tar de archivos del paso 1, y el B del
paso 4 bis (el `shred` está al final del paso 1).

#### 10. Lo que NO entra en este despliegue

La fase 4A **no** toca Mercado Pago: el webhook sigue registrando los pagos sin
aplicarlos a cuotas, no hay links de pago, no hay bandeja de sin conciliar y el
lote de REG-34 no existe. Tampoco hay crons de tesorería: **las cuotas del mes no se
devengan solas todavía** (eso es la fase 4C). Hasta entonces, el crontab del VPS
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
