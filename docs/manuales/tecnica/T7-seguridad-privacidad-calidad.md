---
title: Seguridad, privacidad y calidad
subtitle: Sesión, tokens, cupos, cabeceras, archivos, Ley 25.326, auditoría y tests
series: Serie técnica — Documento 7 de 7
docx: SIGeV-T7-Seguridad-privacidad-calidad
version: 1.0
date: 11/09/2026
---

# Para quién es y qué da por sabido

Para el desarrollador que hereda SIGeV y necesita saber qué controles de seguridad
existen, dónde viven y por qué están escritos así. Da por sabido lo que cuentan T1 y
T2: un solo proyecto Next.js con tres zonas —sitio público, panel del socio y panel
de administración—, la autorización real en cada server action y el dominio como
módulos puros bajo `src/lib`.

Dos advertencias. **La verdad es el código**: donde este documento y
`docs/08-seguridad-y-privacidad.md` difieren, acá se describe lo que hace el programa
hoy, y las diferencias se listan en el capítulo 12. Y el sistema guarda números e
imágenes de DNI, domicilios, fechas de nacimiento y deuda de vecinos identificables,
además de mover dinero de socios: casi ninguna de las decisiones que siguen es
estética.

# Cómo leer este documento

Los capítulos 1 a 5 son la puerta de entrada: qué se protege, la sesión, los enlaces
de un solo uso, el captcha y los cupos. El 6 a 8 son la superficie HTTP y el disco.
El 9 y el 10 cubren el rastro y los dos canales que entran sin sesión. El 11 es
calidad y el 12 cierra con la deuda conocida.

Cada capítulo termina con **Dónde está en el código**. Antes de tocar una guarda
conviene abrir el archivo: casi todos empiezan con un comentario en español que
explica el bug real o la regla estatutaria que los motivó.

# 1. Qué se protege

Tres clases de dato conviven en la misma base y en el mismo proceso, con
tratamientos distintos. Confundirlas es el origen de la mayoría de los errores de
diseño que el proyecto tuvo que corregir.

| Clase | Ejemplos | Cómo se protege |
|---|---|---|
| **Público** | Noticias publicadas, actividades, ubicación, documentos institucionales, portadas | El cuidado es de integridad (sanitización del cuerpo de una noticia) y de caché |
| **Personal** | Número e imágenes de DNI, domicilio, fecha de nacimiento, correo, teléfono, cuotas impagas, texto y fotos de un reporte | Ley 25.326: archivos fuera del webroot, rutas autenticadas, auditoría por visualización, enmascarado en logs y en lookups públicos |
| **Dinero** | Pagos, recibos numerados, suscripciones de Mercado Pago, exenciones, valores de cuota | Idempotencia por identificador de cobro, numeración sin huecos, auditoría de toda anulación, cancelación de débito al dar de baja |

Tres consecuencias prácticas: un archivo personal **nunca** se sirve desde `public/`,
que contiene un solo archivo; una pantalla pública nunca devuelve el padrón, y los dos
lookups por DNI responden con el nombre **enmascarado**; y todo lo que toca dinero pasa
por un único núcleo de escritura, el único lugar donde se verifican las invariantes de
REG-33 (ver T5). Las portadas de noticias son la excepción deliberada: viven bajo el
directorio de subidas y se sirven sin autenticación, porque son públicas.

**Dónde está en el código.** `src/lib/documents/storage.ts`,
`src/lib/reports/storage.ts` y `src/lib/treasury/receipts-dir.ts` son las raíces de
disco; `src/lib/audit.ts` es el rastro; la política está en `docs/08`.

# 2. Sesión y credenciales

Auth.js v5 con provider **Credentials** y estrategia `jwt`: **no hay tabla de
sesiones**, el JWT firmado *es* la sesión. Su `maxAge` es de 8 horas, pero son 8
horas de **inactividad**: cada visita a una zona cubierta por el proxy vuelve a
firmar la cookie y el reloj arranca de nuevo.

Contraseñas con bcrypt de costo 12 y mínimo de 8 caracteres. Cuando el correo no
existe o la cuenta está inactiva, la verificación igual compara contra un hash
literal precalculado (`DUMMY_HASH`): sin eso la latencia revelaría si la cuenta
existe. El asiento de auditoría del login lo escribe la server action, que es la
única capa que ve la IP.

## 2.1 El claim `authAt` y por qué no se usa `iat`

El callback que arma el token escribe un claim propio con el instante de apertura de
la sesión, en milisegundos epoch y **sólo en el login**. No se usa el `iat` estándar
por una razón medida: el proxy corre sobre las dos zonas privadas y ahí Auth.js
re-encripta el token en cada request, así que ese campo avanza solo y a la segunda
visita ya sería posterior a cualquier cambio de contraseña — la comparación quedaría
desactivada en silencio.

## 2.2 Frescura: dos mecanismos, ninguno en `maxAge`

- **Cambio de contraseña.** `sessionPredatesPasswordChange` compara el sello de
  apertura contra `User.passwordChangedAt`. Sin esa columna la sesión vale (filas
  anteriores a la migración del 19/08/2026); con la columna puesta pero sin sello
  utilizable, **cierra**: falla cerrada. Escriben esa columna el recupero, el alta
  por invitación y el seed.
- **Techo absoluto de 7 días.** `SESSION_MAX_LIFETIME_MS` es lo único que le pone fin
  a una sesión robada y usada discretamente, porque las 8 horas se renuevan solas.
  Vive en las guardas y **no** en `maxAge` a propósito: ahí el token deja de
  decodificar y la persona aparece deslogueada sin motivo en pantalla.

Los textos son literales del proyecto: *"Se cambió la contraseña de esta cuenta, así
que esta sesión dejó de valer…"* y *"Por seguridad, las sesiones duran como máximo 7
días y esta ya los cumplió…"*

## 2.3 Tres capas de autorización

| Capa | Qué mira | Para qué sirve |
|---|---|---|
| Proxy (`proxy.ts`) | Los roles del **token** | Filtro barato; redirige al login |
| Layout de zona | `requireAdmin()` / `requireMember()` | Pinta la pantalla de bloqueo con el motivo |
| Cada server action y route handler | `requireAdmin` / `requireSuperadmin` / `requireSuperadminUsers` / `requireMember` | **La autorización real** |

El proxy no alcanza por una razón estructural: una server action no se invoca por su
URL. Next la despacha por el id del encabezado `Next-Action` contra un manifiesto
global del build, así que un POST a la raíz ejecuta igual una action declarada bajo
el panel: cada action que escribe es, a efectos prácticos, un endpoint público.

La guarda de administración corre seis verificaciones en orden: sesión sin id; el
token no trae el rol exigido (rechazo **sin tocar la base**); el id no es entero
positivo; la fila viva de `User` no existe, está inactiva o ya no tiene el rol; la
sesión es anterior al cambio de contraseña; la sesión superó el techo. El token
conserva un solo papel y es el barato: **puede quitar el permiso, nunca darlo**. La
guarda del socio resuelve contra la ficha viva y ordena distinto —id inválido, sin
ficha, sesión rancia, sesión vencida, baja, suspensión y recién al final la cuenta
deshabilitada—, para que al dado de baja le toque el mensaje que le importa.

## 2.4 Roles, degradación y `/redirigir`

Los roles son **acumulables** y el módulo que los interpreta es puro y sin
dependencias, así que lo comparten el proxy, el layout y las actions:

| Rol | Qué habilita |
|---|---|
| `superadmin` | Todo lo del panel de gestión, más las secciones reservadas y los actos irreversibles |
| `admin` | El panel de gestión |
| `socio` | El panel del socio |

La pantalla `/redirigir` lee la sesión después del login y manda al panel que
corresponde, con el sitio público como último destino.

**Con un rol degradado**, la revocación se asienta al instante pero el JWT ya emitido
sigue diciendo lo de antes hasta 8 horas. Durante esa ventana la navegación lateral y
las tarjetas del tablero pueden mostrar secciones que ya no corresponden: **eso es
display**. La primera acción que se intente ejecutar resuelve contra la fila viva y
la rechaza con *"No tenés permiso para editar el padrón."* Es la razón de que la
navegación no se considere nunca un control de acceso. El modo lectura del socio
suspendido es el mismo mecanismo del otro lado: con `allowSuspended` puede consultar
su cuenta, descargar recibos y pagar, y las actions que mutan usan la guarda pelada,
que lo corta citando el Art. 10.

**Dónde está en el código.** `src/auth.config.ts`, `src/proxy.ts`,
`src/lib/auth/require-admin.ts`, `src/lib/auth/require-member.ts`,
`src/lib/auth/session-freshness.ts`, `src/lib/auth/verify-credentials.ts`,
`src/lib/auth/roles.ts`, `src/app/redirigir/page.tsx`.

# 3. Tokens de un solo uso

Los enlaces que viajan por correo se acuñan con 32 bytes aleatorios en `base64url` y
**sólo el sha256 se persiste**: quien lea la base no puede entrar con lo que ve.

| Propósito | TTL | Quién lo emite | Dónde se canjea |
|---|---|---|---|
| `email_verification` | 7 días | El panel (envío de acceso) y el wizard ASOCIATE | `/verificar/[token]` |
| `password_invitation` | 7 días | El panel sobre una ficha con correo cargado, la admisión de un alta, y el propio canje de la verificación de correo | `/acceso/[token]` |
| `password_reset` | **30 minutos** | El formulario público de recupero | `/ingresar/restablecer/[token]` |
| `admin_invitation` | 7 días | Un superadmin de usuarios, al crear una cuenta | `/acceso/[token]` |

**El consumo es atómico.** Un doble clic manda dos POST simultáneos, y
leer-y-después-escribir dejaría una ventana en la que los dos pasan. La marca de uso
va con un `updateMany` condicionado a que la columna de uso siga en nulo: la
condición la evalúa la base, gana exactamente uno y el otro ve cero filas afectadas.
Es el patrón que después copiaron las transiciones de estado de reportes.

**Cuándo se revoca al emitir.** La regla, escrita en la cabecera del módulo: sólo
donde quien emite ya está autenticado o ya demostró tener el buzón. Los enlaces de
ficha se emiten detrás de la guarda de administración y de dos limitadores, así que
revocar los anteriores no es un arma y evita que "no me llegó" deje varios enlaces de
siete días vivos en paralelo. El de recupero **no** se revoca al emitir, porque el
formulario es público y anónimo y cualquiera que conozca una dirección podría matarle
al socio el enlace del buzón: ahí la invariante "un solo enlace vivo" se sostiene en
el canje. Un cambio de correo en la ficha revoca los enlaces vivos de ese socio.

**Dónde está en el código.** `src/lib/tokens.ts` (acuñado, TTL, canje y la regla de
revocación en su cabecera); `src/lib/members/access.ts:235` y
`src/app/admin/solicitudes/actions.ts:88` son los dos emisores de invitación que no
son el envío manual del panel; `src/lib/members/write.ts` revoca por cambio de correo.

# 4. Turnstile

La regla: **captcha en todos los formularios públicos anónimos; nada en las rutas que
ya se abren con un token de un solo uso**. Donde hay un enlace irrepetible no hay
nada que enumerar sin él, y sumarle un captcha sólo castiga al vecino que ya pasó la
barrera.

Llevan Turnstile el paso 1 y el envío de ASOCIATE, el reenvío del enlace de retome,
el paso 1 de REEMPADRONATE, el reenvío del enlace de una presentación, el paso 1 del
wizard de Reportes —el único paso que puede crear filas desde afuera—, `/ingresar` y
`/ingresar/recuperar`. No lo llevan `/acceso/[token]`, `/verificar/[token]`,
`/ingresar/restablecer/[token]`, los dos `retomar/[token]` ni `/reportes/nuevo/[claim]`.

**El verificador falla cerrado**: sin secreto, sin token, con una respuesta que no sea
correcta o con la red caída devuelve falso. Un captcha que aprueba cuando no puede
verificar no es un captcha. En desarrollo se usan las claves dummy de Cloudflare, que
aprueban siempre. Hay además una guarda de **build**: si falta cualquiera de las dos
claves, `next build` tira. Se hace en el build y no al arrancar a propósito — romper
el arranque dejaría al gestor de procesos en un ciclo de reinicios y se llevaría
puesto el sitio público y los webhooks, mientras que cortar el build deja intacta la
versión que ya sirve. El captcha **se suma** a los limitadores; no reemplaza a ninguno.

**Dónde está en el código.** `src/lib/turnstile.ts`; la guarda de build está en
`next.config.ts` y corre sólo en la fase de build de producción.

# 5. Cupos (rate limiters)

Hay **21 limitadores** sobre una misma implementación: un mapa en memoria del proceso
con ventana deslizante y poda de claves vencidas a partir de las 10.000. La API
distingue consultar-y-registrar de sólo consultar —cuando una operación pregunta a
varios hay que registrar recién si **todos** dieron cupo— y devuelve el cupo cuando la
operación no llegó a ocurrir. El default es 5 en 15 minutos. El de 240 por hora del
sondeo de solicitudes es correcto —24 lecturas por espera de checkout— y es el tipo de
número que alguien "corrige" a la baja sin saber por qué está.

| Limitador | Clave | Cupo | Ventana | Qué raciona |
|---|---|---|---|---|
| `loginLimiter` | Correo e IP | 5 | 15 min | Fuerza bruta contra una cuenta |
| `ipLimiter` | IP | 20 | 15 min | Barrido de muchas cuentas desde un origen |
| `verificationMemberLimiter` | Socio | 3 | 60 min | Envío de verificación o invitación de ficha |
| `verificationActorLimiter` | Operador | 20 | 60 min | Barrido de muchos socios desde una sesión |
| `publicTokenLimiter` | IP | 30 | 60 min | POST de canje de enlaces (cuestan un bcrypt) |
| `applicationStatusLimiter` | IP | 240 | 60 min | Sondeo del estado de una solicitud |
| `passwordResetIpLimiter` | IP | 10 | 60 min | Mailbombing desde un origen |
| `passwordResetEmailLimiter` | Casilla | 5 | 60 min | Inundación del buzón de un socio |
| `applicationCreateLimiter` | IP | 5 | 60 min | Creación de solicitudes de alta |
| `resumeResendLimiter` | IP | 3 | 60 min | Reenvío del enlace de retome |
| `resumeResendTargetLimiter` | DNI pedido | 3 | 60 min | Espejo del anterior, por objetivo |
| `asociateEmailLimiter` | Casilla declarada | 5 | 60 min | Los dos correos del wizard, juntos |
| `memberPayLimiter` | Socio | 5 | 60 s | "Pagar ahora" (cada clic crea una preferencia) |
| `memberEditLimiter` | Socio | 6 | 60 s | Edición de datos propios |
| `reregistrationLookupLimiter` | IP | 5 | 15 min | Búsqueda por DNI del paso 1 de REEMPADRONATE |
| `reregistrationResendLimiter` | DNI pedido | 3 | 60 min | Reenvío del enlace de una presentación |
| `asociateDniCheckLimiter` | IP | 5 | 15 min | Chequeo por DNI del paso 1 de ASOCIATE |
| `reportDraftLimiter` | IP | 5 | 60 min | Creación del borrador de un reporte |
| `reportSubmitLimiter` | IP | 5 | 60 min | Envío de un reporte (dispara dos correos) |
| `reportUploadLimiter` | IP | 30 | 60 min | Subida de archivos contra la llave del borrador |
| `reportMemberLimiter` | Socio | 5 | 24 h | Reportes de un socio desde su panel |

Dos criterios antes de agregar el número 22: los que apuntan a un objetivo
identificable —casilla, DNI— se consultan y registran **siempre**, exista o no la
cuenta, para que el techo no sea un oráculo de existencia; y las pantallas
autenticadas se limitan por identidad, para que dos vecinos detrás del mismo CGNAT no
se gasten el cupo entre ellos.

**El proceso tiene que ser uno solo.** Limitadores y mutex por clave viven **en la
memoria del proceso**: con más de una instancia el techo real pasa a ser N veces el
configurado y la invariante "una sola solicitud viva por DNI" desaparece sin ruido,
porque MySQL no tiene índices parciales. Y la IP sale **únicamente** de `X-Real-IP`,
que Nginx sobrescribe: sin esas líneas del server block, todos los limitadores por IP
colapsan en una sola clave y nada avisa.

**Dónde está en el código.** `src/lib/auth/rate-limiter.ts`,
`src/lib/keyed-mutex.ts`, `docs/10` §2.

# 6. Cabeceras y CSP

`next.config.ts` es el archivo más cargado de decisiones de seguridad del proyecto:
unos 18 KB, casi todo comentario. La entrada global aplica a todas las rutas una CSP
armada con arrays de orígenes con nombre, más `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
y una `Permissions-Policy` que apaga cámara, micrófono y geolocalización.

```text
default-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'
script-src  'self' 'unsafe-inline' (+ 'unsafe-eval' en dev) sdk.mercadopago.com
            http2.mlstatic.com challenges.cloudflare.com
img-src     'self' data: blob: wms.ign.gob.ar tile.openstreetmap.org
connect-src 'self' api.mercadopago.com
frame-src   'self' www.mercadopago.com.ar challenges.cloudflare.com
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
upgrade-insecure-requests
```

`'unsafe-inline'` en los scripts es un trade-off deliberado: Next 16 emite el payload
de los componentes de servidor como script inline y la portada lleva JSON-LD; la
alternativa (nonces) obliga a servir todo dinámico y rompería el cacheo por tags del
Módulo 2. La consecuencia está en el capítulo 8. `blob:` lo necesita la vista previa
de fotos del wizard de Reportes. **HSTS no la emite Next**: la termina Cloudflare,
que es quien ve el TLS.

## 6.1 Nueve entradas específicas y la lección de `setHeader`

Después de la global hay nueve entradas por ruta, y la lección que las explica vale
aprenderla una vez: **Next copia las cabeceras de la configuración con `setHeader`,
que REEMPLAZA**. Una CSP emitida en el `Response` de un route handler **nunca llega
al cliente** salvo que haya una entrada específica declarada **después** de la
global. Las entradas pisan por clave, así que reponer sólo la CSP no toca las demás.

| Ruta | Qué repone o cambia |
|---|---|
| Documento de un alta | CSP dura con `frame-ancestors 'self'` más `X-Frame-Options: SAMEORIGIN` (tiene visor embebido) |
| Documento de una presentación | Idéntico, por el mismo visor |
| PDF institucional del socio | CSP dura con `frame-ancestors 'none'`, sin tocar el `DENY` global |
| PDF institucional del panel | Idéntico |
| Archivo de reporte (panel) | `REPORT_FILE_CSP` |
| Archivo de reporte (socio) | `REPORT_FILE_CSP` |
| PDF de un reporte | `REPORT_FILE_CSP` |
| Wizard público de reportes | `Permissions-Policy` con `geolocation=(self)`, para "Usar mi ubicación" |
| Wizard de reportes del socio | Idéntico |

Van entradas explícitas y no comodines a propósito: las rutas no comparten prefijo, y
un `source` con comodín capturaría rutas que todavía no existen, incluida alguna que
sí necesite framing.

## 6.2 El test que compara contra la constante, y el caso de la cartelera

Un test puede mentir muy fácil acá: si asertara el string a mano quedaría verde
contra una entrada muerta. Por eso `tests/report-file-routes.test.ts` **importa la
configuración de Next** —invocándola en la fase de servidor de desarrollo, para
saltear la guarda de Turnstile que exige un `.env`— y exige que la cabecera de cada
una de las tres entradas sea **exactamente** la constante del módulo, que estén
declaradas **después** de la global, que no definan un `X-Frame-Options` propio y que
la constante traiga `frame-ancestors 'none'`. Además deriva las rutas desde una lista
de tres archivos y verifica en disco que existan. Un test hermano hace lo mismo con
la constante de los documentos institucionales y un tercero fija la política de
permisos.

Dos familias de rutas emiten su CSP dura en el `Response` y **no** tienen entrada en
la configuración: el PDF de un aviso de cartelera y los PDF de recibos. Por lo dicho
arriba, esa cabecera no llega y rige la global. Está registrado en
`docs/manuales/HALLAZGOS-2026-09-11.md`; acá sólo se deja constancia de que el
mecanismo es el ya conocido y no uno nuevo.

**Dónde está en el código.** `next.config.ts`, `src/lib/reports/file-response.ts`,
`src/lib/institutional-documents/response.ts`, `tests/report-file-routes.test.ts`,
`tests/institutional-documents-routes.test.ts`, `tests/reports-headers.test.ts`.

# 7. Archivos

| Contenido | Raíz | Cómo se sirve |
|---|---|---|
| Documentos de altas y presentaciones | `UPLOADS_DIR` | Ruta autenticada **y auditada** |
| Portadas de noticias | `UPLOADS_DIR/news/` | Ruta **pública**, con caché inmutable |
| Documentos institucionales | `UPLOADS_DIR/institucional/` | Ruta autenticada, socio y panel |
| Archivos de reportes | `UPLOADS_DIR/reports/` | Rutas de panel y de socio |
| PDF de recibos | `RECEIPTS_DIR` | Ruta del panel (auditada) y ruta del propio socio |

Los nombres son UUID y los directorios van con permisos 750 en el servidor. Ninguna
raíz está dentro de `public/` ni del repositorio.

## 7.1 Magic bytes

La extensión y el tipo declarado los elige quien sube: no son evidencia. Hay
**cuatro** sniffers, cada uno con su allowlist y su tope, y elegir mal es el error
típico de quien agrega una subida nueva.

| Función | Admite | Tope |
|---|---|---|
| `sniffDocument` | jpg, png, webp y pdf | 10 MB |
| `sniffImageExt` | jpg, png, webp | 5 MB |
| `sniffImage` | jpg, png, webp (no pdf) | 10 MB |
| `sniffPdf` | Sólo pdf | 10 MB |

El tamaño se valida **dos veces**: el declarado lo pone el llamador y un archivo
sintético puede mentir, así que el límite real se aplica sobre los bytes que van al
disco. Los identificadores se validan antes de armar una ruta —hay que exigir un
entero positivo, porque el tipo `number` es promesa de compilación y no garantía de
runtime— y la ruta de un recibo se valida con una expresión regular completa **donde
se toca el disco**, no sólo donde se arma, porque viaja guardada en una fila.

## 7.2 `sharp` en Reportes, y la deuda de los DNI

Toda imagen de un reporte pasa por `sharp` **antes de tocar el disco**: se aplica y
se descarta la orientación EXIF, se acota el lado mayor y se re-codifica a JPEG. No
se llama al método que conservaría los metadatos, y *no llamarlo* es exactamente lo
que los borra; un test verifica que el EXIF resultante sea indefinido. Por eso la
columna de tipo de esos archivos es una **constante**: no existe "el archivo tal cual
llegó". El motivo no es de formato sino de contenido: una foto sacada del celular en
la esquina del problema trae el GPS, y guardarla cruda publica el domicilio de quien
reclama.

> Los DNI de ASOCIATE y de REEMPADRONATE **se siguen guardando tal cual llegan**. Es
> deuda anotada en `docs/08`, no una diferencia de criterio.

## 7.3 Cabeceras de descarga, retención y purga

El patrón que copian las demás rutas son seis cabeceras:

| Cabecera | Valor |
|---|---|
| `Content-Type` | El que decidió el sniffer del servidor, nunca el declarado por el cliente |
| `Content-Disposition` | `inline`, con un nombre derivado de ese tipo |
| `Cache-Control` | `no-store, private` |
| `Vary` | `Cookie` |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `default-src 'none'; sandbox` |

Por qué `inline` y no `attachment`, con su límite dicho: el sniffer valida la *firma*
y no el contenido completo, así que un archivo que empieza con bytes de JPEG y sigue
con HTML pasa. Lo impiden en capas el `nosniff`, un tipo que sólo puede ser uno de
cuatro valores del servidor, y la CSP dura —el patrón que usa GitHub para contenido
crudo—, que tiene que bastarse sola. Lo que **no** cubre también está dicho: el
JavaScript embebido en un PDF corre dentro del visor y no pasa por la política de
scripts. Un `attachment` obligaría al operador a bajar cada DNI al disco de la
vecinal, que es justo lo que la política quiere evitar. Dos detalles sostienen el
aislamiento: el identificador del dueño va en el `where` **desde la URL** —sin ese
filtro, un número tipeado a mano serviría el documento de otro expediente a cualquier
operador— y la extensión del nombre de archivo se deriva del tipo del servidor, nunca
de la ruta guardada.

Las imágenes de DNI de un reporte se conservan **360 días** después de presentado o
desestimado; los borradores no enviados, **48 horas**. La purga es el primer paso del
cron del resumen diario y corre **todos los días, también los tranquilos**: si
corriera después de decidir si hay novedades, un día sin nada que contar saltearía
una obligación legal. El lote está topeado en 200 filas por corrida y por paso; el
tope existe **por tiempo**, porque la purga corre dentro de la ventana de 60 segundos
del proxy, y la operación es idempotente, así que un atraso se drena en noches
consecutivas. Se audita **sólo si hubo algo que purgar**: la auditoría es el rastro
de un hecho, no un latido.

**Dónde está en el código.** `src/lib/documents/storage.ts`,
`src/lib/news/images.ts`, `src/lib/reports/images.ts`,
`src/lib/institutional-documents/storage.ts`, `src/lib/treasury/receipts-dir.ts`,
`src/lib/reports/retention.ts`.

# 8. Ley 25.326 en el código

La política vive en `docs/08`. Lo que sigue es dónde está implementada.

| Punto | Regla |
|---|---|
| Logs del gestor de procesos | El mensaje de todo error se enmascara y se corta a 200 caracteres |
| `Notification.error` | Sólo el **código** del fallo, nunca la dirección |
| Bloqueo por allowlist | Se registra el motivo, nunca la casilla |
| Errores de Mercado Pago | Descriptor propio: el SDK no lanza un `Error` y la conversión directa daría `[object Object]` |
| Errores de sistema de archivos | Sólo el código; nunca la ruta absoluta, que el mensaje trae entera |
| Asientos de visualización | Identificadores y tipo, nada más |
| Resúmenes de cron | Contadores, períodos y códigos; ninguna dirección |
| Pantalla de salud | Identificadores largos enmascarados y resúmenes higienizados |
| Lookups públicos por DNI | Nombre enmascarado, del estilo "¿Sos M****** P.?" |

El enmascarado de correos es deliberadamente laxo con lo que acepta como dirección:
tapar de más en un log no le cuesta nada a nadie, y tapar de menos es un dato
personal en claro. Vive en un módulo propio y sin dependencias, no dentro del
procesador de webhooks de donde salió, porque importar un helper de strings desde el
cron terminaba arrastrando el procesador entero con su singleton.

## 8.1 `EMAIL_ALLOWLIST`: la guarda va en el transporte

La allowlist **envuelve el transporte de Nodemailer**, así que cubre wizard, panel y
cron por igual y una pantalla nueva no puede olvidarse de aplicarla. El bloqueo viaja
como excepción con un código propio, y ese literal tiene una sola fuente: el mailer
lo importa para decidir que ese fallo **no** escribe una fila fallida. No es un
detalle: si contara, en producción —donde la allowlist está puesta— una sola corrida
de devengo dejaría unas 160 filas rojas y la pantalla de salud nacería inservible. Un
bloqueo no es un fallo, es el entorno de prueba andando. Y viaja como excepción y no
como retorno silencioso porque los llamadores ya compensan un fallo de envío —queman
el token, devuelven el cupo— y un bloqueo mudo escondería que la prueba no probó nada.

El tope de correos por corrida es un **presupuesto inyectado** y no un contador de
módulo: el procesador del webhook es un singleton de proceso y un contador global lo
habría dejado mudo después de 50 correos hasta el próximo reinicio. El cupo se
devuelve cuando el envío termina sin correo, así que el tope cuenta correos *mandados*
y no intentos, y un valor vacío o inválido cae al default de 50.

## 8.2 404 en vez de 403, y lo que queda abierto

Pedir el recibo de otro devuelve **404**, con el mismo cuerpo que un identificador
inexistente y **sin tocar el disco**: un 403 confirmaría que ese recibo existe, y la
serie es correlativa. Mismo criterio para los archivos de un reporte —un único texto
para "no existe" y "es ajeno"— y para las transiciones de estado, donde cero filas
afectadas responden lo mismo para "ya está resuelto" y para "no existe". No se
loguean direcciones, DNI, nombres, domicilios ni texto libre del operador; en el
`detail` de un asiento van identificadores, códigos, conteos y montos, y nada más.

La superficie de XSS conocida y acotada es una sola: el cuerpo de una noticia se
renderiza como HTML, y su sanitización es la **única** defensa, porque la política de
scripts incluye `'unsafe-inline'` y no puede atajar lo que se escape. Todo camino de
escritura a ese campo tiene que pasar por el sanitizador —hoy son las dos actions del
ABM y nada más—; una migración o un arreglo manual en la base que lo escriban directo
son XSS almacenado sin nada que los frene. La revisión adversarial neutralizó más de
70 payloads y la sanitización es idempotente. La allowlist de esquemas de enlace tiene
cuatro entradas:

- `http`
- `https`
- `mailto`
- `tel`

Los textos legales de configuración, en cambio, se guardan como texto plano: menos
superficie, a propósito.

Dos apuntes finales. `robots.txt` **no es control de acceso** y el comentario del
archivo lo dice: su lista cubre el panel y toda ruta cuya URL *es* un secreto. Y la
portada de una noticia en borrador se sirve a cualquiera que conozca su URL, que es
un UUID que no aparece en el HTML público: decisión consciente, documentada.

**Dónde está en el código.** `src/lib/log-safe.ts`,
`src/lib/members/masked-name.ts`, `src/lib/email/transport.ts`,
`src/lib/email/batch-cap.ts`, `src/lib/news/sanitize.ts`, `src/app/robots.ts`.

# 9. Auditoría

`audit()` es **best-effort**: traga sus errores, los manda a consola y sigue. Es lo
correcto porque hay unos 15 sitios que corren asientos sueltos sin su propio manejo de
errores y dependen de que un hipo de la base no les rompa el flujo principal.
`auditStrict()` propaga, y es para el caso en que el asiento **es** la señal: hoy son
tres llamadores —el aviso de solicitud revivida por pago tardío que escribe el
procesador del webhook, el cierre del libro de re-empadronamiento y la edición de
ficha en modo carga, que degrada a un aviso explícito cuando el asiento no se pudo
persistir—.

La entrada lleva actor, acción, entidad, identificador, detalle e IP. Un nulo pelado
en la columna JSON se **omite**, porque Prisma lo rechaza. Y hay una convención
transversal: **la IP la escribe la action, no el servicio**, porque es la única capa
que ve las cabeceras.

**El asiento que lee la ficha del alta** explica por qué existe la variante estricta.
Cuando un pago de ingreso llega *después* de que la solicitud venció, el estado final
es el mismo que el de una aceptación normal: la única señal de que llegó tarde —y de
que al expirar se canceló el débito— es un asiento con una acción propia, que la ficha
y la cola buscan por el índice de entidad e identificador. El nombre de esa acción
vive en un módulo puro y no en el procesador: si el string se desincroniza, el aviso
desaparece de la pantalla sin que nada falle.

| Sección | Asientos principales |
|---|---|
| Altas | `application_record`, `application_reject`, `application_recategorize`, `application_document_view` |
| Reportes | `report_filed`, `report_dismissed`, `report_dni_view`, `report_retention_purge` |
| Padrón | `member_admit`, `member_update`, `member_withdraw`, `member_readmit`, `member_suspend`, `member_category_change` |
| Acceso del socio | `member_send_verification`, `member_send_verification_failed`, `member_login_email_moved` |
| Exportaciones | `padron_export`, `book_export`, `electoral_roll_export`, `minute_export` |
| Cobros | `cash_payment_create`, `payment_link_create`, `receipt_void`, `receipt_email`, `receipt_view`, `arrears_declared` |
| Mercado Pago | `unmatched_resolve`, `subscription_linked`, `subscription_cancelled`, `payment_foreign` |
| Valores y exenciones | `fee_value_create`, `fee_value_applied`, `fee_exemption_create`, `fee_exemption_revoke` |
| Contenido | `minute_create`, `news_publish`, `activity_create`, `institutional_document_create` |
| Sistema | `config_update` (uno por clave cambiada), `holiday_create`, `notification_resent` |
| Usuarios | `user_create`, `user_enable`, `user_disable`, `role_grant`, `role_revoke`, `admin_invitation_sent` |
| Re-empadronamiento | `reregistration_call`, `presentation_validate`, `presentation_document_view`, `board_notice_post`, `reregistration_withdrawal`, `book_close` |
| Webhook | `webhook_rejected_signature`, `webhook_legacy_ipn` |

Hay **no-asientos deliberados**, los tres con su porqué escrito al lado:

| Qué no audita | Cuándo | Dónde |
|---|---|---|
| El flag de débito de la ficha | El valor no cambia (recarga o doble clic) | `socios/[id]/actions.ts:548` |
| La llave de elecciones | El valor no cambia | `padron-electoral/actions.ts:40` |
| El lote de actualización de suscripciones | No se tocó ninguna suscripción | `tesoreria/valores/actions.ts:72` |

**Auditoría por visualización.** Cada vez que alguien *mira* un documento personal
—el DNI de un alta, el documento de una presentación, la foto del DNI de un reporte,
el PDF de un recibo desde el panel— queda un asiento. Es la contrapartida de servirlos
`inline` en vez de obligar a bajarlos: el archivo no se copia al disco de la vecinal,
pero cada apertura deja rastro. El asiento lleva identificadores y tipo, nunca el
nombre del titular ni su DNI ni la ruta en disco.

**Dónde está en el código.** `src/lib/audit.ts`, `src/lib/applications/query.ts` y
los route handlers de documentos bajo `src/app/api/`.

# 10. Webhook y crons: los dos canales sin sesión

El webhook de Mercado Pago es el único endpoint que escribe dinero sin sesión detrás,
y su orden importa:

1. Sin secreto configurado, responde 500.
2. Se detecta si es una notificación legacy **antes** de parsear el cuerpo, porque
   esas llegan con el cuerpo vacío.
3. Si el cuerpo no parsea y es legacy, asiento propio y **200**; si no es legacy, 400.
4. El identificador del dato se normaliza y se valida contra una expresión regular
   acotada, porque entra sin escapar al manifiesto que se firma. Admite letras: los
   identificadores de suscripción son hexadecimales de 32 caracteres, así que uno de
   sólo dígitos habría rechazado **todos** los avisos de débito.
5. Se valida la firma: tolerancia de ±5 minutos, manifiesto armado, HMAC-SHA256 y
   comparación en tiempo constante. Firma inválida, 401.
6. Se inserta o se recupera la fila del evento por su unique: **primera barrera de
   idempotencia**. Un duplicado ya procesado responde 200.
7. Recién ahí corre el procesador. Un error técnico devuelve 500, que es cuando
   conviene que Mercado Pago reintente.

Dos decisiones que cuesta redescubrir. **Lo que no atendemos responde 200**, no 4xx:
la notificación legacy y las de orden de comercio son legítimas en un formato que el
sistema no implementa, y un 4xx sostenido es algo que el proveedor puede terminar
deshabilitando —ahí se perdería también la buena—. Y este endpoint audita **antes** de
autenticar, o sea que es un canal de escritura anónimo sobre la tabla de auditoría:
por eso sólo audita cuando vinieron **ambos** encabezados de firma, y la notificación
legacy tiene una acción propia —los dos primeros días en producción el panel decía
"51 avisos rechazados por firma inválida" y 49 eran el funcionamiento normal—.

**Los cinco endpoints de cron** comparten una sola guarda: sin secreto configurado
responden **503** y con un bearer que no coincide, **401**. La comparación es en
tiempo constante y el largo se compara antes, porque la función tira si difiere y el
largo del secreto no es un secreto. Las cinco rutas declaran runtime de Node
explícitamente: en Edge la guarda no existiría. Y los nombres de los trabajos viven en
un mapa clave-igual-a-valor para que un typo no compile: uno mal escrito dejaría a la
pantalla de salud con una corrida fantasma y la buena figuraría como "nunca corrió".

**Dónde está en el código.** `src/app/api/webhooks/mp/route.ts`,
`src/lib/mp/signature.ts`, `src/lib/cron/auth.ts` y las cinco rutas bajo
`src/app/api/cron/`.

# 11. Calidad

```bash
npm test                  # suite completa
npm run test:integration  # sólo integración, contra una MariaDB real
```

La corrida de referencia del 11/09/2026 da **297 archivos** y **4183 casos**, de los
cuales se saltean 4 archivos y 14 casos: los de integración, que se saltean enteros si
no está la variable que apunta a la base de pruebas. En los 293 archivos restantes **no
hay un solo salteo** —ni `describe.skip`, ni `it.skip`, ni `.only`—: la suite principal
corre entera, siempre.

Hay **dos configuraciones**. La principal corre en entorno de Node con la zona horaria
fijada en UTC, porque el servidor corre en UTC y así los tests de formato ejercitan de
verdad la conversión a hora argentina. La de integración agrega
`fileParallelism: false`, porque los cuatro archivos hablan con **una** base
compartida y dos que tocan la misma fila producen justo el síntoma que REG-33 prohíbe
—un hueco en la numeración— sin que haya ningún bug; dentro de un archivo el
paralelismo sigue intacto, que es lo que vienen a ejercer. Las dos **no** se heredan
una de otra a propósito: al fusionarlas los arrays se concatenan y el filtro de
integración terminaba incluyendo toda la suite.

**La suite principal no requiere `.env`**, y es una garantía frágil: varios módulos
construyen un singleton que explota al evaluarse si falta la URL de la base. En los
módulos puros ese cliente **se inyecta, no se importa**.

**Integración** necesita una MariaDB real y migrada (la de Docker sirve) en una
variable propia, y cada archivo usa **un año propio** para no pisarse. Verifican que
20 transacciones concurrentes pidiendo número de recibo devuelvan 1 a 20 sin huecos ni
repetidos y que una fallida no consuma número; que dos avisos del mismo cobro no
produzcan dos pagos; la **forma real** del error de unique del adapter de MariaDB; y
el reparto de un cobro, con su tiempo contra el límite de 5 segundos.

## 11.1 Los trece tests "de fuente"

Un test de fuente lee archivos del repositorio y fija una convención que ningún
render podría verificar. Conviene conocerlos antes de mover una ruta.

| Test | Qué fija |
|---|---|
| `admin-nav.test.ts` | Cada entrada de la navegación del panel tiene su página en disco; el filtrado por rol y el orden |
| `public-nav.test.ts` | Los enlaces públicos son únicos, existen en disco y conservan su orden |
| `treasury-tabs.test.ts` | Cada pestaña de Tesorería tiene su página, y la marca de activa funciona en subrutas |
| `reports-headers.test.ts` | Las dos páginas del wizard existen y sólo ellas levantan la geolocalización |
| `report-file-routes.test.ts` | Importa la configuración de Next y exige la CSP exacta, el orden y la **pureza** del módulo de respuesta |
| `institutional-documents-routes.test.ts` | Lo mismo para los PDF institucionales, con el `DENY` global intacto |
| `news-images.test.ts` | El módulo de URL de imágenes no importa nada de Node (lo consume un componente de cliente) |
| `section-tabs.test.ts` | Prohíbe color crudo de Tailwind, exige que las 8 barras importen del módulo y **el negativo**: la barra móvil del socio no debe migrar |
| `dashboard-cards.test.ts` | Cada sección viva tiene exactamente una tarjeta, con el mismo título y el mismo alcance de rol |
| `applications-query.test.ts` | Parte la pantalla del alta por sus tres guardas y fija qué afirma cada rama |
| `asociate-wizard-client.test.ts` | Le quita los comentarios al wizard y fija lo que hace imposibles dos bugs reales de producción |
| `mp-subscription-status.test.ts` | Fija **sólo el negativo** de la pantalla de vinculación |
| `reports-boundary.test.ts` | Compara vértice por vértice el KML del barrio contra la constante del código |

El del wizard **quita los comentarios** antes de medir, porque los archivos comentan a
propósito lo que el código ya no puede hacer: así se mide el programa y no la prosa. Y
el de las pestañas incluye un negativo deliberado —migrar la barra móvil "por
prolijidad" volvería a confundir dos niveles de navegación—, que es la clase de regla
que sólo un test de fuente puede sostener.

Los dobles de base siguen dos reglas: **honran los `where` que reciben** en vez de
reimplementarlos como constantes, y **emulan el rollback**. Una forma de consulta
desconocida **tira**, para que un test nuevo no pase por un filtro ignorado en
silencio. La lección del Módulo 6: la única prueba de que una guarda se está probando
es borrarla y ver el test en rojo.

## 11.2 Las otras verificaciones, y qué no hay

Además de las suites: `npx tsc --noEmit` —la configuración incluye también los
scripts, así que un script roto corta—, `npm run lint` y `npm run build`. El build es
una verificación real: ahí corren la guarda de claves de Turnstile y la guarda de URL
base, que rompen la compilación antes de que un despliegue mal configurado llegue a
servir.

**No hay CI.** Las suites y el lint se corren a mano, y nada impide desplegar con la
suite en rojo, porque el script de despliegue no corre tests. En su lugar el proyecto
sostiene la calidad con una **verificación manual de cierre de módulo**: no se cierra
un módulo sin recorrer sus criterios de aceptación con el operador —en local para lo
que toca dinero, en el sitio productivo para lo que no—, y varias de las lecciones más
caras salieron de ahí.

**Dónde está en el código.** `vitest.config.mts`, `vitest.integration.config.mts`,
`tests/`, `tests/helpers/`, `package.json`, `deploy.sh`.

# 12. Deuda conocida y decisiones abiertas

Lo identificado y no resuelto. El desarrollo de cada punto está en
`docs/manuales/HALLAZGOS-2026-09-11.md`, el archivo que acompaña a esta serie con las
diferencias entre `docs/` y el código detectadas en el relevamiento. Van ahí, entre
otros, dos hallazgos de este documento: las **dos familias de rutas cuya CSP no llega**
—el PDF de un aviso de cartelera y los PDF de recibos— y el **comentario
desactualizado** de `src/lib/audit.ts` (líneas 38-40), que dice que la variante
estricta tiene "un solo llamador" cuando hoy tiene tres.

- **CSP que no llega, en dos familias de rutas**: el PDF de un aviso de cartelera y
  los PDF de recibos emiten `default-src 'none'; sandbox` en el `Response` pero no
  tienen entrada en `next.config.ts`, así que rige la CSP global (6.2).
- **Los DNI de los dos wizards se guardan tal cual llegan**, con su EXIF (7.2).
- **`docs/08` da por existentes dos cosas que no están**: `npm audit` en un CI que no
  existe, y un webhook de Brevo que el enum contempla pero nadie implementó.
- **La premisa de un solo proceso no está forzada por nada**: subir el número de
  instancias rompe cupos y mutex en silencio.
- **`X-Real-IP` es la única fuente de IP** y depende enteramente de Nginx; no figura
  entre los controles de `docs/08`, que es donde se lo buscaría al auditar.
- **Cloudflare puede bloquear un POST sin dejar rastro** en los logs: el único caso
  conocido en que un vecino queda afuera sin señal (`docs/10` §4.8).
- **Pendientes del servidor sin confirmación posterior** (`docs/09`, 17/08/2026): el
  firewall inactivo y la rotación de logs de Docker. Aparte, `docs/08` deja abierta la
  recomendación de deshabilitar en SSH la autenticación por contraseña — `docs/09` no
  la menciona: sólo registra el puerto 2222 y el usuario root.
- **Mantenimiento manual sin índice**: el host del túnel de desarrollo, los cuatro
  sniffers y los tres topes de lote, que cuentan cosas distintas.
- **`EMAIL_ALLOWLIST` sigue definida en producción**: borrarla es un paso del
  checklist de lanzamiento de `docs/07`.

**Dónde está en el código.** Nada de este capítulo vive en un solo archivo: los
punteros son los de los capítulos 6 a 11, más `docs/09` (estado del servidor) y
`docs/manuales/HALLAZGOS-2026-09-11.md`.

# Documentos relacionados

**De esta serie:** T1 (visión y panorama), T2 (arquitectura y capas), T3 (instalación,
despliegue y operación: el `.env`, el crontab, los backups y la pantalla de salud),
T4 (modelo de datos: auditoría, tokens, notificaciones y eventos de webhook), T5
(tesorería y Mercado Pago: el núcleo de cobro y la idempotencia del dinero) y T6
(módulos de dominio, con sus reglas estatutarias).

**Del proyecto:**

- `docs/08-seguridad-y-privacidad.md` — la política acordada con el cliente.
- `docs/02-marco-estatutario.md` — las reglas `REG-xx` que se citan acá.
- `docs/10` — runbook del dominio productivo: verificaciones post-deploy y
  diagnóstico de bloqueos de Cloudflare.
- `docs/11` — sandbox de Mercado Pago, Turnstile y las escotillas de los crons.
- `docs/manuales/HALLAZGOS-2026-09-11.md` — las diferencias entre `docs/` y el código
  detectadas en el relevamiento del 11/09/2026.
