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

Esta sección se reescribió el **23/08/2026** (fase 4B). Antes era el diario de un
despliegue puntual —el de la fase 4A, con su limpieza de datos de prueba y sus dos
imports fundacionales— y no servía para el siguiente. Ahora tiene el **procedimiento
real**: el deploy normal, el rearmado de la base desde cero, las reglas, y lo
específico de cada fase.

> **El diario completo del despliegue de la fase 4A** (limpieza paso a paso,
> `--prune`, import de deuda, las consultas de control) sigue disponible en el
> historial:
> `git show 61d1b11:docs/10-runbook-dominio-produccion.md`.
> No se repite acá porque **corrió una sola vez** y ya no se puede volver a correr:
> hoy la base tiene datos reales.

### 4.0 Antes del PRIMER `deploy.sh` sobre una base con socios reales

`deploy.sh` corre `npx prisma db seed` en cada despliegue. Antes de que eso pase
por primera vez sobre la base con los socios reales, verificá a mano que el `.env`
del VPS no pida las cuentas de prueba:

```bash
grep -n 'SEED_TEST_USERS\|SEED_ALLOW_TEST_USERS' /root/dev/ciudadela/.env
```

**Lo que tiene que devolver**: nada, o a lo sumo `SEED_TEST_USERS="false"`.
`SEED_ALLOW_TEST_USERS` no debe aparecer.

Por qué importa: `admin.prueba@sigev.local` es una cuenta **con rol admin y
contraseña conocida**. Sembrarla en producción es un backdoor de administrador
sobre el padrón real. Hoy el código ya falla cerrado —las cuentas de prueba exigen
el opt-in explícito `SEED_ALLOW_TEST_USERS="true"` (`prisma/seed-guard.ts`) y
`deploy.sh` corre el seed con `NODE_ENV=production`, que las prohíbe aunque el
opt-in estuviera—, así que el `grep` es la tercera capa, no la única. Se hace igual:
diez segundos contra el peor resultado posible.

### 4.1 Despliegue normal (cambios de código + migraciones)

Es lo que se hace **siempre**. Es repetible y no destruye nada.

**Backup primero.** Siempre, aunque la migración parezca inofensiva:

```bash
mysqldump --single-transaction --routines sigev \
  | gzip \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file /root/.sigev_backup_pass \
        -o /root/backup-pre-deploy-$(date +%F).sql.gz.gpg

gpg --batch --quiet --decrypt --passphrase-file /root/.sigev_backup_pass \
    /root/backup-pre-deploy-$(date +%F).sql.gz.gpg | gunzip | tail -1
```

La última línea tiene que decir `-- Dump completed on …`. Si no, **no sigas**.

**El deploy**, en una sola línea copiable:

```bash
cd /root/dev/ciudadela && git pull --ff-only && npm ci && npx prisma migrate deploy && NODE_ENV=production npx prisma db seed && npm run build && pm2 restart sigev --update-env && pm2 save && pm2 logs sigev --lines 20 --nostream
```

Es lo que hace `bash deploy.sh`, más el `pm2 logs … --nostream` del final, que el
script no incluye. Paso por paso:

| Paso | Por qué |
|---|---|
| `git pull --ff-only` | nunca un merge en el VPS |
| `npm ci` | **sin** `--omit=dev`: `prisma` y `tsx` son devDependencies |
| `prisma migrate deploy` | aplica lo que falte. **Nunca `db push`** |
| `db seed` | claves nuevas de `configuration`; es idempotente y no pisa lo cargado |
| `npm run build` | acá se **hornean** `AUTH_URL` y `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| `pm2 restart --update-env` | sin `--update-env` no toma los cambios del `.env` |

**Restaurar** si algo sale mal. Ojo con cuál: la falla peligrosa **no** es tipear
mal el nombre —un archivo que no existe falla cerrado y no pasa nada— sino **elegir
el backup equivocado**. Uno viejo que sí existe se restaura sin chistar sobre la
base viva y se lleva puesto todo lo posterior. Por eso primero se **listan** los
candidatos, después se fija el elegido **en su propia variable**, y recién al final
se toca la base.

```bash
# 1. Qué backups hay, con su fecha. Elegí mirando, no de memoria.
ls -lh --time-style=long-iso /root/backup-pre-deploy-*.sql.gz.gpg
```

```bash
# 2. Fijá el elegido. El caso normal es el de hoy: el deploy salió mal recién.
export RESTORE_FILE=/root/backup-pre-deploy-$(date +%F).sql.gz.gpg
echo "$RESTORE_FILE"
```

Si el que querés es **otro**, esta es la única línea que se edita a mano, y el
nombre se copia **tal cual lo mostró el paso 1**:

```bash
export RESTORE_FILE=/root/backup-pre-deploy-2026-08-19.sql.gz.gpg
echo "$RESTORE_FILE"
```

```bash
# 3. Verificá que ES el que creés: tiene que descifrar y decir cuándo se tomó.
test -s "$RESTORE_FILE" && gpg --batch --quiet --decrypt \
    --passphrase-file /root/.sigev_backup_pass "$RESTORE_FILE" \
  | gunzip | tail -1
```

La salida tiene que decir `-- Dump completed on …` **con la fecha y la hora del
backup que querés restaurar**. Si no descifra, si no dice eso, o si la fecha no es
la que esperabas, **frená acá**: todavía no se tocó nada.

```bash
# 4. Recién ahora, y sólo ahora, sobre la base viva.
test -s "$RESTORE_FILE" && gpg --batch --quiet --decrypt \
    --passphrase-file /root/.sigev_backup_pass "$RESTORE_FILE" \
  | gunzip | mysql sigev && pm2 restart sigev --update-env
```

El `test -s "$RESTORE_FILE" &&` de los pasos 3 y 4 es a propósito: si pegás el
bloque en una terminal nueva —donde el `export` del paso 2 no existe— o el archivo
no está, la condición es falsa y **nada de lo que sigue corre**. Es la regla de 4.3
aplicada al único bloque destructivo del documento.

Y volvé el código al commit anterior (`git log --oneline -5` antes de tirar del
pull te da a cuál).

> **Ojo con volver el código atrás desde el calendario de actividades.** Volver
> a un commit anterior a los cuatro espacios sólo es seguro **mientras no exista
> ninguna actividad de Cocina ni de Aulas**. En cuanto se cargue la primera, el
> código viejo arma la grilla con `historic` y `glass` nada más y esa fila le
> hace devolver **500 a `/actividades`**; el enum tampoco se revierte limpio con
> filas así en la base. Si ya hay actividades en esos dos espacios y necesitás
> volver atrás igual, primero borralas (o pasalas a un salón) desde
> `/admin/actividades`.

### 4.2 Rearmar la base desde cero (lo que se hizo el 22/08/2026)

**Cuándo se usa**: sólo para la **carga fundacional**, cuando lo que hay en el VPS
son datos de prueba y el padrón de verdad viene del Excel. **Ya se hizo una vez.**
Con datos reales cargados —278 socios, 3076 cuotas, recibos emitidos— **esto no se
vuelve a correr nunca**: no hay "des-importar".

Lo único que sobrevive son **seis tablas**: `configuration`, `users`, `roles`,
`user_roles`, `activities` y `news`. Las dos últimas son contenido cargado a mano
desde el panel — no hay archivo en `datos/` que las reponga, y así se perdieron las
actividades de prueba en el rearmado del 22/08/2026. Todo lo demás se rehace desde
los archivos de `datos/`. La suscripción del piloto **no** se rescata a propósito:
vuelve a aparecer en "Sin vincular" y se vincula desde el panel, que es el camino
que la fase 4B dejó hecho.

**Antes de tipear nada**: apagá ASOCIATE desde `/admin/configuracion` y no uses el
panel hasta terminar. Una solicitud que entre en el medio es de un vecino de verdad
y se la lleva puesta el rearmado.

**Paso 1 — Backup cifrado, verificado.** El de 4.1, pero además el tar de archivos,
que ningún otro backup cubre:

```bash
export STAMP=$(date +%F)

mysqldump --single-transaction --routines --databases sigev \
  | gzip \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file /root/.sigev_backup_pass \
        -o /root/backup-pre-rearmado-$STAMP.sql.gz.gpg

gpg --batch --quiet --decrypt --passphrase-file /root/.sigev_backup_pass \
    /root/backup-pre-rearmado-$STAMP.sql.gz.gpg | gunzip | tail -1

install -d -m 750 /var/sigev/recibos
tar czf /root/backup-archivos-$STAMP.tar.gz -C /var/sigev uploads recibos
tar tzf /root/backup-archivos-$STAMP.tar.gz | wc -l
```

El `tail -1` tiene que decir `-- Dump completed on …` y el `wc -l`, un número mayor
que 0. **Si alguna de las dos falla, frená acá.**

**Paso 2 — Copiar las seis tablas a una base de rescate.** Abrí una sesión
interactiva (`mysql`) y dejala abierta hasta el paso 10: los pasos 2, 3, 5 y 10 son
SQL de la misma secuencia, y conviene correrlos de a uno con los conteos a la vista
para poder **frenar** en cuanto un número no dé.

```sql
CREATE DATABASE IF NOT EXISTS sigev_rescate
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE sigev_rescate.configuration LIKE sigev.configuration;
CREATE TABLE sigev_rescate.users         LIKE sigev.users;
CREATE TABLE sigev_rescate.roles         LIKE sigev.roles;
CREATE TABLE sigev_rescate.user_roles    LIKE sigev.user_roles;
CREATE TABLE sigev_rescate.activities    LIKE sigev.activities;
CREATE TABLE sigev_rescate.news          LIKE sigev.news;

INSERT INTO sigev_rescate.configuration SELECT * FROM sigev.configuration;
INSERT INTO sigev_rescate.users         SELECT * FROM sigev.users;
INSERT INTO sigev_rescate.roles         SELECT * FROM sigev.roles;
INSERT INTO sigev_rescate.user_roles    SELECT * FROM sigev.user_roles;
INSERT INTO sigev_rescate.activities    SELECT * FROM sigev.activities;
INSERT INTO sigev_rescate.news          SELECT * FROM sigev.news;

SELECT (SELECT COUNT(*) FROM sigev_rescate.configuration) AS config,
       (SELECT COUNT(*) FROM sigev_rescate.users)         AS usuarios,
       (SELECT COUNT(*) FROM sigev_rescate.roles)         AS roles,
       (SELECT COUNT(*) FROM sigev_rescate.user_roles)    AS user_roles,
       (SELECT COUNT(*) FROM sigev_rescate.activities)    AS actividades,
       (SELECT COUNT(*) FROM sigev_rescate.news)          AS noticias;
```

**Anotá esos seis números.** Son los que tienen que volver en el paso 5.

**Paso 3 — Base nueva.** Recién con los números anotados:

```sql
DROP DATABASE sigev;
CREATE DATABASE sigev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

**Paso 4 — Esquema.** Sólo migraciones; el seed va **después** de restaurar, para
que reponga las claves nuevas sin pisar las cargadas:

```bash
cd /root/dev/ciudadela && npx prisma migrate deploy
```

**Paso 5 — Restaurar las seis tablas.** El orden respeta las claves foráneas
(`user_roles` cuelga de las otras dos, y `news` de `users` por su `author_id`;
`activities` no cuelga de nada). **No hay `TRUNCATE` ni
`SET FOREIGN_KEY_CHECKS = 0`**: el paso 3 dejó la base vacía y ninguna migración
inserta filas, así que vaciarlas sería redundante — y un bloque copiable que borra
`users` y `configuration` es exactamente lo que no queremos que ande dando vueltas
en el documento por si alguien lo corre fuera de orden. Si acá algún `INSERT` se
queja de una clave duplicada, **frená**: significa que no estás sobre la base que
creaste en el paso 3.

```sql
INSERT INTO sigev.roles         SELECT * FROM sigev_rescate.roles;
INSERT INTO sigev.users         SELECT * FROM sigev_rescate.users;
INSERT INTO sigev.user_roles    SELECT * FROM sigev_rescate.user_roles;
INSERT INTO sigev.configuration SELECT * FROM sigev_rescate.configuration;
INSERT INTO sigev.activities    SELECT * FROM sigev_rescate.activities;
INSERT INTO sigev.news          SELECT * FROM sigev_rescate.news;

SELECT (SELECT COUNT(*) FROM sigev.configuration) AS config,
       (SELECT COUNT(*) FROM sigev.users)         AS usuarios,
       (SELECT COUNT(*) FROM sigev.roles)         AS roles,
       (SELECT COUNT(*) FROM sigev.user_roles)    AS user_roles,
       (SELECT COUNT(*) FROM sigev.activities)    AS actividades,
       (SELECT COUNT(*) FROM sigev.news)          AS noticias;
```

Los seis números tienen que ser los del paso 2.

> **Si un `INSERT … SELECT *` falla por cantidad de columnas**, es que una migración
> nueva le agregó una columna a esa tabla y el rescate tiene el esquema viejo. No es
> un problema del backup: enumerá las columnas comunes en las dos puntas
> (`SHOW COLUMNS FROM sigev.users;` y `SHOW COLUMNS FROM sigev_rescate.users;`) y
> repetí el `INSERT` con la lista explícita. Las columnas nuevas quedan con su
> default, que es lo correcto.

**Paso 6 — Seed.** Ahora sí, para que aparezcan las claves de `configuration` que
los módulos nuevos agregaron y el valor de cuota inicial si la tabla está vacía:

```bash
cd /root/dev/ciudadela && NODE_ENV=production npx prisma db seed
```

**Paso 7 — Datos fundacionales**, en este orden (las calles primero: el padrón las
referencia):

```bash
cd /root/dev/ciudadela
npx tsx scripts/import-calles.ts
npx tsx scripts/import-padron.ts --prune --yes
npx tsx scripts/import-deuda.ts
```

`--prune --yes` borra del libro las fichas que **no** están en el Excel. Sobre una
base recién rearmada no hay ninguna para borrar, pero el flag se deja porque el
script exige que el Excel sea la verdad completa para poder podar, y esa
verificación de totales es la que queremos que corra.

**Paso 8 — Controles.** Los números tienen que dar exactamente esto:

```bash
mysql sigev -e "SELECT COUNT(*) AS socios FROM members;
SELECT COUNT(*) AS calles FROM streets;
SELECT COUNT(*) AS cuotas_import FROM fees WHERE origin='import';
SELECT COUNT(DISTINCT member_id) AS deudores FROM fees WHERE status='pending';
SELECT COUNT(*) AS usuarios FROM users;
SELECT COUNT(*) AS recibos FROM receipts;
SELECT COUNT(*) AS solicitudes FROM applications;
SELECT COUNT(*) AS actividades FROM activities;
SELECT COUNT(*) AS noticias FROM news;"
```

Esperado: **278 socios**, **40 calles**, **3076 cuotas**, **118 deudores**,
0 recibos y 0 solicitudes. `usuarios` no tiene un número fijo: tiene que dar **el
que anotaste en el paso 2**. `actividades` y `noticias` tampoco tienen un número
fijo: tienen que dar los que anotaste en el paso 2.

En el panel: `/admin/tesoreria/deudores` lista a los socios con deuda ordenados por
monto, y `/admin/tesoreria/valores` muestra los dos montos vigentes. Si dice
"Todavía no rige ningún valor", el seed no corrió: sin valor vigente no se puede
cobrar nada.

**Paso 9 — Volvé a prender ASOCIATE** en `/admin/configuracion` y confirmá en la
home pública que el botón volvió. Es fácil dejarlo apagado y enterarse por un
vecino.

**Paso 10 — Recién ahora, la limpieza.** Con los números dados y el panel mirado:

```sql
DROP DATABASE sigev_rescate;
```

y los backups del paso 1 se borran con `shred -u` cuando estés seguro, no antes.

### 4.3 Reglas que no se rompen

- **Nunca un `DELETE` o un `UPDATE` con un placeholder adentro de un bloque
  copiable.** Toda variable va arriba, en su propio `SET @var := …` o
  `export VAR=…`, antes de la sentencia que la usa.
- **Nunca `prisma db push`.** Migraciones siempre, y sólo `migrate deploy`.
- **Nunca un backup sin verificar.** Un `.sql.gz.gpg` que no se puede descifrar y
  cuya última línea no dice `-- Dump completed on …` no es un backup.
- **NO tocar `instances` de PM2.** El sistema asume **un solo proceso**: mutex por
  DNI, mutex por socio y rate limiters viven en memoria (`docs/03`).
- **No se prueban cobros en producción.** Desde el 22/08/2026 el dominio corre con
  credenciales productivas de Mercado Pago: ahí la plata es de un vecino. El
  circuito de pagos se prueba en el sandbox local (`docs/11` Parte J).

### 4.4 Específico de la fase 4B (Mercado Pago)

Es un **despliegue normal** (4.1): dos migraciones, nada destructivo, ningún import.
Lo que tiene de propio es lo de después.

**1. Migraciones que trae**: `20260822230724_add_module_4b_mercadopago` (columnas
nuevas de `mp_subscriptions` y `mp_unmatched_payments`; `plan_id` y `payer_email`
pasan a nullable) y `20260823132536_add_other_income` (tabla `other_incomes`, enum
`IncomeMethod`, cuarto valor `other_income` en `UnmatchedStatus`). Ninguna de las
dos toca `payments`, `fees`, `receipts` ni `receipt_sequences`.

**2. Variables de entorno**: **ninguna nueva**. Pero verificá dos cosas del panel de
Mercado Pago, porque de ellas depende que los débitos avisen (`docs/11` Parte D):

- El webhook productivo apunta a `https://vecinalciudadela.ar/api/webhooks/mp` y
  tiene tildados **"Planes y suscripciones" + "Pagos (legacy)"**. En una aplicación
  de tipo Suscripciones el panel **no ofrece "Pagos" a secas**: "Pagos (legacy)" es
  el tópico `payment` y manda el POST moderno firmado.
- **`MP_WEBHOOK_SECRET` del `.env` es la clave de la solapa productiva.** Si no
  coincide, MP entrega igual y **todo** muere en 401 sin que nada lo diga. Cómo se
  diagnostica: `docs/11` Parte I §8.

**3. Segunda línea del crontab** — la conciliación diaria. Sin ella no hay red si un
aviso de MP se pierde:

```bash
# La línea del secreto tiene que existir ANTES: sin ella el cron manda un Bearer vacío.
test -s /root/.sigev-cron-secret || echo 'FALTA /root/.sigev-cron-secret — pará acá'

crontab -l > /root/crontab.bak

if crontab -l | grep -q 'cron/reconcile'; then
  echo 'La línea de reconcile YA está: no se agrega nada.'
else
  (crontab -l; echo '0 3 * * * curl -sS --max-time 900 -X POST -H "Authorization: Bearer $(cat /root/.sigev-cron-secret)" https://vecinalciudadela.ar/api/cron/reconcile >> /var/log/sigev-cron.log 2>&1') | crontab -
fi

crontab -l
```

El `if` es lo que lo hace **idempotente**: corrido dos veces no deja dos líneas de
reconcile. La versión sin `if` —`(crontab -l; echo …) | crontab -` a secas— duplica
la línea en el segundo intento, y dos conciliaciones simultáneas a las 03:00 no
rompen nada (la idempotencia por `mpPaymentId` aguanta) pero ensucian `cron_runs` y
duplican las llamadas a MP.

Tienen que quedar **dos** líneas: solicitudes 08:05 y conciliación 03:00. El archivo
`/root/.sigev-cron-secret` tiene que existir, con permisos `600` y el mismo valor que
`CRON_SECRET` del `.env`.

> **Al desplegar la 4C esas dos pasan a ser seis** (§4.5, y el bloque completo en
> `docs/11` Parte H). Este párrafo describe el estado tras la 4B, que es lo que
> había en el VPS al escribirlo.

**4. Vincular las dos suscripciones preexistentes**, desde
`/admin/tesoreria/suscripciones` (hace falta **superadmin**):

- `a69d4b7c9e65472bb46c0489897880af` → socio **14**
- `fa4a1ba0102c4c0d9fc772920154ed5c` → socio **306**

Verificación: el bloque "Vinculadas" muestra $6.000 y $3.000, sin badge de
divergencia. Es un paso del checklist de lanzamiento de `docs/07`.

**5. Correr la conciliación una vez a mano** y leer el resumen:

```bash
curl -sS --max-time 900 -X POST \
  -H "Authorization: Bearer $(cat /root/.sigev-cron-secret)" \
  https://vecinalciudadela.ar/api/cron/reconcile -w '\nHTTP %{http_code}\n'
```

- **HTTP 200** = sin errores. **HTTP 207** = corrió entera pero algo falló, y el
  motivo está en `errors[]`. 207 no es "casi bien".
- **Un `524` no es un fallo de la corrida.** El `--max-time 900` es del `curl`, pero
  el dominio está detrás de Cloudflare, que corta el origen a los ~100 s. Con dos
  suscripciones vivas la corrida termina en segundos y no se llega ni cerca; el día
  que sean cientos, el `curl` puede volver con 524 **mientras la corrida sigue del
  lado del servidor**. No la relances: el resultado real queda en `cron_runs`.
- **Esto además cierra el único punto que no se pudo verificar en sandbox**: que
  `GET /v1/payments/search` **indexe** (en sandbox devuelve `total=0` aun sin
  filtros). Si el paso 1 responde sin error y con totales coherentes, el paso 1 de
  la conciliación queda confirmado. Anotalo.

**6. Mirar las pantallas nuevas**: `/admin/tesoreria` tiene ahora **Sin conciliar**,
**Suscripciones** y **Otros ingresos** además de Deudores, Efectivo, Recibos y
Valores; y la ficha de un socio con débito muestra su suscripción viva en la pestaña
Cuenta corriente.

**7. Lo que NO hay que hacer**: probar un cobro. El débito del socio 14 del
**10/09** es la verificación real, y tiene que entrar solo: `Payment.debit` + cuota
2026-09 + recibo + email. Si el webhook no llega, el reconcile de las 03:00 del
11/09 lo registra igual — para eso está.

### 4.5 Específico de la fase 4C (crons, notificaciones, salud, padrón electoral)

Es un **despliegue normal** (4.1): una migración aditiva, dos variables opcionales,
ningún import y ningún dato que se toque. Lo que tiene de propio es lo de después
— y una fecha.

> **La fecha dura: el cron de devengo tiene que estar arriba antes del
> 01/10/2026.** Hasta esa fecha no hay ningún mes devengable (la foto de deuda
> cubre hasta agosto y septiembre recién vence el 01/10), así que desplegar antes
> **no crea nada** y es lo correcto. Desplegar **después** tampoco rompe nada: la
> primera corrida backfillea sola desde el piso de cobertura, así que un deploy del
> 05/11 crea septiembre **y** octubre en una sola pasada. Lo que sí es un problema
> es no desplegarlo: mientras el cron no esté en el crontab, los socios al día se
> muestran "al día" debiendo septiembre, porque no hay fila que contar.

**1. Migración que trae**: `20260824101648_add_module_4c_notifications`. Es
**estrictamente aditiva** —una columna nullable (`notifications.period CHAR(7)`) y
cuatro índices—, sin un solo `DROP` ni `MODIFY`. Verificada contra la base local por
`information_schema`, no sólo por `migrate status`. No toca `payments`, `fees`,
`receipts` ni `receipt_sequences`.

**2. Variables de entorno**: dos, y **ninguna es obligatoria** (las dos tienen
default). Se agregan al `.env` del VPS antes del build:

```bash
cd /root/dev/ciudadela
grep -q '^BACKUP_DIR='     .env || echo 'BACKUP_DIR=/var/sigev/backups' >> .env
grep -q '^MAIL_BATCH_CAP=' .env || echo 'MAIL_BATCH_CAP=50'            >> .env
grep -n 'BACKUP_DIR\|MAIL_BATCH_CAP' .env
```

- **`BACKUP_DIR`** tiene que ser **la misma carpeta que escribe `scripts/backup.sh`**
  (`WORK=/var/sigev/backups`, línea 12), porque lo que la pantalla lee es el sello
  `LAST_OK` que ese script deja ahí. Si no está, `/admin/salud` dice **"Sin
  configurar"** y no puede afirmar nada sobre el backup; si apunta a otra carpeta,
  dice **"Sin rastro"**, que es peor porque parece un backup roto.
- **`MAIL_BATCH_CAP`** es el tope de correos **por corrida** (default 50; un 0 o
  basura cae al default). No es un tope de cobros: el presupuesto se consume siempre
  río abajo de la escritura del dinero.
- **`digest_recipients` NO es una variable de entorno.** Se carga desde
  `/admin/configuracion` (paso 4), como los ids de plan de Mercado Pago: cambiar
  quién recibe el resumen no puede exigir un deploy ni un `pm2 restart`.

**3. El deploy**, que es el de 4.1 sin nada agregado (backup previo primero):

```bash
cd /root/dev/ciudadela && git pull --ff-only && npm ci && npx prisma migrate deploy && NODE_ENV=production npx prisma db seed && npm run build && pm2 restart sigev --update-env && pm2 save && pm2 logs sigev --lines 20 --nostream
```

Después del restart, **en este orden**:

**4. `/admin/salud` por primera vez** (hace falta **superadmin**; un admin común ve
una pantalla de bloqueo y ni siquiera tiene la sección en la lateral). Lo que tiene
que verse recién desplegado:

- `reconcile` y `applications` con su última corrida — `applications` empieza a
  escribir `cron_runs` en esta fase, así que su primera fila aparece recién con la
  corrida de las 08:05 del día siguiente;
- `accrual`, `reminder` y `digest` en **"Nunca corrió"**: es lo correcto antes de
  agregar las líneas del crontab;
- el backup en **"Al día"**. Si dice "Sin configurar", faltó `BACKUP_DIR` (paso 2);
  si dice "No se puede leer", el sello está pero el proceso de la app no tiene
  permiso sobre la carpeta — ahí lo roto son los permisos de la pantalla, no el
  backup. Si dice **"Sin rastro"**, comprobalo a mano antes de sacar conclusiones:
  `ls -l /var/sigev/backups/LAST_OK`. El sello lo escribe la versión del script que
  está en el repo desde el 17/08/2026; si el VPS quedó con una copia anterior, el
  archivo no existe y hay que actualizar el script, no el backup.

**5. Cargar `digest_recipients`** en `/admin/configuracion` (superadmin) con la
dirección de la Comisión. **Vacío = el resumen no se manda a nadie**, y la corrida
igual cierra en verde: `recipients: 0` no es un fallo.

**6. Las líneas del crontab** — el bloque idempotente de `docs/11` Parte H, "El
crontab final: seis líneas". Tienen que quedar **seis**: `reconcile` 03:00, backup
04:00, `applications` 08:05, `accrual` 00:30, `digest` 07:30 y `reminder` 10:00.

**7. Prueba en seco de los tres endpoints nuevos**, sin esperar al horario:

```bash
export S=$(cat /root/.sigev-cron-secret)
for j in accrual reminder digest; do
  echo "== $j"
  curl -sS -X POST -H "Authorization: Bearer $S" \
    "https://vecinalciudadela.ar/api/cron/$j" -w '\nHTTP %{http_code}\n'
done
```

`accrual` y `reminder` van a responder `{"skipped":"not_first_day"}` y
`{"skipped":"not_last_day"}` cualquier día que no sea el suyo, y **eso es lo
correcto**: prueban que el endpoint existe, que el secreto es el bueno y que la
guarda del día funciona. Los dos `skipped` no escriben en `cron_runs`, así que no
ensucian `/admin/salud`.

**`digest` es la excepción y conviene saberlo antes de tocarlo**: no tiene guarda de
calendario. Si el día anterior hubo alguna novedad, esta llamada **manda el resumen
de verdad** a lo que haya en `digest_recipients` y deja su fila en `cron_runs`. No
es un problema —es el correo que iba a salir a las 07:30 igual—, pero si preferís
una prueba inocua, corré este paso **antes** del paso 5, con la clave todavía vacía:
sin destinatarios cierra en verde con `recipients: 0`.

En los tres, sin la cabecera `Authorization` tiene que dar **401**; si `CRON_SECRET`
no está en el `.env`, **503**.

**8. La verificación que cierra la fecha dura.** El 01/10/2026, después de las
00:30, el devengo tiene que tener **su línea**:

```bash
grep 'api/cron/accrual' /var/log/sigev-cron.log | tail -3
```

La del 01/10 **no** dice `skipped`: dice el summary con `feesCreated`. Y en
`/admin/salud` el job "Devengo de cuotas" pasa de "Nunca corrió" a su última corrida.
Si ese día no corrió, la escotilla está en `docs/11` Parte H ("Las dos escotillas"):
`POST /api/cron/accrual?force=1`, que se puede disparar cualquier día del mes y
**volver a correr sin duplicar nada**.

**9. Ojo con `EMAIL_ALLOWLIST`.** Mientras siga definida en producción, el
recordatorio y el resumen se bloquean para toda dirección que no esté en la lista.
Eso **no** ensucia `/admin/salud` —un bloqueo de allowlist se cuenta aparte y no
escribe `failed`, justamente para que el tablero no nazca en rojo— pero tampoco le
llega a nadie. Borrarla sigue siendo un paso del checklist de lanzamiento de
`docs/07`. El **devengo no manda correos**, así que es el único de los tres que
anda completo con la allowlist puesta.

**10. Lo que NO hay que hacer**: probar un cobro, como siempre (4.3). Y no hace
falta tocar nada de Mercado Pago: la fase no cambió credenciales, webhooks ni planes.

### 4.6 Verificación post-deploy (cualquier despliegue)

```bash
curl -sI https://vecinalciudadela.ar | grep -i 'content-security-policy'
curl -sI https://vecinalciudadela.ar | grep -i 'strict-transport-security'
curl -s  https://vecinalciudadela.ar/robots.txt | tail -2
```

- La CSP tiene que llegar entera (la emite Next y tiene que sobrevivir a Nginx y a
  Cloudflare).
- Si el HSTS vuelve vacío, falta prenderlo en Cloudflare (paso 1.2).
- La última línea del `robots.txt` es `Sitemap: https://…`: **si dice otro dominio,
  el build se hizo con el `AUTH_URL` equivocado** y hay que rehacerlo.

Y entrá a `/ingresar` desde el navegador: las dos claves de Turnstile cierran el
panel entero, y `NEXT_PUBLIC_TURNSTILE_SITE_KEY` se hornea en el build. `npm run
build` falla a propósito si falta alguna (guarda de `next.config.ts`), pero un
`pm2 restart` con el `.env` mutilado sigue siendo posible.

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
