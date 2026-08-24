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
  la autorización real va igual en la ruta y en cada action.
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
  llama a `auth()` una segunda vez.

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
- `assets/hero.jpg` — foto aérea del barrio para el hero (1980×788; generar variantes responsive).

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

Módulos 0, 1, 2 y 3 cerrados y desplegados. El **Módulo 4 está cerrado entero**:
**4A** (cuenta corriente, efectivo, recibos, deudores), **4B** (Mercado Pago:
webhook que aplica, Checkout Pro, bandeja sin conciliar, ingresos no societarios,
vinculación de suscripciones, conciliación diaria, lote REG-34) y **4C** (crons de
devengo / recordatorio / resumen, `Notification.failed` con reenvío, aviso del
débito rechazado, `/admin/salud`, padrón electoral y la cancelación del débito de MP
al dar de baja). Del **Módulo 5** (panel de socio) está cerrada la **fase 5A**
(24/08/2026): shell propio de `/mi` con pestañas por URL, credencial de socio en
el Inicio, `/mi/datos` editable (teléfono, domicilio, email) y estatuto en PDF
autenticado, con el socio suspendido en modo "ver + pagar" (ve su cuenta y sus
recibos, puede pagar, nada más). Sigue la **fase 5B**: débito automático
autogestionado (adherir y cancelar desde `/mi/debito`), y las solicitudes de baja
(REG-19) y de cambio de categoría con su bandeja en el panel admin. Ver `docs/07`.

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
