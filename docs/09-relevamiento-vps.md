# 09 — Relevamiento del VPS [VERIFICADO 17/08/2026]

Estado real del servidor al momento de iniciar el Módulo 0. Los ítems marcados
`[VERIFICADO]` fueron comprobados con comandos en el servidor: **no asumir otra cosa
ni contradecir este documento**. Los marcados `[PENDIENTE]` requieren acción.

## Datos del servidor [VERIFICADO]

| Ítem | Valor |
|---|---|
| Host | `vmi3062615` — 167.86.71.102 (Contabo) |
| SSH | Puerto 2222, usuario root |
| Disco | 194 GB total, 17 GB usados (9%), **177 GB libres** |
| RAM | 11 GB total, 9.7 GB disponibles |
| Swap | 4 GB (94 MB en uso) |
| Node.js | **v22.22.0** — cumple el requisito de Next.js 15 (≥18.18). No actualizar |
| npm | 10.9.4 |
| git | 2.34.1 |
| MariaDB | **10.11.16**, escuchando solo en `127.0.0.1:3306` |
| Nginx | **1.18.0 (Ubuntu)** |
| Docker | Activo, con `atenea810-app` y `atenea810-db` (postgres:16-alpine) |

## Puertos en uso [VERIFICADO]

| Puerto | Uso |
|---|---|
| 80 / 443 | Nginx |
| 2222 | SSH |
| 3002 | `sir` (PM2, node) |
| 3004 | `cbinfra` (PM2, node) |
| 3005 | `hydro` (PM2, node) |
| 3007 | `atenea810-app` (docker-proxy → 3000 interno) |
| 3306 | MariaDB (localhost) |
| **3006** | **LIBRE — asignado a SIGeV** |

## Bases de datos existentes [VERIFICADO]

`cbinfra`, `sir_database` (+ las del sistema). **No existe `sigev`**: hay que crearla
junto con su usuario dedicado.

Nota: Atenea 810 usa PostgreSQL **dentro de Docker** (`atenea810-db`), aislado y
dedicado. Esto NO cambia la decisión de usar MariaDB para SIGeV.

## Nginx: sitios habilitados [VERIFICADO]

`atenea.redaccion.ar`, `cbinfraestructura`, `elalbumdemessi.redaccion.ar`,
`fuga.redaccion.ar`, `hydrocalculus`, `redaccion.ar`, `soloenpapel.redaccion.ar`.
Todos son symlinks desde `/etc/nginx/sites-available/`.

**Restricción crítica de versión:** Nginx 1.18.0 NO soporta la directiva `http2 on;`
(existe desde 1.25.1). El server block de SIGeV debe usar la sintaxis vieja:

```nginx
listen 443 ssl http2;
```

El patrón a replicar para `sigev.redaccion.ar` es el de `atenea.redaccion.ar`
(subdominio bajo el wildcard, proxy a puerto local). Incluir además:

```nginx
client_max_body_size 15m;   # uploads de DNI y anexos
```

## Estado de seguridad [PENDIENTE — prerrequisitos del Módulo 0]

1. **`ufw` INACTIVO** [VERIFICADO]. Activar con `allow 2222/tcp`, `80/tcp`, `443/tcp`
   ANTES del `enable`. Mantener la sesión SSH abierta y validar con una segunda
   sesión antes de cerrar.
2. **Sin crontab** [VERIFICADO: `no crontab for root`]. No existe backup automatizado
   de bases de datos en el servidor: la única protección actual son los snapshots de
   Contabo. Al implementar el backup de SIGeV, **incluir también `cbinfra` y
   `sir_database`** en el dump nocturno.
3. **`rclone` NO instalado** [VERIFICADO]. `gpg` y `mysqldump` sí están. Instalar
   rclone y configurar remote contra el Google Drive institucional
   (av.ciudadela@gmail.com).
4. **Rotación de logs de Docker**: pendiente de verificar `/etc/docker/daemon.json`.
   Si no existe, los logs de `atenea810-app` crecen sin límite.

## Crear en el Módulo 0

```bash
# Base y usuario dedicados (ejecutar como root en el VPS)
mysql -e "CREATE DATABASE sigev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER 'sigev'@'localhost' IDENTIFIED BY '<password-fuerte>';"
mysql -e "GRANT ALL PRIVILEGES ON sigev.* TO 'sigev'@'localhost'; FLUSH PRIVILEGES;"

# Directorios de datos (fuera del webroot y del repo)
mkdir -p /var/sigev/uploads /var/sigev/recibos
chmod 750 /var/sigev /var/sigev/uploads /var/sigev/recibos
```

## Convivencia con lo existente — regla dura

`sir` (3002), `cbinfra` (3004), `hydro` (3005) y `atenea810` (3007) están **en
producción**. Ninguna tarea de SIGeV puede reiniciar, reconfigurar ni tocar esos
servicios, sus bases ni sus server blocks de Nginx. Al modificar Nginx: siempre
`nginx -t` antes de `systemctl reload nginx`, nunca `restart`.

---

# Ampliación del relevamiento [VERIFICADO 17/08/2026]

## Certificados SSL [VERIFICADO]

| Dominio | Certificado |
|---|---|
| `*.redaccion.ar` (incluye subdominios) | Cloudflare Origin: `/etc/ssl/cloudflare/redaccion.ar.pem` + `.key` |
| `cbinfraestructura.ar` | Let's Encrypt (Certbot) |
| `hydrocalculus.ar` | Let's Encrypt (Certbot) |

**Para el staging `sigev.redaccion.ar` NO hay que emitir ni configurar ningún
certificado nuevo**: se reutiliza el Origin de Cloudflare ya instalado, igual que
hace `atenea.redaccion.ar`.

Para producción (`vecinalciudadela.com.ar`) sí habrá que generar un Origin
Certificate propio en Cloudflare para ese dominio (o usar Certbot, siguiendo el
patrón de cbinfraestructura.ar).

## Server block de SIGeV — staging [LISTO PARA USAR]

Basado literalmente en `/etc/nginx/sites-available/atenea.redaccion.ar` [VERIFICADO].
Guardar como `/etc/nginx/sites-available/sigev.redaccion.ar`, symlinkear a
`sites-enabled/`, correr `nginx -t` y luego `systemctl reload nginx` (NUNCA `restart`).

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name sigev.redaccion.ar;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name sigev.redaccion.ar;

    ssl_certificate     /etc/ssl/cloudflare/redaccion.ar.pem;
    ssl_certificate_key /etc/ssl/cloudflare/redaccion.ar.key;

    # Staging: no indexar. QUITAR en producción (vecinalciudadela.com.ar)
    add_header X-Robots-Tag "noindex, nofollow" always;

    client_max_body_size 15M;   # uploads de DNI y anexos

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

**`X-Forwarded-Proto https` es obligatorio**: sin ese header, Auth.js detrás del
proxy genera URLs http y rompe las cookies de sesión.

DNS: verificar en Cloudflare que exista el registro para `sigev.redaccion.ar`
(hay wildcard DNS configurado para `*.redaccion.ar`; si no resuelve, crear registro
A → 167.86.71.102 con proxy activo).

## PM2 [VERIFICADO]

- `pm2-root` está **enabled** en systemd: las apps se levantan solas tras un reboot.
  Al agregar SIGeV, correr `pm2 save` para persistir el proceso nuevo.
- **`pm2-logrotate` parece NO instalado** (el `pm2 list` no muestra sección de
  módulos). Instalarlo durante el Módulo 0 — beneficia a todas las apps del VPS:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

## Docker — rotación de logs [PENDIENTE, no urgente]

`/etc/docker/daemon.json` no existe → logs sin límite. Hoy `/var/lib/docker/containers/`
pesa solo **148K**, así que no hay urgencia.

Al aplicarlo, tener en cuenta que **reiniciar el demonio de Docker reinicia los
contenedores de Atenea 810** (`atenea810-app` y `atenea810-db`): hacerlo en una
ventana de baja actividad y avisar a ISFD810. Contenido sugerido:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

## Backup — alcance ampliado

Como el servidor no tiene ningún cron de backup [VERIFICADO], el script nocturno de
SIGeV debe respaldar **las tres bases**: `sigev`, `cbinfra` y `sir_database`
(Atenea 810 usa su propio PostgreSQL en Docker: incluirlo con `docker exec
atenea810-db pg_dump` si se decide cubrirlo también).
