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
- [ ] Que el cuerpo del webhook de MP traiga efectivamente `body.id`. Si no lo
      trajera, el fallback que arma la clave de idempotencia pasa a ser crítico.
- [ ] Rechazo y expiración cancelando una suscripción **real** en MP.
- [ ] Recategorización contra una suscripción real (hoy solo cubierta con dobles).

Ideas incorporadas durante el desarrollo del Módulo 1: bloqueo del botón ASOCIATE
según el estado de la persona (socio vigente → avisarle que ya está asociado; ex
socio con `debt_at_withdrawal` → mensaje "acercate a la sede vecinal" sin dejarlo
continuar). Resumen mensual de socios aceptados para confeccionar el acta.

## Módulo 4 — Tesorería

Se ejecuta en **tres fases**, cada una con su branch, su merge a `main` con los
tests en verde y su despliegue antes de empezar la siguiente.

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

Despliegue: `docs/10` §4, bloque "Específico de la fase 4A".

### Fase 4B — Mercado Pago (pendiente)

Gateway ampliado, webhook que **aplica** el pago (cuota + recibo + email), links de
Checkout Pro, bandeja sin conciliar, vinculación de suscripciones preexistentes,
conciliación diaria de respaldo, lote REG-34 ("aplicar el valor vigente a las
suscripciones") y **eliminación de la caché de planes**: recién ahí el wizard deja
de leer el monto de Mercado Pago y pasa a leer `fee_values`.

CA (sandbox local, notificaciones disparadas a mano): un
`subscription_authorized_payment` de prueba genera pago + cuota del período +
recibo por email; un pago `pago:{id}:2` aplica dos cuotas; un pago sin referencia
cae en la bandeja y se vincula desde ahí; matar el webhook y correr la conciliación
registra el pago igual; el lote actualiza el monto de una suscripción de prueba y
reporta la que falla.

### Fase 4C — Notificaciones y salud (pendiente)

Crons de devengo (día 1), aviso de mora (día 30) y resumen diario a la Comisión;
`payment_rejected` que avisa al socio; `Notification.failed` + reintento desde el
panel; `/admin/salud`; export del padrón electoral (REG-31); crontab completo
documentado.

CA: correr el devengo dos veces el mismo día crea una sola cuota por socio; el
aviso de mora en un día que no es 30 no envía nada y el 30 envía una sola vez a
cada deudor; el resumen sin novedades no se envía; un email con el transporte roto
queda `failed` y "Reintentar" lo saca; `/admin/salud` muestra las cinco corridas y
el backup.

**Alcance agregado el 21/08/2026 — propagación del valor de cuota (REG-34).**
Las suscripciones se crean **sin plan asociado** en MP y **copian** el monto
(`docs/06` §2, corregido tras medirlo contra la API real), así que **cambiar el
monto en el panel de Mercado Pago ya no se propaga solo a las suscripciones
vivas**. El M4 tiene que incluir una acción "aplicar el nuevo valor de cuota a
las suscripciones vigentes": recorre las suscripciones activas de la categoría y
les empuja el monto por API (`updatePreapprovalAmount`, ya implementado y
probado), con progreso, reintento de las que fallen, asiento de auditoría y
pantalla de "quedaron N sin actualizar". Es un lote de decenas o pocos cientos de
llamadas, hasta 4 veces al año: no es un problema de escala. Queda atado al acta,
que es más fiel al estatuto que el sync. **Hasta que exista, un cambio de cuota
en MP sólo afecta a las altas nuevas.**

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

Reparto tras cerrar la fase 4A: **1, 3, 4, 5 y 6 van a la 4B** (todo lo que toca
Mercado Pago); **2 va a la 4C** (junto con el resto de las notificaciones); **7
está cerrado**; **8 queda abierto** y sin fase asignada. La 4A no levantó ninguno:
su alcance era la cuenta corriente local.

1. **La conciliación debe barrer preapprovals sin fila local.** Si
   `createPreapproval` sale bien contra MP y la escritura local falla, queda un
   débito autorizado del que SIGeV no sabe nada. El único recupero posible es
   buscar en `GET /preapproval/search` los que tengan `external_reference =
   solicitud:{id}` y no tengan `MpSubscription`. Hoy el único rastro es un
   `console.error` en el log de PM2, que rota.
2. **`payment_rejected` todavía no le avisa a nadie.** El webhook registra el
   rechazo del débito y la solicitud sigue esperando, pero el socio no recibe el
   "no pudimos debitar tu cuota; MP va a reintentar" que promete `docs/06` §4.
   Confirmar que entra en el alcance del M4 junto con el seguimiento de mora.
3. **Un débito recurrente futuro puede revivir una solicitud vencida.** Comparte
   el mismo `external_reference` que el pago de ingreso, y `getPayment` no expone
   ni la fecha ni el tipo de pago, así que hoy no hay forma de distinguirlos.
   Requiere dos fallos coincidentes (webhook del ingreso perdido + cancelación
   fallida), pero se cierra solo agregando esos campos al gateway.
4. **Dos pagos de ingreso reales distintos sobre la misma solicitud** caen hoy en
   `already_processed`, indistinguibles de un reintento. Recuperable por el
   payload crudo; candidato a un `result` propio (`duplicate_entry_payment`).
5. **Cambiar los ids de plan no invalida la caché de montos** (hasta 24 h de
   retraso). Acotado el 21/08/2026: **ningún** camino que escriba un monto en MP usa
   ya la caché —ni `startPaymentAction` ni la recategorización: las dos leen el plan
   fresco y abortan si falla—, así que lo que queda es un monto viejo **en pantalla**
   (paso 2 del wizard), no un débito por el importe equivocado. **Sigue abierto
   después de la 4A**: la fase creó la tabla de valores de cuota y la hizo la única
   fuente de montos de tesorería, pero **no tocó `startPaymentAction`**, que sigue
   leyendo el plan de MP. La caché y esta lectura se van juntas en la 4B.
6. **Una solicitud re-suscripta a mano** (tras revivir por pago tardío) queda
   describiendo la suscripción nueva con la copia "verificá antes de gestionar".
   No es alcanzable hoy porque la re-suscripción es manual; si el M4 automatiza el
   alta de suscripciones, hay que revisar ese texto.
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
124 adherentes) → suscripciones preexistentes vinculadas (fase 4B) → acta marco de
admisión digital dictada (REG-12) → **textos legales aprobados por la CD y cargados
en `/admin/configuracion`** → **crontab instalado en el VPS** (`docs/11`, Parte H:
hoy `/api/cron/applications`; la fase 4C suma devengo, mora, resumen y
conciliación) → activar `asociate_activo` → convocar re-empadronamiento dentro de
los 90 días.

Nota sobre los ids de plan: desde la fase 4A **el monto ya no sale de ahí** —la
tabla de valores de cuota es la única fuente—, pero los ids **siguen siendo
obligatorios** porque `startPaymentAction` del wizard todavía lee el monto del plan
con `getPlan()`. Sin ellos, el paso 2 de ASOCIATE no avanza. Eso se migra en la
fase 4B; recién entonces los ids pasan a ser opcionales.
