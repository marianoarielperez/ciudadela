# 07 — Plan de etapas (Módulos 0 a 6)

Regla: no se arranca un módulo sin cerrar los criterios de aceptación (CA) del anterior.
El lanzamiento público espera a la oficialización de la IGJ. **Desde el 20/08/2026 hay
un solo entorno desplegado, `vecinalciudadela.ar`** (el staging `sigev.redaccion.ar` se
dio de baja): el sitio ya está publicado pero sin difundir, con ASOCIATE apagado, MP en
modo prueba y `EMAIL_ALLOWLIST` puesta. Los módulos 1-5 son usables internamente desde
antes del lanzamiento.

## Módulo 0 — Base
Scaffold Next.js 15 + TS + Prisma + MariaDB (`sigev` DB y usuario dedicado),
Auth.js con credenciales y roles, layout base (público / admin / socio), seed de
superadmin, tabla Configuracion, Auditoria, deploy a staging con PM2 + Nginx +
Cloudflare, hardening previo del VPS (ufw, `/var/sigev/uploads`), script `deploy.sh`,
backup cifrado a Drive operativo.

CA: login funciona en `sigev.redaccion.ar` con HTTPS; un usuario admin y uno socio
de prueba ven paneles distintos; `ufw` activo sin cortar servicios existentes
(sir/cbinfra/hydro/atenea intactos); backup nocturno verificado restaurando un dump.

## Módulo 1 — Padrón interno (Libro 1)
Import de `datos/padron_socios.xlsx` (script idempotente + reporte), import de
`calles_inicial.csv`, entidades Socio/Libro/Membresia/Acta/Movimiento, listado y
ficha de socio, **modo carga de fichas** (edición rápida con navegación por número),
ABM de actas, acciones alta/baja/cambio de categoría con acta, verificación de email
+ invitación de acceso al cargar email, export Excel del padrón.

CA: los registros importados con sus números originales y sus huecos correctos
(283 filas / 22 huecos en la carga del 18/08/2026; **278 filas / 28 huecos** en el
padrón definitivo del 21/08/2026, que además borra las fichas que salieron del
libro);
cargar una ficha completa (DNI, domicilio con calle del catálogo, email) toma <2 min;
una baja con acta queda en el historial y en auditoría; el email de verificación
llega vía Brevo y el estado cambia a `verificado`.

## Módulo 2 — Sitio público
Home (hero + botones con estados), cartelera de noticias + ABM admin (editor
visual básico + imagen de portada), calendario de actividades de los salones
(Salón Histórico y Salón Vidriado, grilla semanal por año) + ABM admin,
página Ubicación (OpenStreetMap), pantalla Configuración (superadmin:
`asociate_activo`, contacto), footer con datos legales, SEO básico (robots,
sitemap, OG), CSP completa, responsive.

Las lecturas del sitio público van cacheadas por tag (`news`, `activities`,
`config`) y las invalidan las acciones del panel: el cambio se ve sin redeploy.

El Estatuto se movió al Módulo 5 (panel del socio, como PDF autenticado):
decisión del 19/08/2026 — no va en el sitio público.

CA: publicar una noticia con imagen desde el panel y verla en la home desde un
celular; Lighthouse accesibilidad ≥90 en home/noticias/actividades; ASOCIATE
deshabilitado muestra el banner correcto cuando `asociate_activo=false` y
habilitarlo desde /admin/configuracion lo refleja sin redeploy; cargar
"Taekwondo niños — Salón Vidriado — martes y jueves 18:00–19:30 — 2026" y
verla en /actividades; una actividad solapada en el mismo salón es rechazada;
robots.txt bloquea /admin y /mi y el sitemap lista las noticias publicadas.

## Módulo 3 — ASOCIATE + Mercado Pago
Wizard completo (5 pasos, Turnstile, términos, uploads), integración MP
(**2 planes** con sus ids en `Configuration`, `POST /preapproval`, webhooks con
`x-Signature`, `WebhookEvent`), estados de solicitud con expiración por cron,
bandeja admin con asentar-en-acta masivo / recategorizar / rechazar (con retención
de ingreso y bloqueo 6 meses), creación de Socio+Membresía al asentar (o reingreso
sobre la ficha existente), resumen mensual para el acta, emails de resultado y
guarda `EMAIL_ALLOWLIST`.

**Estado de los CA al cerrar el módulo (21/08/2026).** Verificados en local, con
base sembrada y navegador:

- [x] Un adherente **sin débito** queda `pendiente_cd`, recibe el email de
      recibida y se asienta en acta.
- [x] Asiento en acta masivo: socio creado con el **número siguiente** del libro
      abierto y `fecha_ingreso` = fecha del acta; la invitación de acceso **no**
      sale si el email no está verificado.
- [x] Bloqueos por DNI: socio vigente ve "ya estás asociado"; baja por mora o con
      deuda ve "acercate a la sede"; ex socio por renuncia sin deuda completa el
      wizard y su asiento queda como **reingreso** sobre la ficha original, con la
      antigüedad intacta.
- [x] Recategorizar con aviso de residencia y sincronización del plan local.
- [x] Rechazo con acta, retención del ingreso y bloqueo de 6 meses.
- [x] Recordatorio a los 3 días y expiración a los 7, corriendo el cron a mano con
      `CRON_SECRET`.
- [x] Resumen para acta del mes: tres listas, imprime bien y exporta a Excel.
- [x] Con `EMAIL_ALLOWLIST` definida, un envío a una casilla ajena queda bloqueado
      y logueado.
- [x] Idempotencia del webhook y validación de firma (cobertura de tests; falta
      el evento real).

**Pendientes de una corrida contra Mercado Pago** (nada de esto se puede probar sin
`MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` cargados — ver `docs/11`). Desde el
22/08/2026 el VPS corre con credenciales **productivas**, así que esta lista se
cierra **en local, contra el sandbox**: probarla en `vecinalciudadela.ar` sería
plata de verdad.

- [ ] Alta **ACTIVO** de punta a punta: wizard → checkout → webhook →
      `aprobada_pendiente_acta`. Con esto se verifica de paso que el paso 2 muestre
      los montos reales de los planes (hoy en local el wizard no pasa del paso 2
      sin token) y que la URL de "volver al pago" del retome sea la correcta.
      **Sigue abierto**: el piloto real del 22/08/2026 (socio 306) recorrió el
      circuito entero con débito, pero el 306 es **Adherente** en el padrón, así que
      lo que quedó probado es la rama del monto *compartido* y el plan
      `mp_plan_shared_id`. La rama del socio activo —el otro plan, el otro monto—
      todavía no la caminó nadie.
- [x] **Que el cuerpo del webhook de MP traiga efectivamente `body.id`.**
      **Contestado el 23/08/2026: sí lo trae**, y es un id de **evento**, distinto
      del id del pago (ejemplos reales `136606437047`, `136766467098`). La
      idempotencia de la ruta usa ése; el fallback quedó para las notificaciones
      que se disparan a mano.
- [ ] Rechazo y expiración cancelando una suscripción **real** en MP.
- [ ] Recategorización contra una suscripción real (hoy solo cubierta con dobles).

**Deuda conocida del Módulo 3, encontrada por un usuario real (23/08/2026).** En el
wizard ASOCIATE, un error de validación del servidor se muestra **pegado al botón de
enviar y sin indicar el campo**: Mariano leyó "Ingresá tu teléfono" al lado del
captcha y concluyó que fallaba Turnstile. La causa es `parseForm`
(`src/lib/forms.ts`): se queda con el `message` del primer issue de zod y **descarta
`path`**, que es donde viene el nombre del campo. **Afecta a todos los formularios
públicos**, no sólo al wizard. Arreglo propuesto: devolver también el campo y que el
formulario lleve el foco ahí. No es 4B; queda por decidir en qué fase entra.

Ideas incorporadas durante el desarrollo del Módulo 1: bloqueo del botón ASOCIATE
según el estado de la persona (socio vigente → avisarle que ya está asociado; ex
socio con `debt_at_withdrawal` → mensaje "acercate a la sede vecinal" sin dejarlo
continuar). Resumen mensual de socios aceptados para confeccionar el acta.

## Módulo 4 — Tesorería

Se ejecuta en **tres fases**, cada una con su branch, su merge a `main` con los
tests en verde y su despliegue antes de empezar la siguiente.

**Estado al 23/08/2026: 4A y 4B cerradas; la prioridad es la 4C.**

### Fase 4A — Cuenta corriente y efectivo — **CERRADA** (22/08/2026)

Migración `20260822125844_add_module_4_treasury`, reglas puras de tesorería, tabla
de valores de cuota + su alta desde Configuración, scripts de datos (padrón
definitivo con poda + deuda histórica), ficha del socio con pestañas y cinta de
períodos, `/mi/cuenta`, cobro en efectivo con recibo PDF numerado + email +
anulación, deudores con cesantía en lote, REG-07 y REG-16 sobre deuda viva,
paginación.

CA verificados en local con el padrón y la deuda importados: el socio 144 muestra
23 cuotas pendientes y $ 138.000; registrar 3 cuotas en efectivo emite el
`2026-00001`, marca pagas las tres más viejas (oct-dic 2024) y la cinta lo refleja;
anularlo las devuelve a pendientes y el número no se reutiliza; 20 cobros
concurrentes numeran `00002..00021` sin huecos contra MariaDB real; en Deudores
sólo los de ≥ 4 cuotas son tildables; cambiar de categoría a un socio con deuda
está bloqueado.

Despliegue: hecho, y no se repite. El diario de aquella carga fundacional —las
~1.200 líneas que corrieron una sola vez el 21/08/2026— quedó en
`git show 61d1b11:docs/10-runbook-dominio-produccion.md`. El `docs/10` §4 de hoy es
el **procedimiento** de despliegue, no el diario, y su §4.2 es el rearmado desde
cero, que sobre datos reales **no se vuelve a correr**.

### Fase 4B — Mercado Pago — **CERRADA** (23/08/2026)

Migraciones `20260822230724_add_module_4b_mercadopago` y
`20260823132536_add_other_income`. Gateway de **once** métodos; **el webhook
aplica** el pago (cuota + recibo + email) en vez de sólo trazarlo; links de
Checkout Pro desde la ficha (admin, con envío por email) y desde `/mi/cuenta`
(socio); bandeja **Sin conciliar** con tres salidas; **ingresos no societarios**
con su pestaña y su ejercicio anual; vinculación de suscripciones preexistentes en
dos pasos; conciliación diaria `/api/cron/reconcile` con **dos fuentes**;
lote REG-34 en `/admin/tesoreria/valores`; suscripción viva en la ficha del socio;
y la **eliminación de la caché de planes**: el wizard dejó de leer el monto de
Mercado Pago y los ids de plan pasaron a ser **opcionales**.

Suite al cerrar: **130 archivos / 1786 tests**, más **5 tests de integración en 2
archivos** (`tests/integration/receipt-sequence.test.ts` y
`tests/integration/mp-apply-concurrency.test.ts`) que corren contra MariaDB real y
se saltean sin `DATABASE_URL_TEST`.

**Estado de los CA** (spec 4B §18). Se verificaron en **tres pasadas contra Mercado Pago real** —cuenta de prueba aislada más túnel—, no con notificaciones simuladas:
a partir de la segunda pasada MP entregó todo por su cuenta (ver `docs/11` Parte J).

| # | Criterio | Estado |
|---|---|---|
| 1 | Débito de suscripción vinculada → pago + cuota del período + recibo por email; el mismo cobro llegando como `payment` no duplica | ✅ verificado contra MP real (recibo `2026-00004`, concepto congelado, PDF y email; las **dos** capas de idempotencia probadas) |
| 2 | Débito de suscripción **no** vinculada → bandeja `no_subscription`; vincular aplica esa fila sola | ✅ verificado |
| 3 | `solicitud:{id}` inexistente + suscripción vinculada → se aplica como débito (el caso del 306) | ⚠️ cubierto por tests y verificado en la revisión de código; no se reprodujo a mano |
| 4 | `pago:{id}:2` aplica las dos cuotas más viejas; con monto distinto, `link_amount_mismatch` | ⚠️ parcial: la imputación sí, contra MP real (el pago aplicó abril y mayo, recibo `2026-00005`); el `link_amount_mismatch` está sólo por tests |
| 5 | Pago sin referencia → bandeja → se resuelve desde ahí; anular el recibo reabre la fila | ⚠️ el pago sin referencia cayó en la bandeja y se resolvió como **ingreso no societario**; resolverlo **hacia un socio** se ejercitó con una fila `no_subscription`, y la **reapertura al anular** está fijada por tests (el `updateMany` dentro de la transacción, probado por orden) |
| 6 | `refunded` → anula el recibo y devuelve las cuotas a pendientes | ✅ reembolso real desde el panel del vendedor: anuló solo, la serie no se reutilizó, y el segundo aviso dio `refund_ignored` |
| 7 | Débito de un cesante se imputa a su deuda congelada; sin pendientes, a la bandeja | ⚠️ cubierto por tests. No se reprodujo a mano a propósito: exigía autorizar otra suscripción entera para un solo mensaje de pantalla |
| 8 | Débito de un adherente crea y paga la cuota del período | ⚠️ cubierto por tests; el socio de la batería es activo |
| 9 | Con el webhook apagado, `reconcile` registra igual y deja `CronRun` | ⚠️ parcial: corrigió el espejo de una suscripción y escribió `cron_runs` con el resumen completo y HTTP 207. El **paso 1** no se puede validar en sandbox (ver abajo) |
| 10 | El lote actualiza el monto en MP y reporta las que fallan, con reintento | ✅ verificado contra la API: 6000 → 7000 en MP y en el espejo local |
| 11 | ASOCIATE paso 2 cobra el valor de `fee_values` sin ids de plan cargados | ✅ alta web completa: `Payment.entry`, recibo `2026-00007`, **cero cuotas devengadas** (REG-14) |
| 12 | Checkout Pro desde `/mi/cuenta` y link del admin por email | ✅ pago real de $12.000; la tarjeta "tu pago quedó registrado" salió en el primer render |
| 13 | **En producción**: las dos suscripciones vinculadas y el débito del 10/09 registrado | ⏳ **pendiente** — es lo que se hace al desplegar (ver "Lanzamiento") |

**Lo que NO se pudo probar y hay que confirmar en producción:**
`GET /v1/payments/search` **no indexa en sandbox** (devuelve `total=0` aun sin
filtros, con el pago existiendo y aprobado; sólo lo encuentra `?id=`). Por eso el
**paso 1 de la conciliación** —recuperar pagos de Checkout Pro perdidos— se apoya
en los tests unitarios y en que la consulta responde 200 bien formada. El paso 2,
que es el que cubre los **débitos**, sí quedó verificado.

**Cinco arreglos de código que sólo aparecieron probando contra MP real** — uno por
commit, y así se cuentan en los tres documentos que los mencionan: éste, `docs/11`
Parte J y `CLAUDE.md`. El detalle técnico está en `docs/11` Parte J y en el ledger:

1. **`9935c1a`** — `searchAuthorizedPayments` mandaba `limit=100` a un endpoint que lo rechaza:
   devolvía **400 siempre, en silencio**, así que el paso 2 de la conciliación
   **nunca había funcionado** y la vinculación decía "Cobros previos: no
   disponible". Era justo la red que tiene que atajar el débito del 10/09.
2. **`03a1e2d`** — el gateway no leía el preapproval que **viene en el propio pago**
   (`point_of_interaction.transaction_data.subscription_id`), así que la
   notificación `payment` de un débito nunca resolvía sola.
3. **`49d06e1`** — las notificaciones que no atendemos (IPN legacy y `merchant_order`) respondían
   4xx y MP las reintentaba; ahora responden 200 "recibido, no procesado".
4. **`82918fb`** — un id sembrado que MP no puede parsear hacía que el cron devolviera 207 en toda
   corrida local: un cron que siempre falla un poco es un cron cuyos errores nadie
   mira.
5. **`903d69d`** — el concepto congelado del recibo no llegaba a la cuenta
   corriente: la fila tachada de un pago revertido o anulado decía "Cuota social" a
   secas y escondía qué había cubierto, que es justo donde saber qué se cobró
   importa más. Afecta a `/mi/cuenta` y a la ficha del socio.

Y **una trampa de entorno**, que no se cuenta entre los cinco porque no es un
defecto del sistema: entrando por el túnel, `next dev` bloquea sus propios chunks de
`/_next/static` y la página llega sin JavaScript, así que Turnstile no se monta y
`/ingresar` responde "credenciales inválidas" — el síntoma no dice nada de la causa.
Se resuelve con `allowedDevOrigins` en `next.config.ts`, y hay que actualizarlo cada
vez que cambia el dominio del túnel (`docs/11` J.1).

Y un **hallazgo de producto** que no es un bug: cuando la tarjeta rechaza, MP
**retiene al vecino en su checkout** ofreciéndole otro medio; no lo devuelve con
`collection_status=rejected`. La pantalla de rechazo es defensiva, no el camino
habitual.

**Deuda que la fase deja anotada** (decidir en 4C o M5):

- **Cuatro definiciones de "suscripción viva"** conviven en el repo
  (`["authorized","paused"]`, `["authorized","pending","paused"]`,
  `["authorized","pending"]` y `"authorized"` a secas). Consecuencia real: una
  `paused` no dispara el aviso "el socio ya tiene otra viva" del vinculador, pero
  la ficha sí la muestra como débito automático.
- **`Member.autoDebit` no se puede corregir desde ninguna pantalla.** Tiene tres
  escrituras y ninguna lo baja. La ficha avisa de la discrepancia; el dato sigue mal
  en la pestaña Ficha, en la columna del padrón y en la exportación.
- **`mp_subscriptions.member_id` es índice, no unique**: un socio puede terminar con
  dos preapprovals vivos (dos débitos por mes). La ficha avisa; nada lo impide.
- **Reimputar un cobro cuyo recibo se anuló** no tiene camino: el pago anulado
  conserva su `mpPaymentId`, que es la barrera contra reenvíos de MP. Arreglarlo de
  fondo exige decidir qué pasa con esa barrera.
- **La ventana del link de pago con precio viejo** (hasta 72 h) no la muestra
  ninguna pantalla: sólo queda el asiento `link_amount_mismatch`. Verla es 4C.
- **La navegación por ejercicio** existe en Otros ingresos pero no en Deudores,
  Efectivo ni Recibos (decisión del cliente: no ensanchar la fase antes del 10/09).

### Fase 4C — Notificaciones y salud (pendiente) — **prioridad actual**

Crons de devengo (día 1), aviso de mora (día 30) y resumen diario a la Comisión;
`payment_rejected` que avisa al socio; `Notification.failed` + reintento desde el
panel; `/admin/salud`; export del padrón electoral (REG-31); crontab completo
documentado.

**Se le suman, de la fase 4B (23/08/2026):**

- **Cancelar la suscripción de MP al dar de baja a un socio.** Reasignado acá desde
  el "Módulo 5" que decían `docs/06` §8 y la spec de 4B, donde no tenía fase
  asignada en este documento. El motivo: las bajas del **panel** —cesantía por mora
  en lote (4A) y baja por acta (M1)— **ya existen y ya corren**, así que hoy se
  puede dejar de ser socio y seguir siendo debitado todos los meses. Es el mismo
  agujero que el M5 iba a tapar, pero está abierto ahora y no depende del panel del
  socio. Alcance: llamar a `cancelPreapproval` al confirmar la baja, best-effort
  con **fallo visible en pantalla** (mismo criterio que el rechazo de solicitudes:
  la baja no se deshace por un error de red, pero tampoco se calla).
- **Ver la ventana del link de pago con precio viejo**: hoy un pago por link
  posterior a una actualización REG-34 se imputa igual y sólo deja el asiento
  `link_amount_mismatch`, que ninguna pantalla muestra.
- **`/admin/salud` tiene que mostrar `cron_runs`**, que ya escribe la conciliación
  diaria de la 4B: hoy el resultado sólo se lee por SQL.

CA: correr el devengo dos veces el mismo día crea una sola cuota por socio; el
aviso de mora en un día que no es 30 no envía nada y el 30 envía una sola vez a
cada deudor; el resumen sin novedades no se envía; un email con el transporte roto
queda `failed` y "Reintentar" lo saca; `/admin/salud` muestra las cinco corridas y
el backup; **declarar la baja de un socio con débito cancela su suscripción en MP y,
si MP falla, la pantalla lo dice**.

**Alcance agregado el 21/08/2026 — propagación del valor de cuota (REG-34).**
**Cerrado en la fase 4B**: el lote vive en `/admin/tesoreria/valores` y quedó
verificado contra la API real. Lo que sigue es el enunciado original, que explica
por qué hizo falta.
Las suscripciones se crean **sin plan asociado** en MP y **copian** el monto
(`docs/06` §2, corregido tras medirlo contra la API real), así que **cambiar el
monto en el panel de Mercado Pago ya no se propaga solo a las suscripciones
vivas**. El M4 tiene que incluir una acción "aplicar el nuevo valor de cuota a
las suscripciones vigentes": recorre las suscripciones activas de la categoría y
les empuja el monto por API (`updatePreapprovalAmount`), con progreso, reintento de
las que fallen, asiento de auditoría y pantalla de "quedaron N sin actualizar". Es
un lote de decenas o pocos cientos de llamadas, hasta 4 veces al año: no es un
problema de escala. Queda atado al acta, que es más fiel al estatuto que el sync.
**Mientras no se corra, un valor de cuota nuevo sólo afecta a las altas nuevas.**

Ideas incorporadas durante el desarrollo del Módulo 1: recibo automático por email
para los débitos acreditados; registro de pago en efectivo con envío automático
del comprobante por email; notificación el día 30 de cada mes a los socios con
cuotas adeudadas, indicando cuántas debe (notificación fehaciente); resumen diario
a las 9:00 a la Comisión con las novedades del día anterior (no se envía si no
hubo novedades); export del padrón electoral (REG-31), diferido desde el Módulo 1
porque depende del dato de deuda real.

### Insumos que deja el Módulo 3 para el Módulo 4

Cosas que se encontraron construyendo el M3, que **no** entraban en su alcance y
que el M4 tiene que levantar. No son ideas sueltas: cada una tapa un agujero
concreto.

Reparto tras cerrar la fase 4B (23/08/2026): **1, 3, 4 y 5 están cerrados**;
**2 sigue en la 4C** (junto con el resto de las notificaciones); **6 quedó sin
efecto**; **7 está cerrado**; **8 queda abierto** y sin fase asignada.

1. ~~**La conciliación debe barrer preapprovals sin fila local.**~~ **Cerrado en la
   fase 4B**: es el paso 4 de `/api/cron/reconcile` (`orphanPreapprovals`,
   `orphanCreated`, `orphanCancelled`).
2. **`payment_rejected` todavía no le avisa a nadie.** El webhook registra el
   rechazo del débito y la solicitud sigue esperando, pero el socio no recibe el
   "no pudimos debitar tu cuota; MP va a reintentar" que promete `docs/06` §4.
   Confirmar que entra en el alcance del M4 junto con el seguimiento de mora.
3. ~~**Un débito recurrente futuro puede revivir una solicitud vencida.**~~
   **Cerrado en la fase 4B**: el gateway expone `dateApproved` y el pago de un
   débito trae su propio preapproval, y la regla de resolución consulta
   `mpPaymentIdEntry` **antes** que la de suscripción, así que la plata de ingreso
   no puede re-imputarse como cuota social.
4. ~~**Dos pagos de ingreso reales distintos sobre la misma solicitud.**~~
   **Cerrado en la fase 4B**: el segundo cae en la bandeja con el motivo
   `duplicate_entry` ("segundo cobro de una solicitud sin acta todavía"), visible y
   resoluble a mano.
5. ~~**Cambiar los ids de plan no invalida la caché de montos.**~~ **Cerrado en la
   fase 4B**: la caché (`src/lib/mp/plans.ts`) **se borró** y el wizard lee
   `fee_values`. Los ids de plan quedaron opcionales.
6. **Una solicitud re-suscripta a mano** (tras revivir por pago tardío) queda
   describiendo la suscripción nueva con la copia "verificá antes de gestionar".
   Sigue sin ser alcanzable: la 4B **no** automatizó el alta de suscripciones. Si
   alguna fase lo hace, hay que revisar ese texto.
7. ~~**Recategorizar con `planIdForCategory = null`** re-abre en silencio la
   divergencia entre el plan local y el de MP.~~ **Cerrado el 21/08/2026**: la
   recategorización resuelve el plan nuevo ANTES de tocar MP y, si no está
   configurado, corta con un error en pantalla sin llamar a la API ni escribir
   nada.
8. **Una solicitud que llegó con la categoría equivocada y que nadie toca** no
   queda marcada en ningún lado: `residenceMismatch` solo se computa al
   recategorizar. Candidato a señal de la bandeja o del resumen.

## Módulo 5 — Panel de socio
Login/recupero, mis datos (con re-verificación de email), mi cuenta corriente,
pagar pendientes por link, aporte voluntario / adherir al débito (adherentes),
solicitar baja (circuito completo con aceptación por acta), vista suspendido.

CA: un socio real de prueba paga 2 cuotas atrasadas por link en sandbox y las ve
aplicadas con sus recibos; una solicitud de baja llega a la bandeja admin, se acepta
con acta y el socio queda `baja` con motivo `renuncia`.

Ideas incorporadas durante el desarrollo del Módulo 1: que el socio vea cuántas
cuotas debe; que pueda solicitar cambio de categoría solo si no tiene deuda de
tesorería (REG-07). Del Módulo 2: publicar el estatuto como PDF dentro del panel
del socio (movido desde el Módulo 2 el 19/08/2026; fuente: `datos/estatuto.docx`).

## Módulo 6 — Re-empadronamiento y cierre de libro
Wizard público (DNI+apellido enmascarado, rate limit), activación con validaciones
(DNIs completos, 180 días, 90 días IGJ), notificaciones 1ª/2ª instancia (email +
circuito cartelera con PDF y días hábiles), tablero, validación de presentaciones
con subsanación, borrador de acta de bajas, **cierre transaccional de libro** con
vista previa, migración, renumeración por antigüedad y export del nuevo padrón.

CA (staging con datos reales cargados): simulacro completo — activar proceso de
prueba, presentar 3 adherentes (1 validado, 1 observado que subsana, 1 sin respuesta),
vencer plazos con fechas simuladas, cerrar libro → Libro 2 con los vigentes no
adherentes + 2 validados, renumerados por antigüedad, con el sin-respuesta dado de
baja con `recurso_hasta` correcto; el Libro 1 queda cerrado y consultable; restaurar
backup revierte el simulacro.

## Lanzamiento (cuando IGJ oficialice)

Ya hecho, antes de tiempo: ~~cambiar `MP_ACCESS_TOKEN` a las credenciales
productivas~~, ~~webhooks productivos apuntando a `vecinalciudadela.ar`~~ y
~~recargar los ids de los dos planes productivos~~. Las tres se hicieron el
**22/08/2026** para el piloto real del socio 306, que se afilió por la web y cuyo
débito funcionó. Desde entonces el dominio corre en producción contra Mercado Pago:
**no se prueban cobros ahí**.

Checklist que queda: **borrar `EMAIL_ALLOWLIST` del `.env` del VPS** (mientras esté
definida, los avisos a los socios NO salen) → SPF/DKIM/DMARC del dominio (ya
autenticado en Brevo) → carga de fichas completa (160 vigentes: 36 activos +
124 adherentes) → **suscripciones preexistentes vinculadas** (la pantalla existe
desde la fase 4B; se hace al desplegarla, ver `docs/10` §4.4) → acta marco de
admisión digital dictada (REG-12) → **textos legales aprobados por la CD y cargados
en `/admin/configuracion`** → **crontab con sus dos líneas** (`docs/11`, Parte H:
`/api/cron/applications` 08:05 y `/api/cron/reconcile` 03:00; la fase 4C suma
devengo, mora y resumen) → activar `asociate_activo` → convocar re-empadronamiento
dentro de los 90 días.

Nota sobre los ids de plan: desde la fase 4A el monto no sale de ahí —`fee_values`
es la única fuente— y desde la fase 4B **los ids son opcionales**: el alta web, la
recategorización y el lote REG-34 leen la tabla local. Lo único que dejan de andar
sin ellos es el aviso de divergencia plan-vs-valor de la conciliación diaria, que
simplemente no corre.
