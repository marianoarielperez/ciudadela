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
- **Ubicación**: mapa embebido de la sede + dirección + contacto.
- **Estatuto**: página con el PDF del estatuto embebido/descargable (el reformado,
  una vez oficializado por IGJ; configurable).
- Footer: datos legales, "Sistema SIGeV", acceso al login (`/ingresar`).

Diseño: mobile-first (el público entra desde el celular), color primario #2E9BDF,
tipografía simple, accesible (población de todas las edades).

## 2. ASOCIATE (wizard público)

Precondición: `asociate_activo=true` y sin re-empadronamiento en curso.
Todos los pasos con Turnstile validado y aceptación de términos + consentimiento
de datos personales (textos en Configuracion).

**Paso 1 — ¿Dónde vivís?**
- Opción A: "En el Barrio Ciudadela" → buscador de calle con autocompletado sobre
  la tabla Calle (matchea `nombre_normalizado` y también `orden_carga` numérico;
  ej.: "hernandez", "Hernández", "1906" encuentran "Hernandez , Jose"). + campo altura.
- Opción B: "En otro barrio" → calle y barrio a mano (texto libre).

**Paso 2 — Categoría**
- Si Ciudadela: elegir **ACTIVO** ($X/mes obligatoria, voz y voto, puede ocupar cargos)
  o **ADHERENTE** (cuota voluntaria de $Y, voz sin voto en asambleas, vota en elecciones).
  Los montos se leen de los Planes de MP (cache diario). Si eligió Adherente,
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

**Paso 4 — Documentación**
- Upload obligatorio: DNI frente y dorso (foto/imagen). Opcional/according: hasta 2
  anexos (factura de servicios a su nombre, certificado, boleta de inmueble…).
  Para Colaborador, al menos 1 anexo de vinculación es obligatorio.

**Paso 5 — Pago / envío**
- Ramas con débito (Activo, Colaborador, Adherente-con-débito):
  - Pantalla informativa ANTES de ir a MP: "El primer débito corresponde a la
    **cuota de ingreso** (equivale a un mes de cuota). **No es reembolsable**,
    cualquiera sea el resultado de tu solicitud. Luego se debitará la cuota mensual."
  - Se crea la suscripción por API (`/preapproval` con `external_reference` =
    solicitud, ver doc 06) y se redirige al checkout de MP para autorizar.
  - Al volver + webhook de autorización y primer pago OK → estado
    `aprobada_pendiente_acta` → pantalla y email: "¡Bienvenido/a! Tu solicitud fue
    **aceptada**. El alta formal se asentará en la próxima reunión de la Comisión
    Directiva y ahí quedará registrada tu fecha de ingreso." + email de verificación
    de domicilio electrónico + invitación a crear contraseña.
  - Abandono del checkout: la solicitud queda `pendiente_pago` 7 días con email
    recordatorio con link para retomar; luego expira.
- Rama sin débito (Adherente que no adhiere):
  - Envío directo → `pendiente_cd` → email "Tu solicitud fue recibida y será
    tratada por la Comisión Directiva" + verificación de email.

## 3. Panel admin — Solicitudes

Bandeja con filtros por estado. Detalle de solicitud: todos los datos + visor de
documentos (visualización auditada) + historial.

Acciones:
- **Asentar en acta** (para `aprobada_pendiente_acta` y para aprobar `pendiente_cd`):
  selección múltiple de solicitudes → elegir/crear Acta (tipo CD, número, fecha) →
  se crean Socio + Membresía (número siguiente del libro abierto) + Movimiento alta
  con `fecha_ingreso` = fecha del acta. Soporta alta masiva (N solicitudes, 1 acta).
- **Recategorizar**: cambia la categoría de la solicitud; si tiene suscripción MP
  activa y el plan/monto difiere, el sistema actualiza la suscripción por API y
  registra el cambio. Luego sigue el circuito normal.
- **Rechazar**: exige acta y deja constancia; si hubo cuota de ingreso debitada,
  se retiene (REG-12.b) y se cancela la suscripción en MP por API. Setea
  `rechazo_hasta` = fecha + 6 meses sobre el DNI (REG-05).

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
  la CD cambió el plan en MP.

## 6. Panel admin — Noticias, Actas, Configuración

- Noticias: ABM con imagen, borrador/publicada.
- Actas: ABM (tipo, número, fecha, descripción) + vista de movimientos asociados.
- Configuración (superadmin): interruptores (`asociate_activo`, `elecciones_en_curso`),
  textos legales, feriados, usuarios y roles, salud del sistema.

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
