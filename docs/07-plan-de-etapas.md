# 07 — Plan de etapas (Módulos 0 a 6)

Regla: no se arranca un módulo sin cerrar los criterios de aceptación (CA) del anterior.
El lanzamiento público espera a la oficialización de la IGJ; hasta entonces todo
corre en staging (`sigev.redaccion.ar`) con MP en modo prueba. Los módulos 1-5 son
usables internamente desde antes del lanzamiento.

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

CA: los 285 registros importados con sus números originales y los 20 huecos correctos;
cargar una ficha completa (DNI, domicilio con calle del catálogo, email) toma <2 min;
una baja con acta queda en el historial y en auditoría; el email de verificación
llega vía Brevo y el estado cambia a `verificado`.

## Módulo 2 — Sitio público
Home (hero + botones con estados), cartelera de noticias + ABM admin, páginas
Ubicación y Estatuto, footer, SEO básico, responsive.

CA: publicar una noticia con imagen desde el panel y verla en la home desde un
celular; Lighthouse accesibilidad ≥90; ASOCIATE deshabilitado muestra el banner
correcto cuando `asociate_activo=false`.

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

## Módulo 5 — Panel de socio
Login/recupero, mis datos (con re-verificación de email), mi cuenta corriente,
pagar pendientes por link, aporte voluntario / adherir al débito (adherentes),
solicitar baja (circuito completo con aceptación por acta), vista suspendido.

CA: un socio real de prueba paga 2 cuotas atrasadas por link en sandbox y las ve
aplicadas con sus recibos; una solicitud de baja llega a la bandeja admin, se acepta
con acta y el socio queda `baja` con motivo `renuncia`.

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
Checklist: registrar/apuntar `vecinalciudadela.com.ar` → cert origin + Nginx →
credenciales MP productivas → webhooks productivos → SPF/DKIM/DMARC del dominio →
carga de fichas completa (163 vigentes, DNIs de los 107 adherentes) → suscripciones
preexistentes vinculadas → acta marco de admisión digital dictada (REG-12) →
textos legales aprobados por CD → activar `asociate_activo` → convocar
re-empadronamiento dentro de los 90 días.
