---
title: Modelo de datos
subtitle: Modelos, enums, invariantes y migraciones
series: Serie técnica — Documento 4 de 7
docx: SIGeV-T4-Modelo-de-datos
version: 1.0
date: 11/09/2026
---

# Sobre este documento

## Para quién es y qué da por sabido

Está escrito para el desarrollador que hereda SIGeV y necesita entender la base antes de
tocar una pantalla. Da por sabido SQL, claves foráneas e índices, y una noción de Prisma
como ORM: qué es un modelo, qué es una migración y cómo se lee un `@@unique`. No da por
sabido nada del dominio de la asociación — cada tabla se explica por lo que sostiene, y
las reglas estatutarias se citan por su `REG-xx`, que vive en `docs/02-marco-estatutario.md`.

La fuente de verdad es `prisma/schema.prisma`. Donde el esquema y `docs/04-modelo-de-datos.md`
digan cosas distintas, acá se describe el esquema; las diferencias se anotan en el archivo
de hallazgos y `docs/04` no se corrige.

## Cómo leer este documento

El capítulo 1 explica las convenciones que atraviesan el esquema entero: no se entiende una
tabla sin ellas. El 2 es el mapa, para ubicarse. El 3 es el cuerpo: un bloque por dominio,
con su tabla de modelos y, debajo, lo que la tabla no puede decir. Los capítulos 4 a 7 son
material de consulta —enums, invariantes, migraciones y datos importados— y se leen
salteados. Cada capítulo cierra con "Dónde está en el código", que es de dónde salió lo que
afirma. Si algo de acá contradice al esquema, manda el esquema.

# 1. Cómo leer el esquema

`prisma/schema.prisma` tiene 1375 líneas y define **37 modelos** y **34 enums**. El
`generator` emite el cliente a `src/generated/prisma` (no a `node_modules`), el `datasource`
es `mysql` y las URLs de conexión no están en el esquema: viven en `prisma.config.ts`, como
pide Prisma 7. En producción la base es MariaDB y el cliente la habla por
`@prisma/adapter-mariadb`.

**Modelo y tabla no se llaman igual.** Cada modelo lleva un `@@map` a la tabla real: el
modelo es `PascalCase` singular (`FeeValue`), la tabla es `snake_case` plural (`fee_values`),
y lo mismo pasa columna por columna con `@map`. Las dos nomenclaturas aparecen —el código de
aplicación habla de modelos y campos; los errores de la base, los índices y el SQL de las
migraciones, de tablas y columnas—, así que acá van juntas en la primera columna de cada
tabla.

**Todo instante se guarda en UTC; toda fecha civil, al mediodía UTC.** Un instante (cuándo
entró un pago, cuándo salió un correo) es un `DateTime` en UTC y se muestra convertido. Una
fecha civil —la de un acta, la de ingreso de un socio, un feriado, la vigencia de un valor de
cuota— no tiene hora que signifique nada, y se guarda como el **mediodía UTC** de ese día
argentino con `civilDateUtc`: con medianoche UTC, cualquier render en UTC-3 corre la fecha un
día para atrás. El corolario es que un instante nunca se compara crudo contra una fecha
civil; para eso está `civilDayOf`, la única función del proyecto que traduce un instante a
día civil argentino. El caso que la motivó: el mediodía UTC son las 09:00 de acá, así que un
`validFrom <= new Date()` a secas deja un valor de cuota invisible entre las 00:00 y las
08:59 del día en que empieza a regir, y un devengo de madrugada abortaría por falta de
monto.

**Casi nada se borra: se marca.** El estado se resuelve con columnas de fecha nullable en vez
de con borrados: un recibo anulado tiene `voidedAt`, motivo y autor, y su número sigue
ocupado; una exención levantada tiene `revokedAt` y el acta de la anulación; un DNI purgado
por retención, `dniPurgedAt`; un token gastado, `usedAt`. La columna en null es el estado
normal y la fecha es a la vez el hecho y su prueba.

Las claves foráneas no son todas iguales. `SetNull` es el default para la trazabilidad
(quién registró, quién validó): una cuenta dada de baja no puede trabar un registro.
`Cascade` es para lo que no tiene vida propia (los roles de un usuario, los archivos de un
reporte). Y `Restrict` es deliberado y escaso: aparece donde el referente **es** la prueba
—el acta de una exención, el acta de una iniciativa tratada, el pago de un recibo— y
borrarlo dejaría un registro sin respaldo.

**La plata es `Decimal(10, 2)`, nunca un float.** Los importes que llegan de Mercado Pago sí
son flotantes, y por eso toda comparación se hace en centavos enteros con `cents()`:
comparar `6000.000000000001` contra `6000` inventa divergencias que no existen. Las cuotas,
en cambio, no llevan monto en absoluto, por lo que explica el capítulo 3.

## Dónde está en el código

`prisma/schema.prisma` (sus comentarios son parte de la especificación); `prisma.config.ts`;
`src/lib/dates.ts`; `src/lib/treasury/periods.ts` (`civilDayOf`, `periodOf`); y las tres
copias de `cents` —`src/lib/mp/webhook-processor.ts`, `src/lib/treasury/split-group.ts` y
`src/lib/members/subscription-amount.ts`, esta última privada de su módulo—.

# 2. Mapa de dominios

Nueve bloques. Las flechas son las relaciones que vale la pena recordar; hay muchas más,
sobre todo hacia `users` (quién hizo qué) y hacia `minutes` (con qué acta).

```text
  ┌──────────────────┐        ┌────────────────────────────┐
  │ USUARIOS Y AUTH  │───────>│ SISTEMA                    │
  │ users · roles    │        │ configuration · audit_log  │
  │ user_roles       │        │ action_tokens · cron_runs  │
  └────────┬─────────┘        │ notifications · streets    │
           │ 1-1              └──────────┬─────────────────┘
           ▼                             │ acredita
  ┌──────────────────────────────────────┴──────────────────┐
  │ PADRÓN   members ─> memberships ─> books                │
  │          members ─> movements ─> minutes <─ (7 tablas)  │
  │          members ─> member_requests                     │
  └──┬────────────┬──────────────┬───────────────┬──────────┘
     │            │              │               │
 ┌───▼─────────┐ ┌▼────────────┐ ┌▼────────────┐ │
 │ SOLICITUDES │ │ TESORERÍA   │ │ RE-EMPADRO- │ │
 │ applications│ │ fee_values  │ │ NAMIENTO    │ │
 │ documents   │ │ fees        │ │ procesos    │ │
 └───┬─────────┘ │ payments    │ │presentations│ │
     │           │ receipts    │ │board_notices│ │
     │           │other_incomes│ │ holidays    │ │
     │           │fee_exemption│ └─────────────┘ │
     │           └──────┬──────┘                 │
     │        ┌─────────▼─────────────┐  ┌───────▼──────┐
     └───────>│ MERCADO PAGO          │  │ REPORTES     │
              │ mp_subscriptions      │  │ reports      │
              │ mp_unmatched_payments │  │ report_files │
              │ webhook_events        │  │ report_seq   │
              └───────────────────────┘  └──────────────┘
  CONTENIDO (aparte): news · activities · institutional_documents
```

Tres lecturas del mapa. La primera: `members` es el centro, pero no el único — `minutes` la
referencian siete tablas con diez columnas, porque casi todo acto institucional se asienta
en un acta, y `users` aparece como autor de la acción en media docena. La segunda: el bloque
de Contenido no se conecta con nada salvo su autor; es el sitio público y vive aparte a
propósito. La
tercera: `other_incomes` está dibujado dentro de Tesorería pero no tiene ninguna clave
foránea hacia `payments`, `fees` ni `receipts`, y eso también es deliberado.

## Dónde está en el código

El mapa sale de las relaciones declaradas en `prisma/schema.prisma`. Para verlo sobre la
base real, `npx prisma studio` las dibuja tal como están.

# 3. Los dominios, uno por uno

## 3.1 Usuarios y autenticación

| Modelo / tabla | Campos clave | Relaciones | Para qué sirve |
|---|---|---|---|
| `User` / `users` | `email` unique, `passwordHash` (bcrypt), `passwordChangedAt`, `active` | 1-1 con `Member`; N-N con `Role`; autor de la acción en media docena de tablas | La cuenta de acceso, de gestión o de socio |
| `Role` / `roles` | `name` unique | `UserRole` | Catálogo de los tres roles: `superadmin`, `admin`, `socio` |
| `UserRole` / `user_roles` | clave primaria compuesta `[userId, roleId]` | FK a `user` con `Cascade`, FK a `role` | La tabla puente que hace los roles acumulables |

Los roles son **acumulables** —una persona puede ser `admin` y `socio` a la vez— y por eso
no son una columna de `users` sino una tabla puente. Quien es socio además tiene su ficha
colgada por `Member.userId`, que es `@unique`: una cuenta, un socio.

`passwordChangedAt` no es informativo: es el sello del último cambio de contraseña, y las
guardas de sesión lo comparan contra el momento en que se emitió la sesión que llega, para
cortar toda sesión anterior (en null no invalida nada). `active`, en cambio, es la baja de
una **cuenta** y no toca la ficha: dar de baja a un socio y desactivar su cuenta son dos
hechos distintos, en dos tablas distintas, y ninguno implica el otro.

## 3.2 Padrón

| Modelo / tabla | Campos clave | Relaciones | Para qué sirve |
|---|---|---|---|
| `Member` / `members` | `dni` unique y nullable, `category`, `status`, `joinedAt`, `leftAt`, `withdrawalReason`, `emailStatus`, `autoDebit`, `reentryBlocked`, `userId` unique | una docena de listas inversas —`memberships`, `movements`, `fees`, `payments`, `presentations`, `reports` entre ellas— más `street` y `user` | La ficha del socio |
| `Book` / `books` | `number` unique, `status`, `openedAt`, `closedAt` | actas de apertura y cierre; `memberships` | El libro de socios. Hoy: Libro 1 cerrado, Libro 2 abierto |
| `Membership` / `memberships` | `memberNumber`, `statusAtClose`, `categoryAtClose` | FK a `member` y a `book` | El número de socio, que es **por libro** |
| `Minute` / `minutes` | `type`, `number`, `date`, `description` | referenciada por siete tablas, con diez columnas | El acta: el respaldo institucional de casi todo |
| `Movement` / `movements` | `type`, `date`, `previousCategory`, `newCategory`, `reason`, `detail` | FK a `member`, a `minute` y a `createdBy` | El historial de la ficha |
| `MemberRequest` / `member_requests` | `type`, `status`, `requestedCategory`, `text`, `cancelledAt` | FK a `member` con `Cascade`, a `decidedBy` y a `movement` | Lo que el socio pide: baja o cambio de categoría |

**`Membership` es la foto del libro, no una tabla puente.** Guarda el número de socio con
dos uniques que se complementan: `[bookId, memberNumber]` sostiene la densidad de la
numeración y `[memberId, bookId]`, que un socio tenga un solo número por libro. Lo que
sorprende son `statusAtClose` y `categoryAtClose`: son **nullable** y nadie los escribe
hasta que el libro se cierra. Un libro cerrado es un documento inmutable, así que la
categoría y el estado de ese día se congelan ahí en vez de leerse de la ficha viva, que
después sigue cambiando (REG-36). Mientras estén en null, las pantallas de Libros caen a
los datos vivos.

**Un acta se identifica por tipo y número, nunca por su id**, y la razón es el
`@@unique([type, number])`: "Acta N° 16" sin decir si es de Comisión Directiva o de
Asamblea señala dos documentos distintos, y los dos suelen existir. El código lo resuelve
con `minuteName`; el error se cometió dos veces, las dos encontradas en verificación en
vivo. Las siete tablas que la referencian son `books` (apertura y cierre),
`movements`, `applications`, `fee_values`, `reregistration_processes` (convocatoria y
cierre), `fee_exemptions` (asiento y anulación) y `reports`; **tres** de ellas la referencian
dos veces, así que son diez columnas.

**El reingreso sale de `Movement`, no de `Member`.** Un socio que se fue y volvió conserva
su `joinedAt` original (REG-11), así que la única fuente de la fecha de reingreso es el
movimiento con `type: "readmission"` — que es lo que después mira el piso de cobertura de
la cuenta corriente para no reclamarle cuotas del período en que estuvo afuera. Y "una
solicitud pendiente por tipo por socio" no la sostiene la base: MySQL no tiene índices
parciales y la condición a filtrar sería justamente `status = 'pending'`, así que se
garantiza dentro de la transacción que la crea, con el conteo adentro y bajo un mutex por
socio.

## 3.3 Solicitudes de alta

| Modelo / tabla | Campos clave | Relaciones | Para qué sirve |
|---|---|---|---|
| `Application` / `applications` | `dni` obligatorio y **no** unique, `status`, `requestedCategory`, `wantsDebit`, `preapprovalId` unique, `entryAmount`, `resumeTokenHash` unique, `acceptedTermsAt` | FK a `member` (reingreso) y a `minute`; `subscriptions`, `payments`, `tokens` | La solicitud del wizard público ASOCIATE |
| `Document` / `documents` | `ownerType`, `ownerId` **sin clave foránea real**, `type`, `path`, `mime`, `size`, `validatedAt` | FK a `validatedBy` con `SetNull` | Documentación personal subida: las dos caras del DNI y anexos |

`Application` es un espejo de `Member` donde los mismos campos son **obligatorios**. La
asimetría no es un descuido: el alta web exige la ficha completa (REG-02), mientras que en
`Member` casi todo es nullable porque el padrón histórico del Libro 1 vino incompleto.

El `dni` de una solicitud no es único a propósito —una persona puede tener una rechazada
vieja y una viva—; lo que no puede haber es más de una **viva**, y esa invariante se valida
dentro de la transacción de creación por la razón de siempre. Cuando el DNI matchea a un ex
socio sin bloqueo, `memberId` apunta a esa ficha y el asiento hace un **reingreso** sobre
ella en vez de crear un duplicado (REG-25). De los tokens sólo se guarda el hash:
`resumeTokenHash` es el sha256 del enlace de retome, que viaja crudo una sola vez.

`Document` es polimórfico y su `ownerId` **no tiene clave foránea**: apunta a una solicitud,
a un socio o a una presentación de re-empadronamiento según diga `ownerType`, y la
integridad la cuida la capa de servicio. La conservación es permanente por decisión
institucional, el acceso es sólo de administración y cada visualización deja un asiento de
auditoría.

## 3.4 Tesorería

| Modelo / tabla | Campos clave | Relaciones | Para qué sirve |
|---|---|---|---|
| `FeeValue` / `fee_values` | `activeAmount`, `sharedAmount`, `validFrom` | FK a `minute` y a `createdBy`, las dos `SetNull` | El historial de valores de cuota: la única fuente de montos |
| `Fee` / `fees` | `period` `Char(7)`, `status`, `origin`; **sin monto** | FK a `member` con `Cascade`, FK a `payment` con `SetNull` | La cuota de un socio y un mes |
| `Payment` / `payments` | `type`, `amount`, `paidAt`, `mpPaymentId` unique, `preapprovalId`, `splitOfPaymentId`, `status` | FK a `member` y `application`; auto-referencia `splitOf` con `Restrict`; 1-1 con `receipt` | El cobro, del mostrador o de Mercado Pago |
| `Receipt` / `receipts` | `number` unique, `[year, seq]` unique, `paymentId` unique, `concept`, `pdfPath`, `voidedAt` | FK a `payment` con `Restrict`, FK a `voidedBy` | El recibo de la serie societaria |
| `ReceiptSequence` / `receipt_sequences` | `year` como clave primaria, `last` | ninguna | El contador anual de la serie |
| `MpUnmatchedPayment` / `mp_unmatched_payments` | `mpPaymentId` unique, `amount`, `payerEmail`, `externalReference`, `preapprovalId`, `reason`, `status` | FK a `payment` y a `resolvedBy` | La bandeja de cobros que no se pudieron imputar |
| `OtherIncome` / `other_incomes` | `amount`, `receivedAt`, `concept`, `method`, `mpPaymentId` unique, `voidedAt` | FK a `registeredBy` y a `voidedBy` | Ingresos que no son de ningún socio: alquileres, rifas |
| `FeeExemption` / `fee_exemptions` | `fromPeriod`, `toPeriod`, `months` (1 a 24), `revokedAt` | FK a `member`, `minute` y `revokeMinute` con **`Restrict`** | La exención de cuota del Art. 7 inc. a.4 |

**`Fee` no lleva monto, y es la decisión que ordena el dominio entero.** La deuda se valúa
siempre a valor vigente al momento del pago (REG-16 generalizado), así que guardarle un
importe a la cuota sería guardar un dato que caduca. El monto sale de `fee_values`, cuyo
vigente es el de mayor `validFrom` menor o igual a hoy, con "hoy" resuelto como día civil
argentino. Un valor nunca se edita: se registra otro encima, como un acta. El
`@@unique([memberId, period])` es la invariante central —un socio, un mes, una cuota— y su
violación es la que dispara el reintento único de la imputación.

**`Payment.mpPaymentId` es la barrera de idempotencia del dinero de Mercado Pago**, con una
consecuencia que hay que respetar: **anular un recibo no borra `mpPaymentId`**; si se
borrara, un reenvío de la misma notificación volvería a cobrar. El mismo id aparece con
`@unique` en `mp_unmatched_payments` y en `other_incomes`, porque son tres salidas distintas
para el mismo hecho y ninguna puede registrarlo dos veces. `splitOfPaymentId` es el reparto
de un cobro entre varios socios: un `Payment` por socio, uno solo —el portador— lleva el
`mpPaymentId` y los demás lo apuntan. **Las dos columnas nunca conviven en la misma fila**,
y eso lo garantiza el núcleo que escribe el cobro, no la base.

**El concepto del recibo se congela al emitir.** `Receipt.concept` es texto guardado, no
derivado: un recibo dice lo que se cobró el día que se emitió, y derivarlo de las cuotas del
pago lo borraba, porque al anular esas filas se despegan. La serie tampoco se borra ni se
renumera: se anula, con su fecha, su motivo y quién lo hizo (REG-33). El número se pide
tarde y dentro de la transacción, contra `receipt_sequences`, con un `INSERT … ON DUPLICATE
KEY UPDATE` que bloquea la fila del año hasta el commit: dos cobros simultáneos se
serializan y un rollback no consume número.

**`other_incomes` no tiene ninguna clave foránea al núcleo de plata, a propósito.** Es plata
de la asociación que no es de ningún socio, y la serie de recibos está armada alrededor del
socio. Sus campos de texto libre pueden nombrar a un tercero: por eso viven ahí, que lo lee
sólo el panel, y no van a la auditoría ni a ningún log (Ley 25.326).

**La exención se materializa como cuotas, y por eso no tocó el núcleo.** Al asentarla se
crean las filas de `fees` del rango entero con `status: "exempt"` y `origin: "exemption"`.
El devengo saltea ese mes porque la fila ya existe y la deuda no la cuenta porque pregunta
por `status: "pending"` a secas: la garantía es estructural, no una línea que diga "exempt",
y el módulo entero no modificó ni un archivo existente de tesorería. Tres de sus cuatro
claves foráneas son `Restrict` —la ficha y las dos actas, la del asiento y la de la
anulación—: ni a quién eximieron ni la constancia de por qué se pueden borrar por debajo.

## 3.5 Mercado Pago

| Modelo / tabla | Campos clave | Relaciones | Para qué sirve |
|---|---|---|---|
| `MpSubscription` / `mp_subscriptions` | `preapprovalId` unique, `planId` nullable, `status` como texto, `payerEmail`, `linkedManually`, `amount` | FK a `application` y a `member` | El espejo local de una suscripción de débito |
| `WebhookEvent` / `webhook_events` | `[origin, externalEventId]` unique, `topic`, `payload` (JSON crudo), `processedAt`, `result`, `error` | ninguna | El registro crudo de cada notificación entrante |

`status` es un `VarChar(32)` y **no** un enum: el catálogo de estados es de Mercado Pago
(`pending`, `authorized`, `paused`, `cancelled` y los que agreguen) y puede crecer sin
avisarnos; un enum habría convertido cada agregado del proveedor en una migración. Y
`memberId` es un índice, **no** un unique: nada impide que un socio tenga dos suscripciones
vivas a la vez, y la base no lo va a frenar.

**`planId` está muerto.** Todos los caminos que crean una fila —el alta web, la adhesión
desde el panel del socio, la vinculación manual y la conciliación— escriben `null`
explícito, y ningún código lo lee. Es histórico: las suscripciones se crean sin plan (el
flujo con plan exige un token de tarjeta y no permite redirigir al vecino) y llevan el monto
copiado en su propio `auto_recurring`. Los dos ids de plan que el sistema sí usa viven en
`Configuration`, y su único uso es el aviso de divergencia entre el plan y el valor vigente
que emite la conciliación diaria.

El `@@unique([origin, externalEventId])` de `webhook_events` **es** la idempotencia de la
ruta del webhook: un reintento del proveedor inserta-o-encuentra y sólo se reprocesa si el
intento anterior quedó sin `processedAt`. Es la primera de las dos capas de idempotencia del
dinero; la segunda es `mpPaymentId`. El enum `WebhookOrigin` tiene dos valores, pero hoy
ninguna ruta escribe `brevo`: el webhook de correo quedó previsto y no implementado.

## 3.6 Re-empadronamiento

| Modelo / tabla | Campos clave | Relaciones | Para qué sirve |
|---|---|---|---|
| `ReregistrationProcess` / `reregistration_processes` | `status`, `calledAt`, `firstEndsAt`, `secondEndsAt`, `igjApprovedAt` | FK al `book` que **cierra**; acta de convocatoria obligatoria, acta de cierre opcional | El proceso del Art. 9° bis |
| `Presentation` / `presentations` | `status`, `channel`, los datos declarados, `resumeTokenHash` unique, `observation`, `appealUntil` | FK a `process`, `member`, `street` y `validatedBy` | Lo que el socio presenta para ratificar su condición |
| `BoardNotice` / `board_notices` | `kind`, `postedAt`, `dueAt` | FK a `process`; N `notifications` | Un cartel en la cartelera física de la sede |
| `Holiday` / `holidays` | `date` unique (mediodía UTC del día civil), `label` | ninguna | Feriados, para contar plazos en días hábiles |

**La cohorte se congela al convocar.** Se crea una fila de `presentations` por cada
adherente vigente en ese momento, con `status: "pending"`, y ésa es la lista de convocados
para todo el proceso. Una fila `pending` **no significa que el socio haya hecho algo**:
existe para poder listar a quién le falta presentarse. Quien pasa a ser adherente después no
fue convocado y no le corre nada. El `@@unique([processId, memberId])` es la invariante de
la que dependen el padrón de faltantes y el conteo de cada instancia.

**Los datos declarados están duplicados a propósito y no tocan la ficha.** Entre la
presentación y la decisión de la Comisión puede pasar un mes, y la ficha viva no puede
quedar a medio camino de una presentación que después se rechaza: se copian a `members`
recién al **validar**. El nombre, el DNI, la categoría, el estado y la fecha de ingreso no
se escriben nunca desde una pantalla pública — el DNI no es autenticación, es una llave que
cualquiera puede tipear.

**En el cartel, la fecha que acredita es `dueAt`, no `postedAt`** (las dos son nullable
mientras el cartel no se colgó). La notificación por cartelera se tiene por cumplida veinte
días hábiles después de la fijación, y estampar el día de la fijación le comería al vecino
veinte días hábiles de su defensa. A quiénes notificó lo dicen las `notifications` que lo
apuntan; ojo con esa clave foránea, que es `SetNull`: borrar un cartel salvaría la
notificación pero perdería **cuál** cartel la respaldaba, y de esa fecha cuelga el cómputo
del plazo. La garantía no está en la clave foránea, así que la pantalla que alguna vez borre
carteles tiene que bloquearlo por su cuenta. `holidays` es una tabla y no una constante
porque los feriados trasladables se fijan por decreto cada año; y si al cómputo le falta el
año que está pisando, el sistema **falla ruidoso** en vez de contar un feriado como hábil.

## 3.7 Reportes

| Modelo / tabla | Campos clave | Relaciones | Para qué sirve |
|---|---|---|---|
| `Report` / `reports` | `number` unique y **nullable**, `kind`, `status`, `anonymous`, la identidad congelada, `lat` y `lng`, `outsideBoundary`, `claimTokenHash` unique, `filedAgency`, `dniPurgedAt` | FK a `member` y a `street`; FK a `filedMinute` con **`Restrict`**; FK a `filedBy` y `dismissedBy` | Reclamos e iniciativas de los vecinos |
| `ReportFile` / `report_files` | `kind`, `path`, `mime`, `width`, `height`, `size` | FK a `report` con `Cascade` | Las fotos y las dos caras del DNI |
| `ReportSequence` / `report_sequences` | `id` como clave primaria (**una sola fila**), `last` | ninguna | El contador del N° público |

**El N° público se asigna al enviar, no al crear.** La fila nace como borrador en el paso 1
del wizard —para que las fotos y el DNI tengan dueño mientras el vecino completa el resto—
así que `number` es nullable mientras es borrador y no nulo desde el envío. Antes el número
que veía el vecino era el `id`, y cada wizard abandonado se llevaba uno. El `id` sigue
mandando en todo lo interno (URLs, claves foráneas, auditoría); lo único que cambió es lo
que se muestra. `report_sequences` es una calca de `receipt_sequences`, con la misma
disciplina de bloqueo dentro de la transacción del envío.

**La identidad es una foto al momento de reportar**: para un socio se copia de su ficha al
crear el borrador, y el PDF dice quién reportó ese día aunque la ficha después cambie.
`anonymous` significa "reservado ante el organismo": la asociación siempre conoce la
identidad; lo que la omite es el PDF que se presenta.

**Toda imagen pasa por sharp antes de tocar el disco.** `ReportFile.mime` es en la práctica
la constante `image/jpeg` porque el store re-codifica: no existe el archivo "tal cual
llegó". No es una validación de formato —de eso se ocupan los magic bytes— sino de
contenido: una foto sacada del celular en la esquina del problema trae el GPS en el EXIF, y
guardarla cruda publicaría el domicilio de quien reclama. Los DNI de ASOCIATE y de
REEMPADRONATE todavía se guardan tal cual: es deuda anotada en `docs/08`, no una diferencia
de criterio. `dniPurgedAt` es la marca de la retención —las caras del DNI se purgan a los
360 días y los borradores nunca enviados a las 48 horas—, y la clave foránea a `filedMinute`
es `Restrict` por el mismo motivo que en la exención: el acta es el respaldo institucional
de que la Comisión trató la iniciativa (Art. 6, Derechos 2).

## 3.8 Contenido

| Modelo / tabla | Campos clave | Relaciones | Para qué sirve |
|---|---|---|---|
| `News` / `news` | `slug` unique, `body` como `Text`, `coverImagePath`, `status`, `publishedAt` | FK a `author` con `SetNull` | La cartelera digital del sitio público |
| `Activity` / `activities` | `room`, `weekdays` (JSON), `startTime` y `endTime` (`VarChar(5)`), `year`, `active` | ninguna | Las actividades semanales de la sede |
| `InstitutionalDocument` / `institutional_documents` | `type`, `yearKey` unique, `fileName`, `size`, `featured` | FK a `uploadedBy` con `SetNull` | Estatuto, memorias y balances que la Comisión publica a los socios |

`News.body` guarda **HTML ya sanitizado en el servidor**; nunca se persiste HTML crudo del
cliente. El `slug` es editable incluso después de publicar, y si cambia la URL vieja da 404:
se aceptó porque es un sitio chico sin posicionamiento heredado que preservar.
`publishedAt` se fija la **primera** vez que se publica y no se pisa al republicar: es la
fecha que ve el vecino y la que ordena la cartelera. Cuidado con el nombre: esta cartelera
**digital** no es la cartelera **física** de la sede, que vive en `board_notices`.

`Activity` guarda los horarios como texto de hora de pared (`"19:30"`) y **sin convertir a
UTC**: es la excepción documentada de la convención de fechas, y es correcta, porque un
horario recurrente no es un instante. `weekdays` es un array JSON de enteros del 1 al 6.

`InstitutionalDocument` tiene el mejor truco del esquema para esquivar la falta de índices
parciales: "una memoria y un balance por año" lo sostiene la **base**, con una clave
materializada. `yearKey` se arma como `"annual_report:2025"` sólo para esos dos tipos y
queda en NULL para los otros dos — y los NULL de un unique de MySQL no chocan entre sí.
`featured` no tuvo esa suerte: es un booleano y `false` no es `NULL`, así que "a lo sumo una
norma destacada" lo sostiene la transacción del asiento, con un alcance que el propio
esquema admite acotado (evita un estado intermedio con dos destacadas, pero no cierra la
carrera de dos altas simultáneas).

## 3.9 Sistema

| Modelo / tabla | Campos clave | Relaciones | Para qué sirve |
|---|---|---|---|
| `Configuration` / `configuration` | `key` como clave primaria, `value` (JSON), `updatedBy`, `updatedAt` | ninguna | Las llaves de sistema que se editan sin desplegar |
| `AuditLog` / `audit_log` | `id` `BigInt`, `action`, `entity`, `entityId`, `detail` (JSON), `ip` | FK a `user` con `SetNull` | La auditoría de toda acción sensible |
| `ActionToken` / `action_tokens` | `tokenHash` unique, `purpose`, `expiresAt`, `usedAt` | FK a `member`; FK a `application` y a `user`, con `Cascade` | Los enlaces de un solo uso |
| `Notification` / `notifications` | `type`, `via`, `status`, `sentAt`, `error`, `period` | FK a `member`, `application`, `boardNotice` y `report` | La acreditación de que a alguien se le avisó |
| `CronRun` / `cron_runs` | `job`, `startedAt`, `finishedAt`, `ok`, `summary` (JSON), `error` | ninguna | La última corrida de cada tarea programada |
| `Street` / `streets` | `id` **sin autoincrement**, `loadOrder`, `name`, `normalizedName` | `members`, `applications`, `presentations`, `reports` | Las 40 calles catastrales del barrio |

`Configuration` es clave-valor con el valor en JSON, y está para lo que tiene que poder
cambiar sin un despliegue: los dos ids de plan de Mercado Pago, los destinatarios del
resumen diario, la llave de la categoría colaborador y cuál es el proceso de
re-empadronamiento vivo. En `AuditLog`, el tercer índice tiene historia: `@@index([action])`
existe porque la pantalla de salud consulta por acción, y sin él esa consulta era un full
scan sobre la tabla que más crece del sistema.

**Una notificación `failed` registra un intento, no una acreditación**, y es la distinción
más importante de esta tabla: el correo no salió. `error` guarda el **código** del fallo,
nunca la dirección (Ley 25.326), y un bloqueo por la lista blanca de correos no cuenta como
fallo: es el entorno de prueba andando. `sentAt` en una fila `failed` es la fecha del
intento, y la columna se sigue llamando así porque renombrarla pedía una migración que no se
justifica. `period` es la marca de deduplicación del recordatorio mensual y tiene un índice,
**deliberadamente no un unique**: con filas `failed` en la tabla, un unique haría que un
intento fallido bloqueara para siempre el reintento de ese período.

De los tokens sólo se guarda el sha256; el crudo viaja una vez, en el enlace. Y `Street.id`
no es autoincrement: son los ids catastrales del municipio, que vienen dados.

## Dónde está en el código

Cada dominio tiene su carpeta en `src/lib`: `members/`, `applications/`, `treasury/`, `mp/`,
`reregistration/` y `board/`, `reports/`, `news/`, `documents/`. Los comentarios del propio
`prisma/schema.prisma` son la fuente primaria de casi todo este capítulo. Para la mecánica
de la plata, el documento T5; para los procesos de dominio, el T6.

# 4. Los enums

Treinta y cuatro enums. La última columna es la que suele faltar: quién escribe esos
valores, porque un enum con un valor que nadie escribe es una trampa.

| Enum | Valores | Significado | Quién lo escribe |
|---|---|---|---|
| `MemberCategory` | `active`, `adherent`, `collaborator`, `cadet`, `honorary`, `lifetime` | Las seis del estatuto | El alta, la recategorización y el modo carga. Por la web llegan sólo las tres primeras (REG-01) |
| `MemberStatus` | `active`, `suspended`, `withdrawn` | El estado societario | El alta, la baja, la suspensión y el lote de cesantía |
| `EmailStatus` | `none`, `declared`, `verified`, `bounced` | Cuánto vale la casilla | El alta escribe `declared` y la verificación por token, `verified`; `none` es el default y **`bounced` no lo escribe nadie** |
| `WithdrawalReason` | `death`, `resignation`, `arrears`, `moved_away`, `not_reregistered`, `expulsion`, `duplicate_annulment`, `other` | Por qué se fue | La baja individual y los lotes. Tres motivos además bloquean el reingreso: `expulsion`, `death` y `duplicate_annulment` |
| `MovementType` | `admission`, `withdrawal`, `category_change`, `readmission`, `suspension`, `suspension_end`, `book_migration`, `fee_exemption`, `fee_exemption_revoked` | Qué pasó en la ficha | Cada acto del padrón escribe el suyo; los dos últimos los estrenó la exención |
| `MemberRequestType` | `withdrawal`, `category_change` | Qué pide el socio | El panel del socio |
| `MemberRequestStatus` | `pending`, `accepted`, `rejected`, `cancelled`, `superseded` | Cómo terminó el pedido | La Comisión, los dos del medio; el socio, `cancelled`; el sistema, `superseded` si la baja llegó por otro camino |
| `MinuteType` | `board`, `assembly` | Comisión Directiva o Asamblea | La carga del acta |
| `BookStatus` | `open`, `closed` | Libro abierto o cerrado | La apertura y el cierre del libro |
| `TokenPurpose` | `email_verification`, `password_invitation`, `password_reset`, `admin_invitation` | Para qué sirve el enlace | Cada emisor de tokens; el último cuelga de la cuenta |
| `NotificationType` | veinte valores | Qué aviso es | El mailer y la cartelera. **El orden importa** (ver abajo) |
| `NotificationVia` | `email`, `board` | Correo o cartelera física | El mailer y el lote de cartelera |
| `NotificationStatus` | `sent`, `delivered`, `bounced`, `posted_board`, `completed_board`, `failed` | Qué pasó con el aviso | El mailer escribe `sent` y `failed`; la cartelera, `posted_board`. **Los otros tres no los escribe nadie** (ver abajo) |
| `NewsStatus` | `draft`, `published` | Borrador o publicada | El panel de noticias |
| `Room` | `historic`, `glass`, `kitchen`, `classroom` | Los espacios de la sede | El alta de actividades; es enum y no tabla a propósito |
| `ApplicationStatus` | `started`, `pending_payment`, `approved_pending_minute`, `pending_board`, `completed`, `rejected`, `expired` | La máquina del alta web | El wizard, el webhook y la bandeja |
| `DocumentOwner` | `application`, `member`, `presentation` | De quién es el documento | Cada wizard que sube un DNI |
| `DocumentType` | `dni_front`, `dni_back`, `annex` | Qué documento es | El wizard; el anexo lo exige la categoría colaborador |
| `WebhookOrigin` | `mp`, `brevo` | Quién notifica | Sólo la ruta de MP escribe el primero; **el segundo, nadie** |
| `FeeStatus` | `pending`, `paid`, `exempt`, `voided` | El estado de la cuota | El devengo, el cobro y la exención, los tres primeros; **el cuarto, nadie** |
| `FeeOrigin` | `accrual`, `import`, `exemption` | De dónde salió la fila | El cron mensual, la importación de deuda y el asiento de la exención |
| `PaymentType` | `debit`, `link`, `cash`, `voluntary`, `entry`, `extraordinary` | Medio y concepto | El mostrador según el concepto; el webhook, `debit`; la bandeja, `link`; el alta web, `entry` |
| `PaymentStatus` | `applied`, `refunded`, `voided` | Vigente, reembolsado o anulado | La anulación del recibo y el procesador del reembolso |
| `UnmatchedStatus` | `open`, `matched`, `dismissed`, `other_income`, `partial` | Cómo se resolvió la fila | El núcleo deriva `matched` y `partial` del grupo; las otras dos, el operador |
| `IncomeMethod` | `cash`, `mp` | Mostrador o Mercado Pago | El alta del ingreso no societario |
| `ReregistrationStatus` | `preparing`, `first_instance`, `second_instance`, `closing`, `closed` | La etapa del proceso | Cada paso, con superadmin |
| `PresentationStatus` | `pending`, `submitted`, `observed`, `validated`, `rejected`, `withdrawn` | Dónde está la presentación | La convocatoria, `pending`; el vecino, `submitted`; el resto, la cola y el lote de bajas |
| `PresentationChannel` | `web`, `in_person` | Por dónde entró | El wizard y la carga presencial; nulo mientras está pendiente |
| `BoardNoticeKind` | `first_instance`, `second_instance`, `withdrawal`, `other` | Qué cartel es | El armado del lote de cartelera |
| `InstitutionalDocumentType` | `norm`, `annual_report`, `balance`, `other` | Qué documento institucional es | El alta desde el panel |
| `ReportKind` | `claim`, `initiative` | Reclamo o iniciativa | El paso 1 del wizard. **Decide el copy de las pantallas** |
| `ReportStatus` | `draft`, `received`, `filed`, `dismissed` | Dónde está el reporte | El wizard, los dos primeros; la bandeja, los dos últimos |
| `ReportFileKind` | `photo`, `dni_front`, `dni_back` | Qué archivo es | El store de archivos del wizard |
| `ReportAgency` | `mcr`, `scpl`, `council`, `province`, `camuzzi`, `other` | Ante qué organismo se presentó | La bandeja, al asentar un reclamo |

**El orden de `NotificationType` es parte del contrato.** Un ENUM de MySQL se guarda como
índice, no como texto, así que intercalar un valor le corre el significado a cada fila ya
escrita. Los tres tipos del módulo de reportes están **después de `generic`**, o sea al
final absoluto, y no antes del comodín como habría sido natural. Todo valor nuevo va al
final, siempre.

**Seis valores no los escribe nadie**, y conviene tenerlos a la vista porque un `where` que
los busque devuelve siempre cero. `FeeStatus.voided` figura en el esquema y en el mapeo de la
grilla de la cuenta corriente, pero ningún camino lo escribe: al anular un cobro las cuotas
del pasado vuelven a `pending` y las del futuro se borran. Otros cuatro tienen **una causa
común: el webhook de correo entrante no se implementó**. `WebhookOrigin.brevo` quedó
reservado para esa ruta que no existe, y con ella se quedaron sin escritor
`EmailStatus.bounced` y dos de los estados de aviso, `delivered` y `bounced` — el primero es
un ascenso de `sent` que sólo puede llegar del proveedor. El sexto, `completed_board`, es la
contracara en la cartelera: hoy se publica el cartel y ahí queda, y el cumplimiento del plazo
se lee de la fecha de vencimiento del propio cartel.

**`ReportKind` decide el texto, no sólo el filtro.** Un reclamo se **presenta ante un
organismo**; una iniciativa la **trata la Comisión Directiva**. Prometerle un organismo a
quien propuso una idea es prometer algo que la asociación no va a hacer, y hubo que
corregirlo cuatro veces en pantallas distintas. Cuando una pantalla nueva escribe una frase
sobre un reporte, la pregunta es qué dice esa frase en los dos casos.

## Dónde está en el código

Los enums están todos en `prisma/schema.prisma`, con comentarios extensos en los que tienen
historia. Las etiquetas en castellano de cada valor viven en `src/lib/members/labels.ts` y
`src/lib/treasury/labels.ts`.

# 5. Invariantes

## 5.1 Las que sostiene la base

Lo que sigue no se puede romper sin que la base se queje. Es una **selección**, no el
inventario: están las que sostienen una regla del negocio y hay que mirar antes de escribir
una migración. El resto de los uniques y de las claves foráneas de cada modelo figura en las
tablas del capítulo 3 y, completo, en el esquema.

| Invariante | Dónde | Qué sostiene |
|---|---|---|
| `mp_payment_id` UNIQUE | `payments` | La barrera de idempotencia del dinero de Mercado Pago. Se replica en `mp_unmatched_payments` y en `other_incomes`: el mismo hecho visto desde tres salidas |
| `[member_id, period]` UNIQUE | `fees` | Un socio, un mes, una cuota. Su violación dispara el reintento único de la imputación |
| `number` UNIQUE + `[year, seq]` UNIQUE, con `receipt_sequences` | `receipts` | La serie de recibos sin huecos y sin repetidos (REG-33) |
| `[book_id, member_number]` y `[member_id, book_id]` UNIQUE | `memberships` | La densidad de la numeración del padrón, y un número por socio y libro |
| `[type, number]` UNIQUE | `minutes` | Un acta se identifica por el par, no por su id |
| `[origin, external_event_id]` UNIQUE | `webhook_events` | La idempotencia de la ruta del webhook |
| `[process_id, member_id]` UNIQUE | `presentations` | Una presentación por socio y por proceso |
| `number` y `claim_token_hash` UNIQUE | `reports` | El N° público sin repetir y la llave del borrador |
| `preapproval_id` y `resume_token_hash` UNIQUE | `applications` | Una solicitud por suscripción; un enlace de retome por solicitud |
| `token_hash` UNIQUE | `action_tokens` | Un enlace de un solo uso, guardado como hash |
| `year_key` UNIQUE | `institutional_documents` | Una memoria y un balance por año, con la clave materializada |
| `split_of_payment_id` FK `Restrict` | `payments` | Un portador con partes no se puede borrar |
| `payment_id` FK `Restrict` | `receipts` | No se borra el pago de un recibo emitido |
| `minute_id` y `revoke_minute_id` FK `Restrict` | `fee_exemptions` | Las dos actas de la exención son la prueba y no se borran por debajo |
| `filed_minute_id` FK `Restrict` | `reports` | El acta con la que la Comisión trató la iniciativa |

## 5.2 Las que viven en código

MySQL no tiene **índices únicos parciales**, y eso explica esta segunda lista entera. Todas
tienen la misma forma —"a lo sumo uno **vigente**"— y todas necesitarían filtrar por una
condición (`status = 'pending'`, `revoked_at IS NULL`, `featured = true`) que un unique de
MySQL no sabe expresar. Se sostienen dentro de la transacción que las puede romper, con la
verificación adentro.

1. **Una solicitud de alta viva por DNI.** Se cuenta dentro de la transacción que la crea.
2. **Una `MemberRequest` pendiente por tipo y por socio.** Mutex por socio envolviendo la
   transacción **entera**, con el conteo adentro: la invariante se sostiene bajo
   concurrencia real, no por buena suerte. Sólo la creación necesita el mutex.
3. **Una `FeeExemption` vigente por socio.** Es una de las seis guardas del asiento y se
   **revalida dentro** de la transacción. La anulación revalida la vigencia por su cuenta:
   un cerrojo optimista sobre `revokedAt IS NULL` cubre la carrera pero no ve la exención ya
   **vencida**, que llega con esa columna en null desde una pestaña vieja.
4. **Un `InstitutionalDocument.featured` a lo sumo.** Se apaga el anterior con un
   `updateMany` dentro de la transacción, y el esquema admite que eso no cierra la carrera
   de dos altas simultáneas. Con el volumen real —un alta ocasional— es inalcanzable.
5. **Un `Payment` tiene `mpPaymentId` o `splitOfPaymentId`, nunca los dos.** Lo garantiza el
   tipo con el que el núcleo escribe la fila.
6. **Cada fila de `documents` apunta a un dueño que existe.** `ownerId` no tiene clave
   foránea porque es polimórfico; la integridad la cuida la capa de servicio.

Dos advertencias acompañan a esta lista. La primera: los mutex y los limitadores viven **en
memoria**, así que todo esto asume un solo proceso — subir las instancias de PM2 rompe la
invariante 2 en silencio. La segunda: con `@prisma/adapter-mariadb` **no existe
`meta.target`** en el error de violación de unique; el nombre del índice viaja en
`meta.driverAdapterError.cause.constraint.index`. Una guarda escrita contra `meta.target`
—que es lo que dice la documentación de Prisma— pasa todos los tests y **nunca matchea en
producción**, porque el doble de los tests es el que miente. Se lee de
`src/lib/treasury/unique-violation.ts`, que soporta las dos formas y falla cerrada.

## Dónde está en el código

`prisma/schema.prisma` para la primera lista. Para la segunda: `src/lib/applications/`,
`src/lib/treasury/exemptions.ts`, `src/app/admin/documentos/actions.ts`,
`src/lib/treasury/service.ts`, `src/lib/keyed-mutex.ts` y
`src/lib/treasury/unique-violation.ts`.

# 6. Las migraciones

**Veinticuatro** migraciones en `prisma/migrations/`, todas con nomenclatura
`AAAAMMDDHHMMSS_nombre` y con su `migration_lock.toml` fijando el provider `mysql`. La regla
no se discute: siempre `prisma migrate deploy`, **nunca `db push`** en producción.

| N° | Fecha | Migración | Qué agrega | Muda datos | Desplegada |
|---|---|---|---|---|---|
| 1 | 17/08/2026 | `init_module_0` | `users`, `roles`, `user_roles`, `configuration`, `audit_log` | no | sí |
| 2 | 18/08/2026 | `add_module_1_padron` | Las ocho tablas del padrón, con `members`, `books` y `minutes` | no | sí |
| 3 | 18/08/2026 | `add_module_1_foreign_keys` | Las claves foráneas diferidas del padrón | no | sí |
| 4 | 19/08/2026 | `add_password_changed_at` | La columna que habilita la invalidación de sesiones | no | sí |
| 5 | 19/08/2026 | `add_module_2_news_activities` | `news`, `activities` | no | sí |
| 6 | 20/08/2026 | `add_module_3_applications_mp` | `applications`, `documents` y las dos tablas de Mercado Pago | no | sí |
| 7 | 22/08/2026 | `add_module_4_treasury` | Las siete tablas de Tesorería, de `fee_values` a `cron_runs` | no | sí |
| 8 | 22/08/2026 | `add_module_4b_mercadopago` | Dos columnas pasan a nullable; el preapproval y el `reason` NOT NULL en la bandeja | no | sí |
| 9 | 23/08/2026 | `add_other_income` | `other_incomes` y el cuarto valor de `UnmatchedStatus` | no | sí |
| 10 | 24/08/2026 | `add_module_4c_notifications` | La columna de período y **cuatro índices** nuevos | no | sí |
| 11 | 24/08/2026 | `member_address_pending_review` | La marca de domicilio pendiente de constatación | no | sí |
| 12 | 25/08/2026 | `member_requests` | `member_requests` y valores nuevos de `NotificationType` | no | sí |
| 13 | 25/08/2026 | `add_kitchen_and_classroom_rooms` | Dos valores nuevos en el enum `Room` | no | sí |
| 14 | 26/08/2026 | `membership_close_snapshot` | Las dos columnas de la foto del cierre de libro | no | sí |
| 15 | 26/08/2026 | `member_request_superseded_status` | El quinto valor de `MemberRequestStatus` | no | sí |
| 16 | 26/08/2026 | `reregistration_process` | Las cuatro tablas del re-empadronamiento | no | sí |
| 17 | 26/08/2026 | `presentation_rejected_notification` | Un valor nuevo de `NotificationType` | no | sí |
| 18 | 27/08/2026 | `fee_exemptions` | `fee_exemptions` y tres valores de enum | no | sí |
| 19 | 29/08/2026 | `add_admin_invitation_token_purpose` | `admin_invitation` en `TokenPurpose` | no | sí |
| 20 | 30/08/2026 | `add_institutional_documents` | `institutional_documents` | no | sí |
| 21 | 01/09/2026 | `add_reports` | `reports`, `report_files` y una columna en `notifications` | no | sí |
| 22 | 02/09/2026 | `report_minute_restrict` | La clave foránea del acta del reporte pasa a `RESTRICT` | no | sí |
| 23 | 03/09/2026 | `report_public_number` | El N° público del reporte y su tabla de secuencia | **sí** | sí |
| 24 | 10/09/2026 | `payment_split` | La columna del reparto y el quinto valor de `UnmatchedStatus` | no | sí |

**La 23 es la única que muda datos existentes.** El backfill renumera lo ya enviado con un
contador de sesión y un `UPDATE … ORDER BY submitted_at, id`: el reporte que en producción
se mostraba como "N° 16" pasó a ser el N° 1. Su verificación post-migración está en
`docs/10` §4.9, y hay que correrla: una renumeración a medias no se nota mirando una
pantalla.

**Las veinticuatro están aplicadas en producción.** La última, la 24, viajó con el
despliegue del 11/09/2026: `deploy.sh` corre `prisma migrate deploy`, así que todo lo que
estaba en `main` en ese momento quedó aplicado. Lo que sí seguía pendiente al cierre de este
documento es la **verificación funcional** del reparto —repartir entre dos socios el cobro
de $ 18.000 del 08/09/2026 desde la bandeja—, que está paso a paso en `docs/10` §4.10:
aplicar la migración y ejercitar la pantalla son dos cosas distintas.

Ninguna migración es destructiva de tablas; la 22 recrea una clave foránea sobre una tabla
que entonces estaba vacía. Y una nota de entorno local medida el 10/09/2026: `prisma migrate
dev` **no regeneró el cliente**, así que conviene correr `npx prisma generate` a mano después
de migrar, o la compilación falla por un tipo que ya está en la base.

## Dónde está en el código

`prisma/migrations/*/migration.sql` (cada una es SQL plano y se lee en un minuto);
`prisma/migrations/migration_lock.toml`; `deploy.sh` en la raíz, que es quien las aplica; y
`docs/10-runbook-dominio-produccion.md` §4.1 para el procedimiento, §4.9 a §4.11 para lo
específico de las últimas.

# 7. Datos importados

Cinco archivos de `datos/` son insumo del sistema: cuatro se importan con su script y el
quinto no. **Los cuatro ya corrieron en producción**, cada uno una sola vez: los tres
primeros al armar la base, y el del estatuto el 30/08/2026, en la misma sesión del despliegue
del módulo de documentos institucionales (`docs/10` §4.7). (El sexto archivo de la carpeta,
`estatuto.docx`, es el original de trabajo del PDF y el sistema no lo mira.)

| Archivo | Qué trae | Script | Qué queda a mano |
|---|---|---|---|
| `padron_socios.xlsx` | El padrón definitivo del Libro N° 1: 278 filas, numeración de 1 a 306 con 28 huecos, DNIs completos y 37 correos cargados | `scripts/import-padron.ts` | El resto de la ficha (domicilio, nacimiento, teléfono) se completa desde el panel |
| `deuda.xlsx` | La deuda a agosto de 2026 en **cantidad de cuotas impagas por año** (2022 a 2026), sin montos: 278 filas, 118 socios con deuda, 3076 cuotas | `scripts/import-deuda.ts` | Nada: las cuotas no llevan monto, así que no hay importe que cargar |
| `calles_inicial.csv` | Las 40 calles catastrales del barrio (`id_calle`, `orden_carga`, `nombre_calle`) | `scripts/import-calles.ts` | Nada; el script valida el encabezado exacto y es idempotente |
| `estatuto.pdf` | El estatuto, para publicarlo a los socios | `scripts/import-estatuto.ts` | Nada, pero **no es opcional**: entre el reinicio y este script la pantalla de documentos del socio se ve vacía |

Los feriados no salen de `datos/`: los siembra `scripts/seed-holidays.ts` con los nacionales
de la Ley 27.399 en sus tres formas —inamovibles, los derivados de Pascua y los trasladables
en su fecha efectiva—, y **no carga** los días no laborables con fines turísticos ni el
Jueves Santo, porque meterlos alargaría plazos sin fundamento legal. Siembra **de una sola
corrida** todos los años escritos en su constante `YEARS`, hoy 2026 y 2027: sumar un año es
editar esa constante y volver a correrlo, no correrlo otra vez tal cual. Es idempotente. Y
`limites-barrio.kml` es el quinto archivo, el que no se importa: el polígono del barrio está
transcripto en `src/lib/reports/boundary.ts`, que es contra lo que se decide si un reporte
cae adentro o afuera.

Dos cuidados con la importación del padrón. Las cuotas importadas se anclan a la fecha de la
foto —el 21/08/2026— y **no al reloj de la corrida**, porque si no la deuda de 2022
aparecería devengada el día que se corrió el script. Y el importador por defecto **sólo crea
lo que falta**: su modo de actualización pisa las fichas con lo que diga el Excel y es
destructivo con todo lo cargado a mano, y ante cualquier ambigüedad el script **aborta** en
vez de adivinar. Queda además un pendiente operativo anotado:
`scripts/fix-withdrawal-reasons.ts` todavía no se corrió en el servidor. Reconcilia el
motivo de baja y el bloqueo de reingreso contra el Excel, toca sólo dos columnas y sólo de
socios ya dados de baja, y existe porque un expulsado registrado con motivo "mora" pasaría
la puerta del alta web (REG-04).

## Dónde está en el código

`scripts/import-padron.ts`, `scripts/import-deuda.ts`, `scripts/import-calles.ts`,
`scripts/import-estatuto.ts`, `scripts/seed-holidays.ts` y
`scripts/fix-withdrawal-reasons.ts`. Todos empiezan con `import "dotenv/config"` como primer
import, porque `tsx` no carga el archivo de entorno por su cuenta y sin eso el cliente de
Prisma no ve la URL de la base.

# Documentos relacionados

De esta serie: **T1 — Visión y panorama** (los módulos y el estado de cada uno); **T2 —
Arquitectura y código** (las capas, y por qué la red no va adentro de una transacción); **T3
— Instalación, despliegue y operación** (la base local, `deploy.sh` y qué verificar después
de una migración); **T5 — Tesorería y Mercado Pago** (el complemento natural del bloque de
Tesorería de acá); **T6 — Módulos de dominio** (el re-empadronamiento, los reportes y las
solicitudes contados como procesos); **T7 — Seguridad, privacidad y calidad**.

De la documentación original: `docs/02-marco-estatutario.md`, con las reglas `REG-xx` que se
citan acá; `docs/04-modelo-de-datos.md`, la especificación acordada con el cliente, anterior
al código y en varios puntos superada —donde difieran, manda el esquema—; y
`docs/10-runbook-dominio-produccion.md` §4.1 y §4.9 a §4.11.
