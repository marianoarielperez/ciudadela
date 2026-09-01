# ASOCIATE: rediseño visual y de copy — la admisión la resuelve la Comisión

**Fecha:** 01/09/2026 · **Estado:** spec aprobada por diseño (mockup aprobado por el operador el 01/09/2026)
**Mockup aprobado:** artifact "Rediseño ASOCIATE" · **Informe base:** artifact "Todavía no sos socio" (auditoría de 4 agentes, 31/08/2026)

## 1. Contexto y problema

El acta marco de admisión digital de REG-12 (`docs/02`) **nunca se dictó**: hoy no hay respaldo
para la "aceptación automática" de quien se asocia por la web. La auditoría encontró que:

- El **modelo de datos ya hace lo correcto**: `Member`, número de socio y `User` nacen los tres
  dentro de la transacción del asiento en acta (`record.ts`). Nadie es socio antes del acta y
  `/mi` es inalcanzable. **Nada de eso se toca.**
- El **léxico afirma lo contrario** en dos textos de cara al vecino: la pantalla post-pago
  (`application-status.tsx:93-97`: "¡Bienvenido/a!" + "Tu solicitud fue aceptada" en caja verde)
  y el correo que dispara el webhook (`templates.ts:236-251`: asunto "¡Tu solicitud fue aceptada!").
- En la rama con débito, "Comisión Directiva" **no aparece ni una vez antes del pago**.

Decisiones del operador que encuadran el trabajo (01/09/2026):

- El acta marco se redactará como resolución interpretativa del Art. 5 (Art. 23 inc. b, ad
  referéndum). **El sistema no promete aceptación automática hasta que exista.**
- Cuota de ingreso ante rechazo: **retención total** (lo que el sistema hace hoy), a asentar en el acta.
- El estatuto reformado estará oficializado por la IGJ en ~15 días, sin objeciones.

## 2. Objetivo

Que quede **inequívoco en todas las superficies** que quien completa el wizard y paga la cuota
de ingreso todavía no es socio: la admisión la resuelve la Comisión Directiva y el alta se
asienta en acta. **Solo cambios visuales y de texto. Cero cambios de lógica, flujo, estados,
datos o pagos.**

## 3. Decisiones de diseño (todas aprobadas explícitamente)

| Decisión | Elección |
|---|---|
| Firma visual | **Stepper de proceso**: el stepper muestra el camino completo "Tu solicitud → La Comisión resuelve → Alta en acta", visible en los 6 pasos |
| Pantalla post-pago | **Línea de tiempo** del trámite (verde cumplido / celeste en curso "Estás acá" / gris futuro) |
| Piezas | **Callout público nuevo** (calcado del banner de veredicto de `/admin/salud`) + **`kind="info"` ADITIVO** en `FormMessage` |
| Etapas post-formulario | "La Comisión resuelve" → "Alta en acta" (verbos del Art. 5 inc. 7) |
| Tono del aviso de admisión | **Celeste institucional, no rojo** (rojo = error del sistema; ámbar = dinero; esto es una regla del trámite) |
| Botón de pago | "Pagar y enviar mi solicitud" |
| Leyenda del recibo | Versión completa (dos frases, ver §6.4) |
| REEMPADRONATE | **No se toca**; la divergencia de primitivas se anota en CLAUDE.md |
| Mockup | Aprobado antes de implementar (01/09/2026) |

Restricciones heredadas del sistema (medidas por los agentes, no opiniones):

- Light-only: el sitio público no renderiza en oscuro; sin variantes `dark:`.
- `#2E9BDF` solo decorativo; todo lo accionable e informativo va `--primary #0079BC`.
- Verde/ámbar solo por tokens `--success`/`--warning`.
- Geist + Geist Mono únicas familias (CSP: `font-src 'self'`). Eyebrows/montos en mono.
- Targets ≥44px (`CONTROL_HEIGHT` h-12 en el wizard), `FOCUS_RING` en todo control,
  `motion-reduce` en toda animación, íconos lucide siempre `aria-hidden` con el dato en texto.

## 4. Piezas nuevas

### 4.1 `ProcessRail` — `src/app/(public)/asociate/process-rail.tsx`

Reemplaza el stepper inline de `asociate-wizard.tsx:377-399`. Composición:

- Eyebrow: `Paso {n} de 6 · Tu solicitud` — clases actuales **+ `font-mono`** (queda idéntico a
  la firma de `/ubicacion` y `/actividades`).
- Tramo 1 (flex ~58%): etiqueta "Tu solicitud" + la barra de progreso ACTUAL
  (`h-1.5 rounded-full bg-muted` / relleno `bg-primary transition-[width] motion-reduce:transition-none`).
- Conector fino → punto con ícono `Landmark` + etiqueta "La Comisión resuelve" (borde `border`,
  texto `muted-foreground`).
- Conector fino → punto con ícono `Stamp` + etiqueta "Alta en acta" (ídem).
- Todo el rail `aria-hidden` (como la barra actual). Debajo, UNA frase `sr-only` estática:
  "Después de enviar tu solicitud, la resuelve la Comisión Directiva y el alta se asienta en acta."
  El `role="status"` existente que anuncia el cambio de paso **no cambia** (anunciar la frase en
  cada paso sería ruido para lector de pantalla).
- El `h1` del paso conserva `headingRef`/`tabIndex={-1}`/foco al montar, y gana un chip de ícono
  (`size-9 rounded-lg bg-primary/10 text-primary`, el gesto del tablero `/admin`) con el ícono
  del paso: 1 `IdCard`, 2 `MapPin`, 3 `Users`, 4 `UserRound`, 5 `FileText`, 6 `CreditCard`.

### 4.2 `Callout` — `src/components/public/callout.tsx`

Aviso con ícono y borde lateral, calcado de `VERDICT_STYLE` (`health-panels.tsx:103-160`):
`rounded-xl border border-l-4 p-4` + fila `flex items-start gap-3` + ícono `mt-0.5 size-5 shrink-0`.
Tonos: `info` (`border-l-primary bg-primary/5`), `warning`, `success`. Props:
`{ tone, icon, role?, id?, inset?, children }`. La variante `inset` (para vivir dentro de otro
recuadro, como la cabecera de la boleta del paso 6) suprime `rounded-xl border border-l-4` y
usa `border-b-2` del tono — misma pieza, dos pieles. **No se modifica `health-panels.tsx`**:
es una pieza nueva.

### 4.3 `FormMessage` `kind="info"` — cambio ADITIVO en `src/components/admin/form-message.tsx`

Quinto kind: texto `text-primary` (4,71:1, el mismo que los links), caja
`border-primary/40 bg-primary/5`. `role` derivado: sin anuncio (como `neutral`), salvo
`role` explícito. **Los cuatro kinds existentes no cambian ni una clase** — el panel entero y
los 8 archivos del wizard que lo importan quedan intactos salvo donde esta spec dice usar `info`.

### 4.4 `TramiteTimeline` — `src/app/(public)/asociate/tramite-timeline.tsx`

`ol` con línea vertical y puntos de estado, del patrón de `/ubicacion` (`ol border-l` + punto
absoluto) más los estados de `step-documents` (check verde). Estados por hito: `done` (disco
`bg-success` con check blanco), `now` (anillo `border-primary`, ícono primary, chip
"Estás acá" en mono `bg-primary/10 text-primary`), `next` (anillo `border-border`, gris).
La usan la pantalla post-pago, la de `pending_board` y la de sondeo del pago.

## 5. Cambios pantalla por pantalla (copy final)

Regla transversal de vocabulario (del estatuto, Art. 5): la persona es "vos"; la cosa es
"tu solicitud"; el verbo del órgano es **"resolver"** (nunca "tratar"); "socio/a" solo para
quien ya fue admitido. Prohibidas antes del acta: "aceptada", "bienvenido", "socio", "tu número".

### 5.1 Marco (`asociate-wizard.tsx`)

- `STEP_TITLES`: 3 pasa a **"¿En qué categoría querés asociarte?"**; 6 pasa a
  **"Pago y envío de tu solicitud"**; el resto queda.
- `AnsweredTrail`: la etiqueta "Categoría" pasa a **"Categoría solicitada"**.
- Stepper inline → `<ProcessRail step={n} />`.

### 5.2 Paso 2 (`step-residence.tsx`)

- Subtítulo nuevo bajo el h1: "De tu domicilio depende en qué categorías podés solicitar el ingreso."
- Tarjetas: "Podés **solicitar el ingreso** como socio activo o adherente." /
  "Podés **solicitar el ingreso** como socio colaborador."

### 5.3 Paso 3 (`step-category.tsx`)

- Subtítulo: "La categoría se solicita: la admisión la resuelve la Comisión Directiva."
- Las TRES tarjetas abren derechos con **"Si la Comisión te admite:"** (span `text-primary font-semibold`):
  - Activo (ícono `Vote`): "Si la Comisión te admite: voz y voto en las asambleas, y podés
    ocupar cargos. El voto rige a los 90 días de tu fecha de ingreso."
  - Adherente (ícono `Heart`): "Si la Comisión te admite: voz en las asambleas y votás en las
    elecciones, también a los 90 días del ingreso."
  - Colaborador (tarjeta fija, ícono `Handshake`): "Si la Comisión te admite: participás como
    socio colaborador. Es la categoría que corresponde a quienes viven fuera del barrio." (+ el
    aviso de acreditación existente, sin cambios).
- Upsell a activo → `FormMessage kind="info"`: "Por {monto} al mes podés **solicitar el ingreso
  como socio activo**, la categoría con voz y voto en las asambleas." Botón igual.
- Pregunta del débito y sus dos tarjetas: sin cambios ("Tu solicitud pasa igual a la Comisión
  Directiva" ya es correcto).

### 5.4 Paso 6 (`step-payment.tsx`)

Rama con débito — la boleta pasa a tres cuerpos dentro del mismo recuadro `border-2 rounded-xl`:

1. **Cabecera institucional** (nueva, `Callout tone="info"` sin bordes propios: fila
   `bg-primary/5` con `border-b-2 border-primary/35`, ícono `Landmark`, `role="note"`,
   `id="aviso-admision"`):
   > **Pagar no te convierte en socio/a.** La admisión la resuelve la Comisión Directiva en su
   > próxima reunión, y puede no hacer lugar a tu solicitud.
2. Las dos filas de importes actuales (la segunda se rotula "Cuota mensual de la categoría
   {activo|adherente|colaborador}").
3. **Franja ámbar** (misma construcción actual, texto nuevo):
   > El estatuto pide abonar la cuota de ingreso —equivale a un mes de cuota— para poder ser
   > admitido (Art. 5). Según los términos que aceptaste, **no se devuelve**, cualquiera sea el
   > resultado. Luego se debita la cuota mensual.
   (Nota deliberada: NO se menciona la "mensual adelantada" del Art. 5 inc. 6 porque el flujo
   no la cobra por separado — el texto describe lo que el sistema hace, no inventa un cargo.)
- Párrafo: "Te llevamos a Mercado Pago para que autorices el débito. Cuando vuelvas te
  confirmamos que el pago entró; el resultado de tu solicitud te lo avisamos por correo cuando
  la Comisión la resuelva."
- Botón: **"Pagar y enviar mi solicitud"**, con `aria-describedby="aviso-admision"`.
  `pendingLabel`s actuales quedan.

Rama sin débito: recuadro actual; el cuerpo pasa a: "Elegiste no adherir al débito automático
de la cuota voluntaria, así que no te vamos a cobrar nada. **Todavía no sos socio/a**: la
Comisión Directiva va a **resolver** tu solicitud en su próxima reunión y te avisamos el
resultado por email."

### 5.5 Pantallas de estado (`application-status.tsx`)

**`approved_pending_minute`** (la crítica):

- `h1`: **"Tu solicitud quedó completa"** (conserva foco al montar).
- `FormMessage kind="info" box`: "Recibimos tu pago, {nombre}. **Ya cumpliste todos los
  requisitos del estatuto** para pedir el ingreso a la vecinal."
- `TramiteTimeline`:
  1. `done` — "Solicitud completa y pago acreditado" / "Te enviamos por correo el recibo de la
     cuota de ingreso." (sin monto: la pantalla no lo tiene y no se agrega plumbing)
  2. `now` (`Landmark`) — "La Comisión Directiva resuelve" + chip "Estás acá" /
     "**Todavía no sos socio/a.** La admisión se resuelve en la próxima reunión (Art. 5 del
     estatuto) y te avisamos el resultado por correo."
  3. `next` (`Stamp`) — "Alta en acta" / "Si te admiten, la fecha del acta es tu fecha de
     ingreso — y desde ahí corren los 90 días para votar en asambleas y elecciones."
- Cierre: el párrafo de verificación de email actual, con "apenas se asiente tu alta" →
  "si tu alta se asienta".
- Desaparecen: "¡Bienvenido/a, {nombre}!", la caja verde `success` y "El alta formal se asienta…".

**`pending_board`**: mismo armado con timeline (hito 1 `done` "Solicitud presentada"; hito 2
`now` ídem; hito 3 `next` ídem). `h1` "Recibimos tu solicitud" queda; la caja verde
"quedó enviada" pasa a `kind="info"` "Tu solicitud quedó **presentada**."; "la va a tratar" →
"la va a resolver".

**`pending_payment` (sondeo)**: conserva títulos, mensajes de error y botones actuales; suma la
timeline con hito 1 `now` + spinner existente ("Estamos confirmando tu pago") y hitos 2-3 `next`.

**`expired` y `resolved`**: sin cambios.

### 5.6 Landing y metadata (`asociate/page.tsx`)

- Meta description: "…en cinco pasos." → "…en línea, en seis pasos."
- Las pantallas de cierre (suspendido/re-empadronamiento) no cambian.

### 5.7 Paneles de DNI y bloqueo (`dni-result-panel.tsx`, `blocked-panel.tsx`)

La auditoría los clasificó 🟢: **sin cambios de copy ni estructura** (heredan solo lo global).

## 6. Emails y recibo

### 6.1 `applicationAcceptedEmail` (`templates.ts:236-251`) — texto nuevo, MISMA función

Se conserva el nombre exportado y la firma `(name)` para **no tocar `webhook-processor.ts` ni
una línea**. Docstring nuevo: deja de citar REG-12; explica que es el acuse de solicitud
completa (el nombre de la función es histórico).

- Asunto: **"Recibimos tu solicitud y tu pago — Vecinal Ciudadela"**
- Cuerpo (título H2 "Recibimos tu solicitud y tu pago"):
  > Hola {nombre}:
  >
  > Registramos tu solicitud de asociación y acreditamos el pago de la cuota de ingreso. El
  > recibo te lo enviamos en un correo aparte.
  >
  > **Con esto tu solicitud quedó completa, pero todavía no sos socio/a de la vecinal.** La
  > admisión la resuelve la Comisión Directiva en su próxima reunión y queda asentada en acta
  > (Art. 5 del estatuto). La fecha de esa acta será tu fecha de ingreso.
  >
  > La Comisión puede no hacer lugar a la solicitud. Si eso pasa, según los términos que
  > aceptaste la cuota de ingreso no se devuelve, damos de baja tu débito automático en
  > Mercado Pago y podés volver a presentarte a los seis meses.
  >
  > Mientras tanto tu débito queda autorizado. Te avisamos el resultado por este mismo medio.
  >
  > Te enviamos aparte un correo para verificar tu dirección de email: confirmala para poder
  > recibir el acceso al portal de socios si tu alta se asienta.

### 6.2 `applicationReceivedEmail` (`templates.ts:254-266`)

Segundo párrafo pasa a: "Tu solicitud de asociación fue recibida. **Todavía no sos socio/a**:
la va a **resolver** la Comisión Directiva en su próxima reunión y te avisamos el resultado por
este medio." (resto igual).

### 6.3 Etiqueta del panel (`src/lib/applications/labels.ts:9`)

`"Aceptada — pendiente de acta"` → **`"Completa — pendiente de resolución"`**. Un string; el
enum y todo el orden de la cola quedan.

### 6.4 Leyenda del recibo de cuota de ingreso (PDF + email del recibo)

**Texto aprobado (completo):**
> Este comprobante acredita el pago de la cuota de ingreso. No acredita la condición de
> socio/a, que se adquiere con la resolución de la Comisión Directiva asentada en acta.

- **Condición**: el recibo es de cuota de ingreso (`type === "entry"`) **y** no hay socio
  asentado (sin `memberId`/número de socio) — es decir, exactamente el camino
  `sendToApplication` que ya existe en `receipt-email.ts:54-65` y la rama sin
  `(socio N° …)` que ya existe en `receipt-pdf.ts`.
- En el **email del recibo**: un párrafo al final del cuerpo, solo en ese camino.
- En el **PDF**: una línea adicional junto al pie existente ("Comprobante interno…"), solo en
  ese caso. La condición se decide donde ya se decide el camino de envío/render — **sin nuevas
  consultas ni cambios de firma públicos** más allá de un parámetro/campo opcional interno.
- **Guarda de no-regresión**: tests que aseguren que un recibo de socio asentado (cuota social
  o entry post-acta) sale **sin** la leyenda y con el contenido de siempre, y que el de
  ingreso pre-acta la lleva. La suite entera de tesorería debe pasar sin tocar ninguna otra
  aserción.

## 7. Qué NO se toca (lista de exclusión dura)

- `src/app/(public)/asociate/actions.ts` — cero cambios.
- `src/lib/mp/**` (webhook, processor, resolve, gateway) — cero cambios.
- `src/lib/applications/record.ts`, `query.ts`, `summary.ts`, `cron.ts` — cero cambios.
- `src/lib/treasury/**` salvo la leyenda condicional de §6.4 (`receipt-email.ts`,
  `receipt-pdf.ts`) — y ahí, solo texto condicional.
- `prisma/**` — sin migraciones, sin cambios de schema ni de seed.
- El wizard REEMPADRONATE (`src/app/(public)/reempadronate/**`) — cero cambios; divergencia
  anotada en CLAUDE.md.
- Los cuatro `kind` existentes de `FormMessage` y todo consumidor del panel.
- Todo el aparato de foco/accesibilidad medido del wizard (headingRef, role=status,
  fieldset/legend, aria-describedby de errores, select nativo).

## 8. Verificación (pedido explícito del operador: no romper nada)

1. **Suite completa** antes y después (`npm test`): verde. Las únicas aserciones que se
   actualizan son las que fijan los strings cambiados a propósito
   (`tests/application-emails.test.ts` — `toMatch(/aceptada/i)` — y el título del test del
   webhook en `tests/mp-webhook-processor.test.ts`; se listan en el plan una por una).
2. **Tests nuevos**: `kind="info"` de FormMessage; leyenda del recibo (presencia/ausencia por
   caso); `ProcessRail`/`TramiteTimeline` (render y accesibilidad básica).
3. **`tsc` + lint + `next build`** limpios.
4. **Verificación visual en dev server** (Browser pane): recorrer los 6 pasos con las cuatro
   ramas (activo / colaborador / adherente con y sin débito), las pantallas de estado
   (forzándolas con datos sembrados en local — permitido por la política de datos de prueba),
   y screenshot de cada una. Sin consola en rojo.
5. **`git diff --stat` final** contra la lista de exclusión de §7: ningún archivo fuera de la
   lista de alcance.

## 9. Fuera de alcance (sugerencias anotadas, no se implementan ahora)

- **Correo propio de "alta asentada"** con la bienvenida real ("¡Bienvenido/a! Sos socio/a
  N° X desde el DD/MM/AAAA", nombrando el acta por tipo y número). La bienvenida NO puede
  mudarse al `invitationEmail` existente: esa plantilla también le llega a socios antiguos que
  recién crean su acceso, y darles la bienvenida sería incorrecto. Requiere un call-site nuevo
  en el asiento — flujo, no copy — y queda para otra tanda.
- **Variante de `verificationEmail` para solicitantes** (hoy dice "en el padrón de socios" y
  promete acceso "apenas confirmes", falso en el alta). Decidido posponer (ronda 1).
- **Aviso de vencimiento de la solicitud** (el cron expira en silencio).
- Unificar las primitivas del wizard con REEMPADRONATE cuando ese flujo se reabra.
- Al dictarse el acta marco: revisar si la Comisión quiere reintroducir un lenguaje de
  aceptación anticipada (esta spec deja el sistema correcto CON o SIN acta marco).
