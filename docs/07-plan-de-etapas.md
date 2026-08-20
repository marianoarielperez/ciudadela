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

CA: los 283 registros importados con sus números originales y los 22 huecos correctos;
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
(planes, `POST /preapproval`, webhooks con `x-Signature`, WebhookEvent),
estados de solicitud, bandeja admin con asentar-en-acta masivo / recategorizar /
rechazar (con retención de ingreso y bloqueo 6 meses), creación de Socio+Membresía
al asentar, emails de resultado.

CA (en sandbox): un alta ACTIVO de punta a punta — wizard → checkout de prueba →
webhook → `aprobada_pendiente_acta` → asentada en acta → socio creado con número
siguiente y `fecha_ingreso` = fecha del acta; un adherente sin débito queda
`pendiente_cd`; un rechazo cancela la suscripción en MP y bloquea el DNI por 6 meses;
reintento de webhook duplicado no duplica nada.

Ideas incorporadas durante el desarrollo del Módulo 1: bloqueo del botón ASOCIATE
según el estado de la persona (socio vigente → avisarle que ya está asociado; ex
socio con `debt_at_withdrawal` → mensaje "acercate a la sede vecinal" sin dejarlo
continuar). Resumen mensual de socios aceptados para confeccionar el acta.

## Módulo 4 — Tesorería
Cuotas devengadas (cron día 1), aplicación automática de pagos, recibos PDF serie
única `AAAA-NNNNN` con envío por email, registro de efectivo, links de Checkout Pro,
bandeja sin-matching, vinculación de suscripciones preexistentes, deudores + propuesta
de cesantía (4 cuotas), pantalla de valores de cuota (MP vs local), conciliación
cron de respaldo, `/admin/salud`.

CA (sandbox): un débito recurrente de prueba genera Pago aplicado a la cuota del
período + Recibo correlativo enviado por email; un efectivo registrado emite recibo
imprimible; matar el webhook y correr el cron registra el pago igual; la numeración
de recibos no tiene huecos tras 20 pagos concurrentes de prueba.

Ideas incorporadas durante el desarrollo del Módulo 1: recibo automático por email
para los débitos acreditados; registro de pago en efectivo con envío automático
del comprobante por email; notificación el día 30 de cada mes a los socios con
cuotas adeudadas, indicando cuántas debe (notificación fehaciente); resumen diario
a las 9:00 a la Comisión con las novedades del día anterior (no se envía si no
hubo novedades); export del padrón electoral (REG-31), diferido desde el Módulo 1
porque depende del dato de deuda real.

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
Checklist: **cambiar `MP_ACCESS_TOKEN` a las credenciales productivas** (hasta el
lanzamiento el dominio corre con las de prueba) → **borrar `EMAIL_ALLOWLIST` del `.env`
del VPS** (mientras esté definida, los avisos a los socios NO salen) →
webhooks productivos apuntando a `vecinalciudadela.ar` → SPF/DKIM/DMARC del dominio
(ya autenticado en Brevo) → carga de fichas completa (160 vigentes: 55 activos +
105 adherentes) → suscripciones preexistentes vinculadas → acta marco de admisión
digital dictada (REG-12) → textos legales aprobados por CD → activar
`asociate_activo` → convocar re-empadronamiento dentro de los 90 días.
