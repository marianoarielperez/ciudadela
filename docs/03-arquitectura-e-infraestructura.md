# 03 — Arquitectura e infraestructura

## Panorama

Monolito **Next.js 15+ (App Router, TypeScript)** que sirve:

- Sitio público (`/`): hero, noticias, ubicación, estatuto, ASOCIATE, REEMPADRONATE.
- Panel admin (`/admin`): CD y superadmin.
- Panel de socio (`/mi`): autogestión.
- API (`/api`): webhooks de MP y Brevo, endpoints internos de cron, descarga
  autenticada de documentos y recibos.

Base de datos **MariaDB** (instancia existente del VPS, localhost:3306) con **Prisma**
(provider `mysql`). Base nueva: `sigev`, usuario dedicado `sigev` con permisos solo
sobre esa base.

Decisión MariaDB vs PostgreSQL: se eligió MariaDB porque ya corre en el VPS con otras
bases en producción, existe rutina de dumps, y mantiene un único motor en el servidor.
La app no requiere ninguna capacidad exclusiva de PostgreSQL.

## VPS (Contabo, existente)

| Ítem | Valor |
|---|---|
| IP | 167.86.71.102 |
| SO | Ubuntu 22.04.5 LTS |
| SSH | Puerto **2222**, root |
| Ocupación de puertos | 3002 `sir`, 3004 `cbinfra`, 3005 `hydro`, 3007 `atenea` (Docker), 3306 MariaDB |
| **Puerto SIGeV** | **3006** (verificar libre con `ss -tlnp` antes de configurar) |
| Proceso | PM2 (`pm2 start npm --name sigev -- start` sobre build de producción) |
| Proxy | Nginx (server block por dominio) detrás de Cloudflare (nube naranja) |
| Swap | 4 GB configurados |

Pendientes de hardening que son **prerrequisito del Módulo 0** (los ejecuta Mariano
con comandos preparados):

1. Activar `ufw` (allow 2222/tcp, 80/tcp, 443/tcp; deny resto) — hoy está inactivo.
2. Rotación de logs de Docker (afecta a `atenea`, conviene cerrarlo ya).
3. Crear `/var/sigev/uploads` con owner del proceso de la app y permisos 750.

## Dominios y entornos

| Entorno | URL | Certificado | Credenciales MP |
|---|---|---|---|
| Staging | `sigev.redaccion.ar` | Cloudflare Origin wildcard `*.redaccion.ar` (ya instalado, válido hasta 2041) | TEST (sandbox) |
| Producción | `vecinalciudadela.com.ar` (+ `www`) | Cloudflare Origin cert propio del dominio | Productivas |

- `vecinalciudadela.com.ar` **ya está registrado y activo** (NIC.ar, a nombre de la
  vecinal). Confirmado por Mariano el 20/08/2026.
- DNS en Cloudflare (plan free), registro A → 167.86.71.102, proxy activo.
- Email saliente: Cloudflare Email Routing para recepción + **Brevo SMTP** para envío
  (crítico: estos correos tienen valor de notificación fehaciente, no pueden caer en
  spam). Mismo patrón ya aplicado en cbinfraestructura.ar y 7777.ar.
- ⚠️ **El dominio autenticado en Brevo es `vecinalciudadela.ar`, NO `.com.ar`.** Se
  dio de alta y se verificó el 19/08/2026 (SPF, DKIM y DMARC resolviendo, envíos
  reales confirmados con `MAIL_FROM=notificaciones@vecinalciudadela.ar`). El sitio y
  el remitente pueden vivir en dominios distintos sin romperse, pero conviene
  unificarlos antes del lanzamiento: que el sitio sea `.com.ar` y los avisos lleguen
  desde `.ar` confunde al socio y no ayuda a la reputación de entrega. Unificar
  significa **rehacer el alta del dominio en Brevo** sobre `.com.ar` y cargar los DKIM
  nuevos en Cloudflare — el mismo procedimiento que ya se hizo una vez.
- El plan free de Brevo (300 emails/día) sobra para ~70-300 socios.

## Despliegue

Git-based, igual al patrón establecido en el VPS:

1. Desarrollo local en Windows (Claude Code). Commit + push a repo privado de GitHub.
   Acceso al repo por SSH deploy key o fine-grained PAT (nunca PAT en texto plano en
   remotes — incidente previo ya conocido).
2. En el VPS: `git pull` → `npm ci` → `npx prisma migrate deploy` → `npm run build`
   → `pm2 restart sigev`. Script `deploy.sh` en el repo con estos pasos.
3. Nginx: server block que proxya el dominio al 3006 (`proxy_pass http://localhost:3006`),
   con `client_max_body_size 15m` (uploads de DNI).

### Variables que se hornean en el build (revisar ANTES de `npm run build`)

`AUTH_URL` no se lee en cada request: queda fija dentro del build porque de ahí salen
`metadataBase`, las URLs canónicas, el `robots.txt` y el `sitemap.xml`. Si se buildea
con el valor equivocado, el sitio publica canonicals apuntando a otro dominio y se
desindexa solo. Cambiar `AUTH_URL` obliga a re-buildear, no alcanza con reiniciar PM2.

Antes de buildear en el VPS, verificar en su `.env`:

- `AUTH_URL` = el dominio real del entorno (staging `https://sigev.redaccion.ar`,
  producción `https://vecinalciudadela.com.ar`).
- `ALLOW_LOCALHOST_BASE_URL` **ausente o comentada**. Es una escotilla solo para el
  build local: si está activa en el servidor, desactiva la guarda que justamente
  impide publicar canonicals a localhost. `grep ALLOW_LOCALHOST_BASE_URL .env` no
  debe devolver ninguna línea sin `#`.
- `UPLOADS_DIR=/var/sigev/uploads`. Si falta, el código cae en silencio a `./uploads`
  dentro del directorio de la app: las portadas de noticias se escriben ahí y se
  pierden en el próximo deploy, sin ningún error visible.

### Verificación post-deploy

```bash
curl -sI https://<dominio> | grep -i 'content-security-policy'   # la CSP llega entera
curl -sI https://<dominio> | grep -i 'strict-transport-security' # si vacío: activar HSTS en Cloudflare
curl -s  https://<dominio>/robots.txt | tail -2                  # Sitemap: con el dominio correcto
```

La CSP y `Permissions-Policy` las emite Next; **HSTS la termina Cloudflare**
(SSL/TLS → Edge Certificates), no la app. Si el `grep` de HSTS vuelve vacío, hay que
prenderla ahí.

## Cron jobs (crontab del sistema, no dentro de la app)

| Frecuencia | Tarea |
|---|---|
| Diario 03:00 | Conciliación MP de respaldo (script Node: consulta pagos y suscripciones por API, detecta lo que los webhooks no registraron) |
| Diario 04:00 | Backup: `mysqldump sigev` + `tar` de `/var/sigev/uploads` → cifrado GPG simétrico → `rclone` a Google Drive de la vecinal (av.ciudadela@gmail.com). Retención 30 días. Complementa los snapshots de Contabo |
| Diario 08:00 | Generación de cuotas devengadas del período (día 1 de cada mes), recordatorios de vencimiento, alertas de mora, avisos de vencimiento de plazos de re-empadronamiento |
| Mensual | Detección de candidatos a vitalicio (REG-06) |

Los scripts viven en `scripts/` del repo y se ejecutan con `node`; los que necesiten
la app usan endpoints `/api/cron/*` protegidos por `CRON_SECRET`.

## Almacenamiento de archivos

- `UPLOADS_DIR=/var/sigev/uploads`, estructura `{solicitudes|socios|reempadronamiento}/{id}/`.
- Nombres de archivo aleatorios (UUID) + extensión validada (jpg/png/webp/pdf, máx 10 MB c/u).
- Se sirven ÚNICAMENTE por API route autenticada que verifica rol y registra el acceso
  en auditoría. Jamás bajo `public/`.
- **Excepción (Módulo 2): las portadas de noticias.** Viven en `UPLOADS_DIR/news/` con
  el mismo criterio de nombre UUID, pero se sirven por `/api/imagenes/noticias/[name]`
  **sin autenticación** y con `Cache-Control` inmutable: una portada es contenido
  público por definición. La regla de API autenticada sigue valiendo entera para los
  documentos personales (DNIs, facturas). El original queda intacto en disco; la
  variante que baja el visitante la genera `next/image` según el ancho de pantalla.
- Recibos PDF generados a `/var/sigev/recibos/{año}/`.

## Observabilidad

- Logs de la app vía PM2 (`pm2 logs sigev`), con log rotate de PM2 activado.
- Tabla `webhook_events` guarda todo webhook crudo recibido (MP y Brevo) para replay/debug.
- Página `/admin/salud` simple: estado de DB, último webhook recibido, último cron OK,
  espacio en disco de uploads.
