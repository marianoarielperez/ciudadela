# Módulo 3 — ASOCIATE + Mercado Pago (spec de diseño)

Fecha: 2026-08-20 · Estado: aprobada por Mariano (entrevista de 3 rondas + diseño presentado)
Referencias: `docs/02-marco-estatutario.md`, `docs/04-modelo-de-datos.md`,
`docs/05-flujos-funcionales.md`, `docs/06-integracion-mercadopago.md`, `docs/07-plan-de-etapas.md`

## 1. Contexto y alcance

Hoy `/asociate` es un placeholder de 20 líneas y no existe una sola línea de Mercado Pago,
webhooks, cron, uploads de documentos ni Turnstile. El Módulo 3 construye el circuito
completo de alta web: wizard público → pago/envío → bandeja admin → asiento en acta.

**Entra:**

1. Wizard ASOCIATE de 5 pasos (docs/05 §2) con Turnstile, términos y consentimiento,
   uploads de DNI y anexos, y bloqueos por DNI en el paso 3.
2. Modelo de datos: `Application`, `Document`, `MpSubscription`, `WebhookEvent`
   (migración nº 6) + claves nuevas de `Configuration`.
3. Integración MP de altas: lectura de montos desde los **2 planes** (cambio acordado
   el 20/08/2026: "SOCIO ACTIVO" y "SOCIO ADHERENTE/COLABORADOR", mismo monto compartido
   — reemplaza los 3 planes de docs/06), `POST /preapproval`, webhooks con validación
   `x-Signature` e idempotencia por `WebhookEvent`.
4. Bandeja `/admin/solicitudes`: listado con filtros, detalle con visor de documentos
   auditado, asentar-en-acta masivo, recategorizar, rechazar.
5. Reingreso web de ex socios sin deuda: la solicitud matchea la ficha existente y el
   asiento registra un reingreso, no un socio duplicado.
6. Resumen mensual para el acta: pantalla imprimible + export Excel.
7. Emails de resultado (aceptado / recibido / rechazado / recordatorio de pago) +
   verificación de email de la solicitud + guarda `EMAIL_ALLOWLIST` para staging.
8. Primer endpoint de cron: `/api/cron/applications` (recordatorio y expiración a 7 días).
9. Textos legales: borrador de términos y consentimiento (Ley 25.326) editable por el
   superadmin desde `/admin/configuracion`.
10. CSP: se llenan los placeholders de MP y Turnstile en `next.config.ts`.
11. Actualización de docs (`04`, `05`, `06`, `07`, `CLAUDE.md`, `.env.example`).

**Fuera de alcance (decidido en la entrevista):**

- Tesorería completa: tablas `Pago`/`Recibo`/`Cuota`/`ValorCuota`, recibos PDF,
  efectivo, aplicación de pagos a cuotas, conciliación cron, notificación del día 30,
  resumen diario a la Comisión → **Módulo 4**. El pago de ingreso del M3 se registra
  como `mpPaymentIdEntry` + `entryAmount` en la solicitud (previsto en docs/04).
- Panel de socio (cuotas adeudadas, cambio de categoría del socio) → **Módulo 5**.
- Vinculación de suscripciones preexistentes y bandeja sin-matching → **Módulo 4**.
- Webhook de Brevo (rebotes → `Notification.status`) → sigue pendiente, no bloquea M3.

## 2. Modelo de datos (migración nº 6)

Convención del repo: modelos PascalCase en inglés, campos camelCase con `@map` a
snake_case, `@@map` plural, comentarios en español explicando el porqué.
**Dinero: `Decimal(10,2)`** (espeja lo que devuelve la API de MP; decidido en ronda 1).

### `Application` → tabla `applications`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Int autoincrement | |
| `fullName` | VarChar(160) | |
| `dni` | VarChar(12) | obligatorio en el alta web (a diferencia de `Member.dni` nullable) |
| `birthDate` | DateTime | mediodía UTC (`civilDateUtc`), validación 18+ |
| `civilStatus` / `nationality` / `occupation` / `phone` | VarChar | espejo de `Member` |
| `email` | VarChar(191) | con confirmación de tipeo en el wizard |
| `emailVerifiedAt` | DateTime? | doble opt-in de la solicitud (REG-08); se copia a la ficha al asentar |
| `streetId` | Int? FK → `streets` SetNull | rama "vivo en Ciudadela" |
| `streetText` / `neighborhood` | VarChar? | rama "otro barrio" (colaborador) |
| `streetNumber` | VarChar(10)? | |
| `requestedCategory` | enum `MemberCategory` | solo `active`/`adherent`/`collaborator` (REG-01, validado por zod y por regla pura) |
| `wantsDebit` | Boolean default false | sub-elección del adherente |
| `status` | enum `ApplicationStatus` | ver máquina de estados §4 |
| `preapprovalId` | VarChar(64)? UNIQUE | |
| `mpPaymentIdEntry` | VarChar(64)? | id del pago de la cuota de ingreso |
| `entryAmount` | Decimal(10,2)? | monto debitado como ingreso (REG-14) |
| `resumeTokenHash` | Char(64) UNIQUE | sha256; mismo criterio que `ActionToken` (el token crudo nunca se persiste) |
| `memberId` | Int? FK → `members` SetNull | seteado si el DNI matcheó un ex socio (caso reingreso) |
| `minuteId` | Int? FK → `minutes` SetNull | acta del asiento o del rechazo |
| `decidedAt` | DateTime? | fecha de asiento/rechazo |
| `remindedAt` | DateTime? | recordatorio de pago enviado (una sola vez) |
| `acceptedTermsAt` | DateTime | obligatorio: sin aceptación no se crea la fila |
| `ip` / `userAgent` | VarChar(45) / VarChar(255) | del momento de creación |
| `createdAt` / `updatedAt` | timestamps | |

Índices: `@@index([status])`, `@@index([dni])`.
**Invariante en runtime** (patrón `requireOpenBook`, MySQL no tiene índices parciales):
no puede haber dos solicitudes vivas (`started`/`pending_payment`/`approved_pending_minute`/
`pending_board`) con el mismo DNI. Se valida dentro de la transacción de creación.

enum `ApplicationStatus`: `started` | `pending_payment` | `approved_pending_minute` |
`pending_board` | `completed` | `rejected` | `expired`.

### `Document` → tabla `documents` (polimórfico, reutilizable en M6)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Int autoincrement | |
| `ownerType` | enum `DocumentOwner` (`application`, `member`, `presentation`) | docs/04 |
| `ownerId` | Int | sin FK real (polimórfico); integridad en la capa de servicio |
| `type` | enum `DocumentType` (`dni_front`, `dni_back`, `annex`) | |
| `path` | VarChar(255) | relativo a `UPLOADS_DIR`: `applications/{id}/{uuid}.{ext}` |
| `mime` | VarChar(100) | |
| `size` | Int | bytes |
| `uploadedAt` | DateTime | |
| `validatedById` | Int? FK → `users` SetNull | reservado (validación admin) |
| `validatedAt` | DateTime? | |

Índice: `@@index([ownerType, ownerId])`.
Conservación **permanente** (decisión institucional, docs/04). Acceso solo admin, auditado.
Formatos aceptados: JPG, PNG, WebP y PDF; máximo **10 MB** por archivo (decidido en ronda 3).
Validación de contenido por magic bytes (sharp para imágenes, cabecera `%PDF` para PDF),
nunca solo por extensión.

### `MpSubscription` → tabla `mp_subscriptions`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Int autoincrement | |
| `preapprovalId` | VarChar(64) UNIQUE | |
| `planId` | VarChar(64) | id del plan MP al que está asociada |
| `applicationId` | Int? FK → `applications` SetNull | origen (altas M3) |
| `memberId` | Int? FK → `members` SetNull | se completa al asentar el alta |
| `status` | VarChar(32) | estados de MP: `pending`, `authorized`, `paused`, `cancelled`… |
| `payerEmail` | VarChar(191) | |
| `linkedManually` | Boolean default false | para las preexistentes (M4) |
| `lastSyncAt` | DateTime? | |
| `createdAt` / `updatedAt` | timestamps | |

### `WebhookEvent` → tabla `webhook_events`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | BigInt autoincrement | |
| `origin` | enum `WebhookOrigin` (`mp`, `brevo`) | |
| `externalEventId` | VarChar(128) | id del evento del proveedor |
| `topic` | VarChar(64) | |
| `payload` | Json | crudo, tal como llegó |
| `receivedAt` | DateTime | |
| `processedAt` | DateTime? | |
| `result` | VarChar(64)? | ej. `application_approved`, `ignored_duplicate`, `no_match` |
| `error` | VarChar(500)? | |

Idempotencia: `@@unique([origin, externalEventId])`. Un reintento de MP con el mismo id
inserta-o-ignora y no vuelve a procesar.

### `ActionToken` — extensión

Se agrega `applicationId Int?` (FK → `applications`, Cascade) para que el token de
verificación de email pueda pertenecer a una solicitud que todavía no es socio.
`purpose` reutiliza `email_verification`. La ruta `/verificar/[token]` resuelve ambos
dueños: si el token tiene `memberId` verifica la ficha; si tiene `applicationId`,
marca `Application.emailVerifiedAt`.

### `Configuration` — claves nuevas

| Clave | Tipo | Uso |
|---|---|---|
| `terms_text` | string (HTML sanitizado servidor, mismo pipeline que noticias) | términos y condiciones del wizard |
| `privacy_consent_text` | string (ídem) | consentimiento de datos (Ley 25.326) |
| `mp_plan_active_id` | string | id del plan "SOCIO ACTIVO" |
| `mp_plan_shared_id` | string | id del plan "SOCIO ADHERENTE/COLABORADOR" |

Los ids de plan se cargan a mano en `/admin/configuracion` (superadmin): explícito y
determinista, en lugar de matchear por nombre contra `GET /preapproval_plan/search`.
Los 4 campos se agregan a la pantalla de configuración existente.

## 3. Integración Mercado Pago

### Gateway

`src/lib/mp/gateway.ts` — `makeMpGateway(deps)` siguiendo el patrón de factories del
repo. Usa el SDK oficial `mercadopago` (docs/03) por debajo, pero el dominio solo ve
la interfaz propia; los tests mockean la interfaz, nunca el SDK ni la red.

Métodos M3: `getPlan(planId)`, `createPreapproval({planId, payerEmail, externalReference,
backUrl})` → `{id, initPoint}`, `cancelPreapproval(id)`, `getPayment(id)`,
`getAuthorizedPayment(id)`.

### Montos

`src/lib/mp/plans.ts` — lee los 2 planes por id (desde `Configuration`), cachea
**24 h** (`unstable_cache` con tag propio `mp-plans` + `revalidate`). El monto del plan
compartido se muestra como cuota del adherente (voluntaria) y del colaborador
(obligatoria). Si la API falla y no hay cache, el paso 2 del wizard muestra un
`FormMessage` de error y no deja avanzar (no se inventa un monto).

### Webhook `/api/webhooks/mp`

Route handler POST. Procesamiento **inline** (docs/06 lo permite a esta escala):

1. Validar `x-Signature` (HMAC-SHA256 con `MP_WEBHOOK_SECRET` sobre `id` + `x-request-id`
   + `ts`, según el manifiesto de MP). Falla → 401, sin registrar payload.
2. Insertar `WebhookEvent`; si el `externalEventId` ya existe **y tiene `processedAt`** →
   200 con `ignored_duplicate`. Si existe sin `processedAt` (un intento anterior falló),
   se reprocesa sobre la misma fila.
3. Procesar según tópico y responder 200:
   - `payments` → `getPayment(id)`. Si `status=approved` y `external_reference`
     matchea `solicitud:{id}` con estado `pending_payment`: guardar `mpPaymentIdEntry` +
     `entryAmount`, pasar a `approved_pending_minute`, enviar emails de aceptación (§6).
     Si `rejected`: registrar en `result` (la solicitud sigue `pending_payment`; MP
     reintenta el débito solo).
   - `subscription_preapproval` → actualizar `MpSubscription.status`.
   - `subscription_authorized_payment` → `getAuthorizedPayment(id)` y registrar en
     `result` (la aplicación a cuotas es M4).
   - Sin match (`external_reference` desconocida, pago ajeno) → `result=no_match`,
     nunca error: el M4 levantará estos casos en la bandeja sin-matching.
4. Cualquier excepción del paso 3 se captura: el evento queda con `error` y se responde
   **500** para que MP reintente (la idempotencia ya está garantizada por el paso 2:
   como el evento quedó registrado sin `processedAt`, el reintento lo reprocesa).

### CSP

En `next.config.ts` se llenan los placeholders existentes: `MP_SCRIPT`
(`https://sdk.mercadopago.com`, `https://http2.mlstatic.com`), `MP_CONNECT`
(`https://api.mercadopago.com`), `MP_FRAME` (`https://www.mercadopago.com.ar`),
`TURNSTILE` (`https://challenges.cloudflare.com`, en script y frame).

## 4. Wizard ASOCIATE

### Arquitectura

`/asociate` es **una sola ruta** con componente cliente de 5 pasos (estado en React,
mobile-first). Pasos 1–2 no tocan la base. El paso 3 llama la server action de creación;
los pasos 4–5 operan sobre la solicitud creada autenticándose con el **token de retome**
(crudo en el estado del cliente; en DB solo su sha256). Refresh antes del paso 3 pierde
el progreso (aceptado: son 2 pantallas cortas). Retome: `/asociate/retomar/[token]`
rehidrata la solicitud en el paso que corresponda.

Precondición de todo el wizard: `asociate_activo=true` (ya implementado en la home;
la página `/asociate` la revalida server-side).

### Pasos (docs/05 §2, sin cambios salvo lo anotado)

1. **¿Dónde vivís?** — Ciudadela (autocompletado sobre `streets`, reutiliza
   `street-autocomplete`) + altura, u otro barrio (texto libre).
2. **Categoría** — según residencia: Activo/Adherente (con sub-elección de débito y el
   aviso suave de upgrade) o Colaborador. Montos desde los planes MP.
3. **Tus datos** — datos personales completos + email con confirmación de tipeo +
   aceptación de términos y consentimiento + **Turnstile** (verificación server-side).
   Al enviar corre la server action `createApplication`:
   - valida Turnstile, rate limit por IP, zod;
   - **bloqueos por DNI** (regla pura `src/lib/applications/eligibility.ts`, ver abajo);
   - crea la `Application` en `started` dentro de una transacción que revalida la
     unicidad de solicitud viva por DNI;
   - devuelve el token de retome; audita `application_created` (sin DNI en `detail`).
4. **Documentación** — uploads (server action multipart): DNI frente y dorso
   obligatorios, hasta 2 anexos (obligatorio ≥1 para colaborador). Guardado en
   `UPLOADS_DIR/applications/{id}/`, validación por magic bytes, límite 10 MB.
5. **Pago / envío**:
   - Ramas con débito (activo, colaborador, adherente-con-débito): pantalla informativa
     de la cuota de ingreso no reembolsable (REG-14/REG-12.b) → `createPreapproval`
     (`external_reference=solicitud:{id}`, `back_url=/asociate/retomar/{token}`) →
     estado `pending_payment` → redirect al checkout de MP. La aceptación llega por
     webhook, nunca por el `back_url` (que solo muestra "estamos confirmando tu pago"
     con polling suave del estado).
   - Rama sin débito (adherente que no adhiere): envío directo → `pending_board` +
     emails de recibida + verificación.

### Bloqueos por DNI (paso 3) — regla pura, testeada

Orden de evaluación sobre `Member` (por DNI) y `Application` (vivas y rechazadas):

| Condición | Resultado |
|---|---|
| Solicitud viva con ese DNI | "Ya tenés una solicitud en trámite" + botón para reenviar el link de retome al email declarado en aquella solicitud (sin mostrarlo en pantalla) |
| Socio `active` o `suspended` | "Ya estás asociado a la vecinal" (al suspendido no se le revela la suspensión) |
| Baja con `reentryBlocked` (expulsión, REG-04) | Mensaje genérico: "No podemos procesar tu solicitud por este medio. Acercate a la sede vecinal." (no se revela el motivo) |
| Baja por `arrears` o con `debtAtWithdrawal` (REG-16) | "Tenés una deuda pendiente con tesorería. Acercate a la sede vecinal para regularizarla." |
| `rejectedUntil` futuro, o `Application` rechazada hace <6 meses con ese DNI (REG-05) | "No podés presentar una nueva solicitud hasta el DD/MM/AAAA." |
| Baja restante (renuncia/mudanza/no reempadronado/otro) sin deuda (REG-25) | **Continúa**; la solicitud guarda `memberId` (caso reingreso) |
| DNI desconocido | Continúa (alta común) |

Anti-enumeración: el chequeo solo corre tras Turnstile válido + rate limit por IP
(limiter nuevo `applicationLimiter`, 5/hora), y los mensajes no distinguen expulsión
de otros bloqueos "de sede".

## 5. Bandeja admin `/admin/solicitudes`

Nueva sección en `ADMIN_NAV` (grupo Gestión) y la tarjeta "Solicitudes" del tablero
recibe su `href` (los tests de sincronía nav↔tarjetas se actualizan solos al editar
las dos fuentes). Usa el shell completo: `PageHeader`, `FormMessage`, `EmptyState`,
badges nuevos en `status-badges.ts` (`applicationStatusBadgeVariant`).

- **Listado** con filtros por estado y búsqueda (nombre/DNI), paginado a 50 como el padrón.
  Badge "Reingreso" cuando `memberId` está seteado.
- **Detalle** `/admin/solicitudes/[id]`: todos los datos, estado de la suscripción MP,
  visor de documentos e historial (auditoría de la entidad).
  Documentos servidos por `GET /api/admin/solicitudes/[id]/documentos/[docId]`
  (`requireAdmin` + `Cache-Control: no-store, private` + auditoría
  `application_document_view` por cada visualización, igual que el export del padrón).
- **Asentar en acta** (masivo): selección múltiple de `approved_pending_minute` y
  `pending_board` → `minute-picker` (elegir/crear acta CD) → por cada solicitud, en
  transacción: si `memberId` → reingreso sobre la ficha existente (`memberService.readmit`
  + actualización de datos de contacto/domicilio declarados + email verificado si
  corresponde); si no → `memberService.admit` con número siguiente del libro abierto y
  `joinedAt` = fecha del acta (REG-11). En ambos casos: `MpSubscription.memberId` se
  completa, la solicitud pasa a `completed`, se envía la invitación de acceso
  (`/acceso/[token]`) si el email está verificado, y se audita `application_record`.
  Usa el patrón anti-acta-huérfana existente (pre-validación + `discardUnusedMinute`).
- **Recategorizar**: cambia `requestedCategory`; si hay suscripción y el plan difiere
  (activo ↔ adherente/colaborador), actualiza la suscripción por API (o cancela y crea
  nueva si MP no permite mover de plan, documentando el corte en `detail`). Audita
  `application_recategorize`.
- **Rechazar**: exige acta (REG-13); cancela la suscripción por API si existe; la cuota
  de ingreso se retiene (REG-12.b, el email de rechazo lo dice); si `memberId`, setea
  `Member.rejectedUntil` = fecha + 6 meses; para no-socios el bloqueo REG-05 sale de la
  propia `Application` rechazada (fecha `decidedAt` + 6 meses). Audita `application_reject`.
- **Resumen para acta** `/admin/solicitudes/resumen?mes=YYYY-MM`: dos secciones —
  aceptadas pendientes de asiento (`approved_pending_minute`) y pendientes de decisión
  (`pending_board`) — con nombre, DNI, categoría, reingreso sí/no y fecha. Pantalla
  imprimible (stylesheet de impresión) + botón de export Excel
  (`/api/admin/solicitudes/resumen-export`, patrón del export del padrón: `requireAdmin`,
  auditado, solo metadatos en `detail`).

## 6. Emails y notificaciones

Sobre la infraestructura existente (`templates.ts` + `mailer.sendToMember`); los emails
de solicitud usan una variante `sendToApplication` del mailer que registra la
`Notification` sin `memberId` (se agrega `applicationId Int?` a `Notification`) con
`type: application_result` (valor ya previsto como `resultado_solicitud` en docs/04;
se agrega al enum `NotificationType`).

| Email | Disparador |
|---|---|
| Verificación de email de la solicitud | al crear la solicitud (paso 3), token con `applicationId` |
| "Tu solicitud fue aceptada" (bienvenida) | webhook del primer pago OK (`approved_pending_minute`) |
| "Tu solicitud fue recibida" | envío rama sin débito (`pending_board`) |
| "Tu solicitud fue rechazada" | acción admin (sin expresión de causa; informa retención del ingreso si hubo débito) |
| Recordatorio de pago con link de retome | cron, `pending_payment` sin `remindedAt` a los 3 días |
| Invitación de acceso | al asentar (ya existe; requiere email verificado, regla actual) |

**Desvío acordado respecto de docs/05**: la invitación a crear contraseña NO se manda
al aceptar sino al asentar, porque no puede existir cuenta (`User`) sin ficha (`Member`).
La verificación de email sí es inmediata (REG-08); docs/05 se actualiza.

**`EMAIL_ALLOWLIST`** (decidido en ronda 2): variable de entorno con casillas separadas
por coma. Si está definida, un transporte envolvente (`makeAllowlistTransport`) bloquea
todo envío a direcciones fuera de la lista y lo loguea (`console.warn` solo con el
motivo, sin la dirección completa — mismos cuidados de docs/08). Staging la define con
las dos casillas de prueba; producción no la define. Guardia en el transporte, no en los
call-sites: cubre wizard, panel y cron por igual.

## 7. Cron `/api/cron/applications`

Route handler POST protegido por `Authorization: Bearer ${CRON_SECRET}` (comparación
timing-safe). Diario:

1. `pending_payment` creado hace ≥3 días sin `remindedAt` → email recordatorio con link
   de retome, sella `remindedAt`.
2. `started`/`pending_payment` sin actividad hace ≥7 días → `expired`; si hay
   `preapprovalId`, `cancelPreapproval` best-effort (si falla queda anotado, no bloquea).
3. Devuelve JSON resumen `{reminded, expired, errors}` y audita `applications_cron`.

Instalación en el VPS: bloque copiable de crontab para Mariano (Claude Code no toca el
VPS). El resto de los crons (conciliación, cuotas) llegan con el M4.

## 8. Seguridad y privacidad

- Turnstile server-side (`siteverify`) en la creación de la solicitud y en el reenvío
  del link de retome. En dev, claves dummy oficiales de Cloudflare.
- Rate limiters nuevos: `applicationLimiter` (5/h por IP, creación),
  `resumeResendLimiter` (3/h por IP). El de retome por token reutiliza `publicTokenLimiter`.
- El token de retome es `randomBytes(32)` base64url, solo sha256 en DB, TTL implícito
  por la expiración de la solicitud (7 días).
- Documentos personales: nunca dentro de `public/`, solo ruta autenticada de admin,
  cada visualización auditada (Ley 25.326 / docs/08).
- Auditoría nueva: `application_created`, `application_document_view`,
  `application_record`, `application_recategorize`, `application_reject`,
  `application_resume_link_sent`, `applications_cron`, `webhook_rejected_signature`.
  Regla vigente: en `detail` van ids, códigos y flags; nunca DNI, email ni domicilios.
- Webhook: firma inválida → 401 sin persistir el payload; el secreto nunca se loguea.

## 9. Tests (vitest, mismos patrones del repo)

- `eligibility.test.ts` — la tabla completa de bloqueos por DNI (regla pura).
- `application-state.test.ts` — transiciones válidas e inválidas de la máquina de estados.
- `mp-signature.test.ts` — validación `x-Signature` (casos válido, inválido, ts viejo).
- `webhook-mp.test.ts` — idempotencia (mismo evento dos veces → un solo efecto),
  pago aprobado → transición + emails, `no_match`, error → 500 reintentable.
- `application-actions-auth.test.ts` — ninguna action escribe sin `requireAdmin`;
  la ruta de documentos devuelve 403 sin sesión admin.
- `record-applications.test.ts` — asiento masivo: alta común vs reingreso, número
  siguiente, `joinedAt` = fecha del acta, compensación de acta huérfana.
- `allowlist-transport.test.ts` — con allowlist definida solo pasan las casillas listadas.
- `applications-cron.test.ts` — recordatorio una sola vez, expiración, guarda `CRON_SECRET`.
- `admin-nav` / `dashboard-cards` — se actualizan solos con la sección nueva.

## 10. Actualización de documentación

- `docs/06`: 2 planes en lugar de 3; ids de plan en `Configuration`.
- `docs/04`: nombres finales en inglés de las entidades nuevas, estado `expired`,
  token de retome, `ActionToken.applicationId`, `Notification.applicationId`.
- `docs/05`: bloqueos del paso 3 (tabla del §4), retome, invitación al asentar.
- `docs/07`: al cerrar el módulo, marcar CA cumplidos.
- `CLAUDE.md`: sección nueva de patrones si aparece alguno reutilizable (gateway MP,
  allowlist de emails); `EMAIL_ALLOWLIST` en la tabla de env.
- `.env.example`: `EMAIL_ALLOWLIST` (documentada como "solo staging").
- Instructivo operativo para Mariano (documento aparte, no commiteado si contiene
  datos sensibles): crear cuenta de prueba MP, los 2 planes sandbox, alta del sitio
  en Turnstile, y qué valores pegar en cada variable del `.env`.

## 11. Criterios de aceptación

Los del plan de etapas (docs/07, en sandbox) más los acordados en la entrevista:

1. Alta ACTIVO de punta a punta: wizard → checkout de prueba → webhook →
   `approved_pending_minute` → asentada en acta → socio creado con número siguiente y
   `joinedAt` = fecha del acta.
2. Adherente sin débito queda `pending_board` y recibe el email de recibida.
3. Rechazo: cancela la suscripción en MP, retiene el ingreso, bloquea el DNI 6 meses.
4. Webhook duplicado no duplica nada (verificable en `WebhookEvent`).
5. Bloqueos: un DNI de socio vigente ve "ya estás asociado"; un DNI con baja por mora y
   deuda ve "acercate a la sede"; un ex socio por renuncia sin deuda completa el wizard
   y su asiento queda como reingreso sobre la ficha original (mismo `memberId`,
   antigüedad intacta).
6. Solicitud abandonada: recordatorio a los 3 días, expirada a los 7 (corriendo el cron
   a mano con `CRON_SECRET`).
7. Resumen para acta del mes muestra las aceptadas y pendientes, imprime bien y exporta
   a Excel.
8. Con `EMAIL_ALLOWLIST` definida, un envío a una casilla ajena queda bloqueado y logueado.

## 12. Desvíos acordados durante la ejecución (21/08/2026)

Esta spec se aprobó el 20/08 y se ejecutó en 22 tasks. Lo que cambió en el camino,
con quién lo decidió y por qué. **La documentación de `docs/` ya refleja todo esto**;
esta lista existe para que la spec no mienta si alguien la lee sola.

1. **Textos legales en texto PLANO, no HTML** (Task 3). El §2 preveía el pipeline
   de sanitización de noticias para `terms_text` y `privacy_consent_text`. Se
   guardan y renderizan como texto plano con saltos de línea respetados: menos
   superficie de XSS, y un pliego de condiciones no necesita marcado. El seed carga
   un borrador y **no lo repone** si alguien lo vacía a mano.

2. **`death` y `duplicate_annulment` → "acercate a la sede"** (decisión de Mariano,
   20/08, Task 7). La tabla de bloqueos del §4 no los contemplaba. Un DNI vivo
   contra una ficha de fallecido es error de datos o suplantación, y la ficha
   anulada por duplicado tiene su gemela real en el padrón: ninguna de las dos
   cosas se resuelve por un formulario web. Usan el **mismo mensaje genérico** que
   la expulsión, sin revelar el motivo.

3. **Orden de guardas: allows → Turnstile → rate limit → zod → padrón** (decisión
   del arquitecto, Task 11). La spec ponía el chequeo de elegibilidad antes de
   validar la forma. Mover zod adelante no debilita el anti-enumeración —para
   llegar hasta ahí hay que haber pasado Turnstile igual— y evita que tres errores
   de tipeo le quemen al vecino los 5 intentos de la hora.

4. **Reingreso: la verificación de email SE CONSERVA si la dirección no cambió**
   (decisión de Mariano confirmada el 20/08, Task 17). El §5 no lo decía. Si la
   ficha ya tenía **esa misma** dirección en estado `verified`, el asiento no la
   degrada a `declared` aunque la solicitud nueva venga sin verificar: el domicilio
   electrónico ya estaba acreditado ante la vecinal (Art. 5° quater), y degradarlo
   dejaría al reingresante sin invitación al portal por no volver a hacer clic. Si
   la dirección **cambió**, manda la de la solicitud y hay que verificarla.

5. **Recategorizar NO bloquea por residencia** (Task 18). Avisa en pantalla antes
   de guardar y deja `residenceMismatch` en la auditoría. La Comisión puede
   apartarse de los Art. 5 y 5 bis —el caso caro es "vive fuera del barrio →
   activo", que da voto y elegibilidad—, pero no en silencio: el acta tiene que
   poder reflejar que se decidió a sabiendas.

6. **El resumen para acta tiene TRES listas, no dos** (Task 19). El §5 preveía
   "aceptadas pendientes de asiento" y "pendientes de decisión". Se agregó
   **"asentadas en el mes"**. Y solo esa tercera filtra por mes: una solicitud
   aceptada no tiene fecha de aceptación (no hay columna, y `updatedAt` se mueve
   con cualquier escritura), así que filtrar las dos primeras escondería a la que
   entró en julio y todavía espera acta — justo la que no hay que olvidar. El borde
   de mes se calcula en hora **argentina**, no UTC.

7. **Un pago que llega DESPUÉS del vencimiento revive la solicitud** (decisión de
   Mariano, 21/08, Task 20). No estaba previsto: el §7 expiraba y listo, y el
   webhook tardío se descartaba como `already_processed`. El vecino había
   autorizado el débito, MP le había cobrado, el cron había cancelado la
   suscripción y **nadie se enteraba**. Ahora la solicitud vuelve a
   `approved_pending_minute` con `result = application_approved_after_expiry`, y
   queda marcada en pantalla (aviso en el detalle, badge "Sin débito" en la
   bandeja) porque hay que rehacer la suscripción a mano. El pago manda sobre el
   vencimiento.

8. **La ventana del recordatorio es `[3, 7)` días**, no "a los 3 días" (Task 20).
   Quien entra al sistema recién al sexto día y medio recibe el aviso y expira en
   la corrida siguiente, con menos de 24 h de margen. Es correcto —nunca expira
   antes de avisar— pero apretado; se podría cerrar un día antes.

9. **`data.id` del webhook: allowlist `^[a-z0-9-]{1,64}$`, no "solo dígitos"**
   (corrección de la Task 14 a una nota de la Task 5). Los `preapproval_id` de MP
   son hex alfanuméricos de 32 caracteres: el filtro numérico habría rechazado
   **todos** los webhooks de suscripción.

10. **El instructivo operativo SÍ se commiteó**, como
    `docs/11-preparacion-mp-sandbox-turnstile.md`. El §10 lo dejaba afuera "si
    contiene datos sensibles"; no los contiene — las credenciales viven solo en los
    `.env`, y el documento explica de dónde sacarlas.
