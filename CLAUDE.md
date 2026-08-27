# SIGeV — Sistema Integral de Gestión Vecinal

Sistema web para la **Asociación Vecinal del Barrio Ciudadela** (Comodoro Rivadavia, Chubut).
Sitio público + gestión de socios + pagos (Mercado Pago) + re-empadronamiento estatutario.

## Antes de programar

Leé los documentos de `docs/` en orden. Son la especificación acordada con el cliente
y **tienen prioridad sobre cualquier decisión de diseño propia**:

1. `docs/01-vision-y-alcance.md` — qué es SIGeV y qué NO es
2. `docs/02-marco-estatutario.md` — reglas de negocio derivadas del estatuto (crítico)
3. `docs/03-arquitectura-e-infraestructura.md` — stack, VPS, despliegue
4. `docs/04-modelo-de-datos.md` — entidades y relaciones
5. `docs/05-flujos-funcionales.md` — flujos pantalla por pantalla
6. `docs/06-integracion-mercadopago.md` — planes, suscripciones, webhooks, conciliación
7. `docs/07-plan-de-etapas.md` — módulos 0 a 6 con criterios de aceptación
8. `docs/08-seguridad-y-privacidad.md` — Ley 25.326, DNIs, backups

Operativos (no son spec, son cómo se opera): `docs/09` relevamiento del VPS,
`docs/10` runbook del dominio productivo, `docs/11` preparación de MP sandbox y
Turnstile (de dónde salen las credenciales y el crontab).

## Stack (no negociable)

- **Next.js 16+** (App Router, TypeScript; `proxy.ts` en lugar de middleware,
  `params`/`searchParams` como Promise) — un solo proyecto: sitio público + panel + API
- **MariaDB** (localhost:3306, ya corre en el VPS) vía **Prisma** (provider `mysql`)
- **Auth.js v5** con provider Credentials (bcrypt). Roles: `superadmin`, `admin`, `socio` (acumulables)
- **Nodemailer + Brevo SMTP** para emails transaccionales
- **PM2** en producción, puerto **3006**, detrás de Nginx + Cloudflare
- PDFs de recibos: `pdf-lib` o `pdfkit` en API route del servidor
- Captcha: **Cloudflare Turnstile** en todos los formularios públicos ANÓNIMOS —
  ASOCIATE (alta y reenvío del enlace de retome), `/ingresar` y
  `/ingresar/recuperar`—. Los que se abren con un token de un solo uso
  (`/acceso/[token]`, `/ingresar/restablecer/[token]`, `/verificar/[token]`) no
  lo llevan: el token ya es la barrera, y no hay nada que enumerar sin él

## Convenciones

- **UI en español** (es-AR: "vos", fechas DD/MM/AAAA, moneda ARS `$ 1.234,56`).
  Código, nombres de variables, tablas y commits en **inglés**.
- Zona horaria: `America/Argentina/Buenos_Aires` (UTC-3, sin DST). Guardar UTC en DB.
- Color primario de marca: celeste `#2E9BDF` (derivado de `assets/logo.png`).
  Ojo accesibilidad: `#2E9BDF` solo llega a 3.06:1 sobre blanco — para botones/links
  se usa el token `--primary` `#0079BC` (4.71:1). Ver `src/app/globals.css`.
- Los archivos subidos (DNIs, facturas) van a `UPLOADS_DIR` (en prod `/var/sigev/uploads`),
  **NUNCA** dentro de `public/` ni del repo. Se sirven solo por API route autenticada.
  Excepción: las imágenes de portada de noticias viven en `UPLOADS_DIR/news/` pero se
  sirven por route handler público SIN autenticación (`/api/imagenes/noticias/[name]`)
  con caché inmutable — son contenido público. La regla de API autenticada aplica a
  documentos personales (DNIs, facturas).
  Los **recibos PDF** siguen la misma regla en `RECEIPTS_DIR` (en prod
  `/var/sigev/recibos`, ya cubierto por `scripts/backup.sh`): se sirven sólo por
  `/api/admin/recibos/[id]` (admin, auditado) y `/api/mi/recibos/[id]` (el socio,
  su propio recibo; uno ajeno da 404, nunca 403).
- Toda acción sensible de admin (aprobar alta, declarar baja, registrar pago, ver documento)
  se registra en la tabla de auditoría.
- Migraciones siempre con `prisma migrate` — nunca `db push` en producción.

## Panel de administración: shell y patrones

El panel tiene un marco compartido. **Una pantalla nueva no escribe su propio encabezado,
sus propios mensajes ni su propio estado vacío**: usa estos componentes.

- **Navegación**: `src/lib/admin/nav.ts` es la ÚNICA fuente de las secciones (grupos
  Gestión / Contenido / Sistema). Agregar una sección = agregar un ítem ahí; la lateral,
  el cajón móvil y el marcado de sección activa salen solos. Las tarjetas de `/admin` viven
  en `src/lib/admin/dashboard-cards.ts` y un test verifica que no se desincronicen.
  La lateral lista solo secciones que funcionan; el roadmap ("Próximamente") vive en las
  tarjetas de Inicio. **Tesorería ya está en la lateral** (entre Socios y Actas) y su
  tarjeta del tablero dejó de ser "Próximamente". La fase 4C sumó **Salud** y
  **Padrón electoral** al grupo Sistema, las dos `superadminOnly` — que es display:
  la autorización real va igual en la ruta y en cada action. El Módulo 6 sumó
  **Reempadronamiento** al grupo Gestión (entre Solicitudes y Socios), SIN
  `superadminOnly`: el admin ve el tablero y valida presentaciones; convocar, declarar
  bajas y cerrar el libro exigen superadmin en la ruta y en cada action.
- **Encabezado**: `PageHeader` (`title`, `breadcrumb`, `actions`, `children`). Convenciones
  acordadas: la **entidad va en el `<h1>`** (el nombre del socio, el título de la noticia) y
  la miga lleva la referencia corta; la **última miga es un sustantivo corto** ("Baja",
  "Editar", "Nueva"), nunca una repetición del título.
- **Mensajes**: `FormMessage` (`kind`: `error | success | warning | neutral`, `box`, `as`).
  Deriva el `role` del `kind`; la prop `role` solo se usa para casos justificados
  (`"none"` para texto estático, `"status"` para el guardado del modo carga).
  **No usar verde/ámbar crudo de Tailwind**: están los tokens `--success` y `--warning`.
- **Estado vacío**: `EmptyState` (`size="list"` reemplaza la tabla entera y ofrece la acción
  que lo resuelve; `size="card"` es una línea). **Nunca renderizar un `thead` sin filas.**
- **Badges de estado**: `src/lib/admin/status-badges.ts`, no ternarios por pantalla.
- **Roles**: la nav y las tarjetas filtran por los roles del TOKEN — es display, y puede
  quedar hasta 8 h desactualizado tras una degradación. **La autorización real va siempre
  en la ruta y en cada server action** (`requireAdmin` / `requireSuperadmin`, que resuelven
  contra la fila viva de `User`).
- Accesibilidad del shell (verificada, no romper): targets ≥44px, `aria-current="page"` en la
  sección activa, `outline-hidden` + `focus-visible:ring-sidebar-ring` en TODO control de la
  lateral (`outline-none` deja el foco invisible en modo alto contraste), skip link al
  `<main id="contenido">`.
- Deuda anotada: 4 formularios y 9 `<select>` crudos siguen sin migrar a `synced-fields`
  (se ven planos en modo oscuro); `AdminActor` no devuelve los roles vivos, así que el layout
  llama a `auth()` una segunda vez. Misma clase de deuda en el panel de socio: el layout de
  `/mi` hace una consulta extra por render (la categoría del socio, para decidir si muestra
  la pestaña "Débito").

## Patrones que estrenó el Módulo 3 (reutilizables)

- **Servicios externos detrás de una factory propia.** `makeMpGateway()`
  (`src/lib/mp/gateway.ts`, sin argumentos: lee `MP_ACCESS_TOKEN` del entorno). El
  M3 la estrenó con siete métodos; hoy expone **once** —la fase 4B le sumó
  `searchPreapprovals`, `searchAuthorizedPayments`, `searchPayments` y
  `createPreference`—. La lista viva, con qué hace cada uno y sus dos trampas de
  paginación, está en `docs/06` §2: no se duplica acá. El dominio **nunca** ve el
  SDK de Mercado Pago, y los tests mockean esa interfaz: ni SDK ni red.
  Mismo criterio para cualquier proveedor que venga después.
- **Las guardas globales van en el transporte, no en los llamadores.**
  `EMAIL_ALLOWLIST` envuelve el transporte de Nodemailer, así que cubre wizard,
  panel y cron por igual y una pantalla nueva no puede olvidarse de aplicarla. El
  log del bloqueo dice el motivo, **nunca la dirección completa** (Ley 25.326).
- **Reglas de negocio como funciones puras, testeadas aparte.**
  `src/lib/applications/eligibility.ts` decide los bloqueos por DNI sin tocar la
  base: la tabla entera de casos se prueba sin fixtures ni Prisma.
- **En módulos puros, el cliente de Prisma se INYECTA, no se importa.**
  `@/lib/prisma` tira al evaluarse si falta `DATABASE_URL`; un test puro que
  importe el módulo se cae sin `.env`. Ver `applications/query.ts` y
  `applications/summary.ts`.
- **Documentos personales: ruta autenticada + auditoría por visualización.**
  `GET /api/admin/solicitudes/[id]/documentos/[docId]` con `requireAdmin`,
  `Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff` y un
  asiento por cada vista. La validación por magic bytes dice qué **es** el
  archivo, no qué se puede hacer con él: el `nosniff` no es opcional.
- **Auditoría best-effort vs. estricta.** `audit()` traga errores y sirve para el
  99%; `auditStrict` es para el caso en que el asiento **es** la señal (el aviso
  de solicitud revivida por pago tardío: si no se escribe, el operador no se
  entera por ninguna pantalla) y hay que saber si falló.
- **Premisa de un solo proceso.** Mutex por DNI y rate limiters viven en memoria:
  ver la advertencia de `docs/03` antes de tocar `instances` en PM2.

## Patrones que estrenó el Módulo 4 (fase 4A)

- **La tabla `fee_values` es la ÚNICA fuente de montos.** Devengo, deuda,
  efectivo y reingreso leen el valor vigente de ahí (`feeValueReader.current()`,
  `src/lib/treasury/fee-values.ts`); los planes de Mercado Pago pasaron a ser
  **referencia**, no registro. El valor nuevo se asienta desde
  `/admin/configuracion` (superadmin), con acta opcional, y **nunca se edita**:
  se registra otro encima, como un acta. El tope de 4 actualizaciones por año
  (REG-34) lo controla la Comisión, no el sistema.
  Ojo con la vigencia: `validFrom` se guarda al **mediodía UTC** del día civil
  argentino y `current()` compara contra el mediodía civil de hoy (`civilDayOf`
  en `periods.ts`), no contra el instante — si no, un valor no regiría hasta las
  09:00 AR de su primer día y un devengo de madrugada abortaría por falta de monto.
- **Pestañas por URL para secciones; Radix `Tabs` sólo para vistas que no
  navegan.** `src/lib/admin/treasury-tabs.ts` + `TreasuryTabs` hacen de Deudores
  / Efectivo / Recibos / Valores rutas propias: deep-link, botón atrás y
  `aria-current` salen solos, y la pestaña se marca también en sus subrutas.
  `MemberTabs` (Radix, con `?tab=`) es lo contrario: paneles de la misma ficha.
- **Numeración sin huecos: el número se pide TARDE y dentro de la transacción.**
  `nextReceiptSeq(tx, year)` incrementa `receipt_sequences` con
  `INSERT … ON DUPLICATE KEY UPDATE`; el lock de la fila del año serializa y un
  rollback no consume número (REG-33). Verificado con 20 recibos concurrentes
  contra MariaDB real. Corolario: **nunca escribir el PDF dentro de esa
  transacción** — el lock se sostiene hasta el commit y el timeout de Prisma es
  de 5 s.
- **El PDF se escribe DESPUÉS del commit, es best-effort y es regenerable.**
  Si falla, el cobro ya quedó asentado; `regenerateReceiptPdf` lo rehace al
  pedirlo. El **concepto se congela** en `Receipt.concept` al emitir: un recibo
  dice lo que se cobró, y derivarlo de `payment.fees` lo borraba al anular.
- **Un débito = una cuota; un link trae `n`; efectivo = `n × valor vigente`.**
  `allocate` (`src/lib/treasury/rules.ts`) imputa siempre las cuotas
  **más viejas** primero. Las cuotas no llevan monto: la deuda se valúa siempre
  a valor vigente al momento del pago (REG-16 generalizado).

## Patrones que estrenó el Módulo 4 (fase 4B)

- **`registerPayment` es el ÚNICO camino que escribe pago + cuotas + recibo.**
  Efectivo, webhook de MP, bandeja sin conciliar y vinculación de suscripciones lo
  llaman todos. No hay una segunda escritura, y por eso las cuatro invariantes de
  REG-33 se verifican en un solo lugar.
- **`Payment.mpPaymentId` es la barrera de idempotencia del dinero de MP**, y son
  DOS capas: la ruta del webhook por `WebhookEvent` (`body.id`, que MP **sí** manda
  y es un id de evento distinto del id del pago) y el procesador por `mpPaymentId`
  (consulta previa + catch del P2002). **Anular un recibo NO borra `mpPaymentId`**:
  si se borrara, un reenvío de MP volvería a cobrar.
- **El procesador del webhook nunca falla por una regla de negocio.** Todo lo que no
  se puede aplicar termina en la bandeja con su motivo; el 500 queda sólo para
  fallos técnicos, que es cuando conviene que MP reintente. `resolve.ts` es una
  tabla **pura** y su regla de oro es **la suscripción manda sobre la referencia**
  —con una excepción anterior a todo: si ESE cobro ya está marcado como pago de
  ingreso, no se re-imputa como cuota social (REG-14).
- **La bandeja se cierra sola al aplicar y se reabre al anular.** El `updateMany`
  vive DENTRO de la transacción del cobro, y la reapertura se acota por `paymentId`
  (no por `mpPaymentId`) para cubrir también un efectivo de mostrador.
- **Las notificaciones que no atendemos responden 200, no 4xx.** La IPN legacy y
  `merchant_order` son legítimas en un formato que no implementamos: "recibido, no
  procesado". Un 4xx sostenido es algo que MP puede terminar deshabilitando, y ahí
  se perdería también la buena. Un POST sin `topic=` sigue dando 400 y sin auditar.
- **`reconcile` (03:00) es la red, y tiene DOS fuentes**: `payments/search` por
  fecha para los pagos de Checkout Pro, y `authorized_payments/search` **por cada
  suscripción viva**, que es lo único que encuentra los débitos recurrentes.
  Reutiliza `processor.applyPayment`: el resultado es idéntico al del aviso perdido.
  Estrena `cron_runs` y devuelve **207** —no 200— cuando corrió entera con errores.
- **Un preapproval IGNORA `notification_url`** (medido contra la API): MP acepta el
  campo y lo descarta en silencio. Los avisos de suscripción dependen ENTERAMENTE de
  la config de webhooks del panel de MP; si se rompe, los débitos dejan de avisar
  **sin ninguna señal** y la única red es el paso 2 del cron.
- **Links de pago `pago:{memberId}:{n}`: `n` es una CANTIDAD, no una lista de
  períodos.** Qué cuotas se imputan lo decide `allocate` al llegar el pago (las más
  viejas). **La preferencia NO se persiste** y **vence a las 72 h** (`expires` +
  `expiration_date_to`, uno sin el otro no hace nada): sin vencimiento, el link
  congela el precio del día en que se generó.
- **Ingresos no societarios: registro aparte, sin recibo.** `other_incomes` no tiene
  ninguna FK al núcleo de plata a propósito. La serie numerada es de las cuotas
  sociales, armada alrededor del socio (REG-33).
- **Contra Mercado Pago, medir antes de suponer.** Tres pasadas contra la API real
  dispararon **cinco arreglos de código** que ningún test podía ver —uno por commit;
  la lista con su commit está en `docs/07`, fase 4B—: un `limit` que un endpoint
  rechaza y devolvía 400 en silencio, un preapproval que viaja dentro del pago, y
  documentación propia que era falsa. Lo verificado está en `docs/11` Parte J.

## Patrones que estrenó el Módulo 4 (fase 4C)

- **Un cron que decide no actuar NO es una corrida.** Los tres crons nuevos corren
  todos los días y deciden adentro (`willAct()` vive en el MÓDULO, nunca en la
  ruta); un día que no corresponde responde 200 con `{skipped}` y **no escribe
  `CronRun`**. Corolario en la pantalla: `/admin/salud` muestra la última corrida
  **efectiva** y marca *stale* recién al doble del período esperado — que es
  **mensual** para el devengo y el recordatorio (31 días), no diario. Medirlos a los
  cinco con la misma vara los pintaría de rojo 29 días de cada 30.
- **Veredicto de dos niveles, y ninguna pantalla nace en rojo.** `/admin/salud`
  separa *act* (algo roto **con una salida que lo apaga**: es el único rojo) de
  *review* (ausencias, colas normales, cruces sanos). Y distingue **historia** de
  **cola**: `inboxTotal`, `mismatchesEver`, `failedEver` se redactan como contexto
  de recorte, nunca como trabajo pendiente. Un contador acumulativo sin ventana ni
  acción que lo baje es una alarma que enseña a ignorar el tablero — el proyecto ya
  lo corrigió tres veces.
- **Dos semánticas de "suscripción viva"** (`src/lib/mp/subscription-status.ts`):
  `canStillCharge` es lista **BLANCA** (no prometer un débito que no existe) e
  `isNotCancelled` es lista **NEGRA de un valor** (no saber es peor que avisar de
  más). Ante un estado que MP no documente fallan hacia lados **opuestos**, y ahí
  está el punto: no son complementarias, y hay un test dedicado a que no lo sean.
  Antes había seis definiciones sueltas y dos costaban plata.
- **`coverageFloor` lo comparten devengo, recordatorio e imputación.** No es una
  regla copiada tres veces: es la misma función. La revisión encontró que el
  recordatorio le reclamaba septiembre a quien ingresó en septiembre —su cuota de
  ingreso cubre ese mes (REG-14)— porque no aplicaba el piso. Se arregló
  **compartiendo la función**, no reimplementándola: así devengo y aviso no pueden
  divergir. Mismo criterio que ya valía entre `coverageFloor` y `allocate`.
- **El mailer dice la verdad, en su único punto de escritura.** `Notification.failed`
  + `error` con el **CÓDIGO** del fallo (nunca la dirección, Ley 25.326) se escribe
  en un solo lugar y cubre los doce call-sites de golpe. Y un bloqueo por
  `EMAIL_ALLOWLIST` **NO es un fallo**: es el entorno de prueba andando. Si contara,
  en producción —donde la allowlist está puesta— una sola corrida dejaría ~160 filas
  rojas y la pantalla de salud nacería inservible.
- **El tope de correos es un presupuesto INYECTADO por corrida** (`MailBudget`), no
  un contador de módulo: el procesador del webhook es un singleton de proceso y un
  contador global lo habría dejado mudo después de 50 correos hasta el próximo
  restart de PM2. El cupo **vuelve** (`refund()`) cuando el envío termina sin correo,
  así que el tope cuenta correos **mandados** y no intentos.
- **La cancelación del débito al dar de baja vive DESPUÉS del commit**, en un módulo
  de dominio (`members/withdraw-with-debits.ts`) que comparten la baja individual y
  el lote de cesantía. Una llamada de red adentro de la `$transaction` sostiene el
  lock hasta el timeout de 5 s de Prisma — mismo corolario que el PDF del recibo.
- **Con `@prisma/adapter-mariadb` NO existe `meta.target`.** El nombre del unique
  violado viaja en `meta.driverAdapterError.cause.constraint.index`. Una guarda
  escrita contra `meta.target` —lo que dice la doc de Prisma y lo que el repo ya
  tenía— **pasa todos los tests y nunca matchea en producción**, porque el fake de
  los tests es el que miente. Se lee de `src/lib/treasury/unique-violation.ts`, que
  soporta las dos formas y **falla cerrada**. La lección de la 4B —medir antes de
  suponer— también vale contra el driver de la base, no sólo contra Mercado Pago.
- **Una escotilla manual para todo lo que actúa un solo día del mes.** El devengo y
  el recordatorio aceptan `?force=1` detrás del mismo `CRON_SECRET`, y el
  recordatorio **adapta el texto por CALENDARIO y no por el parámetro** ("venció y
  quedó impaga" en vez de "vence mañana"). Sin escotilla, una corrida perdida no se
  recuperaba hasta el mes siguiente. El `curl` copiable está en `docs/11` Parte H.

## Patrones que estrenó el Módulo 5 (panel de socio)

- **La adhesión al débito se apoya en la regla 3 de `resolve.ts` SIN tocarla.**
  `member-debit.ts` crea la fila local con su `memberId` desde el nacimiento, así que
  los cobros se imputan por la suscripción como cualquier débito vinculado. La
  referencia `socio:{id}` (reservada en la 4B, estrenada acá) es para que el
  **operador** reconozca la suscripción en el panel de MP, no para resolver pagos.
- **El veredicto de adhesión es una función pura compartida por pantalla y action**
  (`src/lib/members/debit-adhesion.ts`): las cuatro guardas (categoría → suscripción
  cobrable → pago del mes → email) se deciden en un solo lugar, y lo que la pantalla
  muestra deshabilitado es exactamente lo que la action rechaza.
- **`member_requests` con mutex por socio y "una pendiente por tipo".** El mutex
  (`request:{memberId}`) envuelve la `$transaction` ENTERA con el conteo adentro:
  la invariante se sostiene bajo concurrencia real, no por buena suerte. Corolario
  de la revisión: sólo la creación necesita el mutex; el rechazo no puede romper la
  invariante.
- **`requireMember({ allowSuspended })` es el modo lectura del panel de socio** (de
  la 5A, consolidado en la 5B): el suspendido ve su cuenta y paga; adherir el débito,
  cancelarlo y presentar solicitudes usan `requireMember()` pelado y lo cortan.
- **La sección `/admin/solicitudes` unificada fue un rediseño de PRESENTACIÓN.**
  Pestañas Altas | De socios, cola, tarjetas y barra de asiento sticky — con las
  actions de altas, las actas, `record.ts` y los emails byte-idénticos: la suite de
  `applications` pasó sin tocar una aserción. Rediseñar una pantalla no autoriza a
  reescribir su lógica.
- **La regla anti-duplicación mensual es una decisión de producto, no un tecnicismo**:
  quien pagó una cuota en el mes calendario en curso no puede adherirse hasta el mes
  siguiente ("Podés adherirte desde el 01/09/2026"), porque el primer débito entraría
  en el mismo mes ya cubierto. Verificada en vivo en sandbox (docs/11 J.6).
- **El panel de webhooks de MP tiene DOS solapas, y el token `APP_USR-…` de una
  aplicación de cuenta de prueba dispara por "Modo productivo"** — con solo la solapa
  de prueba configurada el silencio es total y nada se encola. En sandbox se
  configuran LAS DOS solapas con la misma URL y clave; costó dos adhesiones medirlo
  (docs/11 J.6, J.1 paso 4 corregido).

## Patrones que estrenó el Módulo 6 (re-empadronamiento y cierre de libro)

- **La cohorte se CONGELA al convocar, y la presentación no toca la ficha hasta que
  la Comisión valida.** `activate` crea una fila de `presentations` por adherente
  vigente, y ésa es la lista de convocados para todo el proceso: quien pasa a ser
  adherente DESPUÉS no fue convocado y no le corre nada. Los datos declarados viven en
  la presentación hasta que alguien los valida; recién ahí se copian a `Member`, y
  **el nombre, el DNI, la categoría, el estado y la fecha de ingreso no se escriben
  nunca desde una pantalla pública** (el DNI no es autenticación: es una llave que
  cualquiera puede tipear).
- **El aviso de cartelera es un LOTE, y la fecha fehaciente es cuando se CUMPLE el
  plazo, no cuando se fija.** La unidad de trabajo del operador es el cartel entero:
  el sistema arma la lista de quienes no tienen casilla utilizable, y una sola fecha
  de fijación estampa los veinte días hábiles en todas las filas del lote. La fecha
  que acredita es `dueAt`, veinte días hábiles después — estampar el día de la
  fijación le comería al vecino veinte días hábiles de su defensa. El barrido corre
  **dentro de la misma transacción** que las filas que lo acreditan, y **un correo que
  no salió no estampa nada**: ni un bloqueo por `EMAIL_ALLOWLIST` ni un `failed`
  acreditan notificación, y sin notificación no hay resolución oponible ni ventana de
  recurso corriendo.
- **Dos aritméticas de plazos, en módulos SEPARADOS que no comparten función, con un
  solo comparador de vencimiento.** `reregistration/rules.ts` cuenta **días corridos**
  (30 de 1ª instancia, 10 de 2ª, 30 para interponer el recurso), que es la lectura
  conservadora del art. 6 del CCyC porque el estatuto no lo aclara;
  `board/business-days.ts` cuenta **días hábiles**, que es lo que el artículo de la
  cartelera sí dice con todas las letras. Separados a propósito para que nadie las
  mezcle: `rules.ts` no importa feriados y no tiene por qué. Pero el **comparador de
  vencimiento es uno solo** (`hasExpired`, día civil contra día civil: el día del
  vencimiento todavía no venció) y el **criterio de cohorte también**
  (`isCohortMember`, con las constantes que además arman la consulta que la congela).
  Y si a la tabla de feriados le falta el año que el cómputo pisa, el sistema **falla
  ruidoso** en vez de contar un feriado como hábil y acortarle el plazo a un vecino.
- **Un acto irreversible se corta en etapas, y sólo la última es una transacción.**
  Checklist → bajas en lote con su acta → cierre. `closeBook` corre en una
  `$transaction` **sin una sola llamada de red** y **revalida adentro** las
  precondiciones que la vista previa ya había mirado: entre la vista previa y el
  commit puede caerse el último vigente, y ahí abriría un libro vacío. La regla es la
  de siempre —red adentro de una transacción, no; el PDF del recibo y el
  `cancelPreapproval` de la baja ya la habían enseñado— y la novedad es que **las
  precondiciones bloqueantes son `where` compartidos**, no reglas copiadas en la
  pantalla y en el dominio (la lección de `coverageFloor`).
- **La foto del libro se escribe por CONJUNTOS, porque fila por fila no entra en el
  timeout.** El plan daba por sentado que 278 updates entraban holgados en los 5 s de
  Prisma; medido contra MariaDB, los round trips solos se comían el presupuesto
  (P2028 a ~5,05 s) y **todo cierre abortaba**. Pasó a ser un `updateMany` por
  combinación estado × categoría —**las 18 del enum**, no sólo las vistas en una
  lectura previa, para que cada fila quede estampada con el valor que tiene en la base
  en ese instante— más un conteo de completitud que **falla cerrado**. La lección de
  la 4B, otra vez y ahora contra el ORM: **medir antes de suponer**.
- **El doble de base de los tests tiene que honrar el `where` que recibe, y las
  guardas se verifican por MUTACIÓN.** Apareció tres veces en este módulo: un fake que
  re-implementa el filtro en vez de aplicarlo deja cláusulas del `where` real sin
  ejercitar —el caso concreto fue un `processId` que el doble sintetizaba como
  constante, así que esa parte del filtro nunca se probó— y el test pasa igual. La
  única prueba de que una guarda se está probando es **borrarla y ver el test en
  rojo**; después se restaura.
- **La renumeración es una función pura, y se verificó a mano contra el resultado
  real.** `planMigration` ordena por **día civil argentino** de la fecha de ingreso,
  con desempate por número del libro viejo y después por id, y `assertDensePlan`
  relee la densidad antes de que se escriba nada. El día civil no es cosmética:
  colapsa los ingresos del mismo día **en un empate** —con la ventana corriendo de
  00:00 a 23:59 hora argentina— para que no los ordene la hora en que un
  administrativo cargó la ficha. En el simulacro los 63 migrados se cotejaron
  **posición por posición** contra la misma regla reimplementada en SQL puro: 0
  discrepancias.
- **Un tope de lote tiene que contar lo que CUESTA, no nombres.** El lote de bajas
  copió de la cesantía por mora un tope de 25 socios; los 25 eran en realidad el
  presupuesto de las cancelaciones de débito en MP (~1,2 s cada una contra el timeout
  de 60 s del proxy), y los convocados del re-empadronamiento son adherentes, que no
  pueden tener débito: 90 bajas, cero llamadas. Hoy el tope es
  `WITHDRAWAL_DEBIT_CALL_BUDGET` —llamadas de red, contadas antes de procesar con
  `isNotCancelled`, el mismo predicado que decide qué se cancela— y la aritmética está
  escrita al lado. Copiar un límite sin copiar su cuenta convierte una guarda de
  tiempo en una traba de trabajo.
- **Un control preseleccionado es una decisión que nadie tomó.** El `MinutePicker`
  abre en "acta existente" con la primera de la lista —que viene ordenada por fecha
  descendente, o sea la más reciente— y la pantalla de confirmación no nombra el acta
  elegida: en el simulacro, el cierre del libro quedó asentado bajo el acta de las
  bajas de minutos antes, que es el documento que la asociación presenta ante la IGJ.
  En un acto irreversible, el default tiene que ser el caso normal (un cierre se
  asienta en su propia acta) y la confirmación tiene que **decir con qué acta** se va
  a firmar. Es la tercera vez que este selector sorprende encadenado; las dos
  anteriores fueron cosméticas y ésta no.

## Patrones que estrenó la exención de cuota (Art. 7 inc. a.4)

- **Un registro con acta + filas MATERIALIZADAS que el núcleo ya sabía tratar.**
  La exención se asienta en `fee_exemptions` y se materializa como cuotas `exempt`
  de todo el rango; el devengo saltea el mes porque ya tiene fila y la deuda no la
  cuenta porque pregunta por `status: "pending"` a secas. Esa garantía es
  **estructural**, no una línea que diga "exempt", y por eso el módulo entero no
  modificó **ni un archivo existente** de `src/lib/treasury/*` ni de `src/lib/mp/*`
  (verificado con `git diff --stat`, no de memoria). Antes de escribir un flag en
  el núcleo, preguntarse si la fila que ya existe alcanza.
- **`activeExemption` es la ÚNICA fuente de las cinco guardas de cobro** —efectivo,
  link, reenvío del link, pago desde `/mi` y adhesión al débito— y de las tres
  pantallas. Misma lección que `coverageFloor`: con un `where` por camino, alcanza
  con que uno olvide `revokedAt: null` para que a un vecino se le siga bloqueando
  el pago después de que la Comisión le anuló la exención.
- **Un acta se nombra por TIPO y NÚMERO (`minuteName`), nunca por su id.** El id es
  a dónde lleva el enlace; `Minute` es único por (tipo, número), así que "Acta
  N° 16" sobre lo que el libro llama Comisión Directiva N° 124 señala otro
  documento — y suele existir. Es el mismo error que el acta del cierre del
  Libro 1, encontrado en verificación en vivo las dos veces.
- **Un cerrojo optimista cubre la CARRERA, no la precondición.** El
  `updateMany` con `revokedAt: null` de la anulación ve la exención ya anulada y
  NO ve la vencida, que llega con su `revokedAt` en null desde una pestaña vieja:
  se anulaba "bien" y le estampaba a la ficha del socio un movimiento
  `fee_exemption_revoked` **con su acta** por un hecho que nunca ocurrió (la
  exención no se levantó, se terminó sola). La vigencia se revalida adentro de la
  transacción con `isInForce` —la misma función de la lista y de los cinco
  bloqueos—, igual que `grant` revalida sus seis guardas y que `closeBook`
  revalida las suyas.
- **Pre-validar lo barato y frecuente ANTES de crear el acta; compensar sólo el
  resto.** El acta huérfana no se resuelve únicamente con `discardUnusedMinute`:
  las tres guardas baratas del asiento (ficha, categoría, exención ya vigente)
  son por donde se rechaza casi siempre, y se miran antes con dos consultas. Los
  TEXTOS salen del dominio (`GRANT_GUARD_MESSAGES`) para que el operador lea lo
  mismo se corte donde se corte.

## Patrones que estrenó el paso "Tu DNI" de ASOCIATE

- **La carga de insumos de elegibilidad es UNA función para los dos
  call-sites.** `loadEligibilityInputs` (`src/lib/applications/eligibility-inputs.ts`)
  alimenta el chequeo temprano del paso 1 Y la guarda del envío del paso de
  datos; `checkEligibility` sigue siendo el único juez y no se tocó. Misma
  lección que `coverageFloor`: compartir la función, no copiarla — con una
  copia por camino, alcanza con que alguien toque una para que el paso 1 y el
  envío diverjan en silencio.
- **Un lookup público por DNI responde enmascarado y con presupuesto propio.**
  `maskedName` se mudó a `src/lib/members/masked-name.ts` (re-export desde
  `reregistration/rules.ts`) y ahora la comparten los dos wizards;
  `asociateDniCheckLimiter` (5/15 min por IP) es un cupo SEPARADO del de
  creación. El paso 1 es cortesía de UX, no una guarda: el POST del paso de
  datos revalida la elegibilidad entera, y el veredicto `ok` no distingue el
  reingreso habilitado del DNI desconocido (decisión del operador, 27/08/2026).

## Flujo de trabajo con el operador (Mariano)

- Claude Code trabaja **localmente en Windows**: escribe código, corre dev server, commitea.
- **Claude Code NO se conecta por SSH al VPS.** Los comandos de servidor se preparan
  en bloques copiables y Mariano los ejecuta a mano (SSH puerto 2222, root).
- El despliegue es git-based: push a GitHub (repo privado) → pull en el VPS → build → PM2 restart.
- **Un solo entorno desplegado: `vecinalciudadela.ar`** (decisión del 20/08/2026).
  El staging `sigev.redaccion.ar` se dio de baja; lo que dicen `docs/03`, `docs/07`,
  `docs/09` y `docs/10` sobre staging es historia, no el estado actual.
  Desde el **22/08/2026** ese dominio corre con credenciales **productivas** de
  Mercado Pago (piloto real: el socio 306 se afilió por la web y su débito
  funcionó) y con `EMAIL_ALLOWLIST` todavía definida — el sitio está publicado
  pero nadie lo conoce.
  **Nunca probar cobros en producción**: ahí la plata es de un vecino. El circuito
  de pagos se prueba en **sandbox local** (`docs/11` Parte J: cuenta de prueba
  propia + túnel; MP entrega las notificaciones solo, no hace falta simularlas) y
  lo único productivo es el piloto controlado: el débito mensual del 306 y un
  efectivo de Mariano.
  Borrar `EMAIL_ALLOWLIST` sigue siendo un paso del checklist de lanzamiento de
  `docs/07`, no algo que ocurra solo.

## Datos incluidos

- `datos/padron_socios.xlsx` — padrón definitivo del Libro N° 1 (**278 filas**,
  numeración 1-306 con **28 huecos**; DNIs completos, 37 emails cargados;
  **160 vigentes = 36 activos + 124 adherentes**, 118 bajas). Importado por
  `scripts/import-padron.ts`; el resto de la ficha se completa a mano desde el
  panel. Ver `docs/04-modelo-de-datos.md`.
- `datos/deuda.xlsx` — deuda a agosto de 2026 expresada en **cantidad de cuotas
  impagas por año** (2022-2026), sin montos: 278 filas, **118 socios con deuda**,
  **3076 cuotas**. La importa `scripts/import-deuda.ts` como cuotas con
  `origin = "import"`, ancladas a la fecha de la foto (`DEBT_SNAPSHOT_DATE`,
  21/08/2026) y no al reloj de la corrida.
- `datos/calles_inicial.csv` — 40 calles catastrales del barrio para el autocompletado
  (campos: id_calle, orden_carga, nombre_calle). Ojo: nombres sin tilde y con comas
  tipo "Pizarro , Francisco" → normalizar para búsqueda.
- `assets/logo.png` — logo institucional (monocromo celeste, fondo transparente).
- `assets/hero-nuevo.jpg` — foto aérea del barrio para el hero de la home (1980×690;
  generar variantes responsive). `assets/hero.jpg` (1980×788) sigue en el repo: es la
  que `scripts/generate-assets.ts` recorta para la imagen de Open Graph.

## Variables de entorno (`.env`)

Referencia completa y comentada: `.env.example`.

```
DATABASE_URL="mysql://sigev:***@localhost:3306/sigev"
AUTH_SECRET=***
AUTH_URL=https://vecinalciudadela.ar       # se HORNEA en el build (SEO, canonicals)
MP_ACCESS_TOKEN=***                        # PRODUCTIVAS desde el 22/08/2026
MP_WEBHOOK_SECRET=***                      # para validar x-Signature
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=***
BREVO_SMTP_KEY=***
MAIL_FROM="Vecinal Ciudadela <notificaciones@vecinalciudadela.ar>"
EMAIL_ALLOWLIST=a@b.com,c@d.com            # si está definida NINGÚN email sale
                                           # fuera de la lista. En producción NO
                                           # se define (se borra al lanzar).
UPLOADS_DIR=/var/sigev/uploads             # dev: ./uploads (gitignored)
RECEIPTS_DIR=/var/sigev/recibos            # PDFs de recibos; dev: ./recibos
                                           # (gitignored). Ya lo respalda backup.sh
NEXT_PUBLIC_TURNSTILE_SITE_KEY=***         # pública: viaja en el HTML
TURNSTILE_SECRET_KEY=***                   # dev: claves dummy de Cloudflare
CRON_SECRET=***                            # protege los CINCO endpoints de cron
BACKUP_DIR=/var/sigev/backups              # 4C: carpeta donde backup.sh deja el
                                           # sello LAST_OK que lee /admin/salud.
                                           # Sin ella el panel dice "sin configurar"
MAIL_BATCH_CAP=50                          # 4C: tope de EMAILS por corrida (no de
                                           # cobros). Vacío o basura → 50
```

Los ids de los dos planes de Mercado Pago **no son variables de entorno**: viven
en `Configuration` (`mp_plan_active_id`, `mp_plan_shared_id`) y se cargan desde
`/admin/configuracion`. Ver `docs/06` y el instructivo `docs/11`.
Desde el Módulo 4 el **monto** ya no sale de ahí: la tabla `fee_values` es la
única fuente (ver más abajo). Desde la fase 4B los ids son **opcionales**: el
alta web, la recategorización y el lote REG-34 leen el monto de `fee_values`, y
el único uso que les queda es el aviso de divergencia plan-vs-valor de la
conciliación diaria, que simplemente no corre si no están cargados.
Lo mismo vale para **`digest_recipients`** (fase 4C): quién recibe el resumen
diario a la Comisión vive en `Configuration` y se edita desde
`/admin/configuracion`. Cambiar los destinatarios no puede exigir un deploy.

## Prioridad actual

Módulos 0 a 5 cerrados y mergeados a `main`; los 0-3 además desplegados hace tiempo.
El **Módulo 4** entero (cuenta corriente y efectivo; Mercado Pago con su webhook,
Checkout Pro, bandeja sin conciliar y conciliación diaria; crons, `/admin/salud` y
padrón electoral) y el **Módulo 5** entero (el panel de socio: shell propio de `/mi`,
débito automático autogestionado desde `/mi/debito` y solicitudes desde
`/mi/solicitudes`, con `/admin/solicitudes` unificada) están cerrados.

El **Módulo 6 está cerrado, mergeado y DESPLEGADO en producción** (27/08/2026):
**6A** (`/admin/socios` en Padrón | Libros | Histórico, con la foto de cierre en
`memberships`), **6B** (el proceso, el wizard público REEMPADRONATE, la cola de
validación, la carga presencial y la cartelera por lotes con días hábiles) y **6C**
(checklist de cierre, bajas en lote con su acta y su anexo de notificaciones, y el
cierre transaccional del libro con migración y renumeración), más el arreglo del acta
del cierre que dejó el simulacro. El **simulacro del criterio de aceptación había
pasado entero en local**: convocatoria con acta, 35 presentaciones, 34 validadas y 1
rechazada, 7 cesantías por mora, 90 bajas en 4 tandas, cierre ejecutado por el
operador, Libro 2 con 63 socios renumerados y verificados posición por posición, las
ocho tablas de plata byte-idénticas, y una restauración que dejó las 33 tablas iguales
a la línea de base. El detalle está en `docs/07` y los informes en
`.superpowers/sdd/simulacro/`. Sigue en pie el pendiente operativo de la 6A: correr
`scripts/fix-withdrawal-reasons.ts` en el VPS.

La **exención de cuota (Art. 7 inc. a.4) está CERRADA** (27/08/2026) **en la branch
`fee-exemption`, sin mergear y sin desplegar**: cinco tareas —el dominio con su
migración, la pestaña Tesorería → Exenciones con asiento y anulación, los cinco cortes
de cobro, el panel del socio y los tres controles de la ficha—, verificación en vivo
con el operador (tres sesiones) y una ronda final de arreglos. El módulo no modificó
**ni un archivo existente** de `src/lib/treasury/*` ni de `src/lib/mp/*`. Lo que falta
es el merge y el despliegue.

**Pendiente de DESPLIEGUE, con fecha dura: el cron de devengo, antes del
01/10/2026.** El código está hecho y testeado; lo que vence es la línea del crontab
del VPS. Mientras no esté, no se crea ninguna fila: el padrón cubre a todos hasta
agosto de 2026 y el import trajo sólo lo impago, así que desde octubre los socios al
día se mostrarían "al día" debiendo septiembre. Desplegar tarde **no** rompe nada
—la primera corrida backfillea sola desde el piso de cobertura—, pero no desplegar
sí. Procedimiento: `docs/10` §4.5; crontab de seis líneas y las dos escotillas de
re-disparo: `docs/11` Parte H.

Verificación real pendiente de la 4B: el **débito del socio 14 del 10/09/2026** tiene
que entrar solo. (`GET /v1/payments/search` **sí indexa en producción** — quedó
confirmado en el primer `reconcile` real, que recuperó 24 débitos históricos; en
sandbox devolvía 0 siempre.)

No arrancar una fase sin cerrar los criterios de aceptación de la anterior.
