---
title: Visión y panorama
subtitle: Qué es SIGeV, cómo está armado y en qué estado está
series: Serie técnica — Documento 1 de 7
docx: SIGeV-T1-Vision-y-panorama
version: 1.0
date: 11/09/2026
---

# Antes de empezar

## Para quién es y qué da por sabido

Este documento abre la serie técnica de SIGeV y está escrito para **una persona desarrolladora
que hereda el proyecto** sin el equipo que lo construyó: alguien que va a tener que corregir un
error, agregar una pantalla o desplegar una versión sin poder preguntarle a nadie por qué las
cosas son como son.

Da por sabido TypeScript, React con componentes de servidor, algún ORM sobre una base relacional
y el vocabulario habitual de una aplicación web. **No** da por sabido nada del dominio: ni el
estatuto de una asociación civil argentina, ni cómo funciona Mercado Pago, ni qué es un
re-empadronamiento. Todo eso se explica acá o en los documentos que este señala.

La regla que gobierna la serie: **la verdad es el código**. Donde la documentación previa del
repositorio —la carpeta `docs/`, el archivo de instrucciones del proyecto o el README— diga otra
cosa que lo que hace el programa, estos documentos describen el programa. Las diferencias
detectadas están anotadas aparte, en el archivo de hallazgos, y no se corrigieron en su origen.

## Cómo leer este documento

Los capítulos 1 a 3 son el panorama: qué hace el sistema, para quién y qué pantallas existen. El
capítulo 4 cuenta en qué orden se construyó, que es la mejor forma de entender por qué el código
está repartido como está. El capítulo 5 congela el estado al 11/09/2026: qué está desplegado, con
qué configuración corre y qué queda pendiente. El capítulo 6 explica cómo se trabajó, y el 7 es
la guía de lectura de los otros seis documentos, más un glosario.

Para resolver algo concreto, la tabla del capítulo 7 dice qué documento abrir según la tarea.
Cada capítulo cierra con "Dónde está en el código".

# 1. Qué es SIGeV y para quién

## La asociación

SIGeV es la plataforma web de la **Asociación Vecinal del Barrio Ciudadela**, una asociación
civil sin fines de lucro de Comodoro Rivadavia, Chubut, bajo contralor de la Inspección General
de Justicia provincial. Es una entidad chica: el padrón histórico tiene 278 fichas y las
personas que operan el sistema son un puñado de integrantes de la Comisión Directiva.

El estatuto vigente fue **reformado el 15/08/2026** y la reforma sigue **pendiente de
oficialización** por el organismo de contralor. Eso no es un detalle administrativo: hay
funcionalidad escrita, probada y apagada esperándola, y una llave de configuración cuyo único
propósito es permitir lanzar el sitio antes de que el organismo se expida.

El primer principio de diseño es que **el estatuto es la especificación**. Cada regla de negocio
cita el artículo del que sale, y esas reglas están numeradas de `REG-01` a `REG-37` en el
documento de marco estatutario del repositorio. Cuando una restricción parezca arbitraria, lo
más probable es que tenga un número de regla al lado y un artículo detrás. Ante duda de
interpretación, el criterio adoptado fue siempre el más conservador.

## Los cuatro procesos que digitaliza

Los nombres en mayúscula son como los ve el vecino en el sitio.

1. **Asociarse (ASOCIATE).** Un vecino se asocia desde la web en seis pasos, sube su documento,
   elige categoría y paga la cuota de ingreso por Mercado Pago; la Comisión Directiva resuelve
   después y asienta el alta en un acta.
2. **Re-empadronarse (REEMPADRONATE).** El proceso estatutario de depuración del padrón de
   socios adherentes (artículos 9° bis y 40): se convoca una cohorte, cada adherente confirma sus
   datos, la Comisión valida, quien no responde en plazo causa baja y el libro se cierra.
3. **Pagar y registrar cuotas sociales.** Débito automático conciliado solo, links de pago, cobro
   en efectivo por mostrador, recibos numerados en PDF y una bandeja para el dinero que entra sin
   saber de quién es.
4. **Reportes.** Reclamos e iniciativas de vecinos —socios o no—. Un **reclamo** se presenta ante
   un organismo (el municipio, la cooperativa de servicios públicos u otro); una **iniciativa** la
   trata la Comisión Directiva. La distinción viene del artículo 2 inciso g y del artículo 6, y
   atraviesa todos los textos de esa parte del sistema.

Alrededor hay tres superficies más: el sitio público institucional, el panel de administración
para la Comisión Directiva y el panel de autogestión para los socios.

## Los números del dominio

Son chicos, y eso explica decisiones de arquitectura que de otro modo parecerían ingenuas: un
solo proceso, exclusiones mutuas en memoria, una sola base.

| Magnitud | Valor |
|---|---|
| Fichas del Libro N° 1 (padrón histórico importado) | 278, numeradas de 1 a 306 con 28 huecos |
| Socios vigentes al importar | 160 (36 activos y 124 adherentes) |
| Bajas históricas | 118 |
| Socios con deuda al 21/08/2026 | 118, con 3076 cuotas impagas |
| Socios esperados después del re-empadronamiento | alrededor de 70 |

Las cuotas al 01/08/2026 son de $ 6.000 mensuales para la categoría activo (obligatoria) y
$ 3.000 para adherente (voluntaria) y colaborador (obligatoria). Los montos **no** están en el
código ni salen de Mercado Pago: viven en una tabla local de valores que la Comisión actualiza
desde el panel, con un tope estatutario de cuatro actualizaciones por año (`REG-34`).

## Qué NO es

- **No da de alta socios sin resolución de la Comisión.** Toda alta, baja o cambio de categoría
  queda vinculada a un acta; no hay forma de crear un socio suelto.
- **No es contabilidad.** No hay plan de cuentas, ni asientos, ni egresos, ni facturación
  electrónica ante el organismo fiscal. Sí registra los ingresos que no son de ningún socio
  —alquiler del salón, eventos, rifas, donaciones—, porque descartarlos mentía sobre plata que
  había entrado; pero es un registro plano y **no emite recibo**, porque la serie numerada de
  recibos es la de las cuotas sociales.
- **No maneja el proceso electoral.** Exporta el padrón electoral para la Junta Electoral y nada
  más.
- **No almacena datos de tarjetas.** Todo pago pasa por Mercado Pago; el sistema guarda
  identificadores de pago y de suscripción, nunca un medio de pago.
- **No es un sistema de tickets municipal.** Reportes es un registro de lo que el vecino planteó
  y de lo que la asociación hizo con eso: no promete resolución, no tiene acuerdo de nivel de
  servicio y no reemplaza el reclamo directo del vecino ante el organismo.
- **No ofrece desde la web las categorías cadete, honorario ni vitalicio.** El modelo las
  contempla y el panel puede registrarlas, pero el alta pública no las ofrece porque van por sede
  o por asamblea.

## Dónde está en el código

Conviene empezar por `docs/01-vision-y-alcance.md` (la visión acordada con el cliente) y
`docs/02-marco-estatutario.md` (las 37 reglas numeradas, cada una con su artículo). El esquema
entero está en `prisma/schema.prisma`. El código de aplicación vive en `src/`.


# 2. Los tres públicos y los tres roles

## Los públicos y las zonas

Atiende a tres públicos que no se solapan en lo que necesitan, y por eso hay tres zonas de
interfaz y tres manuales de usuario distintos.

| Público | Zona | Prefijo | Qué hace ahí |
|---|---|---|---|
| Vecino (socio o no) | sitio público | sin prefijo | Se informa, se asocia, se re-empadrona, presenta un reporte, entra a su cuenta |
| Socio | panel de socio | `/mi` | Ve su estado de cuenta, paga, adhiere el débito, actualiza sus datos, pide cambios |
| Comisión Directiva | panel de administración | `/admin` | Resuelve altas, cobra, lleva libros y actas, publica contenido, opera el sistema |

Quien entra a una zona protegida sin el rol correspondiente va a parar a la pantalla de ingreso;
en el panel de administración, una sesión bloqueada ve una barra mínima con el motivo. Las rutas
de datos bajo `/api` responden 403 con el motivo, o 404 cuando decir 403 filtraría información.
Después de iniciar sesión, una pantalla derivadora manda a cada persona a su zona según el rol;
quien no tiene ninguno va a la portada.

## Los tres roles

Son tres y son **acumulables**: una persona de la Comisión que además es socia tiene los dos
roles y ve las dos zonas.

| Rol | Quién lo tiene | Qué habilita |
|---|---|---|
| `superadmin` | La persona que opera el sistema | Todo, más configuración, usuarios, salud, padrón electoral y los actos irreversibles |
| `admin` | Presidente, secretario, tesorero y la Comisión | Solicitudes, altas y bajas por acta, socios, tesorería, actas, contenido |
| `socio` | Cada asociado con correo registrado | Su ficha, su cuenta corriente, sus recibos, sus solicitudes |

La autenticación es por correo y contraseña, con recupero por correo. Un socio cargado desde la
ficha recibe una invitación para crear su contraseña cuando se le registra un correo verificado.

## La nav es display; la autorización va en cada acción

Es la convención de seguridad más importante del proyecto y conviene entenderla el primer día.
**La navegación que se ve —la barra lateral del panel, las pestañas, las tarjetas del tablero—
filtra por los roles que trae la sesión, y eso es solamente presentación.** La sesión puede estar
hasta ocho horas desactualizada respecto de la base, así que lo que se ve no puede ser la única
defensa.

La autorización real se resuelve contra la fila viva de la persona usuaria y se aplica **dos
veces**: en la ruta que pinta la pantalla y otra vez en cada acción de servidor que escribe. El
motivo es concreto: una acción de servidor de este framework no se despacha por su dirección web
sino por un identificador que viaja en una cabecera, de modo que ni el intermediario de rutas ni
el marco de la página la protegen. Cada acción se autoriza a sí misma en su primera línea, sin
excepción.

## Dónde está en el código

Las guardas de administración viven en `src/lib/auth/require-admin.ts`. La del panel de socio
está en `src/lib/members/access.ts`. El intermediario de rutas es `src/proxy.ts`, y sólo
intercepta los dos prefijos protegidos. La única fuente de la navegación del panel es `src/lib/admin/nav.ts`; la
del panel de socio, `src/lib/mi/nav.ts`. El documento 7 desarrolla el modelo entero.


# 3. Mapa del sitio

Las tres tablas listan las pantallas de primer nivel con una línea cada una; las de detalle y
edición cuelgan de ellas. El detalle está en los documentos 6 y 7 y en los tres manuales.

## Sitio público

| URL | Qué es |
|---|---|
| `/` | Portada: imagen principal, llamados a la acción y las últimas tres noticias |
| `/noticias` y `/noticias/[slug]` | Listado paginado de diez por página, y la nota completa |
| `/actividades` | Calendario semanal de los salones, por día y espacio, con selector de año |
| `/ubicacion` | Mapa del Instituto Geográfico Nacional, dirección, contacto, salones e historia |
| `/reportes` | Puerta de entrada: reclamo o iniciativa, con contadores del año |
| `/reportes/nuevo` y `/nuevo/[claim]` | Wizard de reporte en tres pasos, y su retome por la llave |
| `/asociate` | Wizard de alta web, en seis pasos |
| `/asociate/retomar/[token]` | Retome de la solicitud; es también la vuelta desde Mercado Pago |
| `/reempadronate` | Wizard de re-empadronamiento, en cuatro pasos |
| `/reempadronate/retomar/[token]` | Retome, subsanación y estado de la presentación |
| `/ingresar` y `/ingresar/recuperar` | Inicio de sesión y pedido de recupero de contraseña |
| `/ingresar/restablecer/[token]` | Canje del enlace de recupero |
| `/acceso/[token]` y `/verificar/[token]` | Alta de contraseña por invitación, y verificación de correo |
| `/redirigir` | Derivador posterior al inicio de sesión, según el rol |
| `/api/imagenes/noticias/[name]` | Portadas de noticias: la única ruta de archivo pública |
| `/robots.txt`, `/sitemap.xml` | Posicionamiento; el mapa del sitio se arma en cada pedido |

Las pantallas que se abren con un token de un solo uso no llevan captcha: el token ya es la
barrera y sin él no hay nada que enumerar. Los formularios anónimos sí lo llevan.

## Panel de socio

| URL | Qué es |
|---|---|
| `/mi` | Inicio: credencial, estado de cuenta, débito y accesos rápidos |
| `/mi/cuenta` | Cuenta corriente: deuda, períodos, pagos, recibos y botón de pago |
| `/mi/debito` y `/mi/debito/cancelar` | Estado y adhesión del débito, y su cancelación |
| `/mi/datos` | Ficha del padrón; se editan teléfono, domicilio y correo |
| `/mi/solicitudes` | Institucional: baja por renuncia y cambio de categoría |
| `/mi/solicitudes/reportes` | Los reportes que presentó el socio, y el wizard en modo socio |
| `/mi/documentos` | Biblioteca: estatuto destacado, normas, memorias, balances y otros |
| `/api/mi/recibos/[id]` y `/api/mi/documentos/[id]` | PDF de un recibo propio y de un documento institucional |
| `/api/mi/reportes/[id]/archivos/[fileId]` | Imagen de un archivo propio de un reporte |

La pestaña de débito sólo aparece para las categorías que pagan cuota, y eso también es
presentación. Un socio suspendido entra y paga, pero no adhiere el débito ni presenta solicitudes.

## Panel de administración

| URL | Qué es |
|---|---|
| `/admin` | Tablero con las tarjetas por grupo |
| `/admin/solicitudes` | Altas web: cola, historial y ficha de cada una |
| `/admin/solicitudes/resumen` y `/admin/solicitudes/socios` | Resumen mensual para acta, y solicitudes del panel de socio |
| `/admin/solicitudes/reportes` | Cola de reclamos e iniciativas, con ficha, mapa y PDF |
| `/admin/reempadronamiento` | Tablero del proceso estatutario |
| `/admin/reempadronamiento/convocar` | Convocatoria con acta (superadmin) |
| `/admin/reempadronamiento/presentaciones` | Cola de validación y ficha de cada una |
| `/admin/reempadronamiento/presencial` | Carga presencial de una presentación |
| `/admin/reempadronamiento/cierre` | Checklist, bajas en lote y cierre (superadmin) |
| `/admin/socios` | Padrón con resumen, chips y filtros |
| `/admin/socios/[id]` | Ficha del socio, en cuatro pestañas |
| `/admin/socios/[id]/[accion]` | Baja, cambio de categoría, suspensión o reingreso |
| `/admin/socios/[id]/link` | Link de pago de una o varias cuotas para ese socio |
| `/admin/socios/nuevo` y `/admin/socios/carga/[numero]` | Alta manual con acta, y modo carga |
| `/admin/socios/libros` y `/admin/socios/historico` | Libros abiertos y cerrados, y socios de libros cerrados |
| `/admin/tesoreria/deudores` y `/admin/tesoreria/efectivo` | Deudores con cesantía en lote, y cobro por mostrador |
| `/admin/tesoreria/deudores/gestion-manual` | Lista imprimible de deudores sin correo |
| `/admin/tesoreria/recibos` | Recibos: listado, PDF, reenvío y anulación |
| `/admin/tesoreria/sin-conciliar` | Bandeja de cobros de Mercado Pago sin imputar |
| `/admin/tesoreria/suscripciones` | Suscripciones vinculadas y sin vincular |
| `/admin/tesoreria/otros-ingresos` | Ingresos que no son de ningún socio |
| `/admin/tesoreria/valores` | Valores de cuota y actualización en lote |
| `/admin/tesoreria/exenciones` | Exenciones de cuota vigentes e historial |
| `/admin/actas` | Actas por tipo y año, con exportación |
| `/admin/noticias`, `/admin/actividades` y `/admin/documentos` | Noticias, calendario de la sede y documentos institucionales |
| `/admin/salud` | Veredicto del sistema, en cuatro pestañas (superadmin) |
| `/admin/padron-electoral` | Padrón electoral a una fecha (superadmin) |
| `/admin/usuarios` | Cuentas de gestión y roles (superadmin) |
| `/admin/configuracion` | Parámetros, en cinco pestañas (superadmin) |

Hay además doce rutas de descarga bajo `/api/admin` —exportaciones, recibos, documentos
personales y PDF—: todas con su guarda, sin caché y con asiento si es un documento personal.

## Dónde está en el código

Cada dirección se corresponde con una carpeta bajo `src/app`. Los mapas completos, con archivo y
línea, están en los informes de relevamiento.


# 4. Los módulos, en el orden en que se construyeron

Cada módulo tuvo su especificación, su plan y sus criterios de aceptación, con la regla de no
arrancar uno sin cerrar el anterior. Ese orden explica la forma del código mejor que cualquier
diagrama: las piezas tempranas son genéricas porque todavía no sabían qué iba a venir. Las
fechas son las del repositorio: la del commit que cierra el módulo o la de su fusión.

| Módulo o fase, con su cierre | Qué trae |
|---|---|
| 0 — Base · 17/08/2026 | Esqueleto, base, sesión y roles, auditoría, despliegue y respaldos |
| 1 — Padrón interno · 19/08/2026 | Importación del padrón, socios, libros, actas y modo carga |
| 2 — Sitio público · 20/08/2026 | Portada, noticias, actividades, ubicación y cabeceras |
| Shell del panel · 20/08/2026 | Marco compartido: encabezado, mensajes, estado vacío, lateral |
| 3 — ASOCIATE y pagos · 21/08/2026 | Wizard de alta web, elegibilidad, cuota de ingreso y pagos |
| 4A — Cuenta corriente · 22/08/2026 | Valores de cuota, devengo, deuda, efectivo y recibos |
| 4B — Mercado Pago · 23/08/2026 | Webhook, links, suscripciones, bandeja y conciliación |
| 4C — Crons y salud · 24/08/2026 | Tareas programadas, correo, salud y padrón electoral |
| 5A — Panel de socio · 24/08/2026 | Marco propio, credencial, cuenta corriente y autogestión de datos |
| 5B — Débito y solicitudes · 25/08/2026 | Débito autogestionado y solicitudes de socios |
| Actividades · 25/08/2026 | Semana de lunes a sábado, cuatro espacios y calendario nuevo |
| 6A — Socios · 26/08/2026 | Padrón, Libros e Histórico, con la foto de cierre |
| 6B — Re-empadronamiento · 26/08/2026 | Proceso, cohorte, wizard público y cartelera |
| 6C — Cierre del libro · 26/08/2026 | Checklist, bajas en lote y cierre con renumeración |
| Exención de cuota · 27/08/2026 | Exenciones con acta y cinco cortes de cobro |
| Paso de documento · 27/08/2026 | Elegibilidad temprana: el alta pasa a seis pasos |
| Padrón electoral · 27/08/2026 | Tercer bloque, exportación y rediseño |
| Mejora visual · 27/08/2026 | Pie institucional, imagen principal y tablero |
| Ubicación · 28/08/2026 | Mapa del Instituto Geográfico Nacional y sección de la sede |
| Tres pantallas · 28/08/2026 | Configuración, Salud y Actividades rediseñadas |
| Actas · 29/08/2026 | Cronología por año y exportación de constancia en PDF y Word |
| Usuarios y roles · 29/08/2026 | Cuentas de gestión, roles, invitaciones y desactivación |
| Invitación por correo · 29/08/2026 | La invitación de contraseña viaja por correo |
| Documentos · 30/08/2026 | Estatuto, memorias y balances en el panel y en el panel de socio |
| Admisión de ASOCIATE · 01/09/2026 | Nada promete admisión antes del acta |
| 7 — Reportes · 02/09/2026 | Reclamos e iniciativas: wizards, bandeja, mapa y PDF |
| Llave de colaborador · 02/09/2026 | Cierra la categoría hasta la oficialización |
| Pestañas de sección · 02/09/2026 | Forma de solapa en las nueve barras de pestañas |
| Navegación móvil · 02/09/2026 | Tira grande con flechas flotantes en el panel de socio |
| Número de reporte · 03/09/2026 | El número público se asigna al enviar, con serie |
| 4D — Reparto · 10/09/2026 | Un cobro se reparte entre hasta cinco socios en una transacción |
| Pagos ajenos · 11/09/2026 | El cron detecta lo que la cuenta pagó y no lo cobra |

Tres observaciones. **Los módulos 4 y 6 son los más pesados y los más medidos**: dispararon
correcciones que ningún test podía anticipar, porque venían de medir contra un servicio externo o
contra la base real en lugar de suponer. **A partir del módulo 4 casi nada se reimplementa**:
cuando dos caminos necesitan la misma regla se comparte la función, porque hay varios casos en
los que una regla copiada divergió en silencio. Y **los módulos posteriores al 6 tocaron muy poco
código anterior**: la exención de cuota y el de reportes cerraron sin modificar ni un archivo
existente del núcleo de tesorería ni del de pagos.

## Dónde está en el código

Cada módulo dejó una especificación en `docs/superpowers/specs` y un plan en la carpeta hermana:
treinta especificaciones y treinta y cuatro planes al 11/09/2026. El plan de etapas consolidado
está en `docs/07-plan-de-etapas.md`.


# 5. Estado al 11/09/2026

## Qué está desplegado

Hay **un solo entorno**: el dominio `vecinalciudadela.ar`. El entorno de prueba que existió al
principio se dio de baja el 20/08/2026, y lo que la documentación previa dice sobre él es
historia, no el estado actual.

Producción corre el commit **`243aa26`** desde el despliegue del 11/09/2026 —confirmado por el
operador el 12/09/2026—, hecho con el script del repositorio, que aplica las migraciones
pendientes. **Todo lo que estaba integrado a la rama principal hasta ese commit está
desplegado**: el reparto de un cobro entre socios, el número público de reporte, la llave de
colaborador, las pestañas de sección, la navegación móvil del panel de socio y el arreglo de
pagos ajenos en la conciliación. La migración del reparto quedó aplicada en ese mismo despliegue.

Lo único que quedó fuera es la rama de esta serie de documentación, todavía sin integrar. La rama
principal y su copia remota coinciden exactamente, las ramas de las piezas listadas arriba ya se
borraron, y al 11/09/2026 hay 825 commits y 24 migraciones de base de datos.

Conviene saberlo porque tanto el plan de etapas como la sección de prioridad del archivo de
instrucciones **todavía describen varias de esas piezas como pendientes de fusión o de
despliegue**. Esa descripción quedó atrás y está anotada en el archivo de hallazgos. Las cuatro
migraciones más recientes, todas ya aplicadas en producción, son:

| Migración | Qué trae |
|---|---|
| `add_reports` | Las tablas del módulo de reportes |
| `report_minute_restrict` | El acta de presentación de un reporte queda protegida contra borrado |
| `report_public_number` | El número público de reporte, con su serie; **renumera lo ya enviado** |
| `payment_split` | El reparto de un cobro entre socios |

## Con qué configuración corre

El dominio corre con **credenciales productivas de Mercado Pago desde el 22/08/2026**, a partir
de un piloto real: un socio se afilió por la web y su débito mensual funciona. La consecuencia
operativa no tiene excepciones: **no se prueban cobros contra el dominio**, porque ahí la plata
es de un vecino. El circuito de pagos se prueba en un entorno local contra el modo de pruebas del
proveedor. El sitio está publicado pero no difundido, y el alta web y la categoría colaborador
están apagadas por configuración.

Del entorno del servidor —qué variables están definidas, qué líneas tiene el crontab, qué llaves
de configuración están encendidas— el repositorio no dice nada, y varias de esas respuestas
cambian por completo el comportamiento del sistema. Hay procedimientos de verificación posterior
al despliegue en las secciones 4.9, 4.10 y 4.11 del runbook: ejecutarlos es la forma más rápida
de confirmar el punto de partida.

## Lo que queda pendiente

| Pendiente | Qué es | De quién depende |
|---|---|---|
| Oficialización del estatuto | La reforma del 15/08/2026 sigue sin aprobación del contralor | Externo |
| Corregir motivos de baja | El script `scripts/fix-withdrawal-reasons.ts` no se corrió en el servidor | Operación |
| Borrar la lista blanca de correo | Mientras esté definida, **ningún** aviso sale fuera de la lista | Operación, al lanzar |
| Cargar los destinatarios del resumen | Sin ellos, el resumen diario no se manda a nadie | Operación |
| Encender el alta web | Está apagada por configuración | Operación, al lanzar |
| Encender la llave de colaborador | La categoría es de la reforma; se prende el día de la oficialización | Operación |
| Acta marco de admisión digital | La resolución que respalda el alta web (`REG-12`) | Comisión Directiva |
| Vincular suscripciones preexistentes | Las creadas a mano en el panel del proveedor | Operación |
| Convocar el re-empadronamiento | Dentro de los noventa días de la oficialización | Comisión Directiva |
| Integrar esta serie de documentación | Vive en su propia rama | Desarrollo |

Hay además un hallazgo abierto registrado el 11/09/2026: **los avisos del proveedor de pagos
llegan tarde o no llegan**, y por ahora el dinero lo asienta la conciliación diaria. La red
funciona —para eso está—, pero la causa no está cerrada.

Una advertencia sobre los identificadores: en esta serie aparecen números de socio, de pago, de
recibo y de acta, y **los que salen de pruebas locales no aplican a producción**. La base local se
sembró y se limpió varias veces, tiene fichas inventadas y series reiniciadas.

## Dónde está en el código

La lista de migraciones está en `prisma/migrations`. La verificación posterior a cada despliegue
vive en `docs/10-runbook-dominio-productivo.md`, y el checklist de lanzamiento, al final de
`docs/07-plan-de-etapas.md`.

# 6. Cómo se desarrolló

Conviene saberlo porque hay archivos que parecen documentación y en realidad son contrato.

## El archivo de instrucciones es un contrato, no un README

En la raíz hay un archivo de instrucciones del proyecto que se lee antes de tocar código. No
describe el sistema: **fija decisiones**. Dice qué tecnologías no se negocian, cómo se escriben las
fechas y los importes, dónde van los archivos subidos, y acumula los patrones que estrenó cada
módulo con la lección que los produjo. Un cambio que lo contradiga lo actualiza en el mismo commit.

## Especificación, plan, ejecución

Cada módulo siguió el mismo circuito: una **especificación** acordada con el operador, un plan en
tareas con criterios de aceptación, ejecución tarea por tarea con tests primero, y una revisión
final antes de fusionar. Especificaciones y planes están versionados en `docs/superpowers`, con la
fecha en el nombre. Hay una tercera carpeta, la del espacio de trabajo de las sesiones, que **está
excluida del control de versiones**: una referencia a un archivo inexistente suele venir de ahí.

## Qué es un "test de fuente"

Trece archivos de la suite no ejercitan una función: **leen el repositorio**. Verifican que cada
renglón de la navegación tenga su archivo de pantalla en disco, que una política de seguridad
declarada en una ruta coincida con la entrada correspondiente de la configuración del framework,
que un módulo que debe ser puro no tenga ni un solo `import`, o que una convención de estilo no se
revierta.

Existen porque hay convenciones que ningún test de comportamiento sostiene: un renglón que apunta
a una pantalla inexistente no rompe nada hasta que alguien hace clic, y una política declarada
pero no repuesta en la configuración no llega al navegador, sin error. Un test que falla al
renombrar una carpeta suele ser uno de estos.

La suite son 297 archivos y 4183 casos (14 omitidos sin base de datos); cuatro archivos corren
contra una base real. **No hay integración continua**: los tests se corren a mano.

## El despliegue

Es por repositorio: se publica a la copia remota, se extrae en el servidor y se ejecuta un script
que instala dependencias, aplica migraciones, corre la semilla —idempotente, y lo único que crea
las llaves de configuración que estrena cada módulo—, compila y reinicia el proceso, con un gestor
de procesos en una única instancia detrás de un servidor web. **Una sola instancia no es un
descuido**: hay exclusiones mutuas y limitadores que viven en la memoria del proceso.

## Dónde está en el código

El contrato está en `CLAUDE.md`, en la raíz. Al lado vive el script de despliegue, `deploy.sh`.
Las especificaciones y los planes están versionados en `docs/superpowers`.


# 7. Guía de lectura y glosario

## Qué documento abrir según la tarea

| Para… | Abrir |
|---|---|
| Entender el sistema por primera vez | Este documento (T1) |
| Levantar el proyecto en una máquina local | T3, capítulo 1 |
| Agregar una pantalla o una acción de servidor | T2, capítulos 2, 4, 6 y 7 |
| Tocar el esquema o escribir una migración | T4 |
| Entender cómo entra la plata, o arreglar un pago | T5, capítulos 2, 4 y 7 |
| Entender el padrón, el alta web o los reportes | T6, capítulos 1, 2, 4 y 5 |
| Desplegar, operar o diagnosticar una caída | T3, capítulos 4 a 10 |
| Responder una pregunta de privacidad o seguridad | T7 |
| Explicarle el sistema a la Comisión, a un socio o a un vecino | M1, M2 y M3 |

## Glosario

En el orden en que suelen aparecer al leer el sistema, no alfabético.

- **Acta.** El documento de una reunión de la Comisión Directiva o de una asamblea, con tipo y
  número. Ninguna alta, baja, cambio de categoría, exención ni cierre de libro existe sin una.
- **Socio activo, adherente, colaborador.** Las tres categorías que se ofrecen desde la web: el
  activo paga cuota obligatoria y tiene derechos plenos, el adherente paga una cuota voluntaria y
  el colaborador reside fuera del barrio. El modelo contempla además cadete, honorario y vitalicio.
- **Libro y padrón.** El libro es el registro de asociados, espejado del físico; el padrón, la
  lista de socios de un libro abierto. Al cerrarse un libro, sus socios vigentes migran
  renumerados al siguiente.
- **Cuota de ingreso.** El pago de quien se asocia, de un mes de cuota de su categoría. No es
  reembolsable y **cubre el mes en que ingresó**, así que nadie le reclama ese mes.
- **Devengo.** El proceso mensual que crea la fila de cuota de quien corresponda. No cobra.
- **Piso de cobertura.** Desde qué mes se le puede reclamar cuota a un socio. Lo comparten el
  devengo, el aviso de deuda y la imputación: es una sola función.
- **Valor vigente.** El monto que rige hoy, leído de la tabla de valores. Las cuotas no guardan
  monto: **la deuda se valúa al valor vigente al pagar**. Un valor nuevo se registra encima del
  anterior y nunca se edita, como un acta.
- **Imputación.** Decidir qué cuotas cancela un pago: siempre **las más viejas primero**.
- **Recibo.** El comprobante numerado de un cobro de cuota social, con serie por año y **sin
  huecos**: el número se pide dentro de la transacción y el PDF se escribe después de
  confirmarla.
- **Exención de cuota.** El beneficio que la Comisión otorga por acta: se materializa como cuotas
  exentas del período y bloquea los cinco caminos de cobro de ese socio.
- **Débito automático.** El cobro mensual recurrente de Mercado Pago, que en el vocabulario del
  proveedor se llama **preapproval**. Un débito paga una cuota.
- **Link de pago.** Una preferencia de un solo uso para pagar varias cuotas. Lleva la cantidad, no
  la lista de períodos, y **vence a las 72 horas** para no congelar el precio.
- **Bandeja (sin conciliar).** La cola de cobros que entraron y el sistema no pudo imputar.
- **Reparto.** Resolver una fila de la bandeja repartiendo un cobro entre hasta cinco socios: un
  pago portador con el identificador del proveedor y partes que cuelgan de él.
- **Conciliación.** La tarea diaria que busca en el proveedor lo que no llegó por aviso.
- **Cesantía por mora.** La baja por atraso que habilita el estatuto: individual desde la ficha o
  en lote desde Deudores, siempre con acta.
- **Cohorte.** La lista de convocados, que **se congela al convocar**.
- **Presentación.** Lo que un convocado envía; vive aparte de la ficha hasta que la Comisión valida.
- **Cartelera.** La vía subsidiaria para quien no tiene casilla utilizable: se fija un cartel en la
  sede, el plazo corre en **días hábiles** y la fecha que acredita es la del vencimiento.
- **Reporte, reclamo, iniciativa.** Un reporte es lo que un vecino presenta. Si es un **reclamo**,
  la asociación lo presenta ante un organismo; si es una **iniciativa**, la trata la Comisión
  Directiva. Prometerle un organismo a quien propuso una idea es prometer algo que no se va a
  hacer, y por eso el texto de cada pantalla se revisa en los dos casos.
- **Token de un solo uso.** El enlace con el que se retoma un trámite, se verifica un correo o se
  crea una contraseña. Tiene vencimiento y se consume de forma atómica.
- **Lista blanca de correo.** Una variable de entorno que, si está definida, hace que **ningún**
  correo salga fuera de las direcciones que enumera. Envuelve el transporte, así que ninguna
  pantalla puede olvidarse de aplicarla.
- **Cron.** Cada tarea programada que el servidor dispara por pedido web, protegida por un secreto
  compartido: cinco de aplicación —conciliación, devengo, mantenimiento de solicitudes, resumen
  diario y recordatorio— más el respaldo. Una que decide no actuar **no cuenta como corrida**.
- **Salud.** La pantalla que resume el estado con un veredicto de dos niveles: *actuar* (algo roto
  con una salida que lo apaga, el único rojo) y *revisar*. Ningún indicador nace en rojo.
- **Auditoría.** El registro de toda acción sensible del panel. Guarda identificadores, códigos,
  conteos y montos; nunca nombres, documentos, correos ni domicilios.

## Dónde está en el código

Cada término tiene su capítulo en los documentos 4 a 7, y su implementación bajo `src/lib`.


# Documentos relacionados

| Documento | Contenido |
|---|---|
| T1 — Visión y panorama | Este documento |
| T2 — Arquitectura y código | Stack, zonas, capas, patrones transversales y componentes compartidos |
| T3 — Instalación, despliegue y operación | Entorno local, variables, producción, crons, respaldos, salud y runbooks |
| T4 — Modelo de datos | Esquema entero por dominios, enums, invariantes y migraciones |
| T5 — Tesorería y Mercado Pago | Cuotas, cobros, recibos, exención, integración de pagos y correos |
| T6 — Módulos de dominio | Altas, socios y libros, solicitudes, re-empadronamiento, reportes, actas y contenido |
| T7 — Seguridad, privacidad y calidad | Sesión, tokens, límites, cabeceras, archivos, Ley 25.326, auditoría y tests |
| M1 — Manual del operador | El panel de administración, pantalla por pantalla |
| M2 — Manual del socio | El panel de socio |
| M3 — Guía del vecino | El sitio público y los tres trámites |

La carpeta `docs/` del repositorio conserva la especificación acordada con el cliente y el
material operativo: visión y alcance (01), marco estatutario con las reglas numeradas (02),
arquitectura e infraestructura (03), modelo de datos (04), flujos funcionales (05), integración
de pagos (06), plan de etapas (07), seguridad y privacidad (08), relevamiento del servidor (09),
runbook del dominio productivo (10) y preparación del entorno de pruebas (11). Las diferencias
detectadas entre esos documentos y el código están listadas en el archivo de hallazgos con fecha
11/09/2026, dentro de `docs/manuales`: no se corrigieron en su origen, porque este documento
describe el código.
