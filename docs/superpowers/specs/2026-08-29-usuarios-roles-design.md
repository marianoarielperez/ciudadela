# Módulo de usuarios y roles (`/admin/usuarios`): diseño aprobado

**Fecha:** 29/08/2026 · **Estado:** aprobado por el operador (tres rondas de decisiones + una aclaración sobre roles acumulables)

Este documento es la spec del módulo de gestión de usuarios. Hoy no existe ningún
camino en el producto para otorgar los roles `admin` o `superadmin`: el único
código que escribe un rol es el canje de invitación del socio (otorga `socio`), y
`prisma/seed.ts:54` ya apunta a `/admin/usuarios` como la pantalla canónica que
nunca se construyó. El caso de uso real está documentado en `docs/08` §"Bajas de
usuarios admin al cambiar la CD": el recambio de Comisión Directiva.

---

## 1. Alcance

1. **Listado de usuarios** en `/admin/usuarios` (superadmin-only): todas las
   cuentas, con chips de filtro, búsqueda y estado de cada una.
2. **Detalle por usuario** en `/admin/usuarios/[id]`: datos, roles, estado de la
   cuenta, invitación pendiente y actividad de auditoría.
3. **Otorgar y quitar** los roles `admin` y `superadmin` a cuentas existentes,
   con guardas de autoprotección transaccionales.
4. **Alta de usuario de gestión** (un admin que no es socio: contador,
   colaborador): crea la cuenta con rol `admin` y envía una invitación por email
   con token de un solo uso donde la persona fija su contraseña.
5. **Activar/desactivar cuentas de gestión** y **gestionar invitaciones**
   (ver estado, reenviar, revocar).

**El rol `socio` es intocable desde esta pantalla** (solo lectura): lo gobierna
el ciclo de vida del socio (canje de invitación lo otorga; la baja apaga
`User.active` sin tocar el rol). **Fuera de alcance:** ver §11.

---

## 2. Decisiones del operador (29/08/2026)

| # | Decisión | Elección |
|---|---|---|
| 1 | Alcance | **Roles + alta de admins + activar/desactivar**: cubre el recambio de CD completo sin SQL |
| 2 | Rol `socio` | **Solo lectura**: se muestra con link a la ficha; ni se otorga ni se quita desde acá |
| 3 | Primera contraseña del admin nuevo | **Invitación por email con token** (7 días, un solo uso, patrón `ActionToken`); nadie más que la persona la conoce |
| 4 | Desfase del token JWT al otorgar | **Aviso claro en la UI** ("rige cuando cierre sesión y vuelva a entrar"); sin tocar el circuito de sesiones verificado |
| 5 | Guardas de autoprotección | **Completas**: no quitarse el propio superadmin, no desactivarse a sí mismo, nunca cero superadmins activos — revalidadas dentro de la transacción |
| 6 | Estructura | **Lista + detalle por usuario**: chips y búsqueda en la lista; las acciones con sus Dialogs viven en el detalle |
| 7 | Invitaciones pendientes | **Ver estado + reenviar + revocar** |
| 8 | Historial | **Sección "Actividad" en el detalle** con los asientos de `audit_log` de esa cuenta |
| 9 | Rol al crear | **Siempre `admin`**; `superadmin` se otorga después desde el detalle, como acto separado con su propio asiento |
| 10 | Edición de datos | **Nombre siempre; email solo en cuentas sin `Member`** (con revocación de tokens pendientes); con socio vinculado, el email se cambia desde la ficha |
| 11 | Activar/desactivar | **Solo cuentas de gestión**; en cuentas de socios puros el estado es solo lectura (lo gobierna la baja/readmisión) con link a la ficha |
| 12 | Nav | **"Usuarios", ícono `UserCog`, entre Padrón electoral y Configuración**, `superadminOnly: true` en nav y tarjeta |

**Aclaración acordada (roles acumulables):** otorgarle `admin` a una socia con
cuenta (p. ej. la tesorera o la presidenta) suma el rol a su misma cuenta: entra
con su email, la redirección post-login la lleva a `/admin`, y conserva `/mi`
intacto (ficha, deuda, débito). Quitarle el rol la devuelve a socia llana: el
corte en `/admin` es inmediato para toda acción (las guardas revalidan contra la
fila viva), y a lo sumo le queda visible la cáscara de la navegación hasta 8 h o
hasta re-ingresar. **El orden importa**: si la persona aún no canjeó su acceso de
socia, primero el acceso de socia desde la ficha, después el rol — la guarda
anti-escalada de `access.ts:254-259` bloquea el canje de una invitación de socio
sobre una cuenta con rol de administración, a propósito.

---

## 3. Modelo de datos

**Una sola migración, aditiva y chica**: el enum `TokenPurpose`
(`prisma/schema.prisma:175-179`) gana el valor **`admin_invitation`**.
`ActionToken.userId` ya existe (línea 471) y es lo que este propósito referencia
(los tres propósitos actuales cuelgan de `memberId`). Nada más se toca: ni
`User`, ni `Role`, ni `UserRole`, ni ninguna tabla de plata.

Detalles que se apoyan en lo que ya existe:

- **El alta crea la fila `User` de inmediato** (`email`, `name`, `active: true`,
  rol `admin`) con un `passwordHash` **aleatorio incanjeable** (bcrypt de bytes
  aleatorios que nadie conoce): la cuenta aparece en la lista desde el primer
  momento como "invitación pendiente", y el login es imposible hasta el canje —
  `verify-credentials` compara contra ese hash y falla con el mismo costo de
  tiempo que siempre (anti-enumeración intacta). `passwordChangedAt: null`
  distingue "nunca fijó contraseña".
- **Estado de la invitación**: se deriva de `ActionToken` (`purpose:
  "admin_invitation"`, `userId`, `usedAt`, `expiresAt`) + `passwordChangedAt`.
  Pendiente = token vivo sin usar; vencida = token expirado y
  `passwordChangedAt` null; canjeada = `passwordChangedAt` con valor.
- **No se borra ningún `User`, nunca**: ~18 FKs de autoría lo hacen inviable y
  el padrón es el registro que la asociación presenta ante la IGJ. La palanca es
  `active: false` (ya es así en todo el sistema).

---

## 4. Dominio: `src/lib/users/` (directorio NUEVO)

Módulos nuevos con el cliente de Prisma **inyectado** (patrón de
`applications/query.ts`: un test puro no debe caerse por falta de `.env`).
Ningún archivo existente de `src/lib/members/*`, `src/lib/treasury/*` ni
`src/lib/mp/*` se modifica.

### 4.1 `query.ts` — lecturas de la lista y el detalle

- `listUsers(db, filters)`: todas las cuentas con sus roles, el `Member`
  vinculado (número y estado, para el link a la ficha) y el estado de
  invitación. Filtros: chip (`gestion | socios | inactivas | todas`) + búsqueda
  por nombre/email. Cada chip filtra **exactamente lo que cuenta** (regla de
  `/admin/socios`).
- `getUserDetail(db, id)`: la cuenta completa + últimos asientos de `audit_log`
  (por `[entity="user", entityId]` — acciones hechas SOBRE la cuenta — y por
  `[userId]` acotado a la familia `login*`/`password_reset*` — lo que la cuenta
  hizo con su acceso; los dos índices ya existen).

### 4.2 `service.ts` — escrituras

Todas las operaciones corren dentro de un **mutex en memoria `user-roles`**
(premisa de un solo proceso, `docs/03`) **y además** revalidan sus guardas
**dentro de la `$transaction`** — el mutex es cinturón, la transacción es
tirante (lección del cerrojo optimista de la exención):

- `createManagedUser({ email, name })`: crea `User` + `UserRole(admin)` + emite
  el token `admin_invitation` y devuelve lo necesario para el envío del email
  **después del commit** (regla de oro: ninguna llamada de red dentro de la
  transacción). Guardas previas baratas (patrón de la exención: pre-validar lo
  frecuente antes de crear nada):
  - email ya tiene cuenta → rechazo con link al detalle de esa cuenta;
  - email pertenece a la **ficha de un socio sin cuenta** → rechazo con el
    mensaje "es el email de la ficha del socio N° X: envíale el acceso de socio
    desde la ficha y otorgale el rol a esa cuenta" (respeta la guarda
    anti-escalada del canje);
  - colisión P2002 en el `catch` vía el helper de `unique-violation` (soporta
    las dos formas del driver adapter y falla cerrado).
- `grantRole(actorId, targetId, role)` / `revokeRole(actorId, targetId, role)`:
  solo `admin` y `superadmin`. Guardas en la transacción:
  - `revokeRole(superadmin)` con `targetId === actorId` → rechazo ("no podés
    quitarte tu propio rol de superadmin");
  - tras cualquier revocación de `superadmin`, `count` de superadmins **activos**
    restantes; 0 → rollback ("el sistema no puede quedar sin superadmin");
  - `socio` no es un valor aceptado por el tipo del parámetro (imposible por
    construcción, no por validación).
- `setUserActive(actorId, targetId, active)`: solo cuentas de gestión (con rol
  `admin`/`superadmin`); guardas: no desactivarse a sí mismo, y desactivar a un
  superadmin cuenta contra la guarda de "nunca cero superadmins activos". Para
  cuentas de socios puros la action ni existe en la pantalla y el servicio la
  rechaza igual (la pantalla muestra deshabilitado exactamente lo que la action
  rechaza — patrón `debit-adhesion`).
- `updateManagedUser({ name, email? })`: nombre siempre; email **solo si
  `member == null`**, revalidado en la transacción, con revocación de los
  `admin_invitation` vivos al cambiarlo.
- `resendInvitation(targetId)` / `revokeInvitation(targetId)`: reemite (revoca
  el token anterior y emite uno nuevo; el envío, después del commit) / revoca a
  secas. Solo para cuentas con `passwordChangedAt: null`.

Los textos de rechazo salen del dominio (patrón `GRANT_GUARD_MESSAGES` de la
exención): el operador lee lo mismo se corte donde se corte.

### 4.3 `admin-access.ts` — canje de la invitación

`redeemAdminInvitation(token, password)`: `consume` dentro de la transacción
(gana exactamente un POST concurrente, como siempre), exige `t.userId` y
`purpose: "admin_invitation"`, revalida `user.active`, escribe `passwordHash` +
`passwordChangedAt` (el bcrypt se calcula **fuera** de la transacción, ~300 ms)
y revoca los `admin_invitation` restantes. **No toca roles ni `Member`**.

La ruta pública **`/acceso/[token]` se comparte**: la página ya usa
`tokens.peek` (genérico) y la action gana una **rama por `purpose`** que despacha
a `memberAccess.createPassword` (intacto) o a `redeemAdminInvitation`. Sin
Turnstile: el token es la barrera (regla del stack). Los copys siguen sin nombre
propio (decisión de privacidad de `access.ts:45-70`).

### 4.4 Email de invitación

Plantilla nueva ("Te invitamos a administrar SIGeV…") por el mailer existente:
`EMAIL_ALLOWLIST` envuelve el transporte, así que el camino nuevo queda cubierto
sin hacer nada; un bloqueo por allowlist no es un fallo. El envío es
**post-commit y best-effort**: si falla, la cuenta quedó creada y el botón
"Reenviar invitación" es la recuperación (mismo criterio que el PDF del recibo).

---

## 5. Pantallas

### 5.1 Nav y tablero

- `src/lib/admin/nav.ts`: token `"user-cog"` en `AdminNavIcon` + ítem
  `{ href: "/admin/usuarios", label: "Usuarios", icon: "user-cog", superadminOnly: true }`
  en el grupo Sistema, **entre Padrón electoral y Configuración** (comentario de
  orden: se usa poco — recambio de CD — más que el padrón bianual, menos que
  Salud).
- `src/components/admin/nav-icons.ts`: mapear `UserCog` (Lucide; `Users` ya es
  de Socios).
- `src/lib/admin/dashboard-cards.ts`: tarjeta en Sistema con `title` idéntico al
  `label` y `superadminOnly: true`.
- Se actualizan los tres tests que fijan la sincronía (`tests/admin-nav.test.ts`
  — incluida la lista literal de hrefs superadmin — y
  `tests/dashboard-cards.test.ts`), con el molde de `it` por sección que ya
  existe.

### 5.2 `/admin/usuarios` (lista)

`force-dynamic`, `requireSuperadmin()` con el bloque de bloqueo de Configuración
(pantalla, no redirect), `PageHeader` con bajada.

- **Chips segmentados con contador** (molde exacto de `/admin/socios`): Gestión
  | Socios | Inactivas | Todas — links GET, `aria-current`, cada chip filtra lo
  que cuenta.
- **Búsqueda** por nombre/email (form GET plano, `SELECT_CLASS`/`Input` con
  `aria-label`).
- **Tabla en desktop (`hidden md:block`) + card por fila en móvil
  (`md:hidden`)**: nombre (link al detalle, `INLINE_LINK`), email, badges de
  roles, estado de cuenta/invitación, último ingreso. Números y fechas
  `font-mono tabular-nums`.
- Badges desde `src/lib/admin/status-badges.ts` (funciones nuevas
  `userRoleBadgeVariant` y `userAccountBadgeVariant`; prohibido el ternario por
  pantalla). Semántica por peso: `default` para superadmin (acá hay poder),
  `outline` para invitación pendiente (todavía no ocurrió), `secondary` para
  inactiva (apagado).
- `EmptyState size="list"` que distingue "sin resultados con estos filtros"
  (con "Limpiar filtros") de la lista vacía real; **nunca un `thead` sin
  filas**. `PaginationNav` con `pageHref` si la lista crece.
- Acción del header: "Nuevo usuario de gestión" → `/admin/usuarios/nuevo`.

### 5.3 `/admin/usuarios/nuevo` (alta)

Form con `useSyncedForm` + `TextField` (nombre, email), `useActionState`,
mensajes zod en castellano. Al crear: `redirect` al detalle con `?invitado=1` y
banner de éxito que dice que la invitación salió (o que quedó pendiente de
reenvío si el envío falló). Miga: "Usuarios → Nueva".

### 5.4 `/admin/usuarios/[id]` (detalle)

`PageHeader` con **el nombre en el `<h1>`** y la referencia corta en la miga
(última miga: "Detalle"). Secciones (patrón `PanelHeader` + anclas de Salud):

1. **Datos** — nombre editable; email editable solo sin socio vinculado (con la
   leyenda y el link a la ficha en el caso contrario). Último ingreso.
2. **Roles** — badges actuales; otorgar/quitar `admin` y `superadmin` con
   **`Dialog` destructivo** (nivel 2; el form va aparte con `form={formId}`
   porque `DialogContent` se monta en portal) que redacta el efecto. Tras
   otorgar: banner "El cambio rige cuando {nombre} cierre sesión y vuelva a
   entrar." El rol `socio`, si lo tiene, se muestra como badge con link a la
   ficha y sin controles. Los botones que las guardas van a rechazar se muestran
   deshabilitados con el motivo (quitarse el propio superadmin, dejar cero).
3. **Cuenta** — activar/desactivar (solo gestión) con Dialog destructivo; para
   socios puros, estado en solo lectura con la explicación.
4. **Invitación** — visible solo mientras `passwordChangedAt` es null: estado
   (pendiente/vencida), reenviar, revocar.
5. **Actividad** — últimos asientos de `audit_log` de la cuenta (quién le otorgó
   qué y cuándo; sus logins y restablecimientos), en lista `ul` dividida.

Todo control ≥44px (`min-h-11`), `outline-hidden` + `focus-visible:ring`,
botones pendientes en gerundio ("Guardando…"). La pasada estética fina se hace
con la skill `frontend-design` durante la implementación, sobre los tokens del
panel (`--primary`, `--success`, `--warning`; jamás verde/ámbar crudo).

---

## 6. Autorización

`requireSuperadmin()` en las **tres rutas y en cada server action** (cada action
es un endpoint público: Next despacha por `Next-Action`). El mensaje de bloqueo
usa la factory `makeRequireRole(…, notAllowed)` con un texto propio del módulo
(el actual habla de "configuración"). El `superadminOnly` de nav y tarjeta es
display, como siempre.

---

## 7. Auditoría

Familia nueva, `entity: "user"`, `entityId: targetUserId`, `detail` **sin datos
personales** (Ley 25.326: roles y flags, nunca el email):

| Acción | Cuándo |
|---|---|
| `user_create` | alta de cuenta de gestión |
| `user_update` | cambio de nombre/email (detail `{ fields }`) |
| `user_disable` / `user_enable` | interruptor de cuenta |
| `role_grant` / `role_revoke` | detail `{ role }` |
| `admin_invitation_sent` / `_resent` / `_revoked` | ciclo de la invitación |
| `admin_invitation_send_failed` | el envío post-commit falló (para Salud/diagnóstico) |
| `admin_password_set` | canje del token (actor: la propia cuenta) |

`audit()` best-effort en todo salvo el canje, que calca el patrón de
`/acceso/[token]` existente. `ip` desde `x-real-ip`.

---

## 8. Riesgos mapeados y su tratamiento

| Riesgo (del análisis del 29/08) | Tratamiento |
|---|---|
| Lockout: un solo superadmin, el seed no re-otorga | Guardas completas transaccionales (§4.2), que son **intra-módulo**; la puerta de afuera la avisa `/admin/salud` (abajo) |
| Quitar `socio` deja al socio sin `/mi` con débito vivo | El rol `socio` no se puede tocar desde el módulo (decisión 2) |
| `active` de socios lo gobierna la baja/readmisión | Interruptor solo para cuentas de gestión (decisión 11) |
| Editar email rompe `Member.email ↔ User.email` | Email editable solo sin `Member` (decisión 10) |
| Token JWT no refleja un rol otorgado hasta re-login | Aviso explícito en la UI (decisión 4) |
| Invitación de socio sobre cuenta admin (anti-escalada) | El alta detecta el email de ficha y redirige el flujo (§4.2) |
| Red dentro de transacción | Email post-commit, best-effort, con reenvío (§4.4) |
| Concurrencia en guardas de rol | Mutex `user-roles` + revalidación en transacción (§4.2) |

**La garantía de "nunca cero superadmins activos" es INTRA-MÓDULO.** `revokeRole`
y `setUserActive` cuentan los superadmins activos *después* de escribir y
*dentro* de la transacción, así que ninguna operación de `/admin/usuarios` puede
dejar el sistema sin ninguno. Lo que queda afuera es la **baja de un socio**:
`members/service.ts` apaga el `User.active` de la cuenta vinculada sin mirar
roles, y esa pantalla exige `requireAdmin`, no `requireSuperadmin`. Si la única
superadmin fuera además socia —que es justamente el caso que esta spec promueve,
darle el rol a la tesorera o a la presidenta—, un admin común declarando su baja
dejaría el sistema con cero superadmins activos. Y como el seed no re-otorga
roles ni reactiva cuentas (a propósito), la recuperación sería SQL directo contra
la base de producción: exactamente lo que este módulo existe para eliminar.

**Tratamiento acordado (29/08/2026): que lo vea `/admin/salud`.** El tablero
suma una alerta `act` cuando quedan **uno o menos** superadmins activos, contados
con el MISMO `where` que la guarda del dominio (`ACTIVE_SUPERADMINS_WHERE`, en
`users/query.ts`, importado y no copiado). Va como `act` y no como `review`
porque cumple los dos términos de esa frontera: el estado es una rotura real
—perder esa cuenta obliga a entrar por SQL— y hay una salida concreta que lo
apaga, que el texto de la alerta nombra: otorgarle el rol a una segunda cuenta
desde `/admin/usuarios`. No es de la familia de los contadores acumulativos que
"nacen en rojo" y que ninguna acción baja: es el estado de hoy y se apaga solo al
resolverse. Hoy está encendido —hay un único superadmin— y eso es precisamente lo
que la alerta quiere inducir.

**Regla operativa:** conviene que al menos un superadmin activo **no sea socio**,
para que ningún ciclo de baja o readmisión pueda tocarle la cuenta.

**Queda como tarea aparte** la guarda de raíz: que la baja de socio se niegue a
apagar la cuenta del último superadmin activo. No se hizo en esta branch porque
`src/lib/members/*` está congelado acá —es código de bajas verificado y en
producción— y porque la verificación de cierre de este módulo exige `git diff`
vacío sobre ese directorio (abajo).

**Pagos: verificado que no hay superficie de contacto.** El webhook de MP, los
cinco crons, `registerPayment` y toda la tesorería no leen roles ni `User` en
ningún punto (grep sobre `src/lib/mp`, `src/lib/treasury`, `src/lib/cron`,
`src/app/api`: cero lecturas). El módulo no puede cortar un cobro. Al cerrar, el
`git diff --stat` debe mostrar **cero cambios** en `src/lib/treasury/*`,
`src/lib/mp/*` y `src/lib/members/*` (misma verificación que la exención).

---

## 9. Tests

- **Dominio puro** (`tests/users-*.test.ts`): guardas de `service.ts` con fakes
  que **honran el `where` que reciben** (lección del Módulo 6) y verificación
  **por mutación** de las tres guardas de autoprotección (borrarla y ver el test
  en rojo, después restaurar).
- **Actions** (`tests/usuarios-actions-auth.test.ts`): molde de
  `config-actions-auth` — el rechazo de `requireSuperadmin` no escribe, no
  audita, no invalida caché.
- **Canje**: la rama nueva de `/acceso/[token]` no altera el camino de socios
  (la suite de `member-access` pasa sin tocar una aserción — rediseñar una
  ruta no autoriza a reescribir su lógica).
- **Nav/tarjetas**: actualizar los tres tests de sincronía con el molde por
  sección.
- **Componentes puros** de pantalla: `renderToStaticMarkup` si aplica (molde de
  `admin-health-screen`).

---

## 10. Plan de despliegue

Branch propia (`usuarios-roles`), merge a `main` tras la verificación en vivo
con el operador. La migración del enum es aditiva (sin impacto en filas
existentes). El deploy sigue el runbook de `docs/10` (los comandos del VPS se
copian de ahí, nunca de memoria). Sin variables de entorno nuevas.

---

## 11. Fuera de alcance

- Borrar usuarios (inviable y no deseado; la palanca es `active`).
- Otorgar/quitar el rol `socio` (lo gobierna el ciclo del socio).
- Revocación forzada de sesiones ajenas (un `sessionInvalidatedAt` con mensaje
  propio queda para cuando haga falta; hoy `passwordChangedAt` mentiría).
- Pantalla general de auditoría (la sección Actividad del detalle no la
  reemplaza).
- Cambio de contraseña ajeno desde el panel (existe `/ingresar/recuperar`).
- Devolver los roles vivos en `AdminActor` (deuda anotada en CLAUDE.md; se
  cierra aparte si molesta, no como parte de este módulo).
