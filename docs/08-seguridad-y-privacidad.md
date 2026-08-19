# 08 — Seguridad y privacidad

El sistema maneja datos personales de vecinos (DNI con imágenes, domicilios,
fechas de nacimiento) y registros de pago. Aplica la **Ley 25.326 de Protección
de Datos Personales** (Argentina).

## Datos personales

- **Consentimiento**: los formularios públicos (ASOCIATE, REEMPADRONATE) incluyen
  checkbox obligatorio con texto de consentimiento informado (finalidad: gestión
  del registro de asociados conforme al estatuto; responsable: la Asociación;
  derechos de acceso, rectificación y supresión vía contacto). Texto en
  Configuracion, aprobado por la CD. Timestamp del consentimiento en la Solicitud.
- **Minimización de exposición**: ninguna consulta pública revela datos del padrón.
  La identificación del re-empadronamiento responde con nombre enmascarado y
  mensajes genéricos ante no-coincidencia.
- **Conservación**: las imágenes de DNI y anexos se conservan de forma **permanente**
  (decisión institucional: son el respaldo de la validación de identidad), bajo las
  medidas de este documento.
- **Derechos ARCO**: la rectificación se canaliza por el panel de socio o la CD;
  la supresión de datos de ex socios se evalúa caso por caso por la CD (los datos
  de libros cerrados integran registros institucionales exigibles por IGJ).

## Archivos sensibles

- Almacenados fuera del webroot (`/var/sigev/uploads`), nombres UUID, permisos 750.
- Servidos solo por API route autenticada con verificación de rol; **cada
  visualización de un documento queda en Auditoria** (quién, cuándo, qué documento).
- Validación de subida: MIME real (magic bytes), extensiones jpg/png/webp/pdf,
  máx 10 MB, re-encode de imágenes (elimina metadatos EXIF con GPS).

## Aplicación

- Contraseñas: bcrypt (cost 12), política mínima 8 caracteres, rate limit de login
  (5 intentos/15 min por cuenta e IP), recupero por token de un solo uso (30 min).
- Sesiones: JWT de Auth.js con 8 h de inactividad. Cambiar la contraseña, dar de
  baja al socio o revocarle un rol cierran las sesiones abiertas de esa cuenta;
  además hay un techo absoluto de **7 días** de sesión aunque se siga usando
  (ver `docs/04-modelo-de-datos.md`, entidad Usuario/Rol).
- Formularios públicos: Cloudflare Turnstile + rate limiting por IP (especialmente
  el endpoint DNI+apellido: 5 intentos/15 min). **Turnstile queda diferido al
  Módulo 3** (se integra junto con el wizard de ASOCIATE); hasta entonces los
  formularios públicos de los módulos ya construidos solo están protegidos por
  los limitadores de intentos.
- Webhooks: validación `x-Signature` (MP) y token/secret (Brevo); idempotencia.
- Cabeceras: CSP, HSTS (vía Cloudflare + Next), `X-Frame-Options` salvo el embed
  del mapa.
- Prisma parametriza todo (sin SQL crudo salvo necesidad, y nunca con input directo).
- Endpoints de cron protegidos por `CRON_SECRET`.
- Dependencias: `npm audit` en CI básico; sin paquetes abandonados para crypto/auth.

## Servidor

- `ufw`: allow 2222, 80, 443; deny resto (prerrequisito Módulo 0).
- MariaDB solo en localhost; usuario `sigev` con permisos limitados a su base.
- Secretos solo en `.env` del servidor (permisos 600), nunca en el repo.
- SSH: mantener puerto 2222; recomendar deshabilitar password auth si aún no
  (solo claves) — a confirmar con Mariano.

## Backups

- Nocturno: `mysqldump sigev` + `tar` de uploads → **GPG simétrico** (passphrase
  guardada fuera del VPS) → `rclone` al Google Drive institucional
  (av.ciudadela@gmail.com). Retención 30 días. Verificación de restore trimestral.
- Complemento: snapshots de Contabo (VPS completo).
- Los backups contienen DNIs: viajan y descansan cifrados, siempre.

## Auditoría y roles

- Toda acción sensible registrada (ver 04, entidad Auditoria). El log de auditoría
  es solo-lectura para admin, exportable por superadmin.
- Principio de mínimo privilegio: `admin` no gestiona usuarios ni configuración
  (solo `superadmin`); `socio` solo ve lo propio.
- Bajas de usuarios admin al cambiar la CD: checklist post-elecciones.
