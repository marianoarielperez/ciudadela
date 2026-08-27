# Paso "Tu DNI" en ASOCIATE (chequeo temprano por DNI): diseño aprobado

**Fecha:** 27/08/2026 · **Estado:** aprobado por el operador (dos rondas de decisiones + enfoque técnico)

Hoy el vecino que no puede asociarse por la web —socio vigente, ex-socio con
deuda, expulsado— se entera **al final del formulario más largo**: después de
llenar ~16 campos en "Tus datos" y de resolver un captcha, `checkEligibility`
lo bloquea y `BlockedPanel` le muestra el motivo. Este módulo adelanta ese
veredicto a una pantalla nueva al inicio del wizard: el DNI se pide primero,
el sistema contesta antes de que el vecino cargue nada, y el resto del trámite
queda igual.

---

## 1. Alcance

1. **Un paso nuevo al frente del wizard**: ASOCIATE pasa de 5 a 6 pasos, con
   "Paso 1 de 6: Tu DNI" (campo DNI + Turnstile + Continuar). Los pasos
   actuales se renumeran 2-6 sin cambiar su contenido.
2. **Una server action nueva de chequeo** (`checkDniAction`) que reutiliza la
   regla pura existente (`checkEligibility`) sobre **la misma carga de insumos**
   que usa la creación de la solicitud (se extrae y se comparte, no se copia).
3. **Pantallas de resultado** para cada veredicto bloqueante, con el nombre
   **enmascarado** ("M\*\*\*\*\*\* P.") y el nivel de detalle acordado por el
   operador (§2).
4. **El DNI queda fijo** una vez verificado: viaja por el resto del wizard como
   dato del rastro de respuestas y el campo del paso "Tus datos" desaparece.

**El Paso 1 es cortesía de UX, no una guarda.** El envío del paso "Tus datos"
sigue corriendo `checkEligibility` completo, como hoy: el server sigue siendo
el único juez. **Fuera de alcance:** ver §10.

---

## 2. Decisiones del operador (27/08/2026)

| # | Decisión | Elección |
|---|---|---|
| 1 | Identidad mostrada | **Nombre enmascarado** ("M\*\*\*\*\*\* P."), como REEMPADRONATE. Nunca el nombre completo: el DNI no es autenticación |
| 2 | Detalle del motivo de baja | **Solo la deuda es distinguible** (es accionable). Expulsión, fallecimiento y anulación siguen compartiendo el mensaje genérico de sede, indistinguibles como hoy |
| 3 | Numeración | **Paso 1 de 6**, contando en el stepper (coherente con REEMPADRONATE) |
| 4 | Captcha | **Dos Turnstile**: uno en el paso nuevo y el que ya existe en "Tus datos". Sin mecanismo de pase |
| 5 | Socio vigente | Mensaje + **botón "Ingresar al panel de socio"** (`/ingresar`) |
| 6 | Solicitud en trámite | **Reenvío del enlace de retome ahí mismo**, con el formulario que ya existe |
| 7 | Deuda | Se muestra la **cantidad de cuotas pendientes** (sin pesos). El monto se conversa en la sede |
| 8 | DNI tras el chequeo | **Fijo**: se muestra no editable; cambiarlo es volver al paso 1 y re-verificar |
| 9 | Enfoque de servidor | **Carga de insumos compartida** entre el chequeo y la creación (`loadEligibilityInputs`), la lección de `coverageFloor`: compartir la función, no copiarla |
| 10 | Reingreso habilitado | **Indistinguible del DNI desconocido**: el ex-socio sin bloqueo continúa igual que un vecino nuevo, sin que la pantalla revele que existe una ficha |

---

## 3. Flujo de usuario

### 3.1 El paso nuevo

`/asociate` abre en **"Paso 1 de 6: Tu DNI"**:

- Texto introductorio: *"Con tu DNI verificamos si ya estás asociado o si
  tenés un trámite pendiente."*
- Campo DNI idéntico al actual de "Tus datos" (`inputMode="numeric"`,
  `maxLength 9`, hint *"Sin puntos ni espacios."*, sanitización `\D`,
  sin `autoComplete` ni `autoFocus` — las razones ya están escritas en
  `reempadronate-wizard.tsx`).
- `TurnstileWidget` dentro del form, con `resetKey` = el estado del action.
- `NavButtons submit` con `nextLabel="Continuar"` / `pendingLabel="Verificando…"`.

### 3.2 Los veredictos

| Veredicto | Qué ve el vecino | Y después |
|---|---|---|
| **DNI desconocido** o **ex-socio habilitado** (renuncia, mudanza, no re-empadronado, cesante que saldó) | Nada: avanza al Paso 2 "¿Dónde vivís?". **Los dos casos son indistinguibles** — que el sistema reconoció un reingreso no se le dice a un visitante anónimo | El `memberId` nunca viaja al cliente; el server lo re-resuelve al crear la solicitud, como hoy |
| **Socio vigente** (`active` o `suspended`, sin revelar la suspensión) | Pantalla completa: "Encontramos una ficha a nombre de **M\*\*\*\*\*\* P.** Ya está asociado/a a la vecinal." + *"Si sos vos, no hace falta que te asocies de nuevo: podés ver tu cuenta y tus pagos en el panel de socio."* | Botón **"Ingresar al panel de socio"** → `/ingresar` + "¿No sos vos? Probá con otro documento" + Volver al inicio |
| **Solicitud en trámite** | "Ya tenés una solicitud en trámite. Te podemos reenviar por email el enlace para retomarla." (el literal de hoy) | El **formulario de reenvío** existente, precargado con el DNI tipeado + retry + Volver al inicio |
| **Deuda** (`pendingFees > 0`) | "La ficha a nombre de **M\*\*\*\*\*\* P.** registra **N cuotas pendientes** con tesorería. Para reingresar, acercate a la sede social a regularizarla." | Link a `/ubicacion` (horarios y dirección, como el `BlockedPanel` actual) + retry + Volver al inicio |
| **Sede** (expulsión / fallecimiento / anulación — **un solo literal, indistinguibles**) | El mensaje actual: "No podemos procesar tu solicitud por este medio. Acercate a la sede vecinal." con el nombre enmascarado arriba | Link a `/ubicacion` + retry + Volver al inicio |
| **Rechazo reciente** (REG-05) | "No podés presentar una nueva solicitud por el momento. Vas a poder volver a solicitarlo a partir del **DD/MM/AAAA**." (nombre enmascarado solo si hay ficha) | Retry + Volver al inicio |

Toda pantalla negativa **reemplaza el wizard entero, sin stepper** (doctrina
del repo: un bloqueo no es un paso — `asociate-wizard.tsx:305-306`), con el
`<h1>` enfocado al montar y siempre con salida: "Probar con otro documento"
(descarta el veredicto y vuelve al campo DNI limpio) y "Volver al inicio".
Los bloqueos usan `FormMessage kind="warning"`; el rojo queda para fallas
técnicas, como en todo el sitio.

### 3.3 El resto del wizard

- Superado el chequeo, el **rastro de respuestas** (`AnsweredTrail`) suma la
  fila "DNI: 12345678 — Cambiar" visible en los pasos 2-4; tocarla vuelve al
  paso 1 (y cambiar el DNI implica re-verificar, captcha incluido).
- El campo DNI del paso "Tus datos" **desaparece**: el valor viaja como
  `<input type="hidden" name="dni">`, igual que hoy viajan domicilio y
  categoría. El schema zod del server no cambia.
- Si el vecino cambia el DNI a mano (DOM) o el veredicto cambió entre el paso
  1 y el envío (por ejemplo, se le asentó una deuda en el medio), la guarda del
  envío lo bloquea exactamente como hoy: el `BlockedPanel` actual **queda como
  red** para ese caso.

---

## 4. Servidor

### 4.1 `loadEligibilityInputs` — la carga compartida (enfoque B)

Se extrae a un módulo nuevo (`src/lib/applications/eligibility-inputs.ts`,
con el cliente de Prisma **inyectado**, como `query.ts` y `summary.ts`) la
consulta que hoy vive inline en `createApplicationAction`
(`asociate/actions.ts:262-277`):

- `member.findUnique({ where: { dni } })` con el select de siempre
  (`id`, `status`, `withdrawalReason`, `reentryBlocked`, `rejectedUntil`,
  `_count.fees pending`) **más `fullName`** (lo necesita el enmascarado; a la
  creación no le estorba).
- En paralelo: `applicationService.findLiveByDni(dni)` y
  `applicationService.lastRejectionAt(dni)`.

`createApplicationAction` pasa a llamarla. **Su comportamiento no cambia en
nada**: la prueba es que `tests/create-application-action.test.ts` (34 casos)
pasa **sin tocar una aserción** (el arnés de mocks puede adaptarse si cambia
un import; las aserciones no).

### 4.2 `dniCheckVerdict` — la función pura del veredicto

Módulo nuevo `src/lib/applications/dni-check.ts`. Recibe los insumos + el
`fullName` + `now`, llama a **`checkEligibility` sin modificarla** y mapea su
resultado a los códigos de pantalla del paso 1:

```ts
type DniCheckVerdict =
  | { ok: true }                                   // continuar (desconocido O reingreso habilitado)
  | { ok: false; code: "already_member" | "in_progress" | "visit_office";
      maskedName: string | null }
  | { ok: false; code: "debt"; maskedName: string; pendingCount: number }
  | { ok: false; code: "rejected_wait"; maskedName: string | null; retryAt: Date };
```

- El `ok: true` **no distingue** `memberId` presente o ausente (decisión #10).
- `maskedName` reutiliza **la misma función** de REEMPADRONATE: `maskedName()`
  se muda de `src/lib/reregistration/rules.ts:217-227` a un módulo neutral
  (`src/lib/members/masked-name.ts`) y `rules.ts` la **re-exporta**, así los
  call-sites y los tests de re-empadronamiento no se tocan.
- Tabla de casos con test propio; la precedencia la sigue dictando
  `checkEligibility` (en trámite gana a todo; expulsión gana a deuda).

### 4.3 `checkDniAction` — la action

En `src/app/(public)/asociate/actions.ts`, con el orden de guardas canónico
del proyecto (el de `lookupAction` de REEMPADRONATE, calcado):

1. Interruptor `asociate_activo` con lectura **directa** de `configReader`
   (guarda de autorización, nunca la cacheada).
2. `openWizardProcess` (re-empadronamiento en curso bloquea, mismo mensaje que
   la creación).
3. `asociateDniCheckLimiter.allows(ip)` — **sin cobrar**.
4. `verifyTurnstile` — un captcha malo no cobra el intento.
5. `dniSchema` (el existente, `actions.ts:88`) — el formato inválido tampoco cobra.
6. `record(ip)` — **el cupo se cobra recién cuando se va a tocar el padrón**.
7. `loadEligibilityInputs` + `dniCheckVerdict`.

Respuesta como **códigos**, nunca prosa del server (la pantalla redacta).
Ni `memberId` ni `applicationId` viajan al cliente jamás.

- **Limitador propio**: `asociateDniCheckLimiter`, **5 intentos / 15 min por
  IP**, al lado de `reregistrationLookupLimiter` en
  `src/lib/auth/rate-limiter.ts` y con su mismo razonamiento (ventana corta:
  el vecino legítimo reintenta en el momento; CGNAT móvil). El cupo de
  creación (5/h) queda intacto y separado. Se actualiza el comentario de
  `applicationCreateLimiter` (`rate-limiter.ts:218-223`) que hoy dice ser "la
  única puerta del chequeo de elegibilidad por DNI": deja de ser la única.
- **Sin auditoría**, por la doctrina escrita del repo
  (`reempadronate/actions.ts:142-147`): un asiento por intento crearía el
  registro IP↔DNI-consultado, un dato personal que hoy no existe (Ley 25.326).
- **Sin `revalidatePath`/`revalidateTag`**: la invariante no escrita del
  wizard (`asociate-wizard.tsx:259-270`) — ninguna action del wizard revalida,
  o el wizard vivo se remonta en medio del trámite (pago incluido). La action
  nueva lleva el comentario que lo diga.
- **Sin canal temporal diferencial**: todos los caminos que pasan el cupo
  ejecutan la misma consulta; no hay envíos de email ni trabajo condicional
  pesado que delate el veredicto por latencia.

---

## 5. Cliente

### 5.1 Renumeración (los literales sensibles, uno por uno)

En `asociate-wizard.tsx`:

| Qué | Hoy | Queda |
|---|---|---|
| `TOTAL_STEPS` (`:71`) | 5 | 6 |
| `STEP_TITLES` (`:72-78`) | 1 ¿Dónde vivís? … 5 Pago y envío | 1 **Tu DNI**, 2 ¿Dónde vivís?, 3 Elegí tu categoría, 4 Tus datos, 5 Documentación, 6 Pago y envío |
| Paso inicial del retome (`:127-136`) | 4 o 5 según `requiredDocsComplete` | **5 o 6** (misma función decide) |
| Guarda de no-retorno (`:170`) | `resumeToken && navStep < 4 ? 4` | `navStep < 5 ? 5` — es lo único que impide volver a los pasos de datos con la solicitud (y su preapproval) ya creados |
| Condición del rastro (`:356`) | pasos 2-3 | pasos **2-4** |
| Filas del rastro (`:438`, `:447`) | residencia (paso 1), categoría (paso 2) | **DNI (paso 1)**, residencia (paso 2), categoría (paso 3) |

El renderizado condicional de pasos suma la rama del paso 1 nuevo y corre las
demás. `EMPTY_DRAFT` y `AsociateDraft` no cambian de forma (el `dni` ya
existe en el draft).

### 5.2 Piezas nuevas

- **`step-dni.tsx`**: el formulario del §3.1. Solo primitivas existentes
  (`Field`, `Input` + `CONTROL_HEIGHT`, `TurnstileWidget`, `FormMessage`,
  `NavButtons submit`). Nada de constantes nuevas de alto/foco/link.
- **`dni-result-panel.tsx`**: un componente de pantalla de resultado que
  conmuta por código (§3.2), con la estructura del `BlockedPanel`
  (`<h1>` enfocado + `FormMessage warning box` + salidas). Para
  `in_progress` reutiliza el formulario de reenvío existente:
  `ResendResumeForm` se extrae de `blocked-panel.tsx` a su propio archivo
  (`resend-resume-form.tsx`) y los dos paneles lo importan — sin duplicarlo.
- **Estado en el marco**: el `useActionState` de `checkDniAction` vive en
  `asociate-wizard.tsx` (como el de creación), con el **patrón `dismissed`**
  por identidad — nunca un `useEffect` que resetee banderas. Veredicto
  bloqueante → se renderiza `dni-result-panel` en lugar del wizard;
  "Probar con otro documento" → descarta el veredicto y limpia `draft.dni`;
  `ok` → `patch({ dni })` + avanzar al paso 2.
- **`wizard-shared.ts`**: se agrega el tipo del estado del chequeo
  (`DniCheckState`), con el mismo comentario de advertencia que ya llevan
  `CreateState`/`PayState` (los tipos cliente/server se replican a mano).

### 5.3 "Tus datos" (paso 4)

- Se quita el `Field` de DNI (`step-personal.tsx:113-126`); en su lugar,
  `<input type="hidden" name="dni" value={draft.dni} />` junto a los hidden
  que ya llevan los datos de los pasos 1-3.
- El `BlockedPanel` sigue recibiendo `dni={draft.dni}` para el reenvío.
- La unión discriminada de `NavButtons` (`submit` XOR `onNext`) se respeta:
  el paso nuevo usa `submit`, jamás las dos cosas.

---

## 6. Privacidad y anti-enumeración

Lo que este módulo **revela** a un visitante anónimo que pasa captcha y cupo,
contra un DNI tipeado:

1. Que el DNI **tiene o no** ficha/trámite (los negativos son distinguibles
   entre sí: vigente ≠ en trámite ≠ deuda ≠ sede ≠ rechazo).
2. El **nombre enmascarado** (inicial del nombre + apellido con una inicial),
   solo cuando hay ficha.
3. La **cantidad de cuotas pendientes** en el caso deuda (decisión #7 del
   operador, consciente del trade-off).

Lo que **no** revela, nunca: nombre completo, montos en pesos, el motivo real
de una baja de sede (expulsión/fallecimiento/anulación siguen colapsados en un
literal), la suspensión de un vigente, la existencia de un reingreso
habilitado, `memberId`, `applicationId`, o el email de nadie.

Barreras: Turnstile (falla cerrado) + `asociateDniCheckLimiter` 5/15 min por
IP + sin auditoría del par IP↔DNI + sin diferencial de latencia. Es el mismo
paquete de REEMPADRONATE, que `docs/08` ya bendice; la novedad —veredictos
distinguibles y el conteo de cuotas— se asienta como **enmienda a `docs/08`**
(§9).

---

## 7. Lo que NO cambia (la lista de no-romper)

- **Ni un archivo de `src/lib/mp/*` ni de `src/lib/treasury/*`** (a verificar
  con `git diff --stat` al cerrar, como la exención).
- `checkEligibility` (`src/lib/applications/eligibility.ts`): ni una línea.
  El paso nuevo es un segundo consumidor, no una regla nueva.
- El **comportamiento observable** de `createApplicationAction`: mismas
  guardas, mismo orden, mismos mensajes, mismos asientos de auditoría. Solo
  cambia de dónde importa la carga de insumos.
- El circuito de **retome y pago**: `startPaymentAction`, `appFromToken`,
  el `replaceState`, la entrada del retome por `requiredDocsComplete` (solo
  se corren los números de paso).
- El `BlockedPanel` y su semántica (queda como red del envío del paso 4).
- El flujo de reenvío del enlace (`resendResumeLinkAction`) y sus tres frentes
  anti-oráculo.
- REEMPADRONATE entero (solo `maskedName` se muda de archivo, con re-export).

---

## 8. Tests

| Pieza | Test | Molde |
|---|---|---|
| `checkDniAction` | `tests/asociate-dni-check.test.ts` nuevo: orden de guardas (interruptor, proceso, `allows` sin cobrar, captcha antes del formato, formato inválido no cobra, `record` recién antes del padrón), veredictos, **sin asiento de auditoría**, sin fuga de ids | `tests/reempadronate-lookup.test.ts` (16 casos, es el precedente exacto) |
| `dniCheckVerdict` | Tabla de casos pura (precedencia heredada de `checkEligibility`, enmascarado, `pendingCount`, reingreso indistinguible de desconocido) | `tests/application-eligibility.test.ts` |
| `maskedName` mudada | `tests/reregistration-rules.test.ts` pasa **sin tocarse** (re-export) | — |
| Refactor de la carga | `tests/create-application-action.test.ts` pasa **sin tocar una aserción** | — |
| Marco del wizard | `tests/asociate-wizard-client.test.ts` (matching literal sobre la fuente): se ajusta **solo si** un literal legítimamente movido lo rompe; el bloque del `replaceState` no se toca | — |
| Renumeración | Sin cobertura jsdom en el repo (vitest corre en node): **verificación manual con el dev server** — recorrido completo de los 6 pasos, un retome real entrando en 5 y 6, y las seis pantallas de veredicto | criterio de aceptación §11 |

---

## 9. Documentación a actualizar

- `docs/05-flujos-funcionales.md`: el paso nuevo, su tabla de veredictos, y
  la renumeración del wizard (la tabla de bloqueos del paso de datos queda,
  anotando que ahora es la segunda línea de defensa).
- `docs/08-seguridad-y-privacidad.md`: enmienda al §minimización — ASOCIATE
  suma una consulta pública por DNI con nombre enmascarado, veredictos
  distinguibles y conteo de cuotas, detrás de captcha + 5/15 min
  (decisión del operador, 27/08/2026).
- `CLAUDE.md`: al cerrar el módulo, la sección de patrones si deja alguno
  nuevo (previsiblemente: "la carga de insumos de elegibilidad es una sola
  función para el chequeo y la creación").

---

## 10. Fuera de alcance

- Cambios a las reglas de elegibilidad o de reingreso (REG-04/05/16/25).
- Mostrar montos en pesos, o el detalle de qué períodos se deben.
- Auditar las consultas del paso 1.
- Persistir los chequeos del paso 1 (no se crea ninguna fila).
- Unificar los wizards de ASOCIATE y REEMPADRONATE más allá de `maskedName`.
- Pantallas de admin: nada del panel cambia.
- El caso "socio vigente que quiere recategorizarse": sigue siendo un trámite
  de `/mi/solicitudes` o de la sede, y la pantalla de vigente no lo ofrece
  (puede sumarse después como link, si el operador lo pide).

---

## 11. Criterios de aceptación

1. Un DNI desconocido llega del paso 1 al 2 sin fricción nueva más que el
   captcha, y completa el alta entera como hoy (verificado de punta a punta
   en local, rama de débito incluida en sandbox si se toca algo del paso 6 —
   que no debería).
2. Un socio vigente, un DNI con trámite vivo, un ex-socio con deuda, un
   expulsado y un rechazado reciente ven **su** pantalla del §3.2 en el paso
   1, sin haber cargado ningún dato personal.
3. El ex-socio habilitado (mudanza/renuncia/saldado) pasa el paso 1 **sin
   ninguna señal distinta** del DNI desconocido, y su solicitud se asienta
   como reingreso al aprobarla (como hoy).
4. `npm test` entero en verde, con `create-application-action.test.ts` y
   `reregistration-rules.test.ts` sin aserciones tocadas.
5. Un retome existente entra directo al paso 5 o 6 según documentos, y desde
   ahí no se puede navegar a los pasos 1-4.
6. `git diff --stat` no muestra ningún archivo de `src/lib/mp/*` ni
   `src/lib/treasury/*`.
7. Turnstile aparece y valida en el paso 1 y en el paso 4; agotar el cupo
   5/15 min del paso 1 no afecta el cupo 5/h de creación, y viceversa.
