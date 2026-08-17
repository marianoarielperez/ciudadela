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

- Registrar `vecinalciudadela.com.ar` en NIC.ar **con el CUIT de la vecinal** (no personal).
- DNS en Cloudflare (plan free), registro A → 167.86.71.102, proxy activo.
- Email saliente: Cloudflare Email Routing para recepción + **Brevo SMTP** para envío,
  remitente `notificaciones@vecinalciudadela.com.ar`. Configurar SPF, DKIM y DMARC
  (crítico: estos correos tienen valor de notificación fehaciente, no pueden caer en spam).
  Mismo patrón ya aplicado en cbinfraestructura.ar y 7777.ar.
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
- Recibos PDF generados a `/var/sigev/recibos/{año}/`.

## Observabilidad

- Logs de la app vía PM2 (`pm2 logs sigev`), con log rotate de PM2 activado.
- Tabla `webhook_events` guarda todo webhook crudo recibido (MP y Brevo) para replay/debug.
- Página `/admin/salud` simple: estado de DB, último webhook recibido, último cron OK,
  espacio en disco de uploads.
