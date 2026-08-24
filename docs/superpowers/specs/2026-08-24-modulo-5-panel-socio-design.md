# Módulo 5 — Panel de socio (`/mi`): diseño aprobado

**Fecha:** 24/08/2026 · **Estado:** aprobado por el operador (cuatro rondas de decisiones, 16 respuestas)
**Fases:** 5A (shell, rediseño y lectura) → 5B (débito automático y solicitudes)

Este documento es la spec del Módulo 5. Prevalece sobre `docs/05` §7 y `docs/07` donde
difieran; las diferencias deliberadas están marcadas como **enmienda**.

---

## 1. Alcance

Entra TODO el alcance documentado de `docs/07` más lo pedido por el operador:

1. **Rediseño completo del panel** — shell propio con pestañas por URL, estética
   "puente sitio público → panel", mobile-first, light-only.
2. **Deuda visible** — ya existe (`/mi/cuenta`, fases 4A/4B); se restyla y se enriquece.
3. **Débito automático autogestionado** — adherirse y cancelar desde `/mi/debito`,
   con la regla anti-duplicación mensual (§6).
4. **Solicitud de cambio de categoría** (REG-07) — el socio solicita, la CD decide
   con acta desde una bandeja nueva.
5. **Solicitar baja** (REG-19) — circuito completo: formulario → bandeja → acta →
   baja por `resignation`. Es el CA 2 del módulo en `docs/07`.
6. **Mis datos** — ver la ficha propia; editar teléfono, domicilio (queda
   "pendiente de constatación") y email (re-verificación REG-08).
7. **Estatuto en PDF** — detrás de autenticación (movido del M2, `docs/07:48`).
8. **Vista de suspendido** — ver + pagar; todo lo demás bloqueado (§8).
9. **Tarjeta de identidad en el Inicio** — número de socio, categoría, antigüedad,
   estado electoral REG-31 (dato que hoy el socio no ve en ningún lado).

**Fuera de alcance:** aporte de monto libre por link (el adherente aporta pagando
"cuotas" voluntarias como hoy — decisión del operador, cero riesgo sobre el núcleo);
régimen disciplinario (fuera de v1); re-empadronamiento (M6); modo oscuro (el
proyecto es light-only de hecho: no hay ThemeProvider montado).

---

## 2. Decisiones del operador (24/08/2026)

| # | Decisión | Elección |
|---|---|---|
| 1 | Alcance extra sobre las 3 funciones pedidas | Todo: baja REG-19, Mis datos, estatuto PDF, vista suspendido |
| 2 | Cambio de categoría | **Solicitud → bandeja admin**, la CD aplica con acta (flujo existente) |
| 3 | Quién puede adherir al débito | **Todas las categorías con cuota** (activo, adherente, colaborador) |
| 4 | Regla anti-duplicación | **Pagó cuota este mes calendario → bloquear** hasta el mes siguiente; la deuda NO bloquea |
| 5 | Suspendido | **Ver + pagar deuda**; ninguna otra acción |
| 6 | Cancelar débito desde `/mi` | **Sí**, con confirmación y auditoría |
| 7 | Aporte del adherente | **Esquema actual** (n × valor vigente por link); sin monto libre |
| 8 | Bandeja admin | **Sección nueva unificada** "Solicitudes de socios" en Gestión |
| 9 | Navegación | **Pestañas por URL** arriba (patrón `TreasuryTabs`) |
| 10 | Identidad visual | **Puente público→panel** (claro, celeste, foto del barrio) |
| 11 | MP al aceptar cambio de categoría con débito vivo | **Actualizar monto en MP en el acto**, antes de lo local |
| 12 | Transiciones solicitables | **Las tres con cuota** (activo/adherente/colaborador); la CD valida al decidir |
| 13 | Empaquetado | **Dos fases: 5A luego 5B** |
| 14 | Identidad en el Inicio | **Sí**: número, categoría, antigüedad y estado electoral REG-31 |
| 15 | ¿La cuota de ingreso cuenta como "abonó este mes"? | **Sí, bloquea** |
| 16 | ¿El socio puede retirar una solicitud pendiente? | **Sí**, con timestamp de retiro |

---

## 3. Arquitectura de rutas y shell

### 3.1 Secciones (pestañas por URL)

| Ruta | Sección | Ícono Lucide | Visible para |
|---|---|---|---|
| `/mi` | Inicio | `Home` | todos |
| `/mi/cuenta` | Mi cuenta | `Wallet` | todos |
| `/mi/debito` | Débito automático | `RefreshCw` | solo `categoryPaysFee` |
| `/mi/datos` | Mis datos | `User` | todos |
| `/mi/solicitudes` | Solicitudes | `FileText` | todos |
| `/mi/estatuto` | Estatuto | `ScrollText` | todos |

- Config declarativa **pura** en `src/lib/mi/nav.ts` (sin JSX, testeable en node —
  mismo patrón que `src/lib/admin/nav.ts` con su test). El mapa ícono→componente
  vive en el componente cliente.
- Componente `MiTabs`: pestañas-`Link` scrolleables (patrón `TreasuryTabs`, con el
  truco `-my-1 py-1` para no recortar el anillo de foco), `aria-current="page"`,
  activa también en subrutas.
- El filtrado por categoría de la pestaña Débito es **display**: la autorización
  real va en la página y en cada action, como siempre.

### 3.2 Shell (`src/app/mi/layout.tsx`, reescrito)

- Skip link primero + `<main id="contenido" tabIndex={-1}>` (hoy no existen).
- Header claro clickeable (vuelve a `/mi`): logo, "Vecinal Ciudadela", borde
  inferior celeste `border-b-4 border-primary` (la seña actual que funciona),
  `SignOutButton`. Debajo, `MiTabs`.
- `error.tsx` y `not-found.tsx` propios de `/mi` (hoy caen al chrome global).
- Ancho `max-w-2xl` se mantiene (una columna, mobile-first); piso táctil **48px**
  (`CONTROL_HEIGHT`), el criterio de las pantallas de vecino, no los 44 del admin.
- El layout **no protege** a las páginas (render paralelo de Next): cada page y
  cada action llama `requireMember()` por su cuenta. Regla vigente que toda
  pantalla nueva del M5 respeta.
- El bloqueo del layout usa `FormMessage` (hoy hay un `<p role="alert">` crudo —
  deuda que no se propaga).

### 3.3 Dirección visual

- **Light-only.** No diseñar contra `.dark`; no montar ThemeProvider.
- **Elemento firma: la credencial de socio** en el Inicio — tarjeta con franja de
  `assets/hero.jpg` tratada con overlay calibrado (el patrón del hero público),
  y encima: número de socio grande en `font-mono tabular-nums`, nombre, badge de
  categoría, antigüedad desde `joinedAt`, estado electoral (§9). Es la única
  pieza audaz; el resto queda quieto.
- Debajo, tarjetas-resumen accionables: estado de cuenta (al día / Debés N · $X,
  CTA Pagar), débito automático (estado + CTA), solicitudes pendientes si las hay.
- Se reutilizan los patrones probados: boleta previa de `pay-form`, `ChoiceCard`,
  eyebrows `text-xs uppercase tracking-[0.08em]`, `FormMessage`, `EmptyState`,
  `PeriodStrip`, `status-badges`.
- **Enmienda (implementación, 24/08/2026):** se descartaron los chips de filtro
  por año del libro de pagos. `AccountSection` —el componente que ya comparten
  `/mi/cuenta` y la ficha de tesorería del admin— arma el índice número→id de
  recibos a partir de la lista completa de pagos que recibe
  (`src/components/admin/account-section.tsx:211`); pasarle una lista filtrada
  por año dejaba sin link clicable las celdas pagadas de los años que quedaban
  afuera del filtro. Resolverlo de raíz exigía tocar ese componente compartido,
  fuera de lo que el operador pidió para esta fase, y hoy ningún socio del
  padrón tiene pagos en dos o más años. Quedó el restyle sin los chips.
- Prohibido: verde/ámbar crudo (usar `--success`/`--warning`); tokens
  `--sidebar-*` (identidad exclusiva del admin); `#2E9BDF` en controles (solo
  `--primary` `#0079BC` para lo interactivo).
- Accesibilidad heredada del proyecto: targets ≥48px acá, `outline-hidden` +
  `focus-visible:ring-*`, `aria-current`, color nunca como canal único,
  `motion-reduce`.

---

## 4. Modelo de datos

Lo ÚNICO nuevo en Prisma. `Fee`, `Payment`, `Receipt`, `MpSubscription` no se tocan.

### 4.1 `MemberRequest` (tabla `member_requests`)

```
id            Int       @id @default(autoincrement())
memberId      Int       → Member (onDelete: Cascade)
type          MemberRequestType    // withdrawal | category_change
status        MemberRequestStatus  // pending | accepted | rejected | cancelled
requestedCategory MemberCategory?  // solo category_change; ∈ {active, adherent, collaborator}
message       String?   @db.VarChar(500)   // motivo opcional del socio
text          String    @db.VarChar(2000)  // texto formal generado (REG-19: se conserva)
createdAt     DateTime  @default(now())
decidedAt     DateTime?
decidedById   Int?      → User (onDelete: SetNull)
decisionNote  String?   @db.VarChar(500)
cancelledAt   DateTime?
movementId    Int?      → Movement (onDelete: SetNull)  // el asiento cuando se acepta
@@index([memberId, status])
@@index([status, type])
```

- **Una pendiente por tipo por socio**: MariaDB no tiene unique parcial; la regla
  se garantiza contando dentro de la transacción de creación, bajo el mutex por
  socio (`memberMutex`, ya existente).
- El `text` de la renuncia se genera en el servidor (plantilla fija con nombre,
  número de socio, fecha) y **se guarda**: REG-19 exige texto y timestamp. Se
  renderiza siempre como texto plano, nunca HTML (la CSP no ataja XSS almacenado).

### 4.2 `Member.addressPendingReview`

`Boolean @default(false)`. Se prende cuando el socio edita su domicilio desde
`/mi/datos`; la ficha admin lo muestra como aviso y el admin lo apaga al
constatar (acción con auditoría). `docs/05:424-425`.

### 4.3 `NotificationType`

Dos valores nuevos: `request_accepted`, `request_rejected` (aviso al socio de la
decisión de su solicitud). Salen por el transporte con `EMAIL_ALLOWLIST`, como todo.

---

## 5. Autorización: `requireMember` y el suspendido

### 5.1 Enmienda a la contradicción docs/02 vs docs/05

Gana **"ver + pagar"**: el suspendido devenga cuota (la suspensión no exime) y
saldar deuda lo acerca a la rehabilitación. `docs/02` REG-20 ("no puede operar")
se lee como: ninguna acción de gestión.

### 5.2 Mecanismo

`requireMember` gana una opción `{ allowSuspended?: boolean }` (default `false`,
comportamiento actual intacto — ningún llamador existente cambia).

- **Páginas de `/mi` y `GET /api/mi/*`**: `allowSuspended: true`. El actor vuelve
  con `suspended: true` y las fechas; el shell muestra un banner permanente
  (`FormMessage kind="warning"`) con desde/hasta.
- **Actions permitidas al suspendido**: SOLO `startMemberPaymentAction` (pagar).
- **Actions bloqueadas al suspendido**: adherir/cancelar débito, editar datos,
  crear/retirar solicitudes — cada una rechaza con el mensaje de REG-20.
- El **cesante** (`withdrawn`) sigue totalmente bloqueado, como hoy.
- Tests: la matriz completa (suspendido ve / paga / no adhiere / no edita / no
  solicita; cesante nada) en tests de action.

---

## 6. Débito automático (`/mi/debito`) — fase 5B

### 6.1 Estado visible

La página muestra por primera vez al socio su suscripción: listado con
`isNotCancelled` (lista negra: no saber es peor que avisar de más), "activo"
con `isCharging`, monto y último sync. Si hay más de una viva, se muestran todas
con aviso de contactar a la sede (el sistema no crea la segunda: la hereda).

### 6.2 Adherirse — guardas, en orden, TODAS en la action

1. `requireMember()` — suspendido y cesante no llegan.
2. Rate limit por `memberId` (patrón `memberPayLimiter`).
3. `categoryPaysFee(categoría VIVA)` — se relee de la ficha, nunca del token.
4. **Sin suscripción viva**: `countChargeable(subs del socio) === 0`. Cierra el
   hueco del doble preapproval anotado en `docs/06:469-474` para este camino.
5. **Regla anti-duplicación (la del operador)**: existe un `Payment` del socio con
   `status: "applied"`, `type ∈ {debit, link, cash, entry}` y `paidAt` dentro del
   **mes calendario argentino en curso** → bloqueado hasta el 1° del mes
   siguiente, con motivo y fecha visibles ("Ya abonaste una cuota este mes.
   Podés adherirte desde el 01/10/2026."). `voluntary`/`extraordinary` NO
   bloquean (no son cuota). La cuota de ingreso (`entry`) SÍ bloquea (decisión
   #15). Los límites del mes se calculan con el calendario civil argentino
   (`monthBoundsAR` / `periods.ts`), no con UTC.
6. **Email presente** en la ficha (MP exige `payer_email`); si falta, el CTA
   deriva a `/mi/datos`.

La regla vive como **función pura** `src/lib/members/debit-adhesion.ts`:
`adhesionBlock({ category, subscriptionStatuses, monthPayments }) → { ok } |
{ blocked, reason, availableFrom? }` — tabla de casos testeada sin Prisma
(patrón `eligibility.ts`). Pantalla y action consumen la misma función.

### 6.3 Creación

- `mpGateway.createPreapproval({ reason: subscriptionReason(""), amount:
  feeAmountFor(categoría, feeValueReader.current()), payerEmail: member.email,
  externalReference: "socio:{memberId}", backUrl: "{base}/mi/debito?volvio=1" })`.
  Sin valor vigente se corta ANTES de llamar a MP (patrón del wizard).
- `socio:{memberId}` es el formato que `docs/06:112-114` dejó **reservado** para
  esto. Se agrega a `references.ts` (builder + parser). **No hace falta regla
  nueva en `resolve.ts`**: los cobros llegan con `preapprovalId` y la fila local
  nace con `memberId`, así que la regla 3 existente ("la suscripción manda")
  los imputa como `debit` → `allocate` → cuota más vieja primero. Para un socio
  existente el primer débito **jamás** es cuota de ingreso: `entry` solo se
  produce vía `Application` (verificado en código, fase 4B).
- En `$transaction`: `mpSubscription.create({ preapprovalId, memberId,
  planId: null, status, payerEmail, amount, externalReference,
  linkedManually: false, lastSyncAt: now })` + `member.update({ autoDebit:
  true })` (porque `canStillCharge("pending")` — mismo criterio que la
  vinculación). Catch con log del `preapprovalId` si la base falla con la
  suscripción ya viva en MP (patrón del wizard); en ese residuo, el cobro cae a
  la bandeja por `no_subscription` — la red existente, sin caso nuevo.
- Redirect a `checkoutUrlFor(preapprovalId)`.
- Auditoría `member_debit_adhesion` con ids y flags; la URL del checkout nunca
  va al asiento (Ley 25.326).

### 6.4 La vuelta y el primer débito

- `back_url → /mi/debito?volvio=1`: la página sondea con una server action que
  hace `getPreapproval` fresco y actualiza el espejo local (`status`,
  `lastSyncAt`). El checkout de suscripciones NO usa `return-status.ts` (eso es
  de Checkout Pro).
- La pantalla previa a adherir dice **qué cubre el primer débito** — la cuota
  más vieja pendiente, o el mes que sigue a la cobertura si está al día
  (`upcomingPeriods` ya lo calcula) — en contraste explícito con el wizard, que
  dice "cuota de ingreso".
- Caveat operativo heredado (documentado, no accionable acá): el preapproval
  ignora `notification_url`; los avisos dependen de la config de webhooks del
  panel de MP y la red es el paso 2 del `reconcile` de las 03:00.

### 6.5 Cancelar

- Pantalla de confirmación con la frase de `cancelEffect` (pieza existente).
- Action: `requireMember` (suspendido no) → `cancelPreapproval` → espejo local
  en su propio try (si falla, la conciliación corrige — patrón
  `withdraw-with-debits`) → `autoDebit: false` solo si no queda otra viva
  (`countChargeable === 0`). Auditoría `member_debit_cancel`.
- Cierra el ciclo del email de "débito rechazado" de la 4C: cancelar + volver a
  adherirse es la re-autorización autogestionada.

---

## 7. Solicitudes (fase 5B)

### 7.1 Lado socio (`/mi/solicitudes`)

- Lista de solicitudes propias con estado (`pending/accepted/rejected/cancelled`),
  fecha y decisión.
- **Crear baja**: motivo opcional → se genera el texto formal, se muestra para
  confirmar, se guarda con timestamp. Aviso claro: "la baja es efectiva cuando
  la Comisión la acepte con acta".
- **Crear cambio de categoría**: `ChoiceCard` entre activo/adherente/colaborador
  (menos la actual). Validación en la action, bajo mutex por socio: `status ===
  "active"`, `countPendingFees === 0` (REG-07), `!electionsOngoing` (Art. 5 ter),
  sin otra `pending` del mismo tipo. Reutiliza los mensajes de
  `members/rules.ts` donde aplique.
- **Retirar** una pendiente: `status: "cancelled"` + `cancelledAt` (decisión #16).
- Auditoría en las tres actions; rate limit por `memberId`.

### 7.2 Lado admin — bandeja "Solicitudes de socios"

- Ítem nuevo en el grupo **Gestión** de `src/lib/admin/nav.ts` (+ tarjeta en
  `dashboard-cards.ts`; el test de sincronía existente lo cubre). `requireAdmin`
  (no superadmin). Ruta: `/admin/socios/solicitudes`.
- Lista con filtro por tipo y estado; contador de pendientes en la tarjeta del
  tablero.
- **Aceptar** desemboca **precargado** en el flujo existente con acta:
  - baja → `withdrawWithDebits` con motivo `resignation` (cancela débitos
    post-commit, como hoy);
  - cambio de categoría → `changeCategory` con las guardas REG-07 revalidadas
    dentro de la transacción, como hoy. **Novedad (decisión #11)**: si el socio
    tiene suscripción viva y `feeAmountFor(categoría nueva)` difiere, se llama
    `updatePreapprovalAmount` ANTES del update local; si MP falla, la acción se
    corta entera y no se escribe nada (patrón ya probado en
    `recategorizeApplicationAction`). Espejo `mpSubscription.amount` +
    `lastSyncAt` en la misma transacción local.
  Al completarse, la solicitud pasa a `accepted` con `movementId`, `decidedAt`,
  `decidedById`.
- **Rechazar**: nota opcional, `rejected`.
- En ambos casos: `Notification` al socio (`request_accepted` /
  `request_rejected`) por el transporte con allowlist. La Comisión se entera
  por bandeja + tablero + el resumen diario existente (sin email inmediato
  nuevo).

---

## 8. Mis datos (`/mi/datos`) — fase 5A

- **Solo lectura**: nombre, DNI, fecha de nacimiento, categoría, número de socio,
  fecha de ingreso, estado del email.
- **Editable**:
  - Teléfono: directo.
  - Domicilio: autocompletado de calles reutilizado (`street-autocomplete`),
    `calle_texto` para fuera del barrio; al guardar prende
    `addressPendingReview` y la ficha admin lo muestra.
  - Email: pasa a `declared` y dispara la verificación REG-08 con el circuito
    `ActionToken`/`/verificar/[token]` existente. La guarda de la 4A contra
    emails de admin/ficha ajena (`access.ts`) se respeta.
- Actions con `requireMember` (suspendido NO edita), rate limit, auditoría con
  ids y flags — **nunca el email ni el domicilio en el asiento** (Ley 25.326).
- Formularios con `synced-fields` (no propagar los `<select>` crudos anotados
  como deuda).

## 9. Inicio: credencial y estado electoral — fase 5A

- Número de socio = membresía del **libro abierto** (dato derivado, como en
  Deudores). Antigüedad desde `joinedAt` (REG-29: nunca se reinicia).
- Estado electoral REG-31, **reutilizando la lógica del padrón electoral de 4C**
  (no reimplementarla): categoría habilitada + ≥90 días + sin deuda para
  activos/colaboradores. Se muestra como afirmación con motivo cuando no
  ("Te faltan N días de antigüedad" / "Registrás cuotas pendientes").
- La tarjeta de estado de cuenta repite la semántica de `/mi/cuenta` (misma
  fuente: `fetchMemberAccount`), incluida la rama `feeAmount === null`.

## 10. Estatuto (`/mi/estatuto`) — fase 5A

- `datos/estatuto.docx` se convierte una vez a `datos/estatuto.pdf` (commiteado).
- Página con visor/descarga; el PDF se sirve por `GET /api/mi/estatuto`
  autenticada (`requireMember` con `allowSuspended`), `Cache-Control: no-store,
  private`, `nosniff`, CSP `default-src 'none'; sandbox` (headers de
  `receipt-response` como referencia).

---

## 11. Lo que NO se toca (innegociable del operador)

`registerPayment`, `allocate`, `coverageFloor`, `resolve.ts`, el webhook, la
conciliación, la numeración de recibos y sus tests de integración quedan
**intactos**. El módulo entero se apoya en caminos existentes:

- La adhesión produce cobros que entran por la **regla 3 de resolve** (existente).
- El pago del socio sigue siendo `startMemberPaymentAction` (existente).
- La baja aceptada usa `withdrawWithDebits` (existente).
- El cambio de categoría usa `changeCategory` (existente) + el patrón de
  `updatePreapprovalAmount` ya probado en solicitudes de alta.

Riesgo residual identificado y aceptado: si la fila local de una adhesión no se
escribe con el preapproval vivo, los cobros caen a la bandeja sin conciliar
(`no_subscription`) — red existente.

---

## 12. Fases y criterios de aceptación

### Fase 5A — Shell, rediseño y lectura (sin MP)

Shell + pestañas + `error/not-found` + credencial + Inicio + restyle de
`/mi/cuenta` + `/mi/datos` + `/mi/estatuto` + vista suspendido +
`addressPendingReview`.

- **CA-5A-1**: el panel completo navega con el shell nuevo en 375px y desktop;
  accesibilidad verificada (48px, focus visible, skip link, `aria-current`).
- **CA-5A-2**: un socio edita su email y recibe la verificación; edita su
  domicilio y la ficha admin muestra "pendiente de constatación".
- **CA-5A-3**: un suspendido ve su deuda con el banner y puede pagar; un cesante
  sigue totalmente bloqueado. Ningún test existente de dinero cambia.

### Fase 5B — Débito y solicitudes (transaccional)

`/mi/debito` (adherir/cancelar/estado) + `member_requests` + `/mi/solicitudes` +
bandeja admin + MP en el acto al recategorizar + notificaciones de decisión.

- **CA-5B-1**: en **sandbox local** (docs/11 Parte J), un socio existente se
  adhiere; el débito entra solo por webhook como cuota común (la más vieja
  primero, o el mes siguiente si está al día), con recibo — nunca como `entry`.
- **CA-5B-2**: el botón de adherir se bloquea con motivo y fecha si hay pago de
  cuota aplicado en el mes calendario en curso, y vuelve a bloquearse tras
  adherirse (suscripción viva).
- **CA-5B-3**: una solicitud de baja recorre el circuito entero hasta "baja por
  renuncia" con acta; la solicitud queda `accepted` con su `movementId` y el
  socio recibe el aviso.
- **CA-5B-4**: aceptar un cambio de categoría de un socio con débito vivo y
  monto distinto actualiza MP antes de escribir lo local; si MP falla, no se
  escribe nada.
- **Regla transversal**: los tests de integración del dinero
  (`receipt-sequence`, `mp-apply-concurrency`, `unique-violation`) pasan sin
  ninguna modificación.

### Testing por fase

- Reglas puras con tabla de casos, sin Prisma: `debit-adhesion.ts`,
  reglas de `member_requests`, `src/lib/mi/nav.ts`.
- Tests de autorización por action (matriz suspendido/cesante/anónimo, patrón
  `member-pay-action.test.ts`).
- El circuito de MP se prueba en sandbox local con túnel; **nunca cobros en
  producción** (la plata es de un vecino).

---

## 13. Enmiendas a documentos anteriores

1. `docs/05` §7 "suspendidos: solo-lectura" y `docs/02` REG-20 "no puede operar"
   se resuelven como **ver + pagar** (§5.1).
2. `docs/05` §7 "link por los períodos seleccionados" ya estaba enmendado por
   `docs/06` (`n` es cantidad); esta spec lo reafirma.
3. `docs/06` §2: el formato reservado `socio:{id}` pasa de reserva a uso real
   (§6.3), sin regla nueva en resolve.
4. `docs/07`: el alcance del M5 se implementa en dos fases 5A/5B con los CA de
   esta spec; los dos CA originales del módulo quedan cubiertos (el pago por
   link en sandbox ya fue verificado en 4B; el circuito de baja es CA-5B-3).
