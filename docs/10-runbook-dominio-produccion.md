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
MAIL_FROM="Asoc. Vecinal del Barrio Ciudadela <notificaciones@vecinalciudadela.ar>"
```

Tres cosas que no avisan si están mal:

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

---

## 4. Despliegue en el VPS

Además del `git pull`, el deploy completo es lo que hace `deploy.sh`:

```bash
cd /root/dev/ciudadela && bash deploy.sh
```

que equivale a:

```bash
git pull --ff-only
npm ci                      # sin --omit=dev: prisma y tsx son devDependencies
npx prisma migrate deploy   # el Módulo 2 trae 20260819185852_add_module_2_news_activities
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
