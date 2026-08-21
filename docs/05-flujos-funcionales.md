# 05 — Flujos funcionales

## 1. Sitio público

### Home
- **Hero**: `assets/hero.jpg` (foto aérea del barrio) con overlay sutil en el tercio
  inferior para legibilidad, logo, nombre de la asociación y los dos botones:
  **ASOCIATE** y **REEMPADRONATE**.
  - `asociate_activo=false` o proceso de re-empadronamiento activo → ASOCIATE se
    muestra deshabilitado con banner: "Las asociaciones están suspendidas
    temporalmente durante el proceso de re-empadronamiento (hasta el DD/MM)".
  - REEMPADRONATE solo visible/activo si hay proceso en 1ª o 2ª instancia.
- **Cartelera digital**: últimas noticias publicadas (tarjetas con imagen, título,
  fecha; detalle en `/noticias/[slug]`).
- **Ubicación** (`/ubicacion`): mapa embebido de la sede (OpenStreetMap) +
  dirección + contacto (teléfono y email desde `Configuracion`).
- **Estatuto**: NO tiene página pública. Por decisión del 19/08/2026 se difiere al
  panel del socio (Módulo 5), como PDF servido detrás de autenticación.
- Footer: datos legales, "Sistema SIGeV", acceso al login (`/ingresar`).

Navegación pública: **Inicio · Noticias · Actividades · Ubicación** (más
"Ingresar", que en el celular vive dentro del menú colapsable).

Diseño: mobile-first (el público entra desde el celular), color primario #2E9BDF,
tipografía simple, accesible (población de todas las edades).

### Actividades (`/actividades`) — Módulo 2

Calendario semanal de los dos salones de la sede (Salón Histórico y Salón
Vidriado) con selector de año — solo se listan los años que tienen actividades
visibles. La grilla se lee por día: los siete días de la semana, y en cada uno
las actividades ordenadas por hora con su nombre, horario y salón. En el celular
los días sin actividades se resumen en una línea al pie en vez de ocupar una
tarjeta cada uno.

La carga es desde `/admin/actividades` (nombre, salón, días de la semana,
horario, año, visible en el sitio público sí/no). El alta que se superpone con
otra actividad visible del mismo salón y año se rechaza nombrando a la que ya
estaba.

## 2. ASOCIATE (wizard público)

Precondición: `asociate_activo=true` y sin re-empadronamiento en curso.
Aceptación de términos + consentimiento de datos personales (textos en
`Configuracion`, **texto plano** editable por el superadmin) y **Turnstile
validado server-side en el paso 3** — que es el único paso que escribe en la
base y el único que puede filtrar información del padrón. Los pasos 1 y 2 no
tocan la base; los 4 y 5 ya operan sobre una solicitud creada y se autentican
con el token de retome.

**Arquitectura**: `/asociate` es una sola ruta con un componente cliente de 5
pasos. El paso 3 crea la `Application` y devuelve el **token de retome** (crudo
solo en el cliente; en la base vive su sha256). Un refresh antes del paso 3
pierde el progreso — son dos pantallas cortas, se aceptó a cambio de no escribir
filas basura. A partir del paso 3, `/asociate/retomar/[token]` rehidrata la
solicitud en el paso que corresponda; ese mismo enlace es el `back_url` del
checkout de MP y el que viaja en el email de recordatorio de pago.

**Paso 1 — ¿Dónde vivís?**
- Opción A: "En el Barrio Ciudadela" → buscador de calle con autocompletado sobre
  la tabla Calle (matchea `nombre_normalizado` y también `orden_carga` numérico;
  ej.: "hernandez", "Hernández", "1906" encuentran "Hernandez , Jose"). + campo altura.
- Opción B: "En otro barrio" → calle y barrio a mano (texto libre).

**Paso 2 — Categoría**
- Si Ciudadela: elegir **ACTIVO** ($X/mes obligatoria, voz y voto, puede ocupar cargos)
  o **ADHERENTE** (cuota voluntaria de $Y, voz sin voto en asambleas, vota en elecciones).
  Los montos se leen de los **dos** Planes de MP (caché de 24 h): "SOCIO ACTIVO"
  y "SOCIO ADHERENTE/COLABORADOR", que adherentes y colaboradores comparten. Si
  la API de MP no responde y no hay caché, el paso muestra un error y **no deja
  avanzar**: nunca se inventa un monto. Si eligió Adherente,
  sub-elección: "¿Querés adherir al débito automático de la cuota voluntaria?" Sí/No.
  Si el usuario adherente marca que SÍ va a pagar, mostrar aviso suave: "Sabías que
  por el mismo valor de compromiso podés ser socio ACTIVO con voz y voto? Podés
  cambiar tu elección acá." (no bloquear).
- Si otro barrio: única opción **COLABORADOR** ($Y/mes obligatoria). Aviso de que
  deberá acreditar vinculación con el barrio (inmueble, familiar residente, o
  comercio/actividad en la zona).

**Paso 3 — Tus datos**
- Nombre y apellido, DNI, fecha de nacimiento (validar 18+), estado civil,
  nacionalidad, ocupación, teléfono, email (con confirmación de tipeo).
- Orden de las guardas al enviar: **interruptor de ASOCIATE → consulta del cupo
  → Turnstile → zod → consumo del cupo → bloqueos por DNI → creación**.
  - El **interruptor** (`asociate_activo`) se revalida en la server action, no
    sólo al renderizar la página: la pestaña que quedó abierta cuando la CD lo
    apagó, y un POST armado a mano, no vuelven a pasar por el render. Se lee
    **directo** contra `Configuration`, sin la caché de las páginas públicas: es
    una guarda de autorización y un valor viejo dejaría entrar solicitudes con
    las asociaciones ya cerradas. Va primero de todo por claridad, no por
    ahorro: la consulta del cupo es una lectura en memoria que no cobra nada
    (el cobro es el `record` posterior), así que ponerla antes o después no
    cambia lo que gasta nadie.

    **Ojo, el interruptor no frena lo ya empezado.** Suspende las altas
    NUEVAS. Una solicitud creada antes del apagado sigue su curso hasta
    vencer (7 días): puede subir documentos, y si es de las que van con
    débito, `startPaymentAction` va a crear igual la suscripción en MP y a
    cobrar la cuota de ingreso, que no es reembolsable. Es deliberado —el
    vecino que ya empezó tiene derecho a terminar— pero significa que apagar
    ASOCIATE no corta los cobros de inmediato: la cola se vacía sola en una
    semana. Si hace falta un corte inmediato (por ejemplo al abrir un
    re-empadronamiento), hay que rechazar a mano las solicitudes vivas desde
    la bandeja.
  - El **rate limit por IP (5/h) es de dos fases**: primero se *consulta* si
    queda cupo (sin gastarlo) y recién después del captcha y de zod se *consume*
    el intento. La separación es deliberada: así un captcha vencido —la ficha
    de Turnstile dura 5 minutos y el paso 3 puede llevar más— y los errores de
    tipeo (son ~16 campos y el formulario reporta uno por vez) no le queman al
    vecino los 5 intentos de la hora. El intento se cobra justo antes de la
    primera consulta al padrón, que es lo único que hay que racionar.
  - Validar la forma (zod) antes de consultar el padrón no debilita el
    anti-enumeración: la validez de FORMATO no depende del padrón (es zod sobre
    el POST, sin consulta), cada intento sigue costando un captcha resuelto —el
    token de Turnstile es de un solo uso— y todo lo que toca el padrón sigue
    detrás del captcha y del cupo ya consumido.
- La creación corre dentro de una transacción que revalida la invariante **"una
  sola solicitud viva por DNI"** (MySQL no tiene índices parciales).

**Bloqueos por DNI del paso 3** (regla pura y testeada, en este orden):

| Condición | Qué ve el vecino |
|---|---|
| Ya tiene una solicitud viva con ese DNI | "Ya tenés una solicitud en trámite" + botón para reenviarse el enlace de retome **al email de aquella solicitud**, que nunca se muestra en pantalla |
| Socio `vigente` o `suspendido` | "Ya estás asociado/a a la vecinal" (al suspendido no se le revela la suspensión) |
| Baja por expulsión / `reentryBlocked` (REG-04) | "No podemos procesar tu solicitud por este medio. Acercate a la sede vecinal." — genérico, sin motivo |
| Baja por **fallecimiento** o **anulación por duplicado** | El **mismo** mensaje genérico de sede (decisión de Mariano, 20/08/2026): un DNI vivo contra una ficha de fallecido es error de datos o suplantación, y la ficha anulada tiene su gemela real en el padrón. Ninguna de las dos cosas se discute por un formulario web |
| Baja por mora, o con deuda al momento de la baja (REG-16) | "Tenés una deuda pendiente con tesorería. Acercate a la sede vecinal para regularizarla." |
| Rechazo de menos de 6 meses, sobre la ficha o sobre una solicitud anterior (REG-05) | "No podés presentar una nueva solicitud por el momento" + la fecha exacta a partir de la cual puede reintentar |
| Cualquier otra baja sin deuda (renuncia, mudanza, no re-empadronado) | **Continúa**: la solicitud guarda el `memberId` y el asiento será un **reingreso** sobre la ficha original, no un socio duplicado (REG-25) |
| DNI desconocido | Continúa (alta común) |

Los mensajes de "sede" no distinguen expulsión de fallecimiento ni de anulación:
quien golpea el formulario con DNIs ajenos no puede deducir nada del padrón.

**Paso 4 — Documentación**
- Upload obligatorio: DNI frente y dorso (foto/imagen). Opcional/according: hasta 2
  anexos (factura de servicios a su nombre, certificado, boleta de inmueble…).
  Para Colaborador, al menos 1 anexo de vinculación es obligatorio.
- JPG, PNG, WebP o PDF, máximo 10 MB por archivo, validados por **magic bytes**
  (no por extensión). Se guardan en `UPLOADS_DIR/applications/{id}/` con nombre
  UUID.

**Paso 5 — Pago / envío**
- Ramas con débito (Activo, Colaborador, Adherente-con-débito):
  - Pantalla informativa ANTES de ir a MP: "El primer débito corresponde a la
    **cuota de ingreso** (equivale a un mes de cuota). **No es reembolsable**,
    cualquiera sea el resultado de tu solicitud. Luego se debitará la cuota mensual."
  - Se crea la suscripción por API (`/preapproval` con `external_reference` =
    solicitud, ver doc 06) y se redirige al checkout de MP para autorizar.
  - Al volver + webhook de autorización y primer pago OK → estado
    `approved_pending_minute` → pantalla y email: "¡Bienvenido/a! Tu solicitud fue
    **aceptada**. El alta formal se asentará en la próxima reunión de la Comisión
    Directiva y ahí quedará registrada tu fecha de ingreso."
    La aceptación llega **siempre por webhook**, nunca por el retorno del
    checkout: el `back_url` solo dice "estamos confirmando tu pago" y sondea el
    estado.
  - Abandono del checkout: la solicitud queda `pending_payment`; el cron manda
    **un** recordatorio con el enlace de retome y a los 7 días expira (§10).
- Rama sin débito (Adherente que no adhiere):
  - Envío directo → `pending_board` → email "Tu solicitud fue recibida y será
    tratada por la Comisión Directiva".

**Cuándo sale cada correo** (desvío acordado respecto de la versión original de
este documento): el **email de verificación del domicilio electrónico es
inmediato**, al crear la solicitud en el paso 3 (REG-08). La **invitación a crear
la contraseña NO se manda al aceptar sino al asentar en acta**, porque una cuenta
de acceso (`User`) no puede existir sin ficha de socio (`Member`): antes del
asiento no hay a qué colgarla. Ver §3.

## 3. Panel admin — Solicitudes (`/admin/solicitudes`)

Bandeja con filtros por estado y búsqueda por nombre/DNI, paginada a 50 como el
padrón. Badge **"Reingreso"** mientras la solicitud está viva y matcheó una ficha
existente (después del asiento el campo `memberId` lo tienen todas, así que deja
de ser señal: la distinción real la resuelve el detalle mirando el Movimiento).

Detalle `/admin/solicitudes/[id]`: todos los datos, estado de la suscripción MP,
visor de documentos e historial de auditoría. Los documentos se sirven por
`GET /api/admin/solicitudes/[id]/documentos/[docId]` con `requireAdmin`,
`Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff` y un
asiento de auditoría **por cada visualización** (Ley 25.326, `docs/08`).

Acciones:
- **Asentar en acta** (para `approved_pending_minute` y para aprobar `pending_board`):
  selección múltiple de solicitudes → elegir/crear Acta (tipo CD, número, fecha) →
  se crean Socio + Membresía (número siguiente del libro abierto) + Movimiento alta
  con `fecha_ingreso` = fecha del acta. Soporta alta masiva (N solicitudes, 1 acta),
  con el patrón anti-acta-huérfana del padrón: si el lote entero falla, el acta
  recién creada se descarta. Al asentar: se completa `MpSubscription.memberId`, la
  solicitud pasa a `completed`, se copia el domicilio declarado a la ficha
  (y a la cuenta de acceso, si tenía) y **recién ahí sale la invitación de
  acceso**, solo si el email quedó verificado.
- **Reingreso** (la solicitud traía `memberId`): no se crea socio nuevo. Se
  reactiva la ficha con la categoría solicitada, `fecha_ingreso` **intacta**
  (REG-11), Movimiento `reingreso` y reapertura de la cuenta de acceso si la
  tenía.
  **Domicilio electrónico**: si la ficha ya tenía **esa misma dirección** en
  estado `verificado`, la verificación **se conserva** aunque la solicitud nueva
  venga sin verificar (decisión de Mariano, confirmada el 20/08/2026). El
  domicilio electrónico ya estaba acreditado ante la vecinal (Art. 5° quater) y
  degradarlo a `declarado` por no volver a hacer clic dejaría al reingresante sin
  invitación al portal sin ningún motivo. Si la dirección **cambió**, manda la de
  la solicitud y hay que verificarla de nuevo.
- **Recategorizar**: cambia la categoría de la solicitud; si tiene suscripción MP
  y el monto de la categoría nueva difiere, actualiza la suscripción por API
  **antes** de tocar la fila local (si MP falla, la acción se corta entera) y
  sincroniza el `planId`.
  **No bloquea por residencia**: la Comisión puede apartarse del criterio de los
  Art. 5 y 5 bis —el caso caro es "vive fuera del barrio → activo", que da voto y
  elegibilidad—, pero no en silencio. La pantalla muestra el domicilio declarado y
  advierte antes de guardar, y la auditoría queda con `residenceMismatch`, para
  que el acta pueda reflejar que se decidió a sabiendas.
- **Rechazar**: exige acta y deja constancia (REG-13); si hubo cuota de ingreso
  debitada, se retiene (REG-12.b, y el email de rechazo lo dice) y se cancela la
  suscripción en MP por API — si la cancelación falla, la pantalla lo avisa para
  hacerlo a mano. El bloqueo de 6 meses (REG-05) sale de `rechazo_hasta` sobre la
  ficha cuando hay socio, y de la fecha de decisión de la propia solicitud
  rechazada cuando no lo hay.
- **Solicitud revivida por un pago tardío**: cuando un pago aprobado llega después
  del vencimiento, la solicitud vuelve a `approved_pending_minute` (ver `docs/06`
  §4) y queda **marcada**: aviso en el detalle y, cuando la suscripción figura
  cancelada, badge rojo **"Sin débito"** en la bandeja. Al expirar, el cron
  canceló la suscripción, así que hay que rehacerla a mano antes de asentar el
  alta: el sistema no la re-crea solo.

**Resumen para el acta** (`/admin/solicitudes/resumen?mes=YYYY-MM`): pantalla
imprimible + export Excel, con **tres** listas (no dos):

1. **Aceptadas pendientes de asiento** — todas las vivas, **sin filtrar por mes**.
2. **Pendientes de decisión de la CD** — ídem, todas las vivas.
3. **Asentadas en el mes** — estas sí filtradas, por la fecha real del asiento.

Las dos primeras van sin filtro a propósito: una solicitud aceptada no tiene
fecha de aceptación (no hay columna, y `updatedAt` se mueve con cualquier
escritura), y filtrarlas por mes escondería a la que entró en julio y todavía
espera acta — justo la que no hay que olvidar. El "mes" se calcula en hora
**argentina**, no UTC: a las 22:30 del 31/08 en Comodoro ya es septiembre en UTC
y el operador vería un acta vacía.

## 4. Panel admin — Socios (Libro)

- Listado del libro abierto: número, nombre, DNI, categoría, estado, email
  (con su estado de verificación), deuda (cuotas pendientes), débito automático sí/no.
  Filtros y búsqueda. Export Excel.
- Ficha de socio: datos completos, documentos, historial de movimientos con actas,
  cuenta corriente (cuotas y pagos), notificaciones cursadas, suscripción MP.
- **Modo carga de fichas** (crítico para el arranque): edición rápida de los 163
  vigentes importados, con todos los campos en una pantalla, guardado con Ctrl+S /
  botón, y navegación "anterior / siguiente por número de socio". Al cargar un email:
  botón "enviar verificación + invitación de acceso".
- Acciones con acta: baja (motivo del catálogo), cambio de categoría, reingreso
  (si es cesante por mora, muestra deuda calculada a valor vigente, REG-16),
  suspensión (desde/hasta).
- Export **Padrón electoral** (REG-31): parámetro fecha de elección → Excel/PDF.

## 5. Panel admin — Tesorería

- **Conciliación**: pagos entrantes por webhook ya aplicados (solo se miran);
  pendientes de matching (pago MP sin socio identificable) con buscador para
  asignar a mano.
- **Registrar pago en efectivo**: buscar socio → monto y concepto (cuota período X /
  ingreso / voluntaria / extraordinaria) → genera Pago + Recibo PDF numerado →
  se imprime y/o se envía por email.
- **Generar link de pago**: para socio con cuotas pendientes → crea preferencia de
  Checkout Pro con `external_reference` → copia el link o lo envía por email.
- **Recibos**: listado, reimpresión, envío. Serie única `AAAA-NNNNN`.
- **Deudores**: socios con cuotas impagas; a partir de 4 (REG-15), botón
  "proponer cesantía" que arma el lote para el acta.
- **Valores de cuota**: pantalla que muestra los montos actuales de los Planes MP
  (API) vs. tabla ValorCuota local; botón "registrar nuevo valor" (con acta) cuando
  la CD cambió el plan en MP. Como las suscripciones se crean sin plan asociado y
  copian el monto (`docs/06` §2), cambiar el valor en MP no se propaga solo a las
  suscripciones vigentes: la pantalla incluye también la acción "aplicar el nuevo
  valor de cuota a las suscripciones vigentes" (REG-34) — recorre las suscripciones
  activas de la categoría, empuja el monto por API a cada una, con progreso,
  reintento de las que fallen, asiento de auditoría y pantalla de "quedaron N sin
  actualizar".

## 6. Panel admin — Noticias, Actividades, Actas, Configuración

- Noticias: ABM con editor visual básico e imagen de portada, borrador/publicada.
- Actividades: ABM del calendario de salones (ver `/actividades` en §1).
- Actas: ABM (tipo, número, fecha, descripción) + vista de movimientos asociados.
- Configuración (solo superadmin): interruptor de ASOCIATE (`asociate_activo`),
  datos de contacto (teléfono y email que muestra el sitio público), los **textos
  legales del wizard** (términos y consentimiento de datos) y los **ids de los dos
  planes de Mercado Pago**.
  Los textos legales se guardan y se renderizan como **texto plano** (con saltos
  de línea respetados), no como HTML: es un desvío deliberado de la spec del
  Módulo 3 —menos superficie de XSS, y un pliego de condiciones no necesita
  marcado—. El seed carga un borrador inicial y **no lo repone** si alguien lo
  vacía a mano: el precio de no pisar las ediciones del superadmin.
  Pendientes de módulos posteriores: `elecciones_en_curso`, feriados, usuarios y
  roles, salud del sistema.

## 7. Panel de socio (`/mi`)

Login email + contraseña (Auth.js). Recupero por email.
- **Mis datos**: ver todo, editar teléfono/email/domicilio (cambio de email exige
  re-verificación; cambio de domicilio queda marcado "pendiente de constatación"
  para la CD).
- **Mi cuenta**: estado (categoría, número de socio, antigüedad), cuotas pendientes
  y pagadas, recibos descargables.
- **Pagar**: si hay pendientes, botón que genera el link de Checkout Pro por los
  períodos seleccionados. Si es adherente sin débito: botón "hacer un aporte
  voluntario" y/o "adherir al débito automático".
- **Solicitar baja** (REG-19): formulario con motivo opcional → texto de renuncia
  generado y timestampeado → aviso de que la CD debe aceptarla → estado visible.
- Suspendidos: panel en solo-lectura con aviso de la suspensión.

## 8. REEMPADRONATE (wizard público, Art. 9° bis)

Precondición: proceso en `primera_instancia` o `segunda_instancia`.

**Paso 1 — Identificación** (privacidad primero):
- Inputs: **DNI + apellido** (coincidencia exacta de DNI y parcial de apellido,
  case/tilde-insensitive) → si matchea un adherente vigente del proceso, muestra
  nombre enmascarado "¿Sos M****** P.?" para confirmar. Si no matchea, mensaje
  genérico "No encontramos una coincidencia" (sin revelar si el DNI existe).
  Rate limit estricto (p. ej. 5 intentos/15 min por IP) + Turnstile.
- Nota operativa: esto requiere que los DNI de los 105 adherentes estén cargados
  ANTES de abrir el proceso (modo carga de fichas). El proceso no puede activarse
  si hay adherentes vigentes sin DNI (validación al activar, con listado de faltantes).

**Paso 2 — Confirmación/actualización de datos**: domicilio (calle del catálogo +
altura), teléfono, email (obligatorio declarar uno; dispara verificación).

**Paso 3 — Documentación**: DNI frente y dorso obligatorios + hasta 2 anexos
(factura de servicios, etc.) para acreditar domicilio.

**Paso 4 — Envío**: declaración jurada de veracidad → Presentacion `presentada`
con timestamp (lo que prueba el cumplimiento del plazo) → email de constancia.

**Panel admin — Re-empadronamiento**:
- Activación: elegir libro, fecha de convocatoria, acta de convocatoria, fecha de
  oficialización IGJ (REG-27, muestra cuenta regresiva de 90 días), fecha estimada
  de elecciones (REG-26, advierte si <180 días). Al activar: se notifica a todos
  los adherentes vigentes por email (los sin email o rebotados quedan en lista
  "vía cartelera" con generación del PDF para imprimir y fijar, y registro de
  fechas de cartelera).
- Tablero: totales por estado, días restantes de cada instancia.
- Validación de presentaciones: ver datos + documentos → `validada` / `observada`
  (con nota; el socio recibe email y puede subsanar mientras el proceso esté abierto)
  / `rechazada`.
- Al vencer 1ª instancia: botón "iniciar 2ª instancia" → notifica a los no
  presentados (+10 días, REG-22).
- Al vencer 2ª instancia: botón "preparar cierre" → genera borrador de acta de
  bajas (REG-23) con el detalle de notificaciones de cada uno.
- **Cierre de libro** (transaccional, REG-28): con acta de cierre confirmada →
  bajas `cesantia_no_reempadronado` (con `recurso_hasta`) → se cierra el libro →
  se abre el siguiente → migran vigentes no adherentes + adherentes validados →
  renumeración por `fecha_ingreso` ascendente (empate: número anterior ascendente)
  → Movimientos `migracion_libro` → pantalla resumen + export del nuevo padrón.
  Vista previa obligatoria antes de confirmar (mostrar el resultado completo).
  Reversible solo restaurando backup (avisar en pantalla).

## 9. Reglas transversales de notificación

Cada email estatutario crea una Notificacion; los webhooks de Brevo actualizan
`entregada`/`rebotada`; un rebote en notificación estatutaria genera tarea admin
"pasar a cartelera" (REG-10) con impresión del aviso y registro de fechas.

**Guarda de pruebas (`EMAIL_ALLOWLIST`)**: mientras la variable esté definida,
un transporte envolvente bloquea todo envío a direcciones que no estén en la
lista y lo registra sin escribir la dirección completa en el log. La guarda está
en el **transporte**, no en cada llamador: cubre wizard, panel y cron por igual,
y no hay forma de esquivarla agregando una pantalla nueva. Producción **no** la
define — borrarla es un paso del checklist de lanzamiento de `docs/07`.

## 10. Mantenimiento automático de solicitudes (cron diario)

`POST /api/cron/applications`, protegido por `Authorization: Bearer
${CRON_SECRET}` (comparación timing-safe; sin la variable el endpoint responde
503). Lo dispara el crontab del VPS, no la app (`docs/03`, bloque copiable en
`docs/11`). Cada corrida:

1. **Recordatorio de pago** — solicitudes en `pending_payment` creadas hace 3 días
   o más y sin recordatorio previo: email con el enlace de retome, y se sella la
   fecha para no repetirlo nunca.
2. **Expiración** — solicitudes en `started` o `pending_payment` **creadas hace 7
   días o más**: pasan a `expired` y, si tenían suscripción, se cancela en MP
   best-effort (si MP falla queda contado, no bloquea la corrida). El corte es
   por `createdAt`, **no** por última actividad: el vecino que retoma el trámite
   el día 6 y sube documentos vence igual en la corrida del día 7. Es
   deliberado —el plazo es del trámite, no de la sesión— pero conviene tenerlo
   presente al leer los contadores.
   `approved_pending_minute` y `pending_board` **no vencen nunca**: ahí la pelota
   la tiene la Comisión Directiva, y al vecino no se le puede caer una solicitud
   por una demora que no es suya.
3. Devuelve `{reminded, expired, errors}` y deja asiento de auditoría de la
   corrida — incluso si falló a la mitad, porque ese asiento es el único registro
   consultable de qué alcanzó a hacer.

La ventana efectiva del recordatorio es **de 3 a 7 días**: quien entra al sistema
recién al sexto día y medio recibe el aviso y expira en la corrida siguiente, con
menos de 24 h de margen. Es correcto (nunca expira antes de avisar), pero apretado.
