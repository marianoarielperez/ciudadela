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
3. Crear `/var/sigev/uploads` y `/var/sigev/recibos` con owner del proceso de la app y permisos 750.

## Dominios y entornos

**Hay un solo entorno desplegado: `vecinalciudadela.ar`.**

| Entorno | URL | Certificado | Credenciales MP |
|---|---|---|---|
| Producción | `vecinalciudadela.ar` (+ `www`) | Cloudflare Origin cert propio del dominio | Productivas desde el 22/08/2026 |
| ~~Staging~~ | ~~`sigev.redaccion.ar`~~ | ~~Cloudflare Origin wildcard `*.redaccion.ar`~~ | **DADO DE BAJA el 20/08/2026** |

El staging se dio de baja el 20/08/2026 (decisión del cliente): quedaba un entorno
más que mantener para un sitio que todavía no conoce nadie. El sandbox de Mercado
Pago pasó a ser **cosa de local** (`docs/11`); en el VPS no queda ninguna credencial
de prueba. Lo que este documento, `docs/07`, `docs/09` y `docs/10` digan sobre
staging es historia y no describe el estado actual.

- El dominio es **`vecinalciudadela.ar`**, sin `.com`. Ya está registrado en NIC.ar
  a nombre de la vecinal y **delegado a Cloudflare** (`jocelyn`/`logan.ns.cloudflare.com`,
  verificado por DNS el 20/08/2026).
- DNS en Cloudflare (plan free). **Falta el registro A** de la raíz y de `www` →
  167.86.71.102 con proxy activo: hoy el dominio no resuelve a ninguna IP, así que
  la web todavía no apunta a ningún lado. Ver `docs/10-runbook-dominio-produccion.md`.
- Email saliente: Cloudflare Email Routing para recepción + **Brevo SMTP** para envío
  (crítico: estos correos tienen valor de notificación fehaciente, no pueden caer en
  spam). Mismo patrón ya aplicado en cbinfraestructura.ar y 7777.ar.
- **El correo ya está terminado y verificado.** Dominio autenticado en Brevo el
  19/08/2026, con DKIM (`b1`/`b2.vecinalciudadela-ar.dkim.brevo.com`), SPF y DMARC
  resolviendo, y envíos reales confirmados desde `notificaciones@vecinalciudadela.ar`.
  Sitio y remitente comparten dominio: no hay nada que migrar.
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

### ⚠️ PM2 corre en UN SOLO PROCESO, y eso es una premisa del código

**No clusterizar** (`instances > 1`, `exec_mode: cluster`) sin antes mover a la
base las exclusiones que hoy viven en memoria del proceso:

- La invariante "**una sola solicitud viva por DNI**" (Módulo 3) se sostiene con
  un mutex **por proceso** dentro de la transacción de creación. Con dos
  instancias, dos envíos simultáneos del mismo DNI entran a la vez y crean dos
  solicitudes vivas: MySQL no tiene índices parciales, así que no hay red abajo.
  El arreglo de fondo es una columna única mantenida por la app (o un lock
  distribuido), y hay que hacerlo **antes** de subir `instances`.
- Los **rate limiters** de los formularios públicos (Turnstile, retome, recupero
  de contraseña) también son en memoria: con N instancias, el techo real pasa a
  ser N veces el configurado.

Un `pm2 scale` hecho de apuro un día de carga rompe las dos cosas en silencio:
nada falla, nada se loguea, y el efecto es una solicitud duplicada o un límite
que no limita. A la escala de la vecinal (~300 socios) un proceso sobra.

También se apoya en un solo proceso la protección del endpoint de webhooks:
conviene además **limitar por Nginx** las peticiones a `/api/webhooks/mp`. El
filtro de cabeceras y firma que hace la app frena escáneres, pero no reemplaza un
límite de tasa real.

### Variables que se hornean en el build (revisar ANTES de `npm run build`)

`AUTH_URL` no se lee en cada request: queda fija dentro del build porque de ahí salen
`metadataBase`, las URLs canónicas, el `robots.txt` y el `sitemap.xml`. Si se buildea
con el valor equivocado, el sitio publica canonicals apuntando a otro dominio y se
desindexa solo. Cambiar `AUTH_URL` obliga a re-buildear, no alcanza con reiniciar PM2.

Antes de buildear en el VPS, verificar en su `.env`:

- `AUTH_URL` = el dominio real del entorno, que hoy es uno solo:
  `https://vecinalciudadela.ar`.
- `ALLOW_LOCALHOST_BASE_URL` **ausente o comentada**. Es una escotilla solo para el
  build local: si está activa en el servidor, desactiva la guarda que justamente
  impide publicar canonicals a localhost. `grep ALLOW_LOCALHOST_BASE_URL .env` no
  debe devolver ninguna línea sin `#`.
- `UPLOADS_DIR=/var/sigev/uploads`. Si falta, el código cae en silencio a `./uploads`
  dentro del directorio de la app: las portadas de noticias se escriben ahí y se
  pierden en el próximo deploy, sin ningún error visible.
- `RECEIPTS_DIR=/var/sigev/recibos` (Módulo 4), con la misma falla silenciosa: sin
  ella los PDFs de recibos caen en `./recibos`, quedan fuera del backup y se pierden
  en el próximo deploy.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = la site key del widget de Cloudflare Turnstile
  (Módulo 3). Todo lo `NEXT_PUBLIC_*` se hornea en el bundle del cliente: si falta
  o está mal al buildear, el widget del wizard ASOCIATE —que lo llevan el **paso 1
  ("Tu DNI") y el paso 4 (el envío)**— no se renderiza y **nadie puede asociarse**:
  el vecino se frena ya en el paso 1, sin poder chequear su DNI ni llegar a enviar
  la solicitud —las dos actions rechazan el POST sin token de captcha—. Como
  `AUTH_URL`, cambiarla obliga a re-buildear: reiniciar PM2 no alcanza. La
  `TURNSTILE_SECRET_KEY`, en cambio, se lee en runtime.

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
| Diario 08:05 | **`POST /api/cron/applications`** (Módulo 3, ya en uso): recordatorio de pago a las solicitudes creadas hace 3 días o más, y expiración de las creadas hace 7 días o más (el corte es por `createdAt`, no por última actividad), con cancelación de la suscripción MP. Bloque copiable en `docs/11` |
| Diario 03:17 | Conciliación MP de respaldo (script Node: consulta pagos y suscripciones por API, detecta lo que los webhooks no registraron) |
| Diario 04:00 | Backup: `mysqldump sigev` + `tar` de `/var/sigev/uploads` y `/var/sigev/recibos` → cifrado GPG simétrico → `rclone` a Google Drive de la vecinal (av.ciudadela@gmail.com). Retención 30 días. Complementa los snapshots de Contabo |
| Diario 08:00 | Generación de cuotas devengadas del período (día 1 de cada mes), recordatorios de vencimiento, alertas de mora, avisos de vencimiento de plazos de re-empadronamiento |
| Mensual | Detección de candidatos a vitalicio (REG-06) |

Los scripts viven en `scripts/` del repo y se ejecutan con `node`; los que necesiten
la app usan endpoints `/api/cron/*` protegidos por `CRON_SECRET` (sin la variable,
el endpoint responde 503 en vez de correr sin guarda).

**La PRIMERA corrida de `/api/cron/applications` puede tardar mucho**: arrastra el
backlog de solicitudes vencidas acumuladas desde el despliegue, y cada expiración
con suscripción hace un `cancelPreapproval` contra MP, en serie. Por eso el `curl`
del crontab lleva `--max-time` generoso, y **un timeout no es un fallo**: la
corrida siguiente termina lo que quedó. Ver el bloque de `docs/11`.

## Almacenamiento de archivos

- `UPLOADS_DIR=/var/sigev/uploads`, estructura `{applications|members|presentations}/{id}/`
  (nombres en inglés, igual que el enum `DocumentOwner`; el Módulo 3 estrenó
  `applications/`).
- Nombres de archivo aleatorios (UUID) + extensión validada (jpg/png/webp/pdf, máx 10 MB c/u).
- Se sirven ÚNICAMENTE por API route autenticada que verifica rol y registra el acceso
  en auditoría. Jamás bajo `public/`.
- **Excepción (Módulo 2): las portadas de noticias.** Viven en `UPLOADS_DIR/news/` con
  el mismo criterio de nombre UUID, pero se sirven por `/api/imagenes/noticias/[name]`
  **sin autenticación** y con `Cache-Control` inmutable: una portada es contenido
  público por definición. La regla de API autenticada sigue valiendo entera para los
  documentos personales (DNIs, facturas). El original queda intacto en disco; la
  variante que baja el visitante la genera `next/image` según el ancho de pantalla.
- **Recibos PDF** (Módulo 4): `RECEIPTS_DIR=/var/sigev/recibos`, estructura
  `{año}/{AAAA-NNNNN}.pdf` — determinística a partir del número de recibo, nunca
  armada con texto libre. Se sirven por `/api/admin/recibos/[id]` (admin, auditado)
  y `/api/mi/recibos/[id]` (el socio, sólo el suyo). El PDF se escribe **después**
  del commit del cobro y es regenerable: es una copia, no el asiento.

## Observabilidad

- Logs de la app vía PM2 (`pm2 logs sigev`), con log rotate de PM2 activado.
- Tabla `webhook_events` guarda todo webhook crudo recibido (MP y Brevo) para replay/debug.
- Página `/admin/salud` simple: estado de DB, último webhook recibido, último cron OK,
  espacio en disco de uploads.
