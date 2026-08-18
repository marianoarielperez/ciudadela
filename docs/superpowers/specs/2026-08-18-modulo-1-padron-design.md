# Spec — Módulo 1: Padrón interno (Libro 1)

Fecha: 18/08/2026 · Estado: aprobada por Mariano (entrevista de 3 rondas + diseño aprobado)
Fuentes: `docs/02` (REG-*), `docs/04`, `docs/05` §4 y §6, `docs/07`, estatuto reformado 15/08/2026,
perfil de datos real de `datos/padron_socios.xlsx` (18/08/2026).

## 1. Contexto y objetivo

Digitalizar el Libro N° 1 del registro de asociados: importar el padrón definitivo,
permitir completar las fichas a mano rápido, registrar movimientos societarios con acta,
y dejar los cimientos de email transaccional y acceso de socios.

**El padrón definitivo tiene 283 registros y 22 huecos** (los 20 de REG-35 más **132 y 263**,
duplicados eliminados por Mariano el 18/08/2026). Vigentes: 161 (56 Activos + 105 Adherentes).
Bajas: 122 (114 por mora con deuda, 8 fallecidos/domicilio sin deuda). Los docs 02/04/07 se
actualizan con estos números como parte de este módulo.

## 2. Alcance

1. Migración Prisma `add_module_1_padron` (entidades §4).
2. `scripts/import-calles.ts` + `scripts/import-padron.ts` (idempotentes, con reporte).
3. `/admin/socios`: listado del libro abierto con filtros, búsqueda y export Excel.
4. `/admin/socios/[id]`: ficha completa con historial de movimientos y notificaciones.
5. Modo carga de fichas: edición rápida navegable por número, Ctrl+S, autocompletado de calle.
6. `/admin/actas`: ABM de actas + movimientos asociados.
7. Acciones con acta: alta manual, baja, cambio de categoría, **suspensión y reingreso**
   (decisión: se incluyen aunque docs/07 no los listaba; misma mecánica acta+movimiento).
8. Capa de email (`src/lib/email/`, nodemailer + Brevo SMTP) + verificación de email
   doble opt-in + invitación "creá tu contraseña".
9. **Recupero de contraseña** (deuda confirmada del Módulo 0).
10. Actualización de docs: REG-35 (283/22), flag de deuda en doc 04, ideas nuevas de Mariano
    asignadas a M3/M4/M5 en doc 07, padrón electoral diferido a M4.

### Fuera de alcance (no invadir)

- Wizard ASOCIATE, Solicitud, uploads de DNI, Turnstile → Módulo 3.
- Cuotas, pagos, recibos, deuda real, padrón electoral (REG-31) → Módulo 4.
- Panel de socio funcional → Módulo 5 (los invitados ven `/mi` con "Próximamente").
- Re-empadronamiento, cierre de libro, cartelera/días hábiles, Feriado → Módulo 6.
- Subdivisión de roles Secretario/Tesorero: descartada por ahora (admin único; la
  auditoría ya registra el autor de cada acción).
- Webhooks de Brevo (entrega/rebote): módulo posterior; `Notification.brevoMessageId`
  queda persistido desde ahora para habilitarlos.

## 3. Decisiones tomadas en la entrevista (18/08/2026)

| # | Decisión | Resolución |
|---|---|---|
| D1 | Padrón definitivo | 283 filas / 22 huecos confirmados; Excel ya corregido por Mariano. |
| D2 | Socios 287/288 sin DNI | Se importan con `dni` null. El 287 (adherente vigente) queda marcado en el reporte: conseguir DNI antes de activar el M6. |
| D3 | Bajas sin `fecha_egreso` | Se importan con `leftAt` null (fallecidos / no cumplían requisitos del estatuto viejo). |
| D4 | `deuda_tesoreria` | Flag booleano `debtAtWithdrawal` en Member. Lo usa el M3 para bloquear el re-ingreso web; el M4 lo reemplaza por cuenta corriente real. |
| D5 | `apellido_nombre` | Campo único `fullName`, como en el padrón. Sin split. |
| D6 | Ideas nuevas de Mariano | Se documentan en doc 07 (M3: bloqueo Asociate por deuda, resumen mensual para actas; M4: recibo automático de débito, pago efectivo con comprobante, aviso del 30 a deudores, novedades diarias 9hs a Comisión; M5: cuotas adeudadas y cambio de categoría en panel socio). Nada se adelanta al M1. |
| D7 | `fecha_ingreso` de lote | Es la fecha oficial del libro a todos los efectos (antigüedad, vitalicios). Se importa tal cual, inmutable. |
| D8 | Brevo | Cuenta existente, remitente `av.ciudadela@gmail.com`, dominio actual `sigev.redaccion.ar` (final: `vecinalciudadela.com.ar`). Credenciales las carga Mariano a mano en `.env`. |
| D9 | Padrón electoral (REG-31) | Diferido al Módulo 4 (depende de deuda real). |
| D10 | Enum email | Gana doc 04: `none / declared / verified / bounced`. |
| D11 | Enums | Nativos de Prisma (no VarChar+catálogo): categorías fijadas por estatuto; un cambio estatutario amerita migración. |

## 4. Modelo de datos

Convenciones del M0: PascalCase + `@map`/`@@map` snake_case, `@db.VarChar(n)` explícito,
import desde `@/generated/prisma/client`.

### Enums

```
MemberCategory:   active | adherent | collaborator | cadet | honorary | lifetime
MemberStatus:     active | suspended | withdrawn
EmailStatus:      none | declared | verified | bounced
WithdrawalReason: death | resignation | arrears | moved_away | not_reregistered |
                  expulsion | duplicate_annulment | other        (catálogo REG-18)
MovementType:     admission | withdrawal | category_change | readmission |
                  suspension | suspension_end | book_migration
MinuteType:       board | assembly
BookStatus:       open | closed
TokenPurpose:     email_verification | password_invitation | password_reset
NotificationType / NotificationVia / NotificationStatus: según doc 04
```

### Modelos

- **Member** (`members`): `id`, `fullName` (VarChar 160), `dni` (VarChar 12, UNIQUE, null),
  `birthDate` (null), `civilStatus`, `nationality`, `occupation`, `phone` — todos null;
  domicilio: `streetId` (FK `Street`, null), `streetText` (null, para fuera del barrio),
  `streetNumber` (null), `neighborhood`; email: `email` (null), `emailStatus`
  (default `none`), `emailVerifiedAt`; estado: `category`, `status`, `withdrawalReason`
  (null), `joinedAt` (**nunca se pisa**), `leftAt` (null); flags: `debtAtWithdrawal`
  (default false), `autoDebit` (default false), `reentryBlocked` (default false, REG-04),
  `rejectedUntil` (null, REG-05), `suspendedFrom`/`suspendedTo` (null);
  `userId` (FK User, UNIQUE, null — **la FK vive solo de este lado**); timestamps.
  El estado es desnormalizado: la verdad es el historial de Movement.
- **Book** (`books`): `number` (UNIQUE), `status`, `openedAt`, `closedAt` (null),
  `openingMinuteId`/`closingMinuteId` (null). Un solo libro `open` a la vez
  (invariante por código en la capa de servicios, verificada en el import y en alta).
- **Membership** (`memberships`): `memberId`, `bookId`, `memberNumber`.
  UNIQUE(`bookId`,`memberNumber`) y UNIQUE(`memberId`,`bookId`).
- **Minute** (`minutes`): `type`, `number`, `date`, `description`, `createdById`.
  UNIQUE(`type`,`number`). La fecha del acta define la fecha de ingreso de sus altas (REG-11).
- **Movement** (`movements`): `memberId`, `type`, `date` (= fecha del acta), `minuteId`
  (nullable en schema; obligatoria por código salvo `book_migration` y las altas
  sintéticas del import del Libro 1), `previousCategory`/`newCategory` (null),
  `reason` (null), `detail` (null), `createdById`, `createdAt`.
- **Street** (`streets`): `id` (= id_calle del CSV), `loadOrder` (= orden_carga, indexado),
  `name`, `normalizedName` (indexado). ABM solo superadmin.
- **Notification** (`notifications`): según doc 04 — `memberId` (null), `type`, `via`,
  `sentAt`, `status`, `brevoMessageId` (null), `boardFrom`/`boardTo` (null, cartelera M6),
  `payloadSummary`.
- **ActionToken** (`action_tokens`): `id`, `memberId`/`userId` (null según propósito),
  `purpose`, `tokenHash` (sha256, nunca el token en claro), `expiresAt`, `usedAt` (null).
  Expiración: verificación e invitación 7 días; recupero 30 min. Un solo uso.
- **User**: se agrega la relación inversa `member` (sin columna nueva en `users`).

## 5. Importaciones

### `scripts/import-calles.ts`
- Lee `datos/calles_inicial.csv` (con BOM UTF-8). Normalización: lowercase, sin tildes,
  colapso de espacios, `"Pizarro , Francisco"` → nombre visible intacto pero
  `normalizedName = "pizarro, francisco"`. Upsert por `id_calle` (idempotente).

### `scripts/import-padron.ts`
- Lee `datos/padron_socios.xlsx` (exceljs). Corre con `tsx`, usa `src/lib/prisma`.
- Crea Book 1 (`open`) si no existe; 283 Members + Memberships con su `memberNumber`
  original. Los 22 huecos no se crean.
- Mapeos: `activo` Si→`active` / No→`withdrawn`; `categoria_socio` Activo→`active`,
  Adherente→`adherent`; `motivo_baja`: `Mora`→`arrears`, `Fallecido|Fallecida`→`death`,
  textos de domicilio (Gasoducto/Standard Norte/El Bolsón)→`moved_away`, `-`/vacío→null;
  `deuda_tesoreria` Si→`debtAtWithdrawal=true`; `debito_automatico` Si→`autoDebit=true`;
  `email` presente→`emailStatus=declared`; `dni` numérico→string.
- Fechas: datetime de Excel → fecha civil guardada como UTC 12:00 (evita corrimiento
  de día en UTC-3).
- Cada socio importado recibe un Movement `admission` sintético con `date = joinedAt`
  y `minuteId` null + `detail: "import Libro 1"` (excepción documentada: el acta física
  original no está digitalizada).
- Idempotente: clave de matching `memberNumber` en Book 1; re-ejecutar actualiza sin
  duplicar. Auditoría: una fila `padron_import` con totales.
- Reporte (consola + `scratchpad`/archivo): totales de control (283 / 161 vigentes /
  122 bajas / 22 huecos), filas con avisos (287 sin DNI ⚠ requerido antes del M6,
  288 sin DNI), cualquier fila descartada o valor no mapeable.
- Precondición: el Excel cerrado (sin lock `~$padron_socios.xlsx`).

## 6. Panel admin

Todas las rutas bajo `/admin` (guard doble existente). Toda acción sensible → `audit()`.

### `/admin/socios` — listado
- Tabla del libro abierto: número, nombre, DNI, categoría, estado, email + estado de
  verificación, flag deuda histórica, débito automático.
- Filtros: categoría, estado, con/sin email, con/sin DNI. Búsqueda: nombre / DNI / número.
- Export Excel (exceljs) de la vista filtrada. Auditado (`padron_export`).
- Server-side: RSC + searchParams; paginación simple (283 filas, sin sobre-ingeniería).

### `/admin/socios/[id]` — ficha
- Datos completos, historial de Movements con acta linkeada, Notifications cursadas.
- Slots visibles pero deshabilitados: documentos (M3), cuenta corriente (M4).
- Botonera de acciones con acta (ver §7).

### `/admin/socios/carga/[numero]` — modo carga de fichas
- Todos los campos editables en una pantalla; guardado con botón y **Ctrl+S**.
- Navegación "← anterior / siguiente →" por `memberNumber` saltando huecos, y salto
  directo por número.
- Autocompletado de calle: matchea `normalizedName` (sin tildes) y `loadOrder` numérico
  ("hernandez", "Hernández" y "1906" encuentran "Hernandez , Jose"). Opción "en otro
  barrio" → `streetText` + `neighborhood` libres.
- Al guardar un email nuevo: botón "Enviar verificación + invitación de acceso".
- Objetivo de performance (CA): ficha completa en < 2 minutos.
- Server action con zod; helper genérico `FormData → zod → { error }` nuevo en
  `src/lib/forms.ts` (reutilizable por todos los formularios del módulo).

### `/admin/actas`
- ABM: tipo, número, fecha, descripción. Vista de movimientos asociados.
- Selector reutilizable "elegir acta existente o crear nueva" (lo usan todas las
  acciones de §7; en M3 lo reutiliza la bandeja de solicitudes).

## 7. Acciones societarias (siempre: acta + Movement + auditoría, en transacción)

| Acción | Reglas |
|---|---|
| Alta manual | Las 6 categorías. Crea Member + Membership con número siguiente del libro abierto (arranca en 306). `joinedAt` = fecha del acta (REG-11). |
| Baja | Motivo del catálogo obligatorio. `expulsion` → `reentryBlocked=true` (REG-04). Nunca borra: baja lógica (Ley 25.326 / IGJ). |
| Cambio de categoría | Bloqueado si `Configuration.elecciones_en_curso=true` (REG-07). No toca `joinedAt`. El chequeo "sin deuda" queda para M4 (hoy no hay dato de deuda vigente). |
| Suspensión | `suspendedFrom`/`suspendedTo` + Movement `suspension`; `suspension_end` al levantar. |
| Reingreso | Movement `readmission`; status vuelve a `active`. Si `withdrawalReason=arrears`: aviso "debe saldar deuda a valores vigentes — cálculo disponible en Módulo 4" (REG-16 placeholder). Bloqueado si `reentryBlocked` (expulsados, sin excepción). |

## 8. Email, verificación y accesos

- `src/lib/email/`: transporte nodemailer (Brevo SMTP, envs `BREVO_*`, `MAIL_FROM`)
  con **factory inyectable** (patrón `makeAudit`) para testear sin SMTP real.
  Sin credenciales en `.env` → log en consola (dev no se bloquea).
- Templates es-AR (HTML simple + texto): verificación de email, invitación
  "creá tu contraseña", recupero de contraseña.
- Flujo verificación + invitación (desde carga de fichas o ficha):
  1. Se guarda email → `emailStatus=declared`, Notification `verificacion_email` +
     ActionToken `email_verification`.
  2. El socio abre el link → `emailStatus=verified` + `emailVerifiedAt`.
  3. Si no tiene User: el mismo flujo encadena la creación de contraseña
     (ActionToken `password_invitation`) → crea User rol `socio` vinculado al Member.
- Recupero de contraseña: form público en `/ingresar/recuperar` (email → token 30 min
  un solo uso → nueva contraseña). Respuesta idéntica exista o no el email (no filtrar
  existencia). Rate limiting con los limiters existentes. Auditado.
- Tokens: aleatorios 32 bytes, en DB solo sha256, un solo uso (`usedAt`).

## 9. Seguridad y auditoría

- Nada del padrón es accesible sin rol `admin`/`superadmin`; ABM de calles solo `superadmin`.
- Acciones auditadas: import, alta, baja, cambio de categoría, suspensión, reingreso,
  edición de ficha, envío de verificación/invitación, export Excel, recupero de contraseña.
- Ex socios no se borran (bajas lógicas); derechos ARCO vía CD según doc 08.
- Prisma parametrizado; sin SQL crudo.

## 10. Testing (patrón factory del M0, sin DB de test)

- Mapeos del import (fila Excel → Member) como funciones puras.
- Normalización de calles (tildes, comas, BOM) y matching del autocompletado.
- Ciclo de ActionToken: emisión, expiración, un solo uso, hash.
- Reglas de transición: expulsión bloquea reingreso, `elecciones_en_curso` bloquea
  cambio de categoría, `joinedAt` inmutable en cambios.
- Capa email con transporte fake.

## 11. Criterios de aceptación (actualizados)

1. Los **283** registros importados con sus números originales y los **22 huecos**
   correctos; re-ejecutar el import no duplica nada.
2. Cargar una ficha completa (DNI, domicilio con calle del catálogo, email) toma < 2 min.
3. Una baja con acta queda en el historial de movimientos y en auditoría.
4. El email de verificación llega vía Brevo (remitente `av.ciudadela@gmail.com`) y el
   estado cambia a `verified`; la invitación permite crear contraseña y entrar a `/mi`.
5. El export Excel del padrón refleja los filtros activos.
6. Recupero de contraseña funcional con token de un solo uso (30 min).
7. Docs 02/04/07 actualizados (números reales, flag deuda, ideas nuevas asignadas).

## 12. Dependencias nuevas

- `exceljs` (lectura del padrón + exports), `nodemailer` (+ `@types/nodemailer`).
- Componentes shadcn a agregar: `table`, `select`, `dialog`, `badge`, `tabs`, `sonner`,
  `command` (autocompletado), `checkbox`, `textarea`.

## 13. Pendientes que este módulo deja registrados

- DNI del socio 287 (adherente vigente): conseguir antes de activar el M6.
- Webhooks de Brevo (rebotes → `emailStatus=bounced`): módulo posterior.
- Dominio definitivo en Brevo (SPF/DKIM de `vecinalciudadela.com.ar`): antes del lanzamiento.
- Rate limiter in-memory asume un solo proceso PM2 (sin cambios en M1).
