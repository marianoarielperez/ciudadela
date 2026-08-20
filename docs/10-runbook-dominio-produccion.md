# 10 — Runbook: poner el sitio en `vecinalciudadela.com.ar`

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

## 1. Cloudflare

### 1.1 Alta del dominio

1. Cloudflare → **Add a site** → `vecinalciudadela.com.ar`, plan **Free**.
2. Cloudflare da dos nameservers. Cargarlos en **NIC.ar** (Mis dominios →
   `vecinalciudadela.com.ar` → Delegación), reemplazando los que estén.
3. Esperar a que Cloudflare marque el dominio **Active**. NIC.ar suele tardar
   entre minutos y algunas horas.

### 1.2 Registros DNS

En **DNS → Records**, con la **nube naranja (Proxied)** activa en los dos:

| Tipo | Nombre | Contenido | Proxy |
|---|---|---|---|
| A | `@` | `167.86.71.102` | Proxied |
| A | `www` | `167.86.71.102` | Proxied |

El proxy naranja es lo que hace que Cloudflare termine el TLS público y que el
`X-Real-IP` que ya usa la app llegue bien desde el `realip` de Nginx.

> Si más adelante se unifica el correo en este dominio, acá van también los
> registros de Brevo (TXT `brevo-code`, dos CNAME DKIM, TXT SPF y TXT DMARC).
> Ver la sección 5.

### 1.3 SSL/TLS

1. **SSL/TLS → Overview → Full (strict)**. No usar «Flexible»: rompe el circuito
   HTTPS y deja a Auth.js viendo peticiones como HTTP.
2. **SSL/TLS → Edge Certificates**:
   - **Always Use HTTPS**: ON.
   - **HSTS**: ON (`max-age` 6 meses, incluir subdominios). La app **no** emite
     HSTS a propósito: la termina Cloudflare, que es quien ve el TLS.
   - **Minimum TLS Version**: 1.2.

### 1.4 Certificado de origen

**SSL/TLS → Origin Server → Create Certificate**, con los hostnames
`vecinalciudadela.com.ar` y `*.vecinalciudadela.com.ar`, validez 15 años.
Cloudflare muestra el certificado y la clave **una sola vez**: copiarlos ahora.

En el VPS:

```bash
mkdir -p /etc/ssl/cloudflare
nano /etc/ssl/cloudflare/vecinalciudadela.com.ar.pem   # pegar el Origin Certificate
nano /etc/ssl/cloudflare/vecinalciudadela.com.ar.key   # pegar la Private Key
chmod 600 /etc/ssl/cloudflare/vecinalciudadela.com.ar.key
```

---

## 2. Nginx en el VPS

Crear `/etc/nginx/sites-available/vecinalciudadela.com.ar`. Es el mismo patrón
del server block de staging, **con dos diferencias deliberadas**: el certificado
propio del dominio y **sin** la cabecera `X-Robots-Tag` (en producción el sitio
tiene que indexarse; el `robots.txt` que emite la app ya bloquea `/admin`, `/mi`
y `/api`).

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name vecinalciudadela.com.ar www.vecinalciudadela.com.ar;
    return 301 https://vecinalciudadela.com.ar$request_uri;
}

# www -> raíz, para no tener el sitio duplicado en dos direcciones.
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.vecinalciudadela.com.ar;

    ssl_certificate     /etc/ssl/cloudflare/vecinalciudadela.com.ar.pem;
    ssl_certificate_key /etc/ssl/cloudflare/vecinalciudadela.com.ar.key;

    return 301 https://vecinalciudadela.com.ar$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name vecinalciudadela.com.ar;

    ssl_certificate     /etc/ssl/cloudflare/vecinalciudadela.com.ar.pem;
    ssl_certificate_key /etc/ssl/cloudflare/vecinalciudadela.com.ar.key;

    client_max_body_size 15M;   # portadas de noticias, DNIs y anexos

    location / {
        proxy_pass http://127.0.0.1:3006;
        proxy_http_version 1.1;
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
ln -s /etc/nginx/sites-available/vecinalciudadela.com.ar /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx   # reload, NUNCA restart
```

---

## 3. Variables de entorno

Editar `/root/dev/ciudadela/.env`:

```bash
AUTH_URL=https://vecinalciudadela.com.ar
MP_ACCESS_TOKEN=<credenciales PRODUCTIVAS>
MP_WEBHOOK_SECRET=<productivo>
UPLOADS_DIR=/var/sigev/uploads
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
   conviene dejarlo con el dueño y los permisos correctos de entrada:
   ```bash
   mkdir -p /var/sigev/uploads/news
   chmod 750 /var/sigev/uploads/news
   ```
3. **`sharp`** pasó a dependencia de producción (lo necesita `next/image` en
   runtime, no solo en build). `npm ci` lo instala; si el build se hizo con un
   `node_modules` viejo, las imágenes fallan recién al servirse.
4. **Backup antes de migrar**, como siempre:
   ```bash
   mysqldump sigev > /root/backup-pre-m2-$(date +%F).sql
   ```

### Verificación post-deploy

```bash
curl -sI https://vecinalciudadela.com.ar | grep -i 'content-security-policy'
curl -sI https://vecinalciudadela.com.ar | grep -i 'strict-transport-security'
curl -s  https://vecinalciudadela.com.ar/robots.txt | tail -2
```

- La CSP tiene que llegar entera (la emite Next y tiene que sobrevivir a Nginx y
  Cloudflare).
- Si el HSTS vuelve vacío, falta prenderlo en Cloudflare (paso 1.3).
- La última línea del `robots.txt` es `Sitemap: https://…`: **si dice otro
  dominio, el build se hizo con el `AUTH_URL` equivocado** y hay que rehacerlo.

---

## 5. Correo: el pendiente que queda abierto

El dominio autenticado en Brevo es **`vecinalciudadela.ar`**, sin `.com`. Se dio
de alta y se verificó el 19/08/2026 y funciona: SPF, DKIM y DMARC resolviendo, y
envíos reales confirmados desde `notificaciones@vecinalciudadela.ar`.

Sitio y remitente pueden vivir en dominios distintos sin romperse. Pero estos
correos tienen valor de **notificación fehaciente** ante la IGJ, y que el socio
visite `.com.ar` y reciba los avisos desde `.ar` no ayuda ni a la confianza ni a
la reputación de entrega.

Para unificar (recomendado antes del lanzamiento):

1. En Brevo: **Senders, Domains & Dedicated IPs → Domains**, dar de alta
   `vecinalciudadela.com.ar`. Brevo genera un TXT `brevo-code` y **dos CNAME DKIM
   nuevos** (`b1`/`b2.vecinalciudadela-com-ar.dkim.brevo.com`).
2. Cargar esos registros en la zona `vecinalciudadela.com.ar` de Cloudflare, más
   SPF (`v=spf1 include:spf.brevo.com ~all`) y DMARC.
3. Esperar la verificación en Brevo y recién entonces cambiar en `.env`:
   `MAIL_FROM="Asoc. Vecinal del Barrio Ciudadela <notificaciones@vecinalciudadela.com.ar>"`.
4. Reiniciar PM2 y **mandar un correo de prueba real** antes de dar el cambio por
   bueno.

> Aprendido a la fuerza: Brevo arma el host DKIM reemplazando los puntos del
> dominio por guiones. Si el valor que muestra no coincide con la zona donde
> estás publicando los registros, el dominio se cargó mal en Brevo y no es un
> problema de propagación — nunca va a verificar. La clave SMTP es de la cuenta,
> no del dominio: se reutiliza tal cual.
