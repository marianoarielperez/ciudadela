# Módulo 4 — Fase 4C: crons, notificaciones, salud y padrón electoral

**Fecha**: 23/08/2026 · **Estado**: aprobada por el operador (dos rondas de decisiones,
23/08/2026) · **Base**: `main` con 4B desplegada en producción
**Análisis previo**: cinco informes en `.superpowers/sdd/4c-analysis-*.md`
(notificaciones, crons-devengo, deuda-mora, salud, deudas). Las afirmaciones
`archivo:línea` de esta spec salen de ahí y fueron verificadas el 23/08/2026.

---

## §1. Objetivo

Cerrar el ciclo operativo mensual de Tesorería sin intervención manual: que la deuda
se devengue sola, que los vencimientos se avisen solos, que la Comisión reciba un
resumen diario, que los fallos dejen rastro visible y reintentable, y que el estado
del sistema se lea en una pantalla (`/admin/salud`) en vez de por SQL. Más el padrón
electoral (REG-31) y las deudas que 4B dejó anotadas.

**Fecha dura: el cron de devengo tiene que estar en producción antes del
01/10/2026.** El padrón cubre a todos hasta agosto 2026 y el import trajo sólo lo
impago: desde octubre, un socio al día se mostraría "al día" debiendo septiembre,
porque no hay fila que lo cuente. `coverageFloor` (4B) ya resuelve la imputación;
la deuda visible cuenta filas, y las filas las crea el devengo.

## §2. No entra en 4C

- Gestión de la elección (mesas, votos): el sistema sólo entrega el padrón (REG-31).
- El webhook de Brevo (`delivered`/`bounced` reales): `WebhookOrigin.brevo` queda
  declarado y sin ruta, como hasta ahora.
- Cola genérica de emails con reintento automático: el reintento es **por entidad**
  (modelo del botón del recibo), no una cola.
- El foco automático al campo con error en los formularios públicos (la parte M-L
  del arreglo de `parseForm`): entra sólo la parte S (§11.7).
- `AdminActor` con roles vivos y la migración a synced-fields (→ M5).
- Módulo 5 (portal del socio ampliado) y Módulo 6.

## §3. El modelo de devengo — normativo

Confirmado por el operador el 23/08/2026, con `deuda.xlsx` como evidencia:

1. La cuota del mes M **nace el 01/M** ("al cobro"): se puede pagar durante M.
2. Recién es **deuda/mora el 01/M+1**. "Si no pagó agosto hasta el 31/08 está al
   día; al 01/09 debe una cuota."
3. El padrón (`deuda.xlsx`, foto del 21/08/2026) cubre a todo socio hasta
   **2026-08 inclusive**; los agostos de los deudores están materializados por el
   import (verificado contra el archivo: los morosos completos de 2026 tienen 8 =
   enero..agosto).
4. **Decisión estructural (ronda 2)**: la fila de la cuota del mes M se materializa
   el **01/M+1** — cuando ya es mora. Consecuencia: los 21 puntos del código que
   cuentan filas `pending` (`4c-analysis-deuda-mora.md`) quedan semánticamente
   correctos **sin tocarse**. El socio al día paga el mes en curso o adelanta vía
   `coverageFloor` + `allocate`, que no necesitan fila. La cinta de la cuenta
   corriente no muestra el mes corriente como pendiente: se ve igual que hoy.

Corolario que el implementador no debe "corregir": que Deudores, niveles de mora,
cesantía y `debtAtWithdrawal` cuenten filas `pending` a secas **es correcto** bajo
esta decisión. No hay que enseñarles a distinguir períodos.

## §4. Cron de devengo — `POST /api/cron/accrual`

- **Crontab**: corre todos los días a las 00:30; **actúa sólo cuando el día civil
  argentino es 1** (la decisión adentro, como pide el CA de `docs/07`). El resto de
  los días responde 200 con `{skipped: "not_first_day"}` y **no** escribe `CronRun`
  (§8, D2: una corrida que decide no actuar no es una corrida).
- **Qué hace**: para cada socio de `ACCRUING_CATEGORIES` (`active`, `collaborator`
  — `rules.ts:34`; **el adherente no devenga**) con `status: "active"`, crea las
  cuotas `pending` con `origin: "accrual"` de todos los períodos desde
  `coverageFloor(socio)` hasta el **mes anterior** inclusive (`upTo = mes vencido`).
  El backfill es constitutivo, no opcional: si la primera corrida es en noviembre,
  crea septiembre Y octubre.
- **Regla pura**: `periodsToAccrue(member, upTo, existing): Period[]` en
  `treasury/rules.ts`, construida sobre `coverageFloor` — la MISMA función que
  decide a qué mes va un pago, así que devengo e imputación no pueden divergir.
  Tabla de casos sin Prisma, como todo `rules.ts`.
- **Datos**: `readmittedAt` se trae **en lote** (`groupBy` sobre `movements` tipo
  `readmission`), no una consulta por socio.
- **Idempotencia**: lectura previa de los períodos existentes (patrón del import,
  `import-deuda.ts:361-395`) **más** `createMany({skipDuplicates: true})` por la
  carrera con un pago simultáneo. El CA "correr dos veces el mismo día crea una
  sola cuota por socio" se cumple por el unique `(memberId, period)`.
- **Carrera con el webhook**: `service.ts:319-326` re-lanza cualquier P2002 que no
  sea de `mpPaymentId`; si un pago cae justo cuando el devengo escribe el mismo
  período, hoy sería 500 + reintento de MP. La tarea del devengo incluye tolerar
  ese P2002 del lado del **pago** (reintentar la allocation una vez dentro de
  `registerPaymentCore`) — es la única modificación permitida al núcleo de plata
  en esta fase, y lleva test propio.
- **No** manda emails, **no** necesita `fee_values` (la cuota no lleva monto —
  corregir los dos comentarios que dicen lo contrario: `periods.ts:56-59`,
  `fee-values.ts:44-46`).
- Summary: `{membersScanned, membersAccrued, feesCreated, backfilled, upTo,
  errors[], errorsOmitted}`. Escala hoy: 35 socios, ~35 filas la primera corrida.
- **Escotilla de re-disparo (enmienda del operador, 24/08/2026).** La guarda del
  día 1 deja el devengo sin forma de re-correrse: si la corrida del 01/10 falla
  —VPS caído a las 00:30, un hipo de la base—, recién vuelve a actuar el 01/11, y
  durante todo octubre los socios al día se muestran "al día" debiendo septiembre.
  Es el fallo exacto por el que esta fase tiene fecha dura. Por eso el endpoint
  acepta **`?force=1`** (y opcionalmente `?upTo=YYYY-MM`) detrás del mismo
  `CRON_SECRET` que ya lo protege: el operador re-dispara por SSH y la corrida deja
  su `CronRun` como cualquier otra. `run({ upTo })` ya existe y está testeado — es
  exponerlo en la ruta, no lógica nueva. Sin `force`, el comportamiento no cambia.

## §5. Recordatorio de vencimiento — `POST /api/cron/reminder`

- **Decisión (ronda 1)**: recordatorio ANTES de caer en mora; nada el día 1.
  **Enmienda avalada**: corre a diario (10:00) y actúa **el último día civil del
  mes** — no "el 30", que en febrero no existe y ese mes nunca avisaría.
- **Destinatarios**: socios devengantes (`active`/`collaborator`, vigentes) que
  **no** tienen la cuota del mes en curso cubierta (no existe `Fee(M, paid|exempt)`),
  con email utilizable. Texto: "tu cuota de septiembre vence mañana"; si además
  arrastra `pending` de períodos **anteriores**, se agrega la deuda total a valor
  vigente.
- **Corrección del 24/08/2026 — el piso de cobertura manda, igual que en el
  devengo.** Los dos criterios de arriba no alcanzan: el que ingresó (o reingresó)
  este mes **no** tiene `Fee(M)` de ninguna clase —su cuota de ingreso cubre el mes
  del alta (REG-14) y cuelga de la solicitud, no de una cuota— así que caía como
  candidato y recibía un reclamo por el mes que acababa de pagar. El cron aplica el
  MISMO `coverageFloor` que `periodsToAccrue` (`rules.ts`), con `readmittedAt`
  traído en lote desde el `Movement` de tipo `readmission` (REG-11: no se deriva de
  `joinedAt`): **si `coverageFloor(m) > período en curso`, no es candidato.**
- **Idempotencia persistida**: una fila `Notification` tipo `fee_reminder` (el
  enum ya lo reservó: `schema.prisma:157`) por socio y período; si existe, no se
  reenvía. La marca es en base, no en memoria: sobrevive al restart de PM2.
- **Los sin email** (decisión ronda 1): la pantalla Deudores gana el botón
  **"Lista para gestión manual"** — imprimible: nombre, N° de socio, deuda a valor
  vigente, teléfono si hay. Sin email en la lista impresa no hay dato sensible
  nuevo: es lo que Deudores ya muestra, en papel.
- Escala: hoy ~12 de los 35 devengantes tienen email. El tope de §7 aplica.

## §6. Resumen diario a la Comisión — `POST /api/cron/digest`

- Corre a diario (07:30). Junta las novedades del día civil anterior: pagos
  registrados (cantidad y total por medio), altas web, filas nuevas en la bandeja,
  notificaciones `failed`, corridas de cron con `ok: false`, webhooks con error.
- **Sin novedades no se envía** (CA de `docs/07`) — y esa decisión de no enviar
  **tampoco escribe `CronRun` con error**: es el desenlace sano (§8, D2).
- **Destinatarios** (decisión ronda 1): clave nueva en `Configuration`
  (`digest_recipients`, lista separada por comas), editable desde
  `/admin/configuracion` (superadmin), mismo patrón que los ids de plan. Arranca
  con la dirección del operador. `EMAIL_ALLOWLIST` la filtra igual que a todos.
- El contenido son agregados (cantidades, totales, nombres de socio cuando el
  renglón lo pide) — nunca direcciones de email de terceros ni ids de mandato
  completos (Ley 25.326, mismo criterio que los asientos).

## §7. El mailer dice la verdad: `Notification.failed`, tope y `payment_rejected`

**7.1 — `failed` se escribe.** Hoy `makeMailer().send()` registra DESPUÉS de enviar
(`email/index.ts:19-32`): un fallo no deja fila. Cambia a: intento real fallido →
fila `status: "failed"` con `error` (código/clase, **nunca** la dirección — ya hay
`VARCHAR(200)` migrado y labels escritos: `labels.ts:31-43`). La fila `failed` es
registro de **intento**, no acreditación fehaciente (Art. 5° quater): la distinción
queda en el comentario del modelo.

**7.2 — La allowlist no es un fallo.** Un bloqueo por `EMAIL_ALLOWLIST`
(`transport.ts:60-75`, `code: "EMAIL_ALLOWLIST"`) **no** escribe `failed`: es el
entorno de prueba funcionando. Se loguea como hoy y no ensucia la pantalla de salud.

**7.3 — Tope por corrida.** Los crons que envían (recordatorio, y la conciliación
cuando emite recibos en lote) aceptan un techo de envíos por corrida
(`MAIL_BATCH_CAP`, default 50): lo que excede se difiere y el summary lo dice
(`deferred: N`).

**Corrección del 24/08/2026 (enmienda del operador).** La redacción original decía
que lo diferido "queda para la corrida siguiente", y **es falso** para los recibos:
la conciliación saltea los pagos que ya tiene asentados **antes** de llegar al mail
(`hasLocal`), así que un recibo diferido **no se reintenta nunca** por su cuenta.
Tampoco lo levanta §7.5: un diferido no llega a `sendReceiptEmail` y por eso no
escribe ninguna fila de `Notification`, ni `sent` ni `failed`.

Decisión: **no** se agrega barrido automático —un reenvío masivo es exactamente lo
que el tope vino a evitar, y el diferido es raro (ocurrió una vez, con los 24
recibos del 23/08)—. En su lugar, **`/admin/salud` (§8) lista los recibos sin
enviar con su botón de reenvío**, y el operador decide. El socio, mientras tanto,
tiene el recibo disponible en `/mi/cuenta` desde el momento en que se emite.
Motivo documentado: el 23/08 un solo socio recibió 24 recibos de golpe; con 160
socios y sin allowlist, un backlog son cientos de correos en minutos contra la
cuota de Brevo.

**Segunda corrección (24/08/2026, sobre la anterior).** La enmienda de arriba
sostenía que para el **recordatorio de vencimiento** (§5) la frase original sí era
cierta —"lo diferido entra en la corrida siguiente"—. **También es falsa.** El cron
sólo actúa el ÚLTIMO día civil del mes (`willAct()`), así que la corrida siguiente
es dentro de ~30 días y para entonces `currentPeriod` ya cambió: el socio diferido
**nunca** recibe el aviso de ese mes. Y como diferir no es un error, la corrida
devuelve 200 / `ok: true`.

Decisión: **tampoco** se agrega barrido —mismo argumento, y hoy no se dispara: son
~12 devengantes con casilla contra un tope de 50—. Lo que queda es la señal:
`deferred: N` en el summary, visible en `/admin/salud`. Si algún día ese contador
deja de ser cero, la salida es subir el tope o repartir el aviso en días, no
reintentar en masa.

**Tercera precisión (24/08/2026): la allowlist no cuenta como error tampoco acá.**
§7.2 vale para el summary del cron, no sólo para la fila `Notification`: el
recordatorio cuenta los bloqueos en `allowlistBlocked` y los deja fuera de
`errors[]`. Si no, con `EMAIL_ALLOWLIST` puesta —que es el estado de producción
hasta el checklist de lanzamiento— la corrida del día 30 devolvería 207,
`CronRun.ok = false` y /admin/salud mostraría el job en rojo por diseño, todos los
meses.

**7.4 — `payment_rejected` avisa al socio.** Hoy el webhook corta en
`webhook-processor.ts:435` sin avisar a nadie y descarta el `statusDetail`. Cambia
a: si el pago rechazado se puede atribuir a un socio con email, se le envía "no
pudimos debitar tu cuota" con el motivo traducido a es-AR (tabla de
`status_detail` → texto; los no mapeados caen en un genérico). Best-effort: el
resultado del webhook no cambia (`payment_rejected_traced`), el aviso no puede
convertir un rechazo en 500. El procesador gana la dep `sendToMember` que hoy no
tiene (`webhook-processor.ts:92`).

**7.5 — Reintento por entidad.** `/admin/salud` lista las `failed` y ofrece
reenviar las que tienen camino de reenvío (recibo → `sendReceiptEmail`; las demás
muestran el error y de qué entidad vienen). No hay cola genérica: `payloadSummary`
es texto de 300 chars, no un payload re-armable, y esa limitación queda anotada.

## §8. `/admin/salud`

Sección nueva del grupo **Sistema** (`nav.ts` + icono en el Record exhaustivo de
`admin-nav-list.tsx` + tarjeta gemela en `dashboard-cards.ts` — el test exige
`title` idéntico al `label`).

**Paneles**, todos de sólo lectura salvo el reenvío:

1. **Crons**: última corrida de cada job (`reconcile`, `applications` — que
   **empieza a escribir `CronRun`**, hoy no lo hace —, `accrual`, `reminder`,
   `digest`) con estado, duración y resumen legible. **D2 resuelta**: un cron que
   decide no actuar (día que no es 1, digest sin novedades) **no escribe fila**;
   la pantalla muestra "última corrida efectiva" + la antigüedad, y marca **stale**
   cuando la antigüedad supera el doble del período esperado. `finishedAt IS NULL`
   con `startedAt` viejo se muestra como "colgada".
2. **Backup**: fecha del último `LAST_OK` (`scripts/backup.sh:39-41` ya lo
   escribe). Variable nueva `BACKUP_DIR` en `.env` (+ `.env.example`); sin ella el
   panel dice "sin configurar", no revienta.
3. **Mercado Pago**: fecha del último `webhook_events` recibido (la señal de que
   MP sigue avisando — crítica: las suscripciones dependen de la config del panel
   de MP, que puede romperse en silencio), eventos con `error` sin procesar, y
   rechazos de firma recientes.
4. **Dinero sin resolver**: bandeja abierta (cantidad y total), suscripciones con
   monto divergente, y los asientos `link_amount_mismatch` — **D1 resuelta**: se
   leen de `audit_log` por `action` con **índice nuevo `audit_log(action)`**; el
   `detail` ya trae todo (`webhook-processor.ts:271-272`). Sin tabla nueva.
5. **Avisos fallidos**: las `Notification.failed` (índice nuevo
   `notifications(status)`), con reenvío por entidad (§7.5).
6. **Recibos sin enviar** (enmienda del 24/08/2026, ver §7.3): los `Receipt` con
   `emailedAt` en null y socio con email, que es donde caen los diferidos por el
   tope. `emailedAt = null` es ambiguo —también lo dejan así el socio sin casilla y
   el envío que falló—, así que la pantalla distingue los tres casos y ofrece
   reenviar sólo donde tiene sentido.

**D3 resuelta**: tablero de una mirada. El diagnóstico fino sigue en PM2 y en las
tablas; la pantalla dice QUÉ está mal y desde cuándo, con el dato mínimo para ir a
buscarlo. Sin gráficos.

## §9. Padrón electoral (REG-31) — con la enmienda del operador

Pantalla superadmin en Sistema (junto al flag `elecciones_en_curso`, que por fin
gana quien lo escriba):

- **Entrada**: fecha de la elección (parámetro, `docs/02:157`).
- **Universo**: activos, honorarios, colaboradores, vitalicios y adherentes con
  **≥90 días de antigüedad** a esa fecha (REG-31; la antigüedad sale de
  `joinedAt`, y para reingresados vale `joinedAt` original — REG-11, la
  antigüedad no se reinicia).
- **Enmienda (23/08/2026, avalada por el Código Civil y Comercial)**: el moroso
  puede purgar su deuda **hasta 1 hora antes** de la elección, así que el padrón
  NO lo excluye. Salen **dos bloques**: **Habilitados** (todos los del universo,
  donde activos y colaboradores además no registran mora) y **Con deuda a purgar**
  (activos y colaboradores con mora, con la **cantidad de cuotas** y el monto a
  valor vigente — lo que tienen que pagar en la mesa para votar). El padrón es
  regenerable en cualquier momento, incluida la mañana de la elección.
- **Salida**: pantalla imprimible + export CSV. Columnas REG-31: nombre, número
  de socio, categoría; el bloque de morosos suma cuotas y monto.
- La "mora a la fecha" se evalúa sobre las cuotas `pending` de períodos
  **anteriores** al mes de la elección (coherente con §3; `fee.count` crudo no
  sabe expresarlo — es una consulta nueva con período).
- El sistema NO gestiona la elección (REG-31). Generar el padrón deja asiento.

## §10. Bajas y Mercado Pago

- **Baja individual**: al confirmar, `cancelPreapproval` de las suscripciones no
  canceladas del socio. Best-effort con **fallo visible**: la baja no se deshace
  por un error de red, pero la pantalla lo dice y el débito queda listado para
  reintentar (criterio de `docs/07`). La llamada vive junto a
  `memberService.withdraw` y NO en `withdrawAction` — el lote usa el mismo
  servicio.
- **Lote de cesantía**: cancela también (decisión ronda 1), con **tercer balde**
  de resultados: "cesanteado", "no se pudo cesantear", y "cesanteado pero el
  débito sigue vivo" — meter el tercero en `failures[]` diría que la cesantía
  falló sobre alguien que sí quedó cesante.
- **REG-15** (decisión ronda 2): el lote y las casillas de Deudores sólo para
  **activos y colaboradores**. Los adherentes con deuda siguen visibles como
  deudores, sin casilla.
- **Unificar "suscripción viva"**: hoy hay **cinco** definiciones
  (`4c-analysis-deudas.md`). Se centraliza en un módulo con las dos semánticas que
  de verdad existen —"puede cobrar" y "no está cancelada"— y las cinco pasan a
  importarlo. Las dos divergencias dañinas que esto corrige: `reconcile.ts:17` sin
  `pending` (espejos sin sincronizar, débitos sin recuperar) y
  `vincular/page.tsx:55` sin `paused` (no avisa "ya tiene otra viva" → dos
  débitos por mes).

## §11. Deudas heredadas que entran (decisión ronda 2: todas)

1. **El link al cesante toma plata** — `link/actions.ts` no chequea `status`: el
   link se genera, el vecino paga, y cae en la bandeja sin poder imputarse. Se
   bloquea en la action (y la pantalla deja de nombrar un período que el servicio
   va a rechazar).
2. **Huérfanas canceladas** — `orphanPreapprovals` del reconcile deja de contar
   las `cancelled` (hoy da 3 para siempre; `/admin/salud` nacería con una alarma
   eterna).
3. **`upcomingPeriods` unificado** — la copia literal de `mi/cuenta/page.tsx` y
   `link/page.tsx` pasa a `src/lib/treasury/upcoming.ts`.
4. **Toggle de débito automático en la ficha** — `Member.autoDebit` editable por
   admin, con asiento. Hoy tres lugares lo escriben y ninguno lo baja.
5. **`parseForm` devuelve el campo** — el error dice QUÉ campo falló (usa `path`
   de zod, que hoy se descarta — `forms.ts:43`). Sólo el mensaje; el foco
   automático queda fuera (§2).
6. **Cancelación en baja/lote** — es §10.
7. **`applications` escribe `CronRun`** — es §8.1.

## §12. Crontab final (6 líneas)

```
0 3 * * *  reconcile      (existente)
0 4 * * *  backup.sh      (existente)
5 8 * * *  applications   (existente)
30 0 * * * accrual        (diario; actúa el día 1)
30 7 * * * digest         (diario; sin novedades no envía)
0 10 * * * reminder       (diario; actúa el último día del mes)
```

Todos los endpoints nuevos heredan el patrón del reconcile: `runtime nodejs`,
503 sin `CRON_SECRET`, 401 con `timingSafeEqual` (la guarda se **extrae** — hoy
está duplicada en `applications/route.ts:17-23` y `reconcile/route.ts:13-17`),
`CronRun` sólo en corridas efectivas, 200/207/500, summary sin datos personales.

## §13. Registro de decisiones del operador (23/08/2026)

| # | Decisión |
|---|---|
| 1 | Recordatorio el último día del mes, antes de la mora; nada el día 1 |
| 2 | Sin email → lista imprimible para gestión manual de la Comisión |
| 3 | Resumen diario con destinatarios configurables en el panel |
| 4 | La cesantía en lote también cancela los débitos en MP |
| 5 | La cuota se materializa el 01 del mes siguiente (ya en mora) |
| 6 | Cesantía sólo activos y colaboradores (REG-15) |
| 7 | Padrón electoral completo, con morosos listados para purga (CCyC: hasta 1 h antes) |
| 8 | Entran todas las deudas heredadas recomendadas |
| 9 | Un socio suspendido NO vota: el padrón electoral lo excluye (decisión del 23/08/2026, cierra la pregunta abierta del plan) |

## §14. Criterios de aceptación

1. Correr el devengo dos veces el mismo día crea una sola cuota por socio.
2. La primera corrida del devengo en producción backfillea desde `coverageFloor`:
   corrida el 01/11 sin corridas previas → crea 2026-09 y 2026-10 para los 35.
3. El 15 del mes, un socio que pagó el mes en curso no aparece en Deudores, y uno
   que no lo pagó **tampoco** (todavía no es mora).
4. El recordatorio en un día que no es el último del mes no envía nada; el último
   día envía una sola vez por socio y período, incluso corrido dos veces; febrero
   avisa el 28/29.
5. El resumen sin novedades no se envía y no ensucia `/admin/salud`.
6. Un débito rechazado le llega al socio con el motivo en castellano; el resultado
   del webhook no cambia.
7. Un email con el transporte roto queda `failed` con su error y "Reenviar" lo
   saca; un bloqueo de allowlist NO queda `failed`.
8. `/admin/salud` muestra los cinco crons + backup, el último webhook de MP, la
   bandeja, las divergencias y los `link_amount_mismatch`; una corrida colgada se
   distingue de una sana.
9. El padrón electoral a una fecha dada lista habilitados y morosos-con-cuotas
   según REG-31 + enmienda, imprimible y exportable, con asiento.
10. Declarar la baja de un socio con débito cancela su suscripción en MP; si MP
    falla, la pantalla lo dice. El lote de cesantía: ídem, con el tercer balde.
11. Deudores no ofrece casilla de cesantía a adherentes.
12. Generar un link de pago para un cesante está bloqueado con mensaje claro.
13. Un valor nuevo en `Configuration.digest_recipients` cambia los destinatarios
    sin reiniciar nada.
