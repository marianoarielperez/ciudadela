# 07 — Plan de etapas (Módulos 0 a 6)

Regla: no se arranca un módulo sin cerrar los criterios de aceptación (CA) del anterior.
El lanzamiento público espera a la oficialización de la IGJ. **Desde el 20/08/2026 hay
un solo entorno desplegado, `vecinalciudadela.ar`** (el staging `sigev.redaccion.ar` se
dio de baja): el sitio ya está publicado pero sin difundir, con ASOCIATE apagado y
`EMAIL_ALLOWLIST` puesta. **Mercado Pago corre ahí con credenciales productivas desde el
22/08/2026** (piloto real del socio 306), así que no se prueban cobros contra el dominio.
Los módulos 1-5 son usables internamente desde antes del lanzamiento.

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
formulario lleve el foco ahí. **La fase 4C hizo la mitad**: `parseForm` ya devuelve el
campo que falló. Lo que falta es consumirlo —propagar el estado y `aria-invalid` pantalla
por pantalla, y llevar el foco—, así que el síntoma que motivó la deuda sigue igual. → M5.

Ideas incorporadas durante el desarrollo del Módulo 1: bloqueo del botón ASOCIATE
según el estado de la persona (socio vigente → avisarle que ya está asociado; ex
socio con `debt_at_withdrawal` → mensaje "acercate a la sede vecinal" sin dejarlo
continuar). Resumen mensual de socios aceptados para confeccionar el acta.

## Módulo 4 — Tesorería

Se ejecuta en **tres fases**, cada una con su branch, su merge a `main` con los
tests en verde y su despliegue antes de empezar la siguiente.

**Estado al 24/08/2026: las tres fases cerradas.** Lo único que queda del Módulo 4 es un
paso de operación con fecha: desplegar el cron de devengo antes del **01/10/2026**.

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

**Deuda que la fase deja anotada** — estado tras la fase 4C (24/08/2026):

- ~~**Cuatro definiciones de "suscripción viva"**~~ → **cerrada en 4C**. Eran
  cinco, y la 4C encontró una **sexta** que el escaneo no había visto (la pantalla
  de Suscripciones pedía sólo `authorized`, así que una huérfana `paused` entraba
  al contador de salud y no a la pantalla). Hoy hay **dos** semánticas nombradas en
  `src/lib/mp/subscription-status.ts` y cada una falla hacia su lado seguro.
- ~~**`Member.autoDebit` no se puede corregir desde ninguna pantalla**~~ →
  **cerrada en 4C**: toggle en la ficha del socio, con asiento.
- ~~**La ventana del link de pago con precio viejo**~~ → **cerrada en 4C**:
  `/admin/salud` cuenta los `link_amount_mismatch` (como historia, no como cola).
- **`mp_subscriptions.member_id` es índice, no unique**: un socio puede terminar con
  dos preapprovals vivos (dos débitos por mes). La ficha avisa; nada lo impide. La
  4C agregó el botón de cancelar, pero **acotado a socios dados de baja** (enmienda
  del operador), así que el socio **vigente** con dos débitos sigue sin remedio
  dentro del sistema: hay que cancelar uno desde el panel de Mercado Pago.
- **Reimputar un cobro cuyo recibo se anuló** no tiene camino: el pago anulado
  conserva su `mpPaymentId`, que es la barrera contra reenvíos de MP. Arreglarlo de
  fondo exige decidir qué pasa con esa barrera.
- **La navegación por ejercicio** existe en Otros ingresos pero no en Deudores,
  Efectivo ni Recibos (decisión del cliente: no ensanchar la fase antes del 10/09).
- **`AdminActor` no devuelve los roles vivos**, así que el layout del panel llama a
  `auth()` una segunda vez; y **4 formularios y 9 `<select>` crudos** siguen sin
  migrar a `synced-fields` (se ven planos en modo oscuro). Las dos son deuda del
  shell del panel, **→ Módulo 5**.

### Fase 4C — Crons, notificaciones, salud y padrón electoral — **CERRADA** (24/08/2026)

Migración `20260824101648_add_module_4c_notifications`, **estrictamente aditiva**:
`notifications.period CHAR(7) NULL` y cuatro índices (`notifications.status`,
`notifications(type, period)`, `audit_log.action` y
`webhook_events(origin, received_at)`). Cero `DROP` y cero `MODIFY`: apta para
`migrate deploy` sobre la base con socios reales.

**Qué quedó andando:** cron de **devengo** (`/api/cron/accrual`, actúa el día 1,
con backfill desde `coverageFloor`), **recordatorio de vencimiento**
(`/api/cron/reminder`, actúa el último día del mes), **resumen diario a la
Comisión** (`/api/cron/digest`, sin novedades no envía y no escribe `CronRun`),
`Notification.failed` con el **código** del error y reenvío por entidad, tope de
envíos por corrida (`MAIL_BATCH_CAP`), aviso al socio del **débito rechazado** con
el motivo en castellano, **`/admin/salud`** con los cinco crons y el backup, la
**hoja imprimible** de deudores sin email, el **padrón electoral** (REG-31 +
enmienda del operador), la **cancelación del débito en Mercado Pago al dar de
baja** —individual y en lote— y las siete deudas heredadas de 4B que la fase
levantó.

Suite al cerrar: **154 archivos / 2289 tests**, sobre una base de rama de 130
archivos / 1803 tests (los 1786 del cierre de 4B más los del piso de cobertura,
que se mergeó después): **+24 archivos y +486 tests**. Los archivos de integración
que corren contra MariaDB real y se saltean sin `DATABASE_URL_TEST` pasaron de dos
a **tres**: la 4C sumó `tests/integration/unique-violation.test.ts`.

**Estado de los CA** (spec 4C §14). Distinción importante: casi todo lo de esta
fase **no se puede ejercitar en producción** —el devengo no tiene ningún mes
devengable hasta el 01/10/2026, y con `EMAIL_ALLOWLIST` puesta los correos no
salen—, así que la columna dice de dónde sale la confianza en cada caso.

| # | Criterio | Estado |
|---|---|---|
| 1 | Correr el devengo dos veces el mismo día crea una sola cuota por socio | ✅ lectura previa + `createMany` con `skipDuplicates` sobre `fees_member_id_period_key`. La **forma del P2002** que respalda el reintento se fija contra MariaDB real en `tests/integration/unique-violation.test.ts`, y el revisor comprobó a mano el caso de producción (el `createMany` **dentro de una `$transaction`**) contra la base local |
| 2 | La primera corrida backfillea desde `coverageFloor` (el 01/11 crea 2026-09 y 2026-10) | ⚠️ por tests, y un dry run contra la base local (35 socios, 35 filas, `upTo` 2026-09). No se puede reproducir en producción antes del 01/10: la ventana de `upTo` está vacía hasta esa fecha |
| 3 | El 15 del mes, ni el que pagó ni el que no pagó el mes en curso aparecen en Deudores | ⚠️ por construcción y por tests: el techo del devengo es el **mes vencido** y ninguna pantalla se tocó |
| 4 | El recordatorio: nada salvo el último día; una sola vez por socio y período; febrero avisa el 28/29 | ⚠️ por tests (los dos bordes de mes y febrero, y la dedupe corrida dos veces). El **plan de consulta** sí se midió contra MariaDB con 17.136 filas sintéticas: usa el índice, 0,43 ms |
| 5 | El resumen sin novedades no se envía y no ensucia `/admin/salud` | ✅ el envío se verificó **de punta a punta contra el dev server** y llegó un correo real; la rama "sin novedades" (que no abre `CronRun`) está por tests |
| 6 | Un débito rechazado le llega al socio en castellano; el resultado del webhook no cambia | ⚠️ por tests, con la regla dura —el `WebhookResult` es idéntico al de antes— perseguida por la revisión en los **ocho** caminos de fallo. Ojo: con la allowlist puesta no se escribe fila `Notification`, así que **la dedupe está dormida** hasta que se borre |
| 7 | Un email con el transporte roto queda `failed` y "Reenviar" lo saca; la allowlist NO queda `failed` | ✅ test de **costura** sobre el transporte real (no sobre dobles) y prueba de mutación: envolver el código de la allowlist falla sólo ese test, que era el hueco exacto |
| 8 | `/admin/salud` muestra los cinco crons + backup, MP, la bandeja, las divergencias y los `link_amount_mismatch`; una corrida colgada se distingue | ✅ recorrida contra la base local con datos sembrados — de esa corrida salió el hallazgo de que `CronRun.summary` publicaba un `preapproval_id` entero. `applications` empezó a escribir `CronRun` en esta fase; antes era el único cron que corría en producción sin dejar huella |
| 9 | El padrón a una fecha dada lista habilitados y morosos-con-cuotas, imprimible, exportable y con asiento | ⚠️ por tests y por revisión de código; el BOM del CSV comprobado **por bytes**. No hubo simulacro de mesa |
| 10 | La baja cancela la suscripción en MP; si MP falla, la pantalla lo dice. El lote, ídem con el tercer balde | ✅ **verificado en el navegador contra la API real de sandbox**, los dos desenlaces: fallo `http_404` con el espejo intacto, y éxito con la fila pasando a Cancelada |
| 11 | Deudores no ofrece casilla de cesantía a adherentes | ⚠️ por tests, con el filtro REG-15 en las **dos** capas (pantalla y action) |
| 12 | Generar un link de pago para un cesante está bloqueado con mensaje claro | ⚠️ por tests. Era el agujero que **tomaba plata**: se generaba el link, el vecino pagaba y esa plata caía en la bandeja sin poder imputarse |
| 13 | Un valor nuevo en `digest_recipients` cambia los destinatarios sin reiniciar nada | ✅ el correo real del CA 5 salió a la dirección cargada en la clave, sin deploy ni restart |

**Tres desvíos deliberados de la letra de la spec**, todos verificados contra el
código antes de tomarlos:

1. **§4 dice `status: "active"` y el cron consulta `active` + `suspended`**, porque
   `accrues()` sólo excluye a los dados de baja: un suspendido sigue debiendo. Hoy
   no cambia ninguna fila (hay **0 suspendidos**).
2. **La dedupe del recordatorio no lleva `unique`.** Con `failed` escribiéndose,
   un intento fallido bloquearía el reintento de ese período. Queda lectura previa
   que excluye `failed`, sobre la premisa de **un solo proceso** de `docs/03`.
3. **Se agregó un índice que la spec no nombra** (`webhook_events(origin, received_at)`):
   las dos consultas del panel de Mercado Pago de `/admin/salud` eran full scan.

**El hallazgo que ningún test podía ver.** Con `@prisma/adapter-mariadb` **no
existe `meta.target`**: el nombre del unique violado viaja en
`meta.driverAdapterError.cause.constraint.index`. Una guarda escrita contra
`meta.target` —que es lo que dice la documentación de Prisma y lo que el repo ya
tenía en `applications/record.ts`— habría pasado todos los tests y **nunca** habría
matcheado en producción; el fake de los tests era el que mentía. Se centralizó en
`src/lib/treasury/unique-violation.ts`, que lee las dos formas y **falla cerrada**
(si el adapter cambia, no reintenta). Es la misma lección de la 4B —medir antes de
suponer—, esta vez contra el driver de la base.

**Deuda que la fase deja anotada** (para el M5 o para cuando moleste):

- **El foco de `parseForm`**: la función ya devuelve el campo que falló, pero
  **nadie lo consume todavía**. Lo entregado es la plomería; el síntoma que motivó
  la deuda —que el mensaje no dice DÓNDE falló— sigue igual. Llevar el foco exige
  propagar estado y `aria-invalid` pantalla por pantalla.
- **El socio VIGENTE con dos débitos vivos** no tiene remedio dentro del sistema
  (arriba, en la deuda de 4B): la baja no corresponde y el botón de cancelar está
  acotado a socios dados de baja.
- **El tope del lote de cesantía cuenta SOCIOS, no llamadas de red**
  (`ARREARS_BATCH_MAX = 25`). Un socio con dos suscripciones vivas vuelve a acercar
  el 504 que el tope vino a evitar. Mitigado, no cerrado.
- **La escotilla del recordatorio alcanza UN MES.** Si el aviso se pierde el 30/09
  y se fuerza el 31/10, el correo avisa **octubre**: septiembre queda irrecuperable.
- **`stoppedForActive` tiene un falso positivo que ninguna acción apaga**: el socio
  vigente que se pasó a efectivo y le cancelaron el débito. Por eso la pantalla lo
  pinta en gris y no en rojo.
- **`FORCE_VALUES` y el mensaje del 400 están duplicados literalmente** entre
  `accrual/route.ts` y `reminder/route.ts`. Extraerlos a `src/lib/cron/force-param.ts`
  **antes** de que aparezca un tercer cron con escotilla.
- **`accrues()` quedó sin call-site de producción** (lo reemplazó `periodsToAccrue`,
  que sí sabe recorrer el pasado). **Se conserva a propósito**, con sus tests: es el
  predicado de consulta "¿este socio devenga este mes?" y `rules.ts:104` lo usa como
  contraste para explicar por qué la otra función existe.
- **Tres barridos por rango sin índice** en el resumen diario (`payments.created_at`,
  `notifications.sent_at`, `webhook_events.received_at` sin `origin`), y **ninguno
  sobre `receipts.emailed_at`**. Irrelevante al volumen de hoy.
- **Una anulación no es novedad en ningún renglón del resumen**: un pago registrado
  y anulado el mismo día desaparece del correo.

**Dos cosas que hay que tener presentes al desplegar, y no son bugs:** la hoja de
gestión manual va a salir en producción con las columnas **Domicilio y Teléfono
casi vacías** (el padrón trajo DNI, nombre y categoría, pero domicilio y teléfono
se cargan a mano: hoy hay 2 socios con calle y 1 con teléfono sobre 278); y el
asiento `electoral_roll_generated` significa "la página se renderizó", no "alguien
produjo un padrón".

**El devengo tiene FECHA DURA: antes del 01/10/2026.** Está **implementado y
testeado**, pero lo que vence es el **despliegue** (`docs/10` §4.6): mientras el
cron no esté en el crontab del VPS, no crea ninguna fila. No es una prioridad entre
otras, es un vencimiento. El modelo que confirmó el operador el 23/08/2026 es de dos
niveles: la cuota del mes M **nace el 01/M** (está al cobro, se puede pagar durante
el mes) y recién es **deuda/mora el 01/M+1**. El padrón (`deuda.xlsx`, foto del
21/08) cubre a todos hasta **agosto 2026 inclusive**, y el import trajo **sólo lo
impago**: un socio al día no tiene ninguna fila. Consecuencia: **desde el 01/10 los
socios al día se van a mostrar "al día" debiendo septiembre**, porque no hay fila que
contar. La fase 4B tapó la mitad del problema —`coverageFloor` (`treasury/rules.ts`)
hace que un pago impute el primer mes NO cubierto, así que la plata cae bien— pero la
deuda visible (Deudores, la ficha, `/mi`) cuenta filas, y esas filas sólo las crea el
devengo.

Tres cosas que el devengo tenía que hacer, y que no eran obvias. **Las tres
quedaron hechas**, y así se resolvieron:

1. **Backfillear desde `coverageFloor`, no crear sólo el mes corriente.** Hecho, y
   con la **misma función** que decide a qué mes va un pago (`coverageFloor` en
   `treasury/rules.ts`): devengo, recordatorio e imputación no pueden divergir
   porque comparten la expresión. Si el cron corre por primera vez en noviembre,
   crea septiembre **y** octubre.
2. **No devengar el mes en curso como deuda.** Resuelto por el lado del cron: el
   techo es el **mes vencido** (mes corriente − 1), así que la fila nace el 01/M+1,
   cuando la cuota ya es mora. Es lo que deja correctos, **sin tocarlos**, a los 21
   puntos del sistema que cuentan filas `pending` a secas. Ninguna pantalla se tocó.
3. **Tope o agrupación de emails.** Resuelto con `MAIL_BATCH_CAP` (default 50) como
   **presupuesto por corrida**, no como contador global. El cupo **vuelve** cuando
   el envío termina sin correo (socio sin casilla, recibo anulado), así que el tope
   cuenta correos mandados y no intentos: con 37 casillas sobre 278 socios, un tope
   de intentos se habría agotado sin mandar ninguno.

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

**Las cinco entraron**, con dos precisiones que aparecieron al construirlas: el
aviso no sale "el día 30" sino el **último día civil del mes** (en febrero el 30 no
existe y ese mes nunca habría avisado), y el resumen sale **07:30** y no 09:00, para
que la Comisión lo tenga antes de arrancar el día.

### Insumos que deja el Módulo 3 para el Módulo 4

Cosas que se encontraron construyendo el M3, que **no** entraban en su alcance y
que el M4 tiene que levantar. No son ideas sueltas: cada una tapa un agujero
concreto.

Reparto tras cerrar la fase 4B (23/08/2026): **1, 3, 4 y 5 están cerrados**;
**2 sigue en la 4C** (junto con el resto de las notificaciones); **6 quedó sin
efecto**; **7 está cerrado**; **8 queda abierto** y sin fase asignada.
*(Actualización del 25/08/2026: el 8 se cerró en la fase 5B — el chip "Revisar
domicilio" de la bandeja de Altas, ver abajo.)*

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
8. ~~**Una solicitud que llegó con la categoría equivocada y que nadie toca** no
   queda marcada en ningún lado: `residenceMismatch` solo se computa al
   recategorizar. Candidato a señal de la bandeja o del resumen.~~ **Cerrado
   en la fase 5B (Tarea 6)**: `src/lib/applications/query.ts` computa
   `residenceMismatch` para cada fila con el mismo criterio EXACTO que
   `recategorizeApplicationAction`, y la bandeja de Altas lo muestra como el
   chip "Revisar domicilio".

## Módulo 5 — Panel de socio — **COMPLETO** (25/08/2026)

Se ejecutó en dos fases, como el Módulo 4: **5A** (shell, rediseño y lectura, sin
Mercado Pago, cerrada el 24/08/2026) y **5B** (débito automático autogestionado y
solicitudes, transaccional, cerrada el 25/08/2026). El diseño completo de las dos
fases, con las decisiones del operador y las enmiendas a `docs/02` y `docs/05`,
está en `docs/superpowers/specs/2026-08-24-modulo-5-panel-socio-design.md`.

### Fase 5A — Shell, rediseño y lectura — **CERRADA** (24/08/2026)

Shell propio de `/mi` con pestañas por URL (Inicio, Mi cuenta, Mis datos,
Estatuto; config pura en `src/lib/mi/nav.ts`, componente `MiTabs`), skip link,
`<main id="contenido" tabIndex={-1}>` y fronteras `error.tsx`/`not-found.tsx`
propias — hasta acá el panel caía en el chrome global y no tenía navegación.
`requireMember` ganó la opción `{ allowSuspended }` y el actor `ok` trae
`suspension: { from, to } | null`; con eso, el socio suspendido ve su panel, su
cuenta y sus recibos, y **puede pagar** — ninguna otra acción, cableado en la
home, la cuenta, la ruta del recibo propio y la action de pago. El cesante sigue
totalmente bloqueado. La home quedó reescrita alrededor de la **credencial de
socio** (franja con la foto aérea del barrio, número de socio del libro abierto,
categoría, antigüedad y estado electoral REG-31 — reutilizando la lógica del
padrón electoral de la fase 4C, `src/lib/members/electoral.ts`, en vez de
reimplementarla) más el estado de cuenta y los accesos; desapareció la tarjeta
muerta "Próximamente". `/mi/cuenta` quedó restyleada y perdió el link "← Inicio"
(las pestañas ya navegan). `/mi/datos` entra en funcionamiento: el socio ve su
ficha y edita teléfono, domicilio (queda "pendiente de constatación", columna
nueva `Member.addressPendingReview`, que la ficha admin puede marcar constatada)
y email (dispara la re-verificación REG-08 reutilizando `memberWriter.updateMember`
y `accountEmailNotice.announce`). `/mi/estatuto` + `GET /api/mi/estatuto`
publican el PDF (`datos/estatuto.pdf`) detrás de autenticación — el movido desde
el Módulo 2 del 19/08/2026 queda hecho.

Doce commits, 2346 tests, build y lint limpios.

**Dos enmiendas que dejó la fase:**

1. Se sacaron los **chips de filtro por año** de `/mi/cuenta` (decisión del
   operador, 24/08/2026): `AccountSection` —el componente que ya comparten
   `/mi/cuenta` y la ficha de tesorería del admin— arma el índice número→id de
   recibos a partir de la lista completa de pagos que recibe, así que pasarle
   una lista filtrada por año dejaba sin link clicable las celdas pagadas de los
   años que quedaban afuera del filtro. Arreglarlo de raíz exigía tocar ese
   componente compartido, fuera de lo pedido para esta fase, y hoy ningún socio
   del padrón tiene pagos en dos o más años. Quedó el restyle sin los chips
   (detalle técnico en la spec, §3.3).
2. La contradicción entre `docs/02` REG-20 ("no puede operar") y `docs/05` §7
   (que hablaba de un "panel en solo-lectura" sin precisar qué significaba) se
   resolvió a favor de **"ver + pagar"**: ya estaba decidida en la spec del
   módulo (§5.1) antes de escribir código; esta fase la implementó y los dos
   documentos quedaron alineados con una aclaración de implementación en
   REG-20.

### Fase 5B — Débito automático y solicitudes — **CERRADA** (25/08/2026)

Migración `20260825000751_member_requests`, **estrictamente aditiva**: la tabla
`member_requests` con sus tres FKs y el `ALTER` aditivo del enum de
`notifications.type` (verificado: agrega valores sin reordenar los existentes —
MariaDB remapea por string, no por índice). Apta para `migrate deploy` sobre la
base con socios reales.

**Qué quedó andando** (14 tareas):

- Los inputs del panel de socio a **48px** (la herencia de accesibilidad de la 5A
  que faltaba en `/mi/datos`).
- **`member_requests`** con reglas puras testeadas aparte y servicio con **mutex
  por socio**: la invariante "una pendiente por tipo" se sostiene con el conteo
  **dentro** de la transacción, bajo la clave `request:{memberId}`.
- **`/mi/solicitudes`**: el socio presenta su baja (REG-19) o su cambio de
  categoría (REG-07), ve el estado de cada solicitud y retira las pendientes.
- **Sección `/admin/solicitudes` unificada**: pestañas Altas | De socios con
  contadores, cola Pendientes / Historial, tarjetas, barra de asiento **sticky**
  (misma action de asiento de siempre), chip **"Revisar domicilio"** (cierra el
  ítem 8 de los insumos del M3, arriba) y el detalle de alta reordenado con el
  **visor de DNI embebido**.
- **Aceptación precargada**: el flujo con acta existente ganó un `requestId`
  opcional; al asentar, la solicitud queda `accepted` con su `movementId` y al
  socio le llega el aviso (`request_accepted` / `request_rejected`). Una
  solicitud de **renuncia no puede asentarse con otro motivo** (ver enmiendas).
- **Recategorizar con débito vivo empuja el monto a MP EN EL ACTO**: MP primero,
  lo local después, **corte total si MP falla** — y elige la suscripción que de
  verdad cobra (`isCharging` antes que `canStillCharge`).
- La referencia **`socio:{id}`**, reservada desde la 4B, quedó **estrenada**
  (`docs/06` §2), junto con el **veredicto puro de adhesión**
  (`src/lib/members/debit-adhesion.ts`), compartido por pantalla y action.
- **`src/lib/members/member-debit.ts`**: adherir / preview / syncStatus /
  cancelar. La fila local nace con su `memberId` y los cobros entran por la
  **regla 3 de `resolve.ts` sin tocarla**.
- **`/mi/debito`** + `/mi/debito/cancelar` (la frase de efecto en **segunda
  persona** vía `cancelEffectSentenceForMember`, agregado aditivo), la pestaña
  condicionada por categoría y la tarjeta en el Inicio.

**El núcleo de dinero quedó intacto**: cero modificaciones en `treasury/*`,
`resolve.ts`, `webhook-processor.ts` y `gateway.ts`; en `mp/` sólo dos agregados
aditivos (`references.ts`, `cancel-effect.ts`). Los tests de integración del
dinero (`receipt-sequence`, `mp-apply-concurrency`, `unique-violation`) pasan
sin ninguna modificación — era la regla transversal de la spec, y se cumplió por
construcción, no por retoque de aserciones.

Suite al cerrar: **172 archivos / 2512 tests** (desde los 2346 del cierre de la
5A), lint y build limpios. Los tres archivos de integración contra MariaDB real
siguen salteándose sin `DATABASE_URL_TEST`, como desde la 4C.

**Estado de los CA** (spec §12), con la batería de sandbox del 25/08/2026 — la
evidencia completa, con números de operación y los hechos medidos nuevos, está
en `docs/11` **J.6**:

| # | Criterio | Estado |
|---|---|---|
| CA-5B-1 | Un socio existente se adhiere en sandbox; el débito entra solo como cuota común, con recibo, nunca como `entry` | ✅ **por los DOS caminos**. Rodrigo (298): el webhook no llegó (solapa productiva vacía, ver J.6) y la **conciliación lo recuperó en su primera corrida** (`debitsRecovered: 1` → Payment `type: debit`, cuota 2026-09, recibo **2026-00008**). Roberto (535), ya con el panel bien configurado: **webhook directo** (`subscription_authorized_payment` → `debit_applied`, recibo **2026-00009**). Ninguno de los dos fue jamás `entry` |
| CA-5B-2 | El botón de adherir se bloquea con motivo y fecha si hay pago del mes, y vuelve a bloquearse tras adherirse | ✅ **en vivo**: cancelación desde la pantalla del socio → MP aceptó → webhook `subscription_preapproval` → espejo sincronizado → `autoDebit` bajó solo; la re-adhesión quedó bloqueada con "Ya abonaste una cuota este mes. Podés adherirte desde el 01/09/2026" (capturas del operador) |
| CA-5B-3 | Una solicitud de baja recorre el circuito entero hasta "baja por renuncia" con acta, queda `accepted` con `movementId` y el socio recibe el aviso | ✅ verificado el 25/08 con el circuito completo baja → bandeja → acta → notificación (socio de prueba restaurado al terminar) |
| CA-5B-4 | Aceptar un cambio de categoría con débito vivo actualiza MP antes de escribir lo local; si MP falla, no se escribe nada | ⚠️ por tests, con el **orden fijado por aserción** (MP primero, corte total, sin-suscripción, espejo). El push real de monto **no se ejercitó en sandbox**: no había divergencia que empujar |
| — | Regla transversal: los tests de integración del dinero pasan sin modificación | ✅ (arriba) |

**Enmiendas y decisiones que dejó la fase:**

1. **La bandeja de solicitudes se unificó** (24/08/2026, aprobada por el operador
   tras cuatro rondas de diseño): en lugar de una sección nueva "Solicitudes de
   socios" junto a la de Altas, `/admin/solicitudes` pasó a ser UNA sección con
   pestañas Altas | De socios. Fue un rediseño de **presentación**: las actions
   de altas, las actas, `record.ts` y los emails quedaron intactos, y la suite
   de `applications` pasó sin tocar una aserción (spec enmendada en §7.2).
2. **Una solicitud de renuncia no puede asentarse con otro motivo.** Hallazgo de
   la revisión de la Tarea 9: aplicarla con motivo "expulsión" dejaba al socio
   con `reentryBlocked` de por vida mientras la solicitud decía "aceptada" y el
   correo le informaba que le concedieron su renuncia — el Libro decía una cosa
   y el aviso otra.
3. **El panel de socio pasó a `max-w-3xl` y la pestaña se etiqueta "Débito"** a
   secas: con seis pestañas, el `max-w-2xl` de la 5A desbordaba en escritorio
   ("Estatuto" cortado). Reportado por el operador el 25/08 (spec §13).
4. **El aviso del débito al socio depende de las DOS solapas de webhooks del
   panel de MP** (hecho medido del sandbox, `docs/11` J.6): costó dos adhesiones
   descubrir que el token de una aplicación de cuenta de prueba dispara por
   "Modo productivo".

Ideas incorporadas durante el desarrollo del Módulo 1: que el socio vea cuántas
cuotas debe (cerrado en la 4A, `/mi/cuenta`); que pueda solicitar cambio de
categoría solo si no tiene deuda de tesorería (REG-07, **cerrado en la 5B**:
es una de las cuatro guardas de las reglas puras de `member_requests`). Del
Módulo 2: publicar el estatuto como PDF dentro del panel del socio (movido desde
el Módulo 2 el 19/08/2026; fuente: `datos/estatuto.docx`; **cerrado en la 5A**).
El CA original del módulo "un socio paga 2 cuotas atrasadas por link en sandbox"
ya había quedado verificado en la fase 4B (Checkout Pro desde `/mi/cuenta`,
pago real de $12.000); el del circuito de baja es el CA-5B-3 de arriba.

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
en `/admin/configuracion`** → **crontab con sus seis líneas** (`docs/11`, Parte H:
backup 04:00, `reconcile` 03:00, `applications` 08:05, `accrual` 00:30,
`digest` 07:30 y `reminder` 10:00) → **`digest_recipients` cargada** en
`/admin/configuracion`, o el resumen diario no se le manda a nadie → activar
`asociate_activo` → convocar re-empadronamiento dentro de los 90 días.

**El devengo no espera al lanzamiento.** Su línea del crontab tiene fecha dura
—**antes del 01/10/2026**— y es independiente de todo lo demás de esta lista: no
manda correos, así que la `EMAIL_ALLOWLIST` no lo afecta. Procedimiento completo en
`docs/10` §4.6.

Nota sobre los ids de plan: desde la fase 4A el monto no sale de ahí —`fee_values`
es la única fuente— y desde la fase 4B **los ids son opcionales**: el alta web, la
recategorización y el lote REG-34 leen la tabla local. Lo único que dejan de andar
sin ellos es el aviso de divergencia plan-vs-valor de la conciliación diaria, que
simplemente no corre.
