# 04 — Modelo de datos

Nombres finales de tablas/campos en inglés en el schema de Prisma; acá se describen
con nombres en español por claridad conceptual. El schema debe implementar TODAS
las entidades y restricciones de este documento.

## Diagrama conceptual

```
Libro 1──N Membresia N──1 Socio 1──N Movimiento N──1 Acta
                              │
        ┌──────────┬──────────┼───────────┬─────────────┬──────────────┐
        N          N          N           N             N              N
   Documento    Cuota N──1 Pago 1──1 Recibo │      Notificacion   SuscripcionMP
                                          │
                                     Presentacion (re-empadronamiento)
Solicitud (alta web) ──N Documento
ProcesoReempadronamiento 1──N Presentacion
Usuario N──N Rol · Noticia · Calle · ValorCuota · Feriado · Auditoria · WebhookEvent
Recibo N──1 SecuenciaRecibo (por anio) · PagoSinConciliar · CorridaDeCron
```

## Entidades

### Socio (persona)
Identidad única de la persona a través de todos los libros.
- `id`, `apellido_nombre` (como viene del padrón; opcionalmente split posterior),
  `dni` (UNIQUE, nullable solo para históricos sin dato), `fecha_nacimiento`,
  `estado_civil`, `nacionalidad`, `ocupacion`, `telefono`
- Domicilio: `calle_id` (FK Calle, nullable), `calle_texto` (para colaboradores u
  otras direcciones fuera del barrio), `altura`, `barrio`
- Domicilio electrónico: `email`, `email_estado`
  (`sin_email` | `declarado` | `verificado` | `rebotado`), `email_verificado_at`
- Estado actual (desnormalizado para consultas; la verdad es el historial de
  Movimientos): `categoria` (activo|adherente|colaborador|cadete|honorario|vitalicio),
  `estado` (`vigente` | `suspendido` | `baja`), `motivo_baja` (catálogo REG-18),
  `fecha_ingreso` (fecha del acta de alta original — NUNCA se pisa en cambios de
  libro ni de categoría), `fecha_egreso`
- Flags: `bloqueado_reingreso` (expulsados, REG-04), `rechazo_hasta` (REG-05),
  `deuda_tesoreria_baja` (boolean, `debt_at_withdrawal` en el schema): tenía deuda
  de tesorería al momento de la baja. Es **histórico del Libro 1** (columna
  `deuda_tesoreria` del padrón) y **desde el Módulo 4 ya no se lee**: la deuda es la
  cuenta corriente. Lo sigue escribiendo `withdraw` en toda baja con cuotas
  pendientes —dentro de su transacción, así que cubre cesantía por mora, renuncia y
  mudanza por igual— como dato del asiento, y el listado del padrón todavía lo
  muestra como badge histórico (se migra cuando la fase 4B toque esa consulta).
  `debito_automatico` (boolean, `auto_debit` en el schema): candidato a vincular
  una suscripción MP preexistente (columna `debito_automatico` del padrón, ver 06).
- `usuario_id` (FK Usuario, nullable)

### Libro
- `numero` (1, 2, 3…), `estado` (`abierto`|`cerrado`), `acta_apertura_id`,
  `acta_cierre_id`, `fecha_apertura`, `fecha_cierre`
- Solo puede existir UN libro abierto a la vez.

### Membresia (número de socio por libro)
- `socio_id`, `libro_id`, `numero_socio` — UNIQUE(`libro_id`,`numero_socio`)
  y UNIQUE(`socio_id`,`libro_id`)
- El "número de socio actual" de una persona = su membresía en el libro abierto.

### Acta
- `id`, `tipo` (`comision_directiva` | `asamblea`), `numero`, `fecha`,
  `descripcion`, `creado_por`
- La **fecha del acta define la fecha de ingreso** de las altas que contiene (REG-11).

### Movimiento (historial de estados)
- `socio_id`, `tipo` (`alta` | `baja` | `cambio_categoria` | `reingreso` |
  `suspension` | `fin_suspension` | `migracion_libro`), `fecha` (= fecha del acta),
  `acta_id` (obligatoria salvo `migracion_libro` que hereda el acta de cierre),
  `categoria_anterior`, `categoria_nueva`, `motivo` (catálogo), `detalle`, `creado_por`

### Solicitud (alta web) — `Application` / tabla `applications` (Módulo 3)
- `id`, datos personales completos del formulario (espejo de Socio), `requestedCategory`
  (`active` | `adherent` | `collaborator`; REG-01, las demás categorías salen del
  padrón y no de un formulario), `wantsDebit`, `status`:
  `started` → `pending_payment` (esperando autorización del débito en MP)
  → `approved_pending_minute` (débito autorizado y 1er pago OK ⇒ aceptación automática
     REG-12; falta solo el asiento en acta) → `completed`
  · rama sin débito (adherente que no adhiere): `pending_board` → `completed` | `rejected`
  · **`expired`**: el cron vence a los 7 días las solicitudes en `started` y
    `pending_payment` (nunca las que esperan a la CD). Un pago aprobado que llegue
    después **revive** la solicitud a `approved_pending_minute` (`docs/05` §3).
  · acciones de CD sobre `approved_pending_minute`: confirmar (default), recategorizar
    (cambia categoría + ajusta suscripción MP), `rejected` (retiene cuota de ingreso,
    REG-12.b)
- `preapprovalId` (UNIQUE), `mpPaymentIdEntry` + `entryAmount` (`Decimal(10,2)`:
  hasta que exista Pago/Recibo en el Módulo 4, este par **es** el registro de la
  cuota de ingreso), `emailVerifiedAt`, `minuteId` (acta del asiento o del rechazo),
  `decidedAt`, `remindedAt`, `ip`, `userAgent`, `acceptedTermsAt`
- `resumeTokenHash` (Char(64) UNIQUE): sha256 del **token de retome**. El token crudo
  (32 bytes base64url) vive solo en el cliente del wizard y en el email de
  recordatorio; nunca se persiste. Es lo que autentica los pasos 4 y 5 y la ruta
  `/asociate/retomar/[token]`. No tiene TTL propio: lo acota la expiración de la
  solicitud.
- `memberId` (nullable): seteado cuando el DNI matcheó una ficha existente sin
  bloqueo ⇒ el asiento hace **reingreso** sobre esa ficha en vez de duplicar el
  socio (REG-25). **Ojo**: al asentar se le escribe `memberId` a *toda* solicitud
  —también a las altas nuevas—, porque de ahí cuelga la verificación tardía de
  email. Después del asiento el discriminador alta/reingreso es el Movimiento, no
  este campo.
- `dni` **no es UNIQUE**: una persona puede tener una rechazada vieja y una viva.
  La invariante real es "**una sola solicitud viva por DNI**" y se valida en runtime
  dentro de la transacción de creación (MySQL no tiene índices parciales), con un
  mutex por DNI dentro del proceso. Ver la nota de despliegue de `docs/03`.
- Al completarse el alta se crea Socio + Membresia (número siguiente del libro abierto)
  + Movimiento de alta, con `fecha_ingreso` = fecha del acta (REG-11).

### Documento — `Document` / tabla `documents` (Módulo 3)
- `id`, `ownerType` (`application` | `member` | `presentation`), `ownerId`
  (polimórfico, sin FK real: la integridad la sostiene la capa de servicio),
  `type` (`dni_front` | `dni_back` | `annex`), `path` (relativo a `UPLOADS_DIR`:
  `applications/{id}/{uuid}.{ext}`), `mime`, `size`, `uploadedAt`,
  `validatedById` (nullable, reservado), `validatedAt`
- JPG, PNG, WebP o PDF; máximo 10 MB por archivo; contenido validado por **magic
  bytes**, nunca por extensión.
- Conservación **permanente** (decisión institucional). Acceso solo admin, auditado
  en cada visualización.
- Deuda anotada: no hay `UNIQUE(ownerType, ownerId, type)`, así que dos subidas
  simultáneas del mismo tipo pueden dejar dos filas. El arreglo de fondo es esa
  restricción más una migración.

### Cuota — `Fee` / tabla `fees` (Módulo 4)
- `socio_id`, `periodo` (`YYYY-MM`, CHAR(7)), `estado`
  (`pending` | `paid` | `exempt` | `voided`), `origen` (`accrual` | `import`),
  `pago_id` (nullable, `SetNull`) — UNIQUE(`socio_id`, `periodo`)
- **Sin monto, a propósito** (decisión del 21/08/2026). La deuda se valúa
  **siempre** a valor vigente al momento del pago: es REG-16 generalizado a toda
  la cuenta corriente, y guardar el monto devengado abriría una segunda verdad que
  habría que mantener sincronizada con ValorCuota.
- Se generan el día 1 de cada mes para activos y colaboradores (también los
  suspendidos: la suspensión no exime de la cuota). Adherentes NO devengan (su
  aporte es voluntario y se registra como Pago suelto). Honorarios y vitalicios:
  exentos. El primer devengo es el **primer mes completo posterior al ingreso**.
  El cron que las crea es `POST /api/cron/accrual` (fase 4C). Ojo con una
  precisión que la 4C fijó: corre el día 1 y devenga **hasta el mes vencido**
  (mes corriente − 1), no el mes en curso — la fila nace cuando la cuota ya es
  mora, que es lo que deja correctos a los 21 puntos del sistema que cuentan
  filas `pending` a secas.
- `origen = import` son las cuotas sintéticas que crea `scripts/import-deuda.ts`
  desde `datos/deuda.xlsx` (ver "Importación inicial"). Las `accrual` que ya
  existan mandan: el import nunca las pisa, las saltea y las cuenta en el reporte.
- La cuota de ingreso se modela como Pago tipo `entry`, no como Cuota.

### Pago — `Payment` / tabla `payments`
- `id`, `socio_id` (nullable, `SetNull`), `solicitud_id` (nullable, `SetNull`),
  `tipo` (`debit` | `link` | `cash` | `voluntary` | `entry` | `extraordinary`),
  `monto`, `fecha`, `mp_payment_id` (UNIQUE, nullable), `preapproval_id`
  (nullable), `registrado_por` (nullable; el admin, en el efectivo), `nota`
  (≤ 200 chars), `estado` (`applied` | `refunded` | `voided`)
- **No hay `periodo_aplicado`**: la relación con los períodos es 1:N por
  `Fee.pago_id`, porque un solo pago puede saldar varias cuotas.
  Regla de imputación (`allocate`): **un débito = una cuota**; un link de pago trae
  `n`; el efectivo son `n × valor vigente`. Siempre se imputan las cuotas **más
  viejas** primero.
- El socio se borra con `SetNull` y el pago sobrevive: un cobro asentado no
  desaparece porque la ficha salga del libro.
- **`mp_payment_id` es la barrera de idempotencia del dinero de Mercado Pago**
  (fase 4B). Es UNIQUE, y `registerPayment` consulta por él **antes** de escribir y
  además atrapa el `P2002` de la unique: un mismo cobro llegando dos veces —por los
  dos tópicos del webhook, por un reintento de MP o por la conciliación— devuelve
  `already_processed` y no crea un segundo pago. **Anular el recibo NO lo borra**: si
  se borrara, un reenvío de MP volvería a cobrar. Corolario conocido: un cobro cuyo
  recibo se anuló **no se puede reimputar** (deuda anotada en `docs/07`).
- `registerPayment` es el **único** camino que escribe pago + cuotas + recibo.
  Efectivo, webhook, bandeja y vinculación lo llaman; no hay una segunda escritura.

### Recibo — `Receipt` / tabla `receipts`
- `numero` correlativo único global formato `AAAA-NNNNN` (una sola serie para todos
  los medios de pago) + `anio` y `seq` con UNIQUE(`anio`, `seq`) —la columna real se
  llama `year`, no `anio`—, `pago_id`
  (UNIQUE, `Restrict`), `concepto`, `pdf_path`, `emitido_at`, `enviado_email_at`,
  `anulado_at`, `motivo_anulacion`, `anulado_por`
- **El concepto se congela al emitir** (`concept`, VarChar(200)): un recibo es un
  registro institucional y dice lo que se cobró el día que se emitió. Derivarlo de
  `payment.fees` lo borraba al anular, porque la anulación despega esas cuotas del
  pago.
- Un recibo **nunca se borra ni se renumera**: se anula, con motivo, y el número no
  se reutiliza (REG-33). La anulación **no devuelve todas las cuotas a `pending`**:
  `revertFees` (`src/lib/treasury/rules.ts`) separa por período. Las cuotas de un
  período **posterior al corriente** se **borran** —el cobro en efectivo las creó
  al imputar por adelantado, y dejarlas pendientes contaría como deuda antes de
  tiempo—; el resto vuelve a `pending`. Vale porque `allocate` sólo crea períodos
  que no existían: toda cuota futura ligada a ese pago la creó ese pago.
- El PDF vive fuera del repo, en `RECEIPTS_DIR` (prod `/var/sigev/recibos`), y se
  sirve sólo por ruta autenticada. Se escribe **después** del commit y es
  regenerable: si falla, el cobro igual quedó asentado.

### SecuenciaRecibo — `ReceiptSequence` / tabla `receipt_sequences`
- `anio` (PK), `last`. **La columna real se llama `year`, no `anio`**: en SQL se
  escribe ``SELECT `year`, `last` FROM receipt_sequences`` (con backticks, que `YEAR`
  también es un tipo de dato de MariaDB). Este documento nombra los campos en
  castellano; los únicos nombres que valen para tipear una consulta son los del
  `schema.prisma`.
- Contador por año. Se incrementa con `INSERT … ON DUPLICATE KEY UPDATE` **dentro
  de la transacción que crea el recibo**: el bloqueo de la fila del año serializa a
  los emisores concurrentes y, si la transacción falla, el número no se consumió.
  Es lo que hace que la serie no tenga huecos. Verificado con 20 recibos
  concurrentes contra MariaDB real.

### SuscripcionMP — `MpSubscription` / tabla `mp_subscriptions` (Módulo 3)
- `preapprovalId` (UNIQUE), `planId`, `status` (el string crudo de MP:
  `pending` | `authorized` | `paused` | `cancelled`…; string y no enum porque el
  catálogo es de MP y puede crecer sin avisarnos), `payerEmail`, `linkedManually`
  (bool, para las preexistentes que vincula la fase 4B), `amount`,
  `externalReference`, `lastSyncAt`
- `applicationId` (nullable): la solicitud que la originó. `memberId` (nullable) se
  completa **al asentar el alta**: antes del acta no hay socio al que colgarla.
- **`planId` y `payerEmail` son nullable desde la fase 4B.** Una suscripción creada
  a mano desde el panel de MP no tiene plan de referencia, y `GET /preapproval/{id}`
  puede no traer el email. `""` como centinela queda **prohibido**: un id de plan
  vacío no es un plan.
- `amount` es el **último monto conocido o empujado**: contra él compara la
  conciliación (divergencia con `fee_values`) y sobre él escribe el lote REG-34.
- **`memberId` es índice, NO unique**, y el vinculador rechaza por `preapprovalId`
  repetido pero no por socio repetido: un socio puede terminar con **dos
  preapprovals vivos** (dos débitos por mes). La ficha lo avisa; nada lo impide.
  Deuda anotada en `docs/07`.

### ValorCuota — `FeeValue` / tabla `fee_values` (historial, REG-34)
- `monto_activo`, `monto_compartido` (adherente y colaborador comparten monto,
  decisión del cliente), `vigente_desde`, `acta_id` (nullable), `creado_por`
- **Es la ÚNICA fuente de montos del sistema** (invertido el 21/08/2026): devengo,
  deuda, efectivo, reingreso y —desde la fase 4B— el wizard leen de acá. Los planes
  de Mercado Pago dejaron de ser el registro y pasaron a ser referencia: a MP se le
  **empuja** el valor, ya no se le pregunta.
- Vigente = el de mayor `vigente_desde` ≤ hoy. `vigente_desde` se guarda al
  **mediodía UTC** del día civil argentino y se compara contra el mediodía civil de
  hoy, no contra el instante: si se comparara contra el instante, un valor no
  regiría hasta las 09:00 AR de su primer día y un devengo de madrugada abortaría
  por falta de monto.
- Nunca se edita: un valor mal cargado se corrige asentando otro encima, como un
  acta. El tope de 4 actualizaciones por año lo controla la Comisión, no el sistema.
- **El plan NO gobierna a las suscripciones ya creadas** (corregido el
  21/08/2026): se crean sin plan asociado y **copian** el monto (`docs/06` §2), así
  que cambiar el plan no mueve ni un débito vivo. Aplicar el valor nuevo a las
  suscripciones vigentes es una acción explícita del panel
  (`/admin/tesoreria/valores`, superadmin), implementada en la fase 4B (REG-34). El
  cron diario **avisa** de divergencias, no las corrige.
- Valor sembrado: activo $6.000 / compartido $3.000, vigente desde el 01/08/2026
  (y no el 01/09, o el sistema se quedaba sin monto con que cobrar hoy).

### PagoSinConciliar — `MpUnmatchedPayment` / tabla `mp_unmatched_payments` (fase 4B)
- `mp_payment_id` (UNIQUE), `monto`, `fecha`, `payer_email`, `external_reference`,
  `descripcion`, **`preapproval_id`**, **`motivo`**,
  `estado` (`open` | `matched` | `dismissed` | **`other_income`**), `pago_id` (FK
  real a Pago, `SetNull`), `resuelto_por`, `resuelto_at`
- Bandeja de los pagos de MP que no se pudieron atribuir a un socio: es el único
  lugar donde esa plata existe, así que el encabezado de Pendientes muestra la
  **suma en pesos**, no el recuento.
- **`preapproval_id`** (fase 4B): con qué suscripción llegó el cobro, si se supo.
  Lo completa también un **segundo** evento del mismo cobro que traiga más
  información que el primero, y es lo que hace que vincular una suscripción **cierre
  sola** las filas que la estaban esperando.
- **`motivo`** (`reason`): por qué no se pudo aplicar. Los valores son cerrados en
  código (`UnmatchedReason`, `src/lib/mp/unmatched.ts`) y no un enum de SQL, para no
  migrar por cada motivo nuevo: `no_reference`, `no_subscription`,
  `application_missing`, `duplicate_entry`, `withdrawn_no_pending`,
  `treasury_rejected`.
- **La fila se cierra sola al aplicar y se reabre al anular**: `registerPayment`
  marca `matched` dentro de la misma transacción del cobro, y anular el recibo o
  recibir un reembolso la devuelve a `open` con `pago_id`, `resuelto_por` y
  `resuelto_at` en NULL.
- `payer_email` y `descripcion` son datos personales: viven en la fila (la lee sólo
  el admin) y **nunca** van a la auditoría ni al log.

### CorridaDeCron — `CronRun` / tabla `cron_runs`
- `job`, `iniciada_at`, `terminada_at`, `ok`, `summary` (JSON con contadores),
  `error`
- Última corrida de cada cron. **La estrenó la conciliación diaria de la fase 4B**
  (`job = "reconcile"`): escribe la fila al empezar y la cierra con el resumen
  completo, aunque haya errores. Desde la fase 4C escriben ahí **los cinco**:
  `reconcile`, `applications`, `accrual`, `reminder` y `digest`. Los tres nuevos
  corren todos los días pero **sólo abren fila cuando actúan**: un día que no
  corresponde no deja rastro, a propósito.
- Desde la fase 4C esta tabla se lee desde **`/admin/salud`** (superadmin), que
  muestra la última corrida de cada job y distingue una corrida **colgada**
  (`terminada_at` nulo con `iniciada_at` viejo) de una que terminó mal.
  El endpoint devuelve **207** cuando corrió entera con errores, y la causa de cada
  uno viaja en `summary.errors[]`.

### IngresoNoSocietario — `OtherIncome` / tabla `other_incomes` (fase 4B)
- `monto`, `recibido_at` (la fecha **real** del ingreso, nunca el reloj de la
  corrida), `concepto` (texto libre), `medio` (`cash` | `mp`), `mp_payment_id`
  (UNIQUE, nullable: sólo cuando viene de la bandeja), `nota`, `registrado_por`,
  `anulado_at` / `motivo_anulacion` / `anulado_por`
- Plata que entró y es de la asociación pero **no es de ningún socio**: alquiler del
  salón, eventos, rifas, donaciones (decisión del cliente, 23/08/2026). Antes, la
  bandeja sólo ofrecía "vincular a socio" o "descartar", y descartar **mentía** sobre
  plata que había entrado.
- **No emite recibo.** La serie numerada es de las cuotas sociales y está armada
  alrededor del socio (REG-33); meterle un tercero era tocar el núcleo de plata. Por
  eso esta tabla **no tiene ninguna FK** a `payments`, `fees` ni `receipts`: es
  independiente por diseño.
- Es un **registro**, no contabilidad general: no hay plan de cuentas, ni asientos,
  ni egresos (`docs/01`).
- `concepto` y `nota` pueden nombrar a un tercero (el inquilino del salón): viven en
  la fila y **no van a la auditoría, ni a los logs, ni a la URL** — el filtro por
  texto se sacó a propósito, porque ponía el concepto en los access logs de Nginx y
  Cloudflare (Ley 25.326).
- Se anula, no se borra; los anulados se listan tachados y quedan **fuera** de todas
  las sumas. Un ingreso de MP mal escrito se puede **editar** en concepto y nota
  (nunca en monto, fecha ni `mp_payment_id`), con asiento.
- La pestaña "Otros ingresos" agrupa por **ejercicio anual** (1 de enero a 31 de
  diciembre, que es el de la asociación), con la cinta de 12 meses y el desglose
  efectivo/MP.

### ProcesoReempadronamiento
- `id`, `libro_id`, `estado` (`preparacion` | `primera_instancia` | `segunda_instancia`
  | `cierre_pendiente` | `cerrado`), `fecha_convocatoria`, `fin_primera` (+30 días),
  `fin_segunda` (+10 días), `fecha_oficializacion_igj`, `fecha_estimada_elecciones`
  (nullable, para validar REG-26), `acta_convocatoria_id`, `acta_cierre_id`

### Presentacion (re-empadronamiento de un adherente)
- `proceso_id`, `socio_id` (UNIQUE por proceso), `estado`
  (`pendiente` | `presentada` | `validada` | `observada` | `rechazada` | `baja_declarada`),
  `presentada_at`, `validada_por`, `observacion`, datos confirmados/actualizados
  (email, teléfono, domicilio), documentos (FK Documento)
- `baja_declarada` guarda `acta_id`, `notificada_at` y `recurso_hasta`
  (= notificada_at + 30 días, REG-24).

### Notificacion
- `socio_id` (nullable) y, desde el Módulo 3, **`applicationId`** (nullable): una
  notificación de solicitud todavía no tiene socio. Los dos son excluyentes en la
  práctica; el mailer tiene una variante `sendToApplication` que registra la
  notificación por el segundo camino.
- `tipo` (catálogo: verificacion_email,
  invitacion_password, resultado_solicitud, reempadronamiento_1, reempadronamiento_2,
  baja_declarada, recordatorio_cuota, alerta_mora, recibo, generica…),
  `via` (`email` | `cartelera`), `enviada_at`, `estado` (`enviada` | `entregada` |
  `rebotada` | `fijada_cartelera` | `cumplida_cartelera` | **`failed`**),
  `brevo_message_id`, `cartelera_desde`, `cartelera_hasta` (20 días hábiles,
  REG-10), `payload_resumen`, `error`
- `failed` + `error` (código del fallo de envío, **nunca la dirección**) los escribe
  el mailer desde la fase 4C, en su único punto de escritura: cubre los doce
  call-sites de golpe. Un bloqueo por `EMAIL_ALLOWLIST` **no** cuenta como fallo (es
  el entorno de prueba andando). `/admin/salud` los lista y ofrece reenviar los
  recibos, que es lo que el sistema puede rehacer.
- `period` (CHAR(7), nullable, migración de la 4C) es la dedupe del recordatorio de
  vencimiento: un socio recibe un solo aviso por período. **No lleva unique** a
  propósito — con `failed` escribiéndose, un intento fallido bloquearía el reintento
  de ese mes.

### ActionToken (`action_tokens`) — enlaces de un solo uso
- `purpose` (`email_verification` | invitación de acceso | recupero de
  contraseña), `tokenHash` (Char(64) UNIQUE, sha256 — el token crudo solo viaja
  por email), `expiresAt`, `usedAt`.
- Dueño: `memberId`, `userId` o —desde el Módulo 3— **`applicationId`** (Cascade),
  para que la verificación de email pueda pertenecer a una solicitud que todavía
  no es socio. La ruta `/verificar/[token]` resuelve los dos casos: con `memberId`
  verifica la ficha, con `applicationId` marca `Application.emailVerifiedAt`.
- La verificación de una solicitud se sella **en cualquier estado** (viva,
  completada o rechazada): quien hace clic tarde no puede quedar sin
  verificar. Todo lector que necesite "verificada **y** viva" tiene que filtrar
  por estado por su cuenta.

### Usuario / Rol
- `Usuario`: `email` (UNIQUE), `password_hash` (bcrypt), `socio_id` (nullable),
  `activo`, `ultimo_login`
- Roles: `superadmin` | `admin` | `socio` — tabla N:N, acumulables.
- **Una cuenta de acceso por dirección de email** (decisión de producto, tomada
  durante el Módulo 1): como `email` es la identidad de login y es único, si dos
  socios comparten casilla (típico un matrimonio u otro hogar), solo el primero
  que la usa para crear cuenta tiene portal propio. El segundo sigue siendo socio
  pleno igual —recibe las notificaciones en esa misma casilla, paga en la sede y
  vota— y al intentar verificar su email o canjear una invitación ve un mensaje
  que le explica la situación sin revelar de quién es la cuenta existente. Si en
  el futuro esto genera fricción, permitir que una cuenta gestione varios socios
  es una migración chica (agregar la relación N:N que hoy es 1:1 vía `socio_id`).
- **Invalidación de sesiones**: cambiar la contraseña, dar de baja al socio o
  revocarle un rol cierran las sesiones abiertas de esa cuenta (comparando el
  sello de apertura del JWT contra `password_changed_at`); además hay un techo
  absoluto de **7 días** de sesión, independiente de la actividad. Ver
  `docs/08-seguridad-y-privacidad.md`.

### Noticia (`news`) — Módulo 2
- `title` (varchar 160), `slug` (único, varchar 180 — editable después de publicar:
  si cambia, la URL vieja da 404), `body` (text, HTML **ya sanitizado en el
  servidor** por `src/lib/news/sanitize.ts`; nunca se persiste HTML crudo del
  cliente), `cover_image_path` (nullable), `status` (`draft` | `published`),
  `published_at` (se fija la primera vez que se publica y no se pisa al
  republicar), `author_id` (FK a `users`, `SET NULL`).
- La portada se guarda en `UPLOADS_DIR/news/` con nombre UUID y se sirve por el
  route handler **público** `/api/imagenes/noticias/[name]` con caché inmutable
  (excepción a la regla de uploads: una portada es contenido público). Ver
  `CLAUDE.md` y `src/lib/news/images.ts`.
- OJO: no confundir esta cartelera digital con la cartelera **física** de
  notificaciones (`Notificacion.via = cartelera`).

### Actividad (`activities`) — Módulo 2

Actividad sistemática semanal de un salón de la sede ("Gimnasia mujeres",
"Taekwondo niños"), con vigencia anual. Solo consulta pública; no hay reservas.

- `name` (varchar 120), `room` (enum `Room`: `historic` = Salón Histórico,
  `glass` = Salón Vidriado — salones fijos, sin tabla), `weekdays` (JSON, array
  de enteros 1–7, lunes=1), `start_time`/`end_time` (varchar "HH:MM", hora de
  pared local SIN conversión a UTC: es un horario recurrente, no un instante),
  `year` (smallint), `active` (bool).
- Regla: dos actividades activas del mismo salón y año no pueden solaparse
  en día y horario (validada en `src/lib/activities/rules.ts`). Compartir el
  borde exacto (una termina 19:30, la otra empieza 19:30) sí es válido.

### Calle
- Importada de `datos/calles_inicial.csv`: `id_calle`, `orden_carga`, `nombre_calle`,
  `nombre_normalizado` (lowercase, sin tildes, sin espacios dobles ni comas espaciadas,
  para el buscador). ABM solo superadmin.

### Feriado
- `fecha`, `descripcion` — para cómputo de días hábiles (REG-10). ABM admin.

### Configuracion
- Clave/valor tipado: `asociate_activo` (bool), `reempadronamiento_proceso_id`
  (nullable — si está seteado, ASOCIATE se suspende y REEMPADRONATE se activa),
  `elecciones_en_curso` (bool, REG-07), textos legales (términos, consentimiento
  de datos), datos de contacto, links de estatuto.
- Implementadas en el Módulo 2 (`src/lib/config.ts`, editables desde
  `/admin/configuracion`, solo superadmin): `asociate_activo` (bool),
  `contact_phone` (string), `contact_email` (string).
- Agregadas en el Módulo 3, misma pantalla: `terms_text` y
  `privacy_consent_text` (**texto plano**, se renderizan respetando los saltos de
  línea — deliberadamente NO HTML, a diferencia de las noticias), y
  `mp_plan_active_id` / `mp_plan_shared_id` (los ids de los dos planes de Mercado
  Pago, ver `docs/06`).
- Las páginas públicas leen estas claves cacheadas por tag: guardar la
  configuración invalida el tag `config` y el sitio refleja el cambio sin
  redeploy (lo mismo hacen los ABM de noticias y actividades con sus tags
  `news` y `activities`). El panel admin lee siempre directo, sin caché.

### Auditoria
- `usuario_id`, `accion`, `entidad`, `entidad_id`, `detalle_json`, `ip`, `timestamp`
- Se registra: login, aprobación/rechazo/recategorización de solicitudes, altas/bajas/
  movimientos, registro de pagos en efectivo, anulaciones, visualización de documentos,
  cambios de configuración, cierres de libro.
- Acciones del Módulo 3: `application_created`, `application_document_view`,
  `application_record`, `application_recategorize` (lleva `residenceMismatch`),
  `application_reject`, `application_resume_link_sent`,
  `application_approved_after_expiry`, `application_accepted_email_failed`,
  `applications_cron`, `webhook_rejected_signature`.
- Regla vigente y no negociable: en `detail` van **ids, códigos y flags**; nunca
  DNI, email ni domicilios (Ley 25.326, `docs/08`).

### WebhookEvent (`webhook_events`)
- `origin` (`mp` | `brevo`), `externalEventId` — `@@unique([origin, externalEventId])`,
  que es la idempotencia—, `topic`, `payload` (JSON crudo), `receivedAt`,
  `processedAt`, `result`, `error`
- `processedAt` es lo que distingue un reintento inocuo de un reproceso legítimo:
  evento repetido **con** `processedAt` → `ignored_duplicate`; **sin**
  `processedAt` (un intento anterior falló) → se reprocesa sobre la misma fila.
- Valores de `result` del Módulo 3: `application_approved`,
  `application_approved_after_expiry`, `already_processed`, `payment_rejected`,
  `payment_ignored`, `subscription_synced`, `authorized_payment_traced`,
  `no_match`, `unknown_topic`, `ignored_duplicate`.
- Deuda anotada: no hay política de retención, y `error` podría llegar a embeber
  un fragmento de respuesta de MP con el email del pagador.

## Importación inicial (seed del Libro N° 1)

Script `scripts/import-padron.ts` que lee `datos/padron_socios.xlsx`:

1. Crea Libro 1 (abierto) y las **278** membresías con su `numero_socio` original.
   Los **28** números ausentes (REG-35) no se crean: son huecos legítimos del libro.
   El script valida el **conjunto** de huecos, no su cantidad, y aborta antes de
   escribir nada si no coincide.
2. Crea cada Socio con lo que haya: `apellido_nombre`, `categoria_socio`,
   `fecha_ingreso`, `estado` (`activo`='Si' → vigente; 'No' → baja), `fecha_egreso`,
   `motivo_baja` mapeado al catálogo (`Mora`→`cesantia_mora`, `Fallecido/a`→
   `fallecimiento`, domicilios fuera del barrio→`cesantia_mudanza`, `-`→null).
   `fecha_ingreso` se toma tal cual figura en el libro y es la fecha oficial a
   todos los efectos: decisión del cliente **no recapturarla** desde las fichas
   de papel, aunque difiera de la fecha real de ingreso de algún socio antiguo.
3. Los domicilios/teléfonos/estado civil faltantes quedan null: se completan a
   mano desde el panel admin (pantalla de edición de socio pensada para carga
   rápida desde ficha, con navegación siguiente/anterior por número de socio).
   Estado real del archivo (padrón definitivo del 21/08/2026): **278 filas** con
   **DNI completo** —los socios 287 y 288, que no lo tenían, salieron del libro— y
   **37 emails** cargados; el resto de la ficha se completa desde el panel.
4. El campo `debito_automatico`='Si' del Excel marca candidatos a vincular
   suscripciones MP preexistentes (ver `06-integracion-mercadopago.md`).
5. El import es idempotente (re-ejecutable sin duplicar) y genera reporte de
   inconsistencias en `padron-import-report.txt`. **Por defecto sólo crea**: para
   pisar las fichas ya cargadas con los datos del Excel hace falta
   `--update-existing`, y para borrar de la base las fichas que salieron del libro,
   `--prune --yes`. Ver el procedimiento en `docs/10` §4.
6. El Excel **es** el padrón (decisión del 21/08/2026): una ficha que dejó de
   figurar ahí es una ficha que la Comisión sacó del libro.

### Deuda histórica (`datos/deuda.xlsx`, Módulo 4)

Script `scripts/import-deuda.ts`, que se corre **después** del padrón:

1. El archivo no trae montos: dice **cuántas cuotas** debe cada socio en cada año
   calendario (2022-2026). Totales de control del archivo del 21/08/2026: 278
   filas, **118 socios con deuda**, **3076 cuotas**.
2. Cada cantidad se convierte en cuotas concretas asignadas a los **últimos N meses
   del año** (y hacia atrás desde el mes de egreso, en las bajas), con
   `origen = import` y `estado = pending`. La regla es pura y está probada aparte
   (`src/lib/treasury/debt-import.ts`).
3. El ancla del año abierto sale de `DEBT_SNAPSHOT_DATE` (21/08/2026), la fecha en
   que se midió el Excel, y **no del reloj de la corrida**: si no, el mismo archivo
   diría otra cosa cada vez que se lo importa.
4. Aborta antes de escribir si los totales de control no dan, si algún socio no
   matchea por número **y** DNI, o si el mes de baja del Excel no coincide con el de
   la ficha. Es idempotente por socio: al que ya tiene alguna cuota importada lo
   saltea entero.
