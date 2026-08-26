# Módulo 6 — Re-empadronamiento y cierre de libro: diseño aprobado

**Fecha:** 25/08/2026 · **Estado:** aprobado por el operador (cuatro rondas de decisiones + dos aclaraciones)

Este documento es la spec del Módulo 6. Prevalece sobre `docs/02` §re-empadronamiento,
`docs/04` §ProcesoReempadronamiento, `docs/05` §8 y `docs/07` §Módulo 6 donde difieran;
las diferencias deliberadas están marcadas como **enmienda**.

---

## 1. Alcance

1. **Proceso de re-empadronamiento** (Art. 9° bis): entidad con ciclo de vida propio,
   convocada por acta, con 1ª y 2ª instancia, tablero y validación de presentaciones.
2. **Wizard público REEMPADRONATE**: identificación por DNI, ficha completa,
   documentos, declaración jurada, constancia.
3. **Carga presencial** desde el panel (Art. 9° bis a: "presencial o electrónica").
4. **Circuito de cartelera completo** (REG-10): feriados, días hábiles, PDF
   imprimible, registro por lotes, notificación fehaciente al cumplirse el plazo.
5. **Cierre de libro por etapas** (Art. 40, REG-28): checklist pre-cierre, bajas por
   `not_reregistered` con ventana de recurso, migración transaccional al libro
   siguiente con renumeración por antigüedad.
6. **Reorganización de `/admin/socios`**: pestañas por URL Padrón | Libros |
   Histórico, listado rediseñado, libros consultables con export, padrón histórico.
7. **Sección nueva `/admin/reempadronamiento`** en el grupo Gestión.

**El proceso es repetible por diseño**: referencia al libro que depura y su cierre
abre siempre `número + 1`. El proceso del Libro 2 (en ~2 años) usa las mismas
pantallas sin tocar código. El historial de procesos queda consultable.

**Fuera de alcance:** ver §15.

---

## 2. Decisiones del operador (25/08/2026)

| # | Decisión | Elección |
|---|---|---|
| 1 | Alcance del Art. 40 (depuración incluye mora del Art. 9) | **Checklist pre-cierre**: muestra los cesanteables por mora con link al lote de Deudores; advierte, no bloquea. La cesantía sigue siendo decisión humana (REG-15). Hoy son 7 socios (verificado contra `deuda.xlsx` × `padron_socios.xlsx`) |
| 2 | Plazos del Art. 9° bis (30/10/30) y Art. 40 (90) | **Días corridos** (interpretación conservadora, art. 6 CCyC). La cartelera sigue en 20 días **hábiles** porque su artículo lo dice |
| 3 | Vía presencial | **Sí**: carga admin de la presentación de quien se acerca a la sede |
| 4 | Email | **Obligatorio en ambas vías** (web y presencial): el re-empadronamiento constituye el domicilio electrónico del Art. 5° ter |
| 5 | REG-26 (180 días antes de elecciones) | **Sin validación**: se guarda y muestra la fecha estimada, sin advertir ni bloquear (enmienda a docs/05 "advierte") |
| 6 | Circuito de cartelera | **Completo** (feriados + PDF + fehaciente al CUMPLIRSE los 20 días hábiles) y **por lotes**: la unidad de trabajo del operador es el aviso, nunca el socio individual |
| 7 | Recurso (Art. 9° bis d) | **Mínimo viable**: se guarda notificación fehaciente y `appealUntil` (+30 corridos); un recurso acogido se resuelve con el REINGRESO existente (número nuevo al final del libro abierto, `joinedAt` intacto) |
| 8 | Identificación del wizard | **DNI solo** (enmienda a docs/05 "DNI+apellido") + Turnstile + rate limit + confirmación por nombre enmascarado. **Sin precarga de datos guardados, salvo el email** |
| 9 | Datos del wizard | **Ficha completa sin el nombre**: nacimiento, estado civil, nacionalidad, ocupación, domicilio (catálogo + altura), teléfono, email. Es LA oportunidad de completar las fichas vacías del padrón |
| 10 | Efecto sobre la ficha | La presentación **no toca la ficha**; los datos se vuelcan a `Member` recién cuando el admin la marca validada |
| 11 | Numeración del libro nuevo | **REG-28 confirmado**: renumeración densa 1..N por `joinedAt` ascendente; empate → número del libro anterior ascendente |
| 12 | Adherentes suspendidos | **Participan** (notificados, pueden presentarse; sin presentación caen en la baja). Los no adherentes suspendidos migran conservando su suspensión |
| 13 | Observaciones | Siempre **por email** (toda presentación tiene email); sin circuito de cartelera para observaciones |
| 14 | Libro cerrado | Consultable como foto de solo lectura **+ export a Excel auditado** |
| 15 | Estructura del panel | **Socios en pestañas (Padrón / Libros / Histórico) + sección propia Reempadronamiento** en Gestión |
| 16 | Reutilización | **Proceso por libro**: cada cierre abre el libro siguiente; nada hardcodea "Libro 2" |

---

## 3. Marco estatutario: lecturas fijadas

- **Art. 40 leído entero**: la depuración transitoria aplica los criterios de
  cesantía del Art. 9 completo (incluida la mora) y no solo el 9° bis. Se resuelve
  con el checklist pre-cierre (decisión 1), sin automatizar ninguna cesantía.
- **Notificación fehaciente**: email → al enviarse al domicilio electrónico
  registrado (Art. 5° ter). Cartelera → al **cumplirse** los 20 días hábiles
  (`boardTo`), nunca al fijarse. `appealUntil` cuenta desde la fecha fehaciente.
- **El recurso de 30 días es para interponerlo** (única lectura operable del
  Art. 9° bis d); la asamblea que lo trate llegará casi seguro con el libro nuevo
  ya abierto — por eso el acogimiento es un reingreso, no una reapertura del cierre.
- **Sin validaciones de calendario**: ni los 180 días pre-electorales (REG-26) ni la
  periodicidad de 2 años del Art. 9° bis se validan (decisión 5; la periodicidad
  del estatuto es además un TECHO — depurar al menos cada 2 años—, no un piso,
  al revés de como lo redactó REG-28).
- **Cohorte fija**: la convocatoria alcanza a los **adherentes vigentes (activos y
  suspendidos de categoría adherente) al momento de activar**. Un adherente creado
  después (recategorización de la CD durante el proceso) NO fue convocado, queda
  fuera del proceso y migra como cualquier vigente. Un cohortado que deja de ser
  adherente vigente por otro camino (baja, recategorización) sale del alcance de la
  baja por no re-empadronamiento: la etapa de bajas solo toca a quien sigue siendo
  adherente vigente sin presentación validada.

### Correcciones a documentos existentes (van en este módulo)

1. `docs/02` línea ~44 y dos comentarios de `prisma/schema.prisma` (`Notification`)
   citan **"Art. 5° quater"**: el artículo correcto es **5° ter** (el 5 quater no
   existe). Corregir las tres citas.
2. `docs/05` §8: actualizar paso 1 (DNI solo, decisión 8) y paso 2 (ficha completa,
   decisión 9).
3. `docs/07` §Módulo 6 CA: decía "staging con datos reales"; el simulacro corre en
   **local** (staging dado de baja el 20/08/2026).

---

## 4. Modelo de datos

Cuatro tablas nuevas, dos retoques. Todo por `prisma migrate`.

### 4.1 `reregistration_processes` (`ReregistrationProcess`)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Int PK | |
| `bookId` | FK → `books` | el libro que se depura |
| `status` | enum `ReregistrationStatus` | `preparing \| first_instance \| second_instance \| closing \| closed` |
| `calledAt` | DateTime | fecha de convocatoria (fecha del acta) |
| `firstEndsAt` | DateTime | `calledAt` + 30 días corridos |
| `secondEndsAt` | DateTime? | se fija al iniciar la 2ª instancia (+10 corridos) |
| `igjApprovedAt` | DateTime? | oficialización IGJ (Art. 40; solo informativo, los procesos futuros no la cargan) |
| `estimatedElectionAt` | DateTime? | se muestra, sin validación (decisión 5) |
| `callMinuteId` / `closeMinuteId?` | FK → `minutes` | actas de convocatoria y de cierre |
| `createdAt` | | |

`Configuration.reregistration_process_id` (clave nueva en `config-keys.ts`):
seteada = proceso activo → ASOCIATE suspendido y REEMPADRONATE visible. Se limpia
al cerrar. Lectura **directa** (`configReader`, sin caché) en las guardas, como
`asociate_activo`.

### 4.2 `presentations` (`Presentation`)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Int PK | |
| `processId` + `memberId` | FKs, `@@unique([processId, memberId])` | cohorte: una fila por adherente convocado, creada en `pending` al activar |
| `status` | enum `PresentationStatus` | `pending \| submitted \| observed \| validated \| rejected \| withdrawn` |
| `channel` | enum `PresentationChannel?` | `web \| in_person` (null mientras `pending`) |
| datos declarados | | `birthDate`, `civilStatus`, `nationality`, `occupation`, `streetId`/`streetText`, `streetNumber`, `neighborhood`, `phone`, `email` (obligatorio al presentar) — mismos anchos que `Member` |
| `submittedAt` | DateTime? | la prueba del cumplimiento del plazo |
| `validatedById` / `validatedAt` | | |
| `observation` | VarChar(500)? | nota de la observación |
| `resumeTokenHash` | Char(64)? `@unique` | retorno seguro a la presentación propia (§5.4), mismo criterio que `Application.resumeTokenHash` |
| `withdrawalNotifiedAt` | DateTime? | fecha FEHACIENTE de la notificación de baja |
| `appealUntil` | DateTime? | `withdrawalNotifiedAt` + 30 corridos (REG-24) |
| `createdAt` / `updatedAt` | | |

Transiciones: `pending → submitted → validated | observed | rejected`;
`observed → submitted` (subsana, solo en 1ª/2ª instancia); `rejected → observed`
(reversible por admin hasta el cierre); `pending | observed | rejected → withdrawn`
(etapa de bajas). Terminales al cierre: `validated` (migra) o `withdrawn` (baja).
Documentos: `Document` con `ownerType = "presentation"` (enum ya reservado) +
`ownerId = presentation.id`; nuevo `savePresentationDocument` en
`documents/storage.ts` (mismos magic bytes, mismo `MAX_DOCUMENT_BYTES`).

### 4.3 `holidays` (`Holiday`)

`id`, `date` (DateTime `@unique`, mediodía UTC del día civil como `fee_values`),
`label` VarChar(80). ABM en `/admin/configuracion` (superadmin) + script
`scripts/seed-holidays.ts` con los feriados nacionales 2026-2027. Alimenta el
cómputo de días hábiles (lun-vie menos feriados) de la cartelera.

### 4.4 `board_notices` (`BoardNotice`) — el aviso de cartelera como lote

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Int PK | |
| `processId` | FK | |
| `kind` | enum `BoardNoticeKind` | `first_instance \| second_instance \| withdrawal \| other` (`other` = rebote suelto posterior) |
| `postedAt` | DateTime? | fecha de fijación, asentada por el operador **una sola vez por aviso** |
| `dueAt` | DateTime? | `postedAt` + 20 días hábiles, computada al asentar |
| `createdAt` | | |

`Notification` suma `boardNoticeId Int?` (FK, `SetNull`): las ~100 filas
individuales de un aviso se crean, se fijan (`boardFrom = postedAt`) y se cumplen
(`boardTo = dueAt`) **en lote** al asentar el aviso. La fila individual existe solo
como trazabilidad REG-09; el operador nunca opera de a una.

### 4.5 Retoques

- **`Membership`** suma `statusAtClose MemberStatus?` y
  `categoryAtClose MemberCategory?`: la foto del libro se escribe al cerrarlo
  (para las 278 filas del libro que se cierra, incluidas las bajas históricas).
- **`memberService.withdraw`** (mejora dirigida, beneficia también a las bajas
  existentes): cancela en la misma transacción las `member_requests` `pending` del
  socio (`status = cancelled`, `cancelledAt`, detalle "baja del socio"). Hoy quedan
  huérfanas para siempre en la bandeja (hueco documentado por el análisis del
  25/08). Con test propio.

---

## 5. Wizard público REEMPADRONATE

Ruta `/reempadronate`. Visible/activo solo con proceso en `first_instance` o
`second_instance`. Reutiliza las primitivas de ASOCIATE: `wizard-ui` (controles
48px, mobile-first), stepper con `AnsweredTrail`, `StreetPicker`, subida con magic
bytes, Turnstile, patrón de guardas de `asociate/actions.ts`.

**El wizard NO tiene ningún paso de pago** (decisión del operador, 25/08/2026):
a diferencia de ASOCIATE, acá no se ofrece pagar, ni adherir débito, ni cambiar
monto — nada que toque el circuito de pagos. El adherente solo se re-empadrona.
`step-payment` y toda referencia a Mercado Pago quedan explícitamente fuera.

### 5.1 Paso 1 — Identificación

Input: **DNI** (+ Turnstile). Rate limit nuevo `reregistrationLookupLimiter`
(5/15 min por IP). Si el DNI corresponde a un cohortado vigente del proceso:
**"¿Sos M****** P.?"** (nombre enmascarado, mismo formato que docs/05) → confirma
→ paso 2. Cualquier otro caso (DNI inexistente, no adherente, no cohortado, baja):
**el mismo cartel genérico** "Tu DNI no figura en el padrón de este proceso.
Acercate a la Vecinal (dirección y horarios)" — sin revelar cuál fue el motivo.

### 5.2 Paso 2 — Datos (ficha completa sin el nombre)

Fecha de nacimiento, estado civil, nacionalidad, ocupación, domicilio (calle del
catálogo con `StreetPicker` + altura + barrio), teléfono y **email (obligatorio)**.
**Precarga: únicamente el email si la ficha ya tenía** (decisión 8); todo lo demás
se tipea de cero — el DNI no es autenticación y precargar expondría datos ajenos.
El nombre no se edita (ancla de identidad; correcciones en la sede).

### 5.3 Pasos 3 y 4 — Documentos y envío

DNI frente y dorso obligatorios + hasta 2 anexos. El texto de ayuda explicita el
criterio del Art. 5.3: factura de servicios **a nombre del solicitante** o
certificado policial. Paso 4: declaración jurada → `submitted` con `submittedAt`
(la prueba del plazo) → **email de constancia** con el enlace de retorno (§5.4).

### 5.4 Retorno y subsanación

El acceso con datos a una presentación existente es SIEMPRE por el enlace con
token (`resumeTokenHash`, patrón `mintResumeToken → enviar → commit` de
`applications/service.ts`), que viaja en la constancia y en el email de
observación. Reingresar el DNI en el paso 1 con presentación ya enviada muestra
solo la pantalla de estado ("en revisión" / "observada" / "validada") con un
"reenviar enlace" (Turnstile + rate limit por DNI, como el retome de ASOCIATE) —
**nunca los datos**. La subsanación de una `observed` rehidrata el wizard desde
la presentación propia (con token sí se precarga: el buzón ya demostró ser suyo)
y reenvía a `submitted`. El wizard acepta envíos y subsanaciones **solo con el
proceso en 1ª o 2ª instancia**: al pasar a `closing` se cierra, y lo que quede
`observed` lo resuelve el operador (validar o rechazar) en la etapa A del cierre.

---

## 6. Carga presencial

Action de admin "Registrar presentación presencial" dentro de la sección
Reempadronamiento: busca al cohortado (buscador tipo `member-search`), carga los
mismos datos del §5.2 (**email obligatorio también acá**, decisión 4), sube los
documentos y asienta con `channel = in_person`. Queda `submitted` y entra a la
misma cola de validación (el que carga no valida en el mismo acto: cuatro ojos).

---

## 7. Panel: sección `/admin/reempadronamiento`

Ítem nuevo en `nav.ts` (grupo **Gestión**, entre Solicitudes y Socios) + tarjeta
en `dashboard-cards.ts` (el test de sincronía obliga). Ícono Lucide `ClipboardCheck`.

- **Sin proceso activo**: `EmptyState` con la explicación, el historial de
  procesos anteriores (si los hay) y el CTA "Convocar proceso" (**superadmin**).
- **Convocatoria**: libro a depurar (el abierto), acta de convocatoria
  (`MinutePicker`), fecha de oficialización IGJ (opcional), fecha estimada de
  elecciones (opcional, sin validación). Al activar, en una transacción: proceso
  `first_instance`, cohorte (`presentations` en `pending` para cada adherente
  vigente), `Configuration.reregistration_process_id`. Post-commit: emails de
  convocatoria a los cohortados con email utilizable (`MailBudget`,
  `NotificationType.reregistration_first`) y `BoardNotice` de 1ª instancia con los
  sin-email. La pantalla avisa además cuántas solicitudes de alta vivas hay para
  rechazar a mano (docs/05 §2).
- **Tablero**: la **línea de proceso** — stepper horizontal con las 5 etapas
  fechadas y los días restantes (elemento distintivo de la sección; acá la
  secuencia numerada SÍ es información). Contadores por estado de presentación
  como chips que filtran la cola; estado de cada aviso de cartelera (por fijar /
  en curso / fehaciente el DD/MM); acciones de fase.
- **Cola de validación**: patrón de `/admin/solicitudes` (segmentos
  Pendientes | Resueltas, cards con ícono + badge, metadatos, acciones al pie).
  Visor de documentos con **auditoría por vista** (ruta nueva
  `GET /api/admin/reempadronamiento/presentaciones/[id]/documentos/[docId]`,
  calcada de la de solicitudes: `requireAdmin`, `no-store`, `nosniff`, asiento
  por vista). Acciones: **Validar** (aplica los datos a la ficha vía
  `memberWriter.updateMember` — revoca tokens obsoletos, sincroniza email de
  acceso, dispara verificación REG-08 —, audita `presentation_validate`),
  **Observar** (nota obligatoria + email de observación con enlace de
  subsanación), **Rechazar** (reversible mientras el proceso esté abierto).
- **Iniciar 2ª instancia**: botón habilitado al vencer `firstEndsAt` (escotilla:
  también antes, con confirmación explícita — la CD manda sobre el calendario).
  Fija `secondEndsAt` (+10 corridos), emails `reregistration_second` a los no
  presentados con email + `BoardNotice` de 2ª instancia para los sin-email.
- **Preparar cierre**: habilitado al vencer `secondEndsAt`; pasa el proceso a
  `closing` y abre la pantalla de cierre (§9).

Autorización: **convocar, iniciar 2ª instancia y todo el cierre = superadmin**;
validar/observar/rechazar/carga presencial = admin. Como siempre, en la ruta y en
cada action (`requireSuperadmin` / `requireAdmin`), nunca solo en la nav.

---

## 8. Notificaciones y cartelera

- Todo envío pasa por el `mailer` existente (allowlist en el transporte,
  `Notification.failed` con código, `MailBudget` en los masivos).
- **Emails nuevos** en `templates.ts`: convocatoria (1ª instancia), 2ª instancia
  ("bajo apercibimiento de baja"), constancia de presentación (con enlace),
  observación (con enlace), baja declarada (con ventana de recurso).
- **Cartelera por lotes** (decisión 6): el sistema arma solo la lista de
  destinatarios sin email utilizable, genera **un PDF por aviso** (pdf-lib, on
  demand como los recibos: encabezado institucional, texto del aviso, lista de
  socios con número y nombre, fechas) y el operador asienta **una sola fecha de
  fijación**, que estampa `boardFrom`/`boardTo` en todas las filas del lote. El
  aviso se muestra como una tarjeta: "1ª instancia · 100 socios · fijado
  02/10/2026 · fehaciente el 02/11/2026" (veinte días hábiles contados con
  `businessDayEnd`, salteando el feriado del 12/10; el ejemplo decía 30/10, que
  es lo que da si no se cuenta ese feriado).
  Caso borde individual: un email que rebota DESPUÉS del envío masivo aparece
  como tarea puntual "pasar a cartelera" (se suma a un aviso
  `other` propio).
- **Días hábiles**: función pura `businessDayEnd(from, n, holidays)` en
  `src/lib/board/` (lun-vie, feriados de `holidays`), testeada con tabla de casos
  (fin de semana, feriado pegado, cruce de año).

---

## 9. Cierre de libro — tres etapas, nunca un solo botón

### Etapa A — Checklist pre-cierre

Pantalla de estado con veredicto de dos niveles (patrón `/admin/salud`):
- **Presentaciones sin resolver** (`submitted`/`observed` vivas): bloquean seguir.
- **Cesanteables por mora HOY** (activos/colaboradores vigentes con ≥4 pendientes,
  cálculo en vivo — hoy 7): advertencia con link al lote de
  `/admin/tesoreria/deudores`. **No bloquea** (decisión 1).
- Avisos de cartelera aún en curso: se listan como contexto.

### Etapa B — Declarar las bajas (REG-23)

Con borrador de anexo del acta generado por el sistema: lista de cohortados no
validados con, para cada uno, las notificaciones cursadas (vías y fechas) y los
vencimientos. La declaración corre en **lotes de ≤25** (patrón y tope del lote
REG-34, confirmación en dos pasos), repetibles hasta vaciar la cola. Cada baja:

- `withdrawWithDebits.withdraw({ reason: "not_reregistered", minuteId })` — el
  camino existente: `status = withdrawn`, `leftAt`, `debtAtWithdrawal` en la misma
  transacción, tokens revocados, `User.active = false`, débitos MP cancelados
  **post-commit** con balde propio de fallos (los adherentes no pueden adherir
  débito, así que serán ~0 llamadas, pero el camino queda cubierto).
- `Presentation → withdrawn`; las `member_requests` pendientes se cancelan solas
  (§4.5).
- Notificación de baja: email si la ficha tiene casilla utilizable
  (`withdrawalNotifiedAt` = envío) o entra al `BoardNotice` de bajas
  (`withdrawalNotifiedAt` = `dueAt` al asentarse la fijación). `appealUntil` se
  computa al quedar fehaciente. Auditoría `reregistration_withdrawal` por socio.

### Etapa C — Cerrar y migrar (transacción única, solo-DB)

**Vista previa obligatoria**: quiénes migran con el mapeo número viejo → nuevo,
quiénes quedaron de baja, y el aviso "reversible solo restaurando backup".
Precondición dura re-validada dentro de la transacción: cero adherentes vigentes
de la cohorte sin `validated`. Con el acta de cierre confirmada, en una sola
`$transaction` sin ninguna llamada de red:

1. Foto: `statusAtClose`/`categoryAtClose` en TODAS las membresías del libro.
2. Libro viejo → `closed`, `closedAt`, `closingMinuteId`.
3. Libro `número + 1` → `open`, `openedAt`, `openingMinuteId` (misma acta).
4. Membresías nuevas para todos los vigentes (activos y suspendidos), renumeradas
   **1..N por `joinedAt` ascendente; empate → número del libro anterior
   ascendente** (REG-28). Los suspendidos migran suspendidos (decisión 12).
5. `Movement { type: book_migration, minuteId: acta de cierre }` por migrado
   (docs/04: "hereda el acta de cierre").
6. Proceso → `closed`; `Configuration.reregistration_process_id` se limpia.

Post-commit: pantalla de resumen + export del padrón nuevo. Auditoría
`book_close` con `auditStrict` (el asiento ES la señal del acto ante la IGJ).
`requireOpenBook` queda satisfecho en todo momento: el cambio abierto→cerrado y la
apertura ocurren en la misma transacción.

---

## 10. Reorganización de `/admin/socios`

`layout.tsx` nuevo (molde `tesoreria/layout` SIN `PageHeader` — variante
`solicitudes`: cada hija pone su `<h1>`) con pestañas por URL e íconos
(`socios-tabs.ts` + componente cliente con el mapa de íconos, nunca en `lib/`):
**Padrón** (`Users`) | **Libros** (`BookMarked`) | **Histórico** (`History`).

### 10.1 Padrón (el listado renace)

- **Chips-resumen clickeables** que filtran: Vigentes 160 · Activos 36 ·
  Adherentes 124 · Suspendidos · Bajas 118 (conteos vivos; patrón segmented de
  `solicitudes/socios` con `SEGMENT_*`).
- Búsqueda + filtros con `SELECT_CLASS` y `aria-label` (adiós a los 4 selects
  crudos), `INLINE_LINK` en los links, `PaginationNav` + `pageHref` compartidos
  (adiós a la paginación duplicada — se actualiza el comentario de
  `pagination.ts`).
- **Tabla en desktop** (calidad Deudores: `font-mono tabular-nums`, `text-right`
  en numéricas, badges de `status-badges.ts`, íconos Lucide para débito y estado
  de email con `title` + `sr-only`) que **colapsa a cards en móvil** (patrón
  `RequestCard`: `flex flex-wrap`, badge que cae abajo solo).
- `EmptyState size="list"` reemplaza la tabla entera; nunca un `thead` sin filas.
- La ficha `[id]` **no cambia de contrato**: `MemberTabs` y `?tab=cuenta` quedan
  (12 pantallas de M4 linkean ahí). Solo suma en la pestaña Ficha el bloque
  "Libros": sus membresías (Libro 1 · N° 12 → Libro 2 · N° 4).
- `fetchPadron` (export) sigue sin paginar; los tests existentes lo vigilan.

### 10.2 Libros

Una card por libro (número, badge `open`/`closed`, fechas, actas, asentados) →
detalle: listado de membresías con número, nombre y — en libros cerrados — la
foto (`statusAtClose`/`categoryAtClose`). **Export a Excel auditado** por libro
(mecanismo y auditoría del export del padrón, acción `book_export`).

### 10.3 Histórico

Toda persona que pasó por la vecinal (consulta desde `Member`, no desde
`Membership`): búsqueda nombre/DNI, filtros de estado/categoría/motivo de baja,
números por libro, y el **veredicto de reingreso** derivado de `eligibility`
existente (expulsado: nunca; rechazo <6 meses; deuda viva del cesante). Es la
pantalla para responder "¿puede volver a asociarse?".

---

## 11. Sitio público

- Botón **REEMPADRONATE** en la home (el comentario placeholder ya existe),
  visible solo con proceso en 1ª/2ª instancia.
- **ASOCIATE suspendido** durante el proceso: banner "Las asociaciones están
  suspendidas temporalmente durante el proceso de re-empadronamiento (hasta el
  DD/MM)" — la guarda 0 de `createApplicationAction` ya lo anticipa; pasa a leer
  también `reregistration_process_id`.
- `/reempadronate` con `robots: noindex` en las rutas con token, Turnstile en el
  paso 1 y en el reenvío de enlace (formularios públicos anónimos), rate limits
  propios. `/mi`: banner "Re-empadronate" para el adherente cohortado logueado
  que aún no presentó (enlaza al wizard público).

---

## 12. Autorización, auditoría y privacidad

- Superadmin: convocar, 2ª instancia, etapas A/B/C del cierre, ABM de feriados.
  Admin: validar/observar/rechazar, carga presencial, asentar cartelera, ver
  documentos. Siempre en ruta + action.
- Acciones de auditoría nuevas: `reregistration_call`, `reregistration_second`,
  `presentation_submit` (sin IP de socio: es anónimo público, como ASOCIATE),
  `presentation_validate` / `_observe` / `_reject`, `presentation_document_view`,
  `board_notice_post`, `reregistration_withdrawal`, `book_close` (**estricta**),
  `book_export`. En `detail` van ids, códigos y flags — nunca DNI, email ni
  domicilios (Ley 25.326).
- Los documentos de presentación viven en `UPLOADS_DIR/presentations/<id>/`,
  servidos solo por la ruta autenticada con asiento por vista.

---

## 13. Invariantes de pagos (verificadas contra el análisis del 25/08)

1. La migración **no toca** `Fee`, `Payment`, `Receipt` ni `joinedAt`; `treasury/`,
   `mp/` y `resolve.ts` no se modifican.
2. El corte de plata de un dado de baja ya vive en `registerPaymentCore`
   (recorta a pendientes; sin pendientes → bandeja "Cesante sin deuda"). Las bajas
   masivas no necesitan nada nuevo.
3. El lapso sin número de socio entre cierre y consulta ya está contemplado por
   el padrón electoral y el PDF de recibos; con la transacción única de la etapa C
   ese lapso no existe para los migrados.
4. Ninguna llamada de red dentro de una `$transaction` (débitos MP post-commit;
   PDFs on demand).
5. Lotes acotados a 25 por el presupuesto de tiempo de Nginx (precedente REG-34).
6. El devengo del 01/10 convive con el proceso: si el cierre ocurre cerca del
   día 1, el devengo lee `status` vivo y simplemente no devenga a los ya dados de
   baja; no hay carrera nueva (la baja no escribe `Fee`).

---

## 14. Verificación

- **Módulos puros con cliente inyectado** (patrón del proyecto): plazos y
  transiciones del proceso, veredicto de identificación (DNI → cohortado),
  `businessDayEnd` (tabla de casos con feriados), renumeración REG-28 (orden,
  empates, densidad 1..N), precondiciones del cierre, cancelación de
  `member_requests` en la baja.
- **Tests de pantalla** con `renderToStaticMarkup` (precedente
  `admin-health-screen`): tablero, checklist, vista previa del cierre.
- **Sincronía nav/tarjetas/tabs**: los tests existentes obligan a registrar la
  sección nueva y las pestañas de Socios.
- **CA de docs/07 en local** (enmienda: decía staging): simulacro completo con
  Docker MariaDB y datos reales — activar proceso, 3 adherentes (1 validado,
  1 observado que subsana, 1 sin respuesta), vencer plazos con fechas simuladas,
  cerrar → Libro 2 con los vigentes no adherentes + 2 validados renumerados por
  antigüedad; el sin-respuesta de baja con `appealUntil` correcto; Libro 1
  cerrado, consultable y exportable; restaurar backup revierte todo.

---

## 15. Fuera de alcance (a propósito)

- Entidad Recurso / estados de recurso (decisión 7: el reingreso existente).
- Validaciones de 180 días pre-electorales y periodicidad de 2 años (decisión 5).
- Cartelera para observaciones (decisión 13).
- Crons nuevos: todas las transiciones de fase son botones humanos habilitados
  por fecha, con escotillas de adelanto confirmado.
- Webhooks de Brevo para rebotes automáticos (REG-08 sigue igual que hasta ahora).
- Gestión de la elección y padrón electoral: sin cambios (REG-31 ya corre sobre
  `Member` y tolera el cambio de libro por diseño).
- Modo oscuro del wizard público (el sitio público es light-only como ASOCIATE).
