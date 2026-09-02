# Llave `colaborador_habilitado` (lanzar antes de la IGJ): diseño aprobado

**Fecha:** 02/09/2026 · **Estado:** aprobado por el operador (cuatro decisiones + mecanismo)

El estatuto reformado (Asamblea Extraordinaria del 15/08/2026) **todavía no está
vigente**: la IGJ del Chubut no lo oficializó. La asociación quiere lanzar el
sitio igual. Lo único "grande" que depende de la reforma y no puede ofrecerse es
la categoría **socio colaborador** (Art. 5 bis: quien no vive en el barrio pero
acredita vinculación). Este módulo la apaga con una llave de configuración que la
Comisión prende el día que la IGJ apruebe, sin deploy, y cambia un rótulo que
afirma la vigencia del texto reformado. Nada más del sitio se toca.

---

## 1. Alcance

1. **Una llave nueva en `Configuration`**, `colaborador_habilitado`, hermana de
   `asociate_activo`: booleana, ausente cuenta como apagada, switch de superadmin
   en `/admin/configuracion` → Sitio público.
2. **Cierra DOS puertas a "colaborador"**: la rama "En otro barrio" del wizard
   ASOCIATE (paso 2) y el pedido de cambio de categoría del socio en
   `/mi/solicitudes`. Cada puerta tiene su guarda del lado del servidor, que lee
   la llave directo, y su pantalla, que lee la misma llave y muestra deshabilitado
   exactamente lo que la action rechaza.
3. **Un rótulo**: el eyebrow "Norma vigente" de `/mi/documentos` pasa a
   "Estatuto". Es código; la descripción del PDF la edita el operador desde
   `/admin/documentos`.

**Las puertas de admin quedan como están**: alta manual (`/admin/socios/nuevo`),
cambio de categoría de un socio, readmisión y recategorización de una solicitud
pendiente siguen ofreciendo colaborador. Son de la Comisión, que sabe qué
estatuto rige. **Fuera de alcance:** ver §9.

---

## 2. Decisiones del operador (02/09/2026)

| # | Decisión | Elección |
|---|---|---|
| 1 | Alcance de la llave | **ASOCIATE y `/mi/solicitudes`**. Las puertas de admin no se tocan |
| 2 | Paso 2 con la llave apagada | **Tarjeta "En otro barrio" visible pero deshabilitada**, con la línea "Por ahora, la asociación en línea es sólo para quienes viven en el Barrio Ciudadela." El vecino entiende por qué no sigue |
| 3 | Copy que cita el estatuto reformado | **Sólo el rótulo "Norma vigente"** de `/mi/documentos`. Las citas de artículos y los "90 días" quedan para que el operador las coteje contra el estatuto anterior (§9) |
| 4 | Mecanismo | **Clave en `Configuration`** con switch de superadmin. Se prende sin deploy. Descartadas: constante en código (exige deploy y la Comisión no puede sola) y variable de entorno (sin pantalla, y la caché pública no se invalida sola) |

---

## 3. La llave

- **Clave:** `colaborador_habilitado`, en `CONFIG_KEYS` como `collaboratorEnabled`,
  con docblock: existe porque la categoría es del estatuto reformado y el sitio se
  lanza antes de la oficialización; nombre en castellano por el precedente de
  `asociate_activo` y `elecciones_en_curso`.
- **Valor:** booleano JSON. `configReader.getBool` ya trata cualquier cosa que no
  sea `true` como `false`, así que **ausente = apagada**: en producción no hay que
  sembrar nada, y el sitio nace cerrado para colaboradores. No hay migración ni
  seed.
- **Lector cacheado:** `getCollaboratorEnabled` en `src/lib/config.ts`, con
  `unstable_cache` y el tag `CACHE_TAGS.config`, para la página `/asociate` y la
  de retome (`revalidate = 3600` + tag). `updateConfigAction` ya llama
  `updateTag(CACHE_TAGS.config)`, así que guardar el switch cambia la página
  pública al instante.
- **Lecturas directas:** toda guarda lee con `configReader.getBool`, sin caché,
  por el mismo motivo que `asociate_activo` (docs/05 §2): un `true` viejo dejaría
  crear una solicitud después de apagar.

---

## 4. Servidor: la regla pura y las dos guardas

### 4.1 ASOCIATE

- Una función pura NUEVA, `categoryOfferedOnWeb(category, livesInBarrio,
  collaboratorEnabled)` (`src/lib/applications/wizard.ts`), compone REG-01 con
  la llave: primero `categoryAllowedForResidence` y después, si la categoría es
  colaborador, la llave. Tercer parámetro obligatorio, sin default: cada
  llamador decide qué llave leyó. Ciudadela → `active | adherent`, sin cambio.
  Otro barrio → `collaborator` **sólo si `collaboratorEnabled`**; apagada, otro
  barrio no admite ninguna categoría. **`categoryAllowedForResidence` queda
  intacta** (ver la enmienda de §11): la usan cuatro pantallas del panel para
  avisar de un desajuste de residencia, y ninguna se gatea.
- `createApplicationAction` lee la llave directo y llama la regla **una vez**.
  Si el veredicto es `false`, el mensaje se elige por causa: con otro barrio,
  `requestedCategory === "collaborator"` y la llave apagada, "Por ahora, la
  asociación en línea es sólo para quienes viven en el Barrio Ciudadela."; en
  cualquier otro caso (incluido un POST a mano que pida colaborador viviendo en
  Ciudadela), el mensaje de REG-01 que ya existe. La guarda va donde hoy
  está la revalidación de REG-01 (después de zod, antes de la fecha de
  nacimiento); no es "guarda 0" porque depende de los datos parseados.
- `checkDniAction` (paso 1) no cambia: no hay categoría todavía.
- `src/app/admin/solicitudes/actions.ts` (recategorización, admin) pasa `true`
  con un comentario: la puerta es de la Comisión y el desajuste de residencia
  sigue siendo **auditado, no bloqueante**, como hoy.

### 4.2 `/mi/solicitudes`

- La constante `REQUESTABLE_CATEGORIES` de `src/lib/members/member-requests/rules.ts`
  pasa a ser la función pura **`requestableCategories(collaboratorEnabled)`**:
  `["active", "adherent"]` más `"collaborator"` sólo con la llave prendida.
  `canCreateRequest` recibe `collaboratorEnabled` en su input y valida con esa
  misma función; el mensaje para colaborador con la llave apagada es "Por ahora
  no se puede pedir el pase a socio colaborador."
- El servicio de solicitudes (`memberRequests.create`) lee la llave directo en el
  mismo lugar donde ya lee `elecciones_en_curso` y la pasa a la regla.
- El `z.enum` de `createCategoryRequestAction` valida la **forma** contra el
  superconjunto (`ALL_REQUESTABLE_CATEGORIES`, las tres); la regla decide el
  fondo. Así el rechazo por llave lleva su mensaje y no un "Elegí la categoría
  nueva" genérico.

---

## 5. Cliente: las tres pantallas

### 5.1 Paso 2 de ASOCIATE ("¿Dónde vivís?")

- `ChoiceCard` (`wizard-ui.tsx`) gana `disabled?: boolean`: el `<input
  type="radio">` va `disabled`, el `<label>` pierde `cursor-pointer` y el hover,
  y se atenúa por la superficie y el control (`border-dashed bg-muted/40`,
  `cursor-not-allowed`, radio e ícono al 50 %), **nunca por el texto**: la
  línea que explica el motivo es el único aviso que recibe el vecino y se queda
  a contraste pleno (enmienda de §11). El foco y el `has-[:focus-visible]` no
  cambian para las tarjetas habilitadas. `ChoiceCard` la importan también el
  paso 3 de ASOCIATE, los dos pasos de REPORTES y `/mi/solicitudes`: la prop es
  opcional y aditiva, y sin ella nada cambia.
- `AsociateWizard` recibe `collaboratorEnabled: boolean` (obligatoria) y se la
  pasa a `StepResidence`. `/asociate/page.tsx` y `/asociate/retomar/[token]/page.tsx`
  la leen con `getCollaboratorEnabled()`; en el retome no se ve (entra en el paso
  5), pero la prop es obligatoria a propósito para que nadie la olvide.
- Con la llave apagada, la tarjeta "En otro barrio" va `disabled` y su texto
  pasa de "Podés solicitar el ingreso como socio colaborador." a "Por ahora, la
  asociación en línea es sólo para quienes viven en el Barrio Ciudadela.". El
  título, el `fieldset`, la validación de `next()` y `chooseBranch` no cambian:
  un radio deshabilitado no dispara `onChange`.
- **Nada más del wizard cambia.** El paso 3 conserva la tarjeta informativa de
  colaborador, el paso 5 su anexo obligatorio y el paso 6 su rama con débito:
  son la implementación que se prende con la llave, no código muerto.

### 5.2 Configuración → Sitio público

- Un segundo switch debajo del de ASOCIATE, mismo componente visual:
  **"Categoría socio colaborador habilitada (Art. 5 bis)"**, ayuda: "Apagada,
  ASOCIATE sólo admite a quienes viven en el barrio y el socio no puede pedir
  el pase a colaborador. Prendela cuando la IGJ oficialice el estatuto
  reformado."
- `ConfigFormInitial`, `GROUPS` (pestaña "Sitio público"), el schema de
  `updateConfigAction` (`z.literal("on").optional()`) y la lista de `entries`
  suman la clave. La escritura sigue siendo una sola transacción.
- La tira de estado suma la fila "Socio colaborador: Habilitado / Deshabilitado"
  con `warning: false`: apagada es el estado esperado hasta la IGJ, y ninguna
  pantalla nace en rojo.

### 5.3 `/mi/solicitudes` y `/mi/documentos`

- `CategoryRequestForm` deja de importar la constante y recibe
  `requestable: MemberCategory[]` desde la página, que lo arma con
  `requestableCategories(await configReader.getBool(...))` (el panel lee
  directo). Las tarjetas son `requestable` menos la categoría actual; nunca queda
  vacío (un colaborador existente sigue pudiendo pedir activo o adherente).
- `/mi/documentos`: el eyebrow y el `aria-label` "Norma vigente" pasan a
  "Estatuto"; el comentario del código deja de decir "la norma vigente".

---

## 6. Bordes y lo que NO cambia

- **Apagar no frena lo ya empezado.** Una solicitud de colaborador creada con la
  llave prendida sigue por el retome (pasos 5-6 no chequean la llave), igual que
  con `asociate_activo`. En producción no existe ninguna.
- **Un socio que YA es colaborador** no se ve afectado: la llave gobierna qué se
  puede *pedir*, no qué se *es*.
- **Sin migración, sin seed, sin variable de entorno, sin línea de crontab.**
- **`src/lib/treasury/*` y `src/lib/mp/*` no se tocan** (colaborador comparte
  plan y monto con adherente; `changesFeeAmount` no cambia). Se verifica con
  `git diff --stat`, no de memoria.
- La portada no cambia: su CTA es de ASOCIATE entero. `/reempadronate` no cambia:
  su cohorte es de adherentes y no toca categoría.

---

## 7. Tests

- `tests/application-wizard.test.ts`: la regla con la llave en los dos estados
  (otro barrio + colaborador: `false` apagada, `true` prendida; Ciudadela igual
  en ambos). **Verificación por mutación** durante la implementación: borrar la
  guarda y ver el test en rojo, después restaurar.
- `tests/create-application-action.test.ts`: POST de colaborador con la llave
  ausente → el mensaje "Por ahora…" y ninguna solicitud creada; con la llave en
  `true` los tests de colaborador que ya existen siguen pasando (la fixture
  agrega la clave). Un POST a mano con `livesInBarrio=no` y `active` sigue
  cayendo por REG-01 con su mensaje.
- `tests/member-requests-rules.test.ts` y `tests/mi-solicitudes-actions.test.ts`:
  colaborador rechazado con la llave apagada y aceptado con la prendida; `cadet`
  sigue rechazado en ambos.
- `tests/config.test.ts`: la clave expuesta con su nombre. `tests/config-actions.test.ts`:
  el switch escribe `true` marcado y `false` destildado, en la misma transacción.
- `tests/asociate-wizard-client.test.ts` (tests de fuente, sin jsdom): el paso 2
  pasa `disabled={!collaboratorEnabled}` a la tarjeta y contiene la línea nueva;
  `ChoiceCard` declara la prop.

---

## 8. Documentación a actualizar

- `docs/02-marco-estatutario.md`: nota al inicio, debajo de "pendiente de
  oficialización": el sitio se lanza ANTES con la categoría colaborador apagada
  por `colaborador_habilitado`.
- `docs/05-flujos-funcionales.md` §2: precondición, paso 2 (la tarjeta
  deshabilitada), paso 3 ("única opción COLABORADOR" sólo con la llave), orden de
  guardas del paso 4; §5 `/mi/solicitudes`; §6 Configuración (la clave nueva).
- `docs/07-plan-de-etapas.md`, "Lanzamiento": el checklist suma "prender
  `colaborador_habilitado` cuando la IGJ oficialice" y "actualizar la descripción
  del estatuto en `/admin/documentos`".
- `CLAUDE.md`: prioridad actual y una línea en el bloque de `Configuration`.
- Docblock de `CONFIG_KEYS.collaboratorEnabled`.

---

## 9. Fuera de alcance (para que el operador lo coteje contra el estatuto anterior)

Copy que afirma reglas del texto reformado como vigentes. No se sabe desde el
código si el estatuto anterior ya las tenía; se listan para que el operador
decida y las pida aparte:

- "El voto rige a los 90 días de tu fecha de ingreso" (paso 3 y pantalla de
  estado de ASOCIATE; el voto del adherente es rasgo del texto reformado).
- "La cuota de ingreso equivale a un mes de cuota (Art. 5)" en el paso de pago,
  y las citas del borrador de Términos y Condiciones sembrado (editable desde
  `/admin/configuracion`).
- "Conforme al estatuto, un socio expulsado no puede reingresar" (`eligibility.ts`).
- "Art. 2 inc. g" como eyebrow permanente de `/reportes`; "Art. 6" en el flujo y
  el email de reportes.
- "Art. 5° ter" en `/mi/solicitudes` y en las reglas de cambio de categoría.
- El PDF de `/mi/documentos` es el texto reformado: la descripción la actualiza
  el operador desde `/admin/documentos`.

También fuera: esconder colaborador en las pantallas de admin, y cualquier
mecanismo de fecha o cuenta regresiva de la IGJ (la llave se prende a mano).

---

## 10. Criterios de aceptación

1. Con la clave ausente en `Configuration`, `/asociate` muestra "En otro barrio"
   deshabilitada con la línea nueva, y un POST armado a mano con colaborador
   devuelve el mensaje "Por ahora…" sin crear la solicitud.
2. Con la llave prendida desde `/admin/configuracion`, la misma tarjeta se
   habilita sin deploy ni reinicio y el alta de colaborador vuelve a funcionar
   entera (paso 3, anexo, débito), byte-idéntica a la de hoy.
3. Con la llave apagada, `/mi/solicitudes` no ofrece Colaborador y la action lo
   rechaza con su mensaje; prendida, lo ofrece y lo acepta.
4. `/mi/documentos` ya no dice "Norma vigente".
5. La suite completa en verde; `git diff --stat` sin archivos de
   `src/lib/treasury/*` ni `src/lib/mp/*`; sin migración nueva.
6. Verificación y auditoría final (pedido explícito del operador): suite,
   `tsc`, lint, build, auditoría del diff contra la lista de archivos del plan,
   revisión de código y prueba en el navegador con la llave en los dos estados,
   con informe escrito. Sin eso el módulo no se declara cerrado.

---

## 11. Enmiendas de implementación (02/09/2026, al escribir el plan)

- **La regla pura es una función nueva, no un tercer parámetro.** Al escribir
  el plan apareció que `categoryAllowedForResidence` tiene **seis** llamadores y
  no dos: además de la creación pública y la recategorización de admin, la usan
  la cola de solicitudes (`applications/query.ts`, con su test), la página de la
  bandeja y `decision-forms.tsx`, que es un componente **cliente** y no puede
  leer configuración. Un tercer parámetro obligatorio habría obligado a los
  cinco del panel a pasar `true` a mano, o a un default que la spec quería
  evitar. La solución que preserva la intención —una sola regla pura, testeada
  por mutación, para todo lo público— es `categoryOfferedOnWeb`, que **compone**
  REG-01 con la llave y deja `categoryAllowedForResidence` intacta como regla
  estatutaria del panel. §4.1 quedó redactada así.
- **La tarjeta deshabilitada no atenúa el texto.** La primera implementación
  aplicó `opacity-60` a la tarjeta entera, como decía §5.1, y la revisión midió
  la línea del motivo en 2,3:1 sobre blanco (AA exige 4,5:1): el único aviso que
  recibe el vecino quedaba ilegible. La atenuación pasó a la superficie y al
  control (`border-dashed bg-muted/40`, radio e ícono al 50 %) y el texto se
  queda a contraste pleno; un test de fuente fija que `opacity-60` no vuelva.
  §5.1 quedó redactada así.
- **Auditoría ampliada del diff (pedido del operador, 02/09/2026).** Además de
  `src/lib/treasury`, `src/lib/mp` y `prisma`, la verificación final comprueba
  que la rama no toca `admin/tesoreria`, los webhooks, los crons, los recibos,
  `/mi/debito`, `/mi/pagar` ni los módulos de débito del socio, y que ninguna
  línea agregada nombra piezas del circuito de pagos o suscripciones.
