# La invitación que nadie ve: diagnóstico de un caso real de producción

**Fecha:** 29/08/2026 · **Estado:** diagnóstico CERRADO; **arreglo §7.1+§7.2+§7.3 IMPLEMENTADO y verificado en vivo** (29/08/2026) en la rama `invitation-email-net` (plan: `docs/superpowers/plans/2026-08-29-invitacion-por-correo.md`). Tres decisiones del operador durante la ejecución: el texto del §7.2 no promete que crear la contraseña vaya a funcionar (cubre también la casilla compartida, que rebota en `conflict`); el chequeo del §7.3 lista por EDAD de la invitación (48 h desde la emisión, no "por vencer"); y la ventana se eligió sabiendo que con `EMAIL_ALLOWLIST` puesta en producción el correo-red no sale para el padrón general hasta el lanzamiento.

Este documento existe para que una sesión nueva pueda retomar el arreglo sin
volver a diagnosticar. El incidente ocurrió en producción
(`vecinalciudadela.ar`), se midió contra la base real, y la causa está
confirmada al milisegundo. **No hay que reproducir el diagnóstico: hay que
arreglar lo que describe la §4.**

---

## 1. El incidente, tal como lo vivieron las dos personas

El operador (superadmin) le mandó a una socia el enlace de acceso al portal
desde la ficha. Lo que vio cada uno:

| # | Quién | Qué hizo | Qué vio |
|---|---|---|---|
| 1 | Operador | Envió el acceso desde `/admin/socios/106?tab=acceso` | "Se envió" |
| 2 | Socia | Abrió el correo y tocó **"Confirmar mi email"** | **"El enlace venció o ya fue usado. Pedí a la vecinal que te lo reenvíe"**, en rojo, DEBAJO del formulario |
| 3 | Operador | Volvió a la ficha | El email figura **verificado** |
| 4 | Socia | Pidió restablecer la contraseña | La pantalla dijo que se envió |
| 5 | Socia | Abrió un correo y tocó el enlace | El mismo error, ahora en una página que dice "Verificación de email — No pudimos usar este enlace" |

La socia concluyó que el trámite le había fallado. El operador vio en el panel
que estaba verificado. **Los dos tenían razón**, y ese es el problema.

---

## 2. La evidencia (medida contra la base de producción)

Consultado el 29/08/2026 sobre el socio 106:

```
members:
  id = 106
  email = micaaguero047@gmail.com
  email_status = verified
  email_verified_at = 2026-08-29 17:42:28.938
  user_id = NULL            ← NO TIENE CUENTA

action_tokens (del member 106):
  purpose = email_verification
    created_at = 2026-08-29 17:23:13.923
    expires_at = 2026-09-05 17:23:13.910
    used_at    = 2026-08-29 17:42:28.938   ← consumido con éxito

  purpose = password_invitation
    created_at = 2026-08-29 17:42:28.989   ← 51 ms después de la verificación
    expires_at = 2026-09-05 17:42:28.938
    used_at    = NULL                      ← VIVO Y SIN USAR

users WHERE email='micaaguero047@gmail.com':
  (cero filas)

audit_log (entity=member, entity_id=106):
  member_email_verified     2026-08-29 17:42:29.023
  member_send_verification  2026-08-29 17:23:14.284
```

**El cotejo con las capturas de pantalla de la socia cierra el caso al minuto.**
La base guarda UTC y el teléfono mostraba hora argentina (UTC−3):

- verificación exitosa: `17:42:28` UTC = **14:42:28** AR
- captura del error: **14:43** AR → **un minuto DESPUÉS de que la verificación funcionara**
- segunda captura: **15:41** AR → una hora más tarde, con la página en su estado
  "enlace muerto" (otra pantalla distinta: ver §3)

---

## 3. Por qué las dos capturas son cosas distintas

Hay que mirar `src/app/(public)/verificar/[token]/page.tsx` para entenderlo: la
página **nunca** dibuja el formulario y el error al mismo tiempo. O `usable` es
verdadero y renderiza `ConfirmForm`, o es falso y renderiza el `<p>` rojo.

- **Captura 1** (14:43): muestra el formulario COMPLETO —la dirección, el botón
  "Confirmar mi email", el texto del Art. 5° quater— **y además** el error rojo.
  Esa combinación solo la puede producir `ConfirmForm`, o sea el **estado de
  error de la server action después de un POST**. La socia envió el formulario y
  la action le contestó "ya fue usado".
- **Captura 2** (15:41): dice "Verificación de email — No pudimos usar este
  enlace". Ésa sí es la página con `usable === false`: un GET sobre un token
  muerto. Es el correo VIEJO reabierto, no el del recupero (el del recupero
  llevaría a `/ingresar/restablecer/[token]`, que es otra pantalla).

---

## 4. La causa raíz

**El token de `password_invitation` solo llega a la persona por el `redirect` de
la action.** Nunca viaja por correo en este camino.

El circuito, en orden:

1. El operador envía la verificación desde la ficha
   (`sendVerificationAction` → `verificationTarget` decide `email_verification`).
2. La socia abre `/verificar/[token]`. La página hace **`peek`, no `consume`**
   —correcto y deliberado: los escáneres de enlaces de los clientes de correo
   abren la URL antes que la persona—.
3. La socia toca "Confirmar mi email" → POST → `confirmEmailAction` →
   `memberAccess.verifyEmail` → `tokens.consume` **dentro de la transacción**.
4. `applyEmailVerification` (`src/lib/members/access.ts`) marca el email como
   verificado, revoca los enlaces vivos y **emite el `password_invitation`**,
   devolviendo el token **crudo**.
5. La action **redirige** a `/acceso/{token}` con ese token crudo.
6. La socia crea su contraseña.

**El punto de falla está entre el 4 y el 6.** El token crudo existe una sola vez,
en memoria, y su único vehículo es ese redirect. Si el redirect se pierde, el
token queda **emitido, válido y sin que nadie lo haya visto nunca** — que es
exactamente el estado en el que quedó la fila de la §2.

**Qué se perdió acá:** un segundo POST. `tokens.consume` usa un `updateMany`
condicional (`where: { id, usedAt: null }`), así que entre dos envíos
simultáneos **gana exactamente uno** y el otro recibe `null` → `ACCESS_ERRORS.dead`.
El primero verificó y emitió; el segundo mostró el error. La socia vio el
segundo.

**El origen del segundo POST no está confirmado y probablemente no importa.**
Lo que sí está verificado: `ConfirmForm` **ya se protege del doble clic**
(`disabled={pending}`), así que no fue eso. La captura 1 muestra **2 pestañas
abiertas** en el navegador de la socia, lo que hace muy plausible que haya
tenido el formulario cargado dos veces y confirmado en las dos. Volver atrás
después del redirect es otra vía posible. **El arreglo no debe apostar a
eliminar el segundo POST**: tiene que hacer que perderlo no cueste la cuenta.

**Y el paso 4-5 del incidente se explica solo:** `passwordReset.request`
(`src/lib/auth/password-reset.ts`) solo envía si existe una cuenta habilitada.
La socia no tiene `User`, así que **no se mandó ningún correo de recupero** — la
pantalla dice "listo" igual, a propósito, por anti-enumeración. El correo que
ella abrió después era el viejo de verificación.

---

## 5. Lo que este bug le hace al sistema, más allá del caso

1. **La persona queda con el email verificado y sin cuenta**, y sin ninguna
   forma de darse cuenta: el mensaje que ve dice que el enlace falló, cuando en
   realidad su trámite se completó a medias.
2. **El operador no tiene cómo enterarse.** En la ficha ve "verificado", que es
   la señal de éxito. Nada en el panel dice "esta persona quedó a mitad de
   camino". Hoy solo se descubre porque el socio se queja.
3. **Queda un token de invitación vivo hasta 7 días** que nadie usó ni puede
   usar, porque nadie lo vio.
4. El camino de recupero, que es lo que cualquiera intentaría, **no sirve**: sin
   cuenta no hay nada que recuperar, y la pantalla no lo puede decir.

**El estado "email verificado + sin cuenta" es normal y transitorio** (existe
entre el paso 4 y el 6 de todo canje exitoso), así que no se puede tratar como
error por sí solo. Lo anómalo es que **persista**.

---

## 6. Cómo se destraba un caso ya ocurrido (sirve para la socia hoy)

Desde `/admin/socios/106?tab=acceso`, el botón de envío. Con
`emailStatus === "verified"` y `userId === null`, `verificationTarget`
(`src/lib/members/card-edit.ts:160-179`) devuelve **`password_invitation`**, así
que el panel manda la invitación de contraseña —no la verificación otra vez— y
**esa sí viaja por correo**. Revoca el token colgado y emite uno nuevo.

Ese camino ya existe y funciona: no es lo que hay que arreglar. Lo que hay que
arreglar es que haga falta.

---

## 7. El plan propuesto

### 7.1 El arreglo central: que la invitación también viaje por correo

Cuando la verificación es exitosa y emite el `password_invitation`, ese enlace
debe **además** mandarse por correo a la casilla que se acaba de confirmar. El
redirect sigue siendo el camino rápido (la persona ya está ahí, no tiene sentido
mandarla al buzón); el correo es la **red** para cuando ese camino se corta.

Restricciones del proyecto que este arreglo tiene que honrar:

- **Ninguna llamada de red dentro de una `$transaction`.** El envío va
  **después del commit**, en la action, nunca dentro de `verifyEmail`. El
  proyecto ya pagó esta lección dos veces (el PDF del recibo y el
  `cancelPreapproval` de la baja).
- **Un solo token.** El mismo que viaja en el redirect es el que va por correo.
  Emitir dos sería peor que el bug: el segundo revocaría al primero y rompería
  el redirect.
- **Best-effort.** Si el correo no sale, el redirect igual funciona y el
  operador conserva el botón de reenvío. Un fallo de correo no puede tumbar una
  verificación que ya se asentó.
- **`EMAIL_ALLOWLIST` envuelve el transporte**, así que el camino nuevo queda
  cubierto solo; y **un bloqueo por allowlist NO es un fallo** (no se audita como
  `send_failed`).
- La plantilla ya existe: `invitationEmail` en `src/lib/email/templates.ts`,
  que se usa hoy para el reenvío desde la ficha. **Sí saluda por nombre**, y hay
  un comentario que explica por qué eso es correcto justamente en esta rama: se
  llega acá solo con el email ya verificado por la propia persona, así que un
  dedazo del operador no puede entregar el nombre a un tercero. Ese razonamiento
  **se mantiene** con el arreglo: el correo sale a la dirección que la persona
  acaba de confirmar haciendo clic.
- Ojo con el **canje tardío de una solicitud** (`applicationId`): la misma
  función `applyEmailVerification` la usan dos puntas (ficha y solicitud
  asentada). Verificá qué corresponde en cada una antes de mandar correo en las
  dos.

### 7.2 Que el segundo POST no mienta

Hoy el segundo envío dice "El enlace venció o ya fue usado", que es cierto sobre
el token y **falso sobre lo que le pasó a la persona**: su verificación
funcionó. Con el arreglo 7.1 el daño se acota (el correo llega igual), pero el
mensaje sigue siendo desorientador.

Vale evaluar que, cuando el token está usado **y** el email de esa ficha ya
figura verificado **y** no hay cuenta, la pantalla diga algo cierto y útil
("Tu email ya está confirmado. Te mandamos por correo el enlace para crear tu
contraseña"). **Cuidado con la seguridad**: esa rama no puede convertirse en un
oráculo que confirme el estado de una ficha a cualquiera que tenga un token
usado, ni en una vía para pedir reenvíos ilimitados. Si no se puede hacer sin
abrir eso, es preferible dejarlo y quedarse con 7.1.

### 7.3 Que el operador pueda verlo

Nada en el panel distingue "verificado y andando" de "verificado y a mitad de
camino". Propuesta: un chequeo en `/admin/salud` que cuente los socios
**vigentes** con `emailStatus === "verified"`, `userId === null` y sin
invitación viva —o con la invitación por vencer— y los liste con enlace a su
ficha.

Encaja con la arquitectura de esa pantalla, que ya distingue *act* (algo roto
**con una salida que lo apaga**, único rojo) de *review*. Éste es **review**: no
está roto, hay gente esperando. La salida es el botón de reenvío de la ficha.
Cuidado con la regla hermana del proyecto: un contador acumulativo sin ventana
ni acción que lo baje enseña a ignorar el tablero — acotalo a los casos que
todavía se pueden resolver.

### 7.4 Qué NO hacer

- **No** intentar impedir el segundo POST como arreglo principal. El botón ya se
  deshabilita; el segundo envío viene de otra pestaña o de volver atrás, y
  perseguir eso no cierra el agujero. El agujero es que perder el redirect
  cueste la cuenta.
- **No** tocar `peek` vs `consume` en la página: que el GET no consuma es
  deliberado y protege de los escáneres de correo.
- **No** hacer que `tokens.consume` deje de ser atómico. Que gane exactamente un
  POST es correcto.
- **No** cambiar el comportamiento anti-enumeración del recupero.

---

## 8. Contexto del repositorio que la sesión nueva necesita

- **Rama:** trabajar sobre `main`. El módulo de usuarios y roles se mergeó y
  **se desplegó a producción el 29/08/2026** (merge `f3ad0ee`); no tiene nada
  que ver con este bug y no hay que tocarlo.
- **Archivos del circuito** (leerlos antes de proponer nada):
  - `src/app/(public)/verificar/[token]/page.tsx` — el GET, con `peek`
  - `src/app/(public)/verificar/[token]/confirm-form.tsx` — el formulario
  - `src/app/(public)/verificar/[token]/actions.ts` — la action y el redirect
  - `src/lib/members/access.ts` — `verifyEmail`, `applyEmailVerification`,
    `createPassword`, `ACCESS_ERRORS`, `REDEEM_PAGE_COPY`
  - `src/lib/tokens.ts` — `peek`, `consume`, `issue`, `revokeForMember`, y el
    comentario de encabezado sobre cuándo se revoca al emitir
  - `src/lib/members/card-edit.ts` — `verificationTarget`
  - `src/app/admin/socios/carga/[numero]/actions.ts` — `sendVerificationAction`
  - `src/lib/email/templates.ts` — `invitationEmail`, `portalInvite`
  - `src/lib/email/index.ts` y `transport.ts` — el mailer y la allowlist
  - `src/app/(public)/acceso/[token]/` — el canje de la contraseña
- **Este circuito lo comparten dos ramas**: la ficha del padrón (M1) y la
  solicitud del wizard ASOCIATE (M3). Un cambio en `applyEmailVerification` las
  toca a las dos.
- **`/acceso/[token]` tiene además una rama de cuentas de gestión** desde el
  módulo de usuarios (`admin_invitation`). No se toca, pero conviene saber que
  está: la action despacha por propósito de token.
- **Reglas del proyecto** (están en `CLAUDE.md`, leerlo entero): UI en es-AR con
  voseo y código en inglés; nada de red dentro de una transacción; el bcrypt
  siempre fuera; auditoría sin datos personales (Ley 25.326); migraciones con
  `prisma migrate`, nunca `db push`; el operador corre los comandos del VPS y
  Claude no se conecta por SSH.
- **Tests:** `npx vitest run`. Al 29/08/2026 son 3512 pasando. Hay suites
  específicas del circuito (`member-access`, `redeem-pages`, las de tokens) que
  **tienen que seguir pasando sin tocar una aserción**: si alguna falla, el
  error está en el cambio.

---

## 9. Cómo verificar el arreglo

1. **Unitario:** que una verificación exitosa emita **un** token y que el envío
   del correo ocurra **después** del commit, con el mismo token que devuelve el
   redirect. Verificar por mutación.
2. **El caso del incidente:** simular el segundo POST (consume ya usado) y
   comprobar que la persona igual recibió el enlace por correo.
3. **Las dos ramas:** ficha y solicitud asentada.
4. **Que la rama de socios no cambie de comportamiento** en los casos borde ya
   verificados: token vencido, ficha sin email, socio de baja, token ya usado.
5. **En vivo, con el operador**: la casilla de prueba habilitada en
   `EMAIL_ALLOWLIST` local es `marianoaperez@yahoo.com.ar` y
   `perezmarianoariel@gmail.com`. **Nunca probar contra la casilla de un
   vecino.**

---

## 10. El caso concreto que quedó abierto

Socia del **padrón N° 106** (`members.id = 106`), `micaaguero047@gmail.com`.
Al 29/08/2026 sigue **sin cuenta**, con el email verificado y un
`password_invitation` vivo que nunca vio (vence el 05/09/2026).

Se destraba con el §6 y **no hace falta esperar el arreglo**. Si cuando la
sesión nueva empiece la socia ya entró, el caso sirve igual como referencia: la
evidencia de la §2 quedó registrada acá.
