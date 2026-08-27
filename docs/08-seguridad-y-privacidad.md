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
  La identificación del re-empadronamiento responde con **nombre enmascarado** y
  mensajes genéricos ante no-coincidencia. El chequeo temprano por DNI de
  ASOCIATE (spec 2026-08-27) sigue la misma regla con una ampliación decidida
  por el operador (27/08/2026): detrás de Turnstile y de un cupo de 5/15 min
  por IP, responde el nombre **enmascarado**, veredictos distinguibles entre sí
  (vigente / trámite / deuda / sede / rechazo) y, en el caso deuda, la
  **cantidad** de cuotas pendientes — nunca montos, nunca el nombre completo,
  nunca el motivo real de una baja de sede, y el reingreso habilitado es
  indistinguible de un DNI desconocido.
- **Conservación**: las imágenes de DNI y anexos se conservan de forma **permanente**
  (decisión institucional: son el respaldo de la validación de identidad), bajo las
  medidas de este documento.
- **Derechos ARCO**: la rectificación se canaliza por el panel de socio o la CD;
  la supresión de datos de ex socios se evalúa caso por caso por la CD (los datos
  de libros cerrados integran registros institucionales exigibles por IGJ).

## Archivos sensibles

- Almacenados fuera del webroot (`/var/sigev/uploads` para documentos personales,
  `/var/sigev/recibos` para los PDFs de recibos), nombres UUID, permisos 750.
- Servidos solo por API route autenticada con verificación de rol; **cada
  visualización de un documento queda en Auditoria** (quién, cuándo, qué documento).
  Los recibos suman una ruta para el propio socio (`/api/mi/recibos/[id]`): pedir
  uno ajeno devuelve **404** —no 403— con el mismo cuerpo que un id inexistente y
  sin tocar el disco, así que el status no funciona como oráculo de existencia.
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
  el endpoint DNI+apellido: 5 intentos/15 min). Turnstile se difirió al Módulo 3 y
  ahí quedó cerrado: cubre el wizard de ASOCIATE y el reenvío del enlace de retome
  (Módulo 3) y, desde el 21/08/2026, también `/ingresar` y `/ingresar/recuperar`,
  que hasta entonces sólo tenían los limitadores de intentos. Los formularios que
  se abren con un token de un solo uso (`/acceso/[token]`,
  `/ingresar/restablecer/[token]`, `/verificar/[token]`) **no** llevan captcha: el
  token es la barrera, y sin él no hay nada que enumerar. En todos los casos el
  captcha se SUMA a los limitadores; no reemplaza a ninguno.
- Webhooks: validación `x-Signature` (MP) y token/secret (Brevo); idempotencia.
- Cabeceras: CSP y `Permissions-Policy` las emite Next (`next.config.ts`);
  **HSTS la termina Cloudflare**, no la app. `X-Frame-Options: DENY` es global y
  no afecta al embed del mapa (limita quién nos enmarca a nosotros, no a quién
  enmarcamos); lo que habilita el mapa es `frame-src`.

### El cuerpo de las noticias tiene UN solo control (Módulo 2)

`sanitizeNewsBody` (`src/lib/news/sanitize.ts`) es la única defensa contra XSS
almacenado en el cuerpo de una noticia: el render público usa
`dangerouslySetInnerHTML` y la CSP **no puede** atajar lo que se escape, porque
`script-src` incluye `'unsafe-inline'` —necesario para la hidratación de Next y
el JSON-LD— y eso habilita también los manejadores de evento inline.

La consecuencia práctica, verificada en la revisión final del Módulo 2: si una
fila de `news` llega a tener HTML sin sanitizar, se ejecuta. **Todo camino de
escritura a `news.body` tiene que pasar por `sanitizeNewsBody`** — hoy son las
dos server actions del ABM y nada más. Una migración, un import o un arreglo
manual en la base que escriban ese campo directo son XSS almacenado, sin nada
que los frene. Si en el futuro se quiere una segunda línea de defensa, la vía
es nonces en la CSP, que obligan a servir todo dinámico y romperían el cacheo
por tags (decisión documentada en la spec del Módulo 2, §7).

La revisión adversarial de la allowlist no encontró forma de evadirla: más de
70 payloads (`javascript:` ofuscado con entidades, tabs, nulos y mayúsculas;
`data:`; protocol-relative; SVG y MathML; mXSS por `<noscript>`/`<template>`;
escape de atributos) quedaron todos neutralizados, y la sanitización es
idempotente. Los esquemas permitidos son `http`, `https`, `mailto` y `tel`.

### Portadas de noticias: públicas por diseño, incluso en borrador

`/api/imagenes/noticias/[name]` no consulta el estado de la noticia, así que la
portada de un **borrador** —o de una noticia despublicada— se sirve a cualquiera
que conozca la URL. Es una decisión consciente: el nombre es un UUIDv4 que nunca
aparece en el HTML público mientras la noticia esté en borrador, y agregarle una
consulta de estado convertiría cada imagen en una lectura a la base. Tenerlo
presente si alguna vez se prepara un comunicado sensible y se comparte el enlace
de su imagen antes de publicarlo.
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

- Nocturno: `mysqldump sigev` + `tar` de `uploads` y `recibos` → **GPG simétrico** (passphrase
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
