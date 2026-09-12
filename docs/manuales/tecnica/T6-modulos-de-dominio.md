---
title: Módulos de dominio
subtitle: Solicitudes, socios, re-empadronamiento, reportes, actas y contenido
series: Serie técnica — Documento 6 de 7
docx: SIGeV-T6-Modulos-de-dominio
version: 1.0
date: 11/09/2026
---

# Para quién es y qué da por sabido

Este documento es para el desarrollador que hereda SIGeV y tiene que tocar algo que no
es plata: una solicitud de alta, una ficha de socio, el re-empadronamiento del Art. 9°
bis, un reporte del vecino, un acta o el contenido del sitio.

Da por sabido lo que explican los documentos anteriores de la serie: el panorama del
sistema (T1), la arquitectura por capas y el shell del panel (T2), cómo se levanta y se
despliega (T3) y el esquema de la base (T4). El dinero vive entero en T5 y acá sólo
aparece cuando un módulo de dominio lo toca de refilón. No da por sabido el estatuto:
cada regla que viene de ahí se cita con su identificador `REG-xx` del documento
`docs/02-marco-estatutario.md`.

# Cómo leer este documento

Cada capítulo cubre un módulo y termina con "Dónde está en el código". Las máquinas de
estado van siempre como tabla de tres columnas: el estado, cómo se entra y cómo se sale; si
una transición no está en la tabla, no existe. Lo que se describe es el código al
11/09/2026, no lo que dicen las specs: donde los dos difieren manda el código y la
diferencia está anotada en el archivo de hallazgos.

El orden sigue el ciclo de vida de una persona: cómo entra (1), qué le pasa mientras es
socio (2 y 3), la depuración estatutaria que puede sacarla (4), y lo que no depende de ser
socio: reportes (5), actas (6), contenido (7), cuentas de gestión (8) y padrón electoral
(9).

# 1. Solicitudes de alta (ASOCIATE)

Una solicitud de alta es una fila de `Application`: lo que el vecino carga en el wizard
público de seis pasos mientras la Comisión Directiva no la resuelva. No es un socio, y
ninguna pantalla lo trata como tal antes del asiento en acta.

## 1.1 Máquina de estados

| Estado | Cómo se entra | Cómo se sale |
|---|---|---|
| `started` | El paso 4 crea la fila | Al pago, a la Comisión (sin débito) o al vencimiento |
| `pending_payment` | Arrancó el checkout y hay suscripción en Mercado Pago | El aviso de cobro, el vencimiento a los 7 días, o el rechazo |
| `approved_pending_minute` | Llegó el pago de la cuota de ingreso | El asiento en acta, o el rechazo |
| `pending_board` | El adherente sin débito envió | El asiento en acta, o el rechazo |
| `completed` | El asiento creó o reactivó la ficha | Terminal |
| `rejected` | Rechazo con acta obligatoria | Terminal |
| `expired` | El cron de mantenimiento la venció | Revive si después llega el pago |

`LIVE_APPLICATION_STATUSES` son los cuatro estados en los que la solicitud "existe" para
el vecino y bloquean una segunda con el mismo DNI. Los dos asentables en acta se revalidan
**dentro** de la transacción del asiento, porque la bandeja es masiva y dos administradores
pueden estar asentando el mismo lote. Rechazar también es una decisión posible sobre una
solicitud que todavía no pagó: el conjunto decidible es más amplio que el asentable.

Las transiciones que pueden llegar por duplicado —el envío sin débito, el rechazo, el
vencimiento del cron y el aviso de cobro— se escriben como actualización condicional, con
el estado de origen dentro del filtro. Así, dos envíos simultáneos escriben uno solo, y
sólo el que escribió manda el correo y deja el asiento de auditoría. Las otras dos no lo
necesitan y no lo usan: el paso del wizard al checkout y el asiento en acta escriben por
identificador, porque ya vienen serializadas por el flujo que las dispara.

## 1.2 Elegibilidad por DNI

`checkEligibility` es una función pura: la action junta los insumos (ficha por DNI,
solicitud viva, último rechazo) y la regla decide. No toca la base, así que la tabla
entera de casos se prueba sin fixtures. Las causales, en el orden en que se evalúan:

| Causal | Condición | Qué ve el vecino |
|---|---|---|
| 1 · en trámite | Hay una solicitud viva con ese DNI | "Ya tenés una solicitud en trámite" y el reenvío del enlace |
| 2 · ya es socio | Ficha vigente o suspendida | "Ya estás asociado/a" (el suspendido ve lo mismo) |
| 3 · expulsado | La baja tiene motivo de expulsión | Nombra la expulsión y su ratificación (REG-04) |
| 4 · a la sede | Reingreso bloqueado sin expulsión asentada | Desvío genérico a la sede |
| 5 · a la sede | Baja por fallecimiento o anulación de duplicado | El mismo desvío, indistinguible |
| 6 · deuda | Registra cuotas pendientes; sin saldarlas no hay reingreso (REG-16) | Cuántas cuotas, nunca cuántos pesos |
| 7 · espera | El bloqueo por rechazo no venció | Desde qué fecha reintentar (REG-05) |
| 8 · sin bloqueo | Ex socio, o DNI desconocido | Reingreso (REG-25) o alta común |

La expulsión se nombra con todas las letras desde el 27/08/2026 y es la única excepción a
la indistinguibilidad del resto: las causales 4 y 5 comparten literal exacto a propósito. Lo
que bloquea por deuda es la deuda **viva** de la cuenta corriente, no la bandera histórica
que quedó anotada al dar la baja.

Los insumos los carga `loadEligibilityInputs`, una sola función para los dos call-sites: el
chequeo temprano del paso 1 y la guarda del envío del paso 4. El paso 1 agrega encima una
capa de privacidad: el nombre sale enmascarado, la deuda se expresa en cantidad de cuotas y
el reingreso habilitado es indistinguible del DNI desconocido. Es cortesía de interfaz, no
una guarda —el POST del paso 4 revalida todo— y no se audita, también a propósito.

## 1.3 Residencia, categoría y la llave del colaborador

El alta web ofrece tres categorías de las seis del enum: activo, adherente y colaborador.
El cadete se asocia en la sede; honorario y vitalicio las otorga la Comisión por acta.

Qué categoría corresponde lo decide la residencia, en dos funciones encadenadas.
`categoryAllowedForResidence` es la regla estatutaria pura (REG-01): en el barrio, activo
o adherente; fuera, colaborador. Encima va `categoryOfferedOnWeb`, que es la anterior más
la llave de configuración `colaborador_habilitado`.

La llave existe porque la categoría de socio colaborador es del estatuto reformado,
pendiente de la Inspección General de Justicia, y el sitio se lanza antes. Con la llave
apagada —y ausente cuenta como apagada— la rama "En otro barrio" no admite ninguna
categoría; el mensaje es uno solo y lo dicen las dos puntas: la tarjeta deshabilitada y el
rechazo del POST. Cambiar de rama en el paso 2 limpia el domicilio y también la categoría,
porque sería una respuesta que el vecino nunca dio.

## 1.4 La cuota de ingreso y la solicitud revivida

La cuota de ingreso equivale a un mes de cuota de la categoría elegida y no es reembolsable
(REG-14). El monto sale siempre de la tabla de valores de cuota, nunca de los planes de
Mercado Pago: sin valor vigente no se crea la suscripción y el paso 3 se niega a mostrar
categorías. El débito sólo es opcional para el adherente.

El caso interesante es el pago tardío. El cron vence la solicitud a los siete días y manda
a cancelar la suscripción; si Mercado Pago demora el aviso, puede llegar un cobro cuando
la fila ya está vencida. La decisión del cliente del 21/08/2026 es que el pago manda sobre
el vencimiento: el procesador del webhook intenta primero la transición desde
`pending_payment` y, sólo si esa no encontró nada, la intenta desde el estado vencido. La
segunda se asienta con `auditStrict`, porque ahí el asiento **es** la señal: el estado
final es idéntico al de una aceptación normal y sin ese registro nadie se entera de que el
alta puede haber quedado sin débito. De ese hecho cuelga el aviso de la ficha, que es de
tres estados: suscripción cancelada, sin fila local, o cualquier otro estado —que manda a
mirar el panel de Mercado Pago.

## 1.5 Vencimientos y cron de mantenimiento

El cron de solicitudes corre todos los días con dos tareas. El recordatorio de pago sale a
los tres días de haber quedado esperando el pago, una sola vez; el vencimiento cae a los
siete días y sólo sobre los dos estados donde la pelota la tiene el vecino. Los otros dos
estados vivos no vencen nunca: ahí la espera es de la Comisión y no se le puede caer al
vecino una solicitud por una demora que no es suya. El vencimiento manda a cancelar la
suscripción best-effort, y si falla lo levanta la conciliación diaria.

## 1.6 Acuse, no admisión

El rediseño del 01/09/2026 fijó una regla de copy que atraviesa todas las superficies:
ninguna pantalla ni ningún correo dice "aceptada" ni "bienvenido" antes del acta. El
stepper es un `ProcessRail` que muestra el trámite entero —formulario, "La Comisión
resuelve", "Alta en acta"—; el correo que confirma el pago es un acuse; y los recibos de la
cuota de ingreso emitidos antes del acta llevan una leyenda de admisión pendiente, que se
**omite** cuando no corresponde. La razón de fondo: el acta marco de admisión digital que
preveía REG-12 no existe, así que cada alta necesita su propio asiento.

## 1.7 Aprobación, rechazo y retome

**Aprobación.** El asiento es masivo desde la cola y el sistema procesa **en serie**, una
transacción por solicitud: en serie porque cada alta numera con el máximo más uno del libro
abierto y dos transacciones concurrentes chocarían contra el índice único del par libro y
número; una por solicitud porque el rechazo de una no puede tirar abajo las otras veinte de
la misma reunión. Antes de crear el acta cuenta cuántas son realmente asentables: si son
cero, corta y el acta nunca llega a existir. La auditoría se escribe **antes** que los
correos, porque son hasta cincuenta envíos en serie y un timeout dejaría los asientos sin
rastro. Después del commit van la invitación al portal —sólo a fichas con correo verificado
y sin cuenta— y el aviso de mudanza de la dirección de ingreso.

**Rechazo.** Exige acta (REG-13) y se escribe como `updateMany` condicional: si otro
administrador llegó primero, el mensaje lo dice. Si hay ficha, le escribe el bloqueo de
seis meses con la misma aritmética que después lo lee. Después del commit y en bloques
separados van la cancelación de la suscripción y el correo del resultado; si la
cancelación falla, la ficha muestra el aviso y el asiento lleva el identificador del
preapproval para terminarlo a mano.

**Retome.** Apenas la solicitud existe, la dirección del navegador se reescribe al enlace
de retome con `replaceState`. De ahí cuelga una invariante frágil: **ninguna action del
wizard puede revalidar caché**, porque una revalidación remonta el árbol y le borra al
vecino la dirección reescrita. Con la solicitud creada no se vuelve a los pasos 1 a 4.

## 1.8 Dónde está en el código

- `src/lib/applications/statuses.ts` — los conjuntos de estados, en un módulo puro
- `src/lib/applications/eligibility.ts` — las ocho causales y sus textos
- `src/lib/applications/eligibility-inputs.ts` — la carga de insumos compartida
- `src/lib/applications/decision.ts` — qué estados admiten rechazo y recategorización
- `src/lib/applications/wizard.ts` — categorías, residencia y mayoría de edad
- `src/lib/applications/cron.ts` — el recordatorio y el vencimiento
- `src/lib/applications/record.ts` — el asiento en acta
- `src/app/(public)/asociate/` — el wizard y sus actions
- `src/app/admin/solicitudes/` — la cola, la ficha y el rechazo

# 2. Socios, libros e histórico

## 2.1 Las cuatro entidades

`Member` es la persona: una fila por vecino, con su documento, su domicilio, su categoría y
su estado. `Book` es el Libro de Registro de Asociados, con su acta de apertura y su acta de
cierre. `Membership` es la pertenencia de una persona a un libro, con su número en ese libro
y —una vez cerrado— la foto de cómo estaba al cerrarse. `Movement` es el hecho societario
asentado en acta: admisión, baja, cambio de categoría, readmisión, suspensión, fin de
suspensión, migración de libro, exención y anulación de exención.

La separación importa: la persona es una sola y la antigüedad nunca se reinicia (REG-29),
pero su número cambia con cada libro. Por eso el histórico es una pantalla propia.

## 2.2 Categorías y estados

Las seis categorías del enum son activo, adherente, colaborador, cadete, honorario y
vitalicio. Los tres estados son vigente, suspendido y dado de baja. Los motivos de baja
están normalizados en ocho valores (REG-18): fallecimiento, renuncia, mora, mudanza, no
re-empadronado, expulsión, anulación por duplicado y otro.

Del estado cuelgan el acceso al panel del socio, el devengo de cuotas, la cohorte del
re-empadronamiento y el padrón electoral. Todos los caminos que lo escriben son acciones de
operador; **ningún cron lo toca**, y esa propiedad es la que hace aceptables las dos ventanas
de concurrencia del cierre.

## 2.3 Alta manual y modo carga

El alta manual es la ficha que se carga desde el mostrador: nombre, categoría, documento y
correo opcionales, más el acta. El documento se chequea dos veces —antes y contra el índice
único— y el asiento guarda el número del libro pero **no** el documento.

El modo carga completa una ficha existente por su número de libro. Dos detalles que
conviene no romper: si no cambió ningún campo no escribe ni audita, y el asiento principal
usa auditoría **estricta** después del commit, así que un fallo del registro se le dice en
pantalla en vez de tragárselo. Cuando la dirección de ingreso se muda hay un asiento
aparte, un aviso a la casilla anterior y la revocación de los enlaces vivos de la ficha.

## 2.4 Baja individual y en lote

Toda acción societaria pasa por `runAction`, que impone un orden fijo: autorización,
validación del formulario, parseo del acta **aparte**, existencia del socio, guarda pura
previa al acta, resolución del acta, ejecución, auditoría y redirección. Si la ejecución
falla, el acta recién creada se descarta.

La cancelación del débito automático vive **después** del commit, en
`withdraw-with-debits`, por dos motivos: una llamada de red dentro de la transacción
sostiene el bloqueo hasta el timeout de cinco segundos de Prisma, y si colgara de la
pantalla individual el lote de cesantía quedaría afuera. Es best-effort con fallo
**visible**: la baja queda asentada y el llamador recibe qué quedó abierto.

Cuando la baja aplica una solicitud del socio hay una guarda que sorprende: la solicitud es
de baja por renuncia, así que si el operador cambia el motivo a otro la action lo rechaza y
le indica la salida.

La cesantía por mora es un lote en dos pasos. Con cuatro cuotas de atraso, consecutivas o
no, corresponde la cesantía de activos y colaboradores (REG-15); el adherente no entra. El
primer paso devuelve la lista resuelta contra la base sin escribir nada; el segundo crea el
acta y, socio por socio, revalida la categoría y el umbral **contra la base**.

## 2.5 El tope del lote cuenta llamadas, no socios

`WITHDRAWAL_DEBIT_CALL_BUDGET` vale 25 y es un tope de **llamadas de red a Mercado Pago**,
no de socios. La distinción costó un arreglo: el lote de bajas del re-empadronamiento copió
el tope de la cesantía por mora dando por sentado que eran socios, pero los convocados son
adherentes y no pueden tener débito: noventa bajas, cero llamadas. Hoy las llamadas se
cuentan antes de procesar, con el mismo predicado que decide qué se cancela. Copiar un
límite sin copiar su cuenta convierte una guarda de tiempo en una traba de trabajo.

## 2.6 Recategorización, suspensión y reingreso

| Acción | Guardas propias | Qué más hace |
|---|---|---|
| Cambio de categoría | Regla estatutaria, elecciones en curso y cuotas pendientes (REG-07) | Empuja el monto nuevo a Mercado Pago **antes** del cambio local; si el local falla, restaura el anterior |
| Suspensión | La fecha final no puede ser anterior a la inicial; máximo 180 días (Art. 10 inc. b) | No toca la cuenta ni revoca enlaces: el bloqueo lo aplica la guarda del panel |
| Fin de suspensión | El socio tiene que estar suspendido | — |
| Reingreso | La regla de readmisión | El de un deudor **no** se bloquea; el asiento es lo único que registra cuánto debía |

Dos acciones del mismo archivo no son societarias y por eso no llevan acta ni movimiento:
la corrección de la bandera de débito automático —que no toca ninguna suscripción— y la
constatación del domicilio que el socio cambió desde su panel.

## 2.7 Acceso al portal y nombre enmascarado

El envío del acceso lo decide `verificationTarget`, la **misma función** que la pantalla
usa para habilitar el botón: con la ficha de baja no corresponde, sin correo pide cargarlo
primero, con correo no verificado manda la verificación, con cuenta ya creada deriva al
restablecimiento y en el resto manda la invitación de contraseña. Hay dos cupos: por socio
y por operador.

`maskedName` convierte "Castillo Nestor" en "N***** C.": la primera palabra es el apellido
y viaja sólo como inicial con punto; las demás conservan su inicial con un asterisco por
letra restante. El texto se recorre por puntos de código sobre la forma compuesta, porque
el padrón tiene acentos y eñes que a veces llegan descompuestos. La comparten los dos
wizards públicos.

## 2.8 Dónde está en el código

- `src/lib/members/service.ts` — admisión, baja, suspensión y readmisión
- `src/lib/members/rules.ts` — las guardas puras de cada acción societaria
- `src/lib/members/withdraw-with-debits.ts` — la baja con cancelación de débito
- `src/lib/members/card-edit.ts` — el modo carga y el destino de verificación
- `src/lib/members/masked-name.ts` — el enmascarado, con su tabla de casos en el test
- `src/app/admin/socios/` — padrón, ficha, acciones societarias, libros e histórico

# 3. Solicitudes de socios

Son las que el socio presenta desde su panel: baja por renuncia y cambio de categoría.
Viven en `member_requests` y las resuelve la Comisión desde la pestaña "De socios".

## 3.1 Máquina de estados

| Estado | Cómo se entra | Cómo se sale |
|---|---|---|
| Pendiente | El socio la presenta desde su panel | Se aplica, se rechaza, el socio la retira, o una baja la deja sin objeto |
| Aceptada | El operador la aplicó con su acta | Terminal |
| Rechazada | El operador la rechazó, con nota opcional | Terminal |
| Retirada | El propio socio la retiró | Terminal |
| Sin efecto | Al socio lo dieron de baja por otro camino | Terminal |

Los dos últimos son hechos distintos y la pantalla no puede confundirlos: llamarle
"retirada" a una solicitud que cerró una cesantía por mora le atribuye al socio una acción
que no hizo.

## 3.2 Una pendiente por tipo, bajo mutex

La invariante es "una solicitud pendiente por tipo y por socio", y se sostiene con un mutex
por socio que envuelve la transacción **entera**, con el conteo adentro: así se sostiene
bajo concurrencia real y no por buena suerte. Sólo la creación necesita el mutex, porque
el rechazo no puede romper la invariante. Las banderas globales (elecciones en curso,
llave del colaborador) se leen **fuera** de la transacción.

## 3.3 Las guardas, el retiro y la aplicación

`canCreateRequest` es una función pura y cada guarda traduce, a la voz del socio, una regla
que la capa del operador ya aplica: sólo un socio vigente presenta solicitudes; ya hay una
pendiente de ese tipo; falta elegir la categoría, o es la misma que ya tiene; el pase a
colaborador está cerrado por la llave; hay elecciones en curso; registra cuotas pendientes.
La baja **no lleva más guardas**: renunciar con deuda es un derecho estatutario.

La fila guarda el **texto formal** del escrito, generado por el sistema —para la baja, con
la fecha, el nombre y el número del libro abierto—; el asiento lleva identificadores y
banderas, nunca ese texto.

El retiro es una actualización condicional que lleva el identificador del socio y el estado
pendiente en su filtro, y ésa es la guarda de pertenencia. Si no actualizó ninguna fila, el
mensaje es deliberadamente indistinguible entre "ya fue resuelta" y "no existe". Aplicar una
solicitud es hacer el acto societario desde la pantalla de siempre, con la solicitud
precargada.

## 3.4 La regla anti-duplicación mensual del débito

No está en este módulo pero se decide en la misma familia de guardas: quien pagó una cuota
en el mes calendario en curso no puede adherirse al débito hasta el mes siguiente, porque el
primer débito entraría en un mes ya cubierto. El veredicto de adhesión es una función pura
compartida por la pantalla y la action, así que lo que se muestra deshabilitado es lo que la
action rechaza.

## 3.5 Dónde está en el código

- `src/lib/members/member-requests/rules.ts` — las guardas puras y sus textos
- `src/lib/members/member-requests/service.ts` — el mutex y la transacción
- `src/lib/members/debit-adhesion.ts` — el veredicto de adhesión al débito
- `src/app/mi/solicitudes/` — la punta del socio
- `src/app/admin/solicitudes/socios/` — la punta del operador

# 4. Re-empadronamiento (Art. 9° bis)

Es la depuración estatutaria del padrón de adherentes: se los convoca a ratificar sus
datos, y a quien no responde en los plazos se le declara la baja y el libro se cierra.
Desplegado en producción desde el 27/08/2026.

## 4.1 Máquina de estados

| Estado del proceso | Cómo se entra | Cómo se sale |
|---|---|---|
| Preparando | Por ningún camino: es un estado del enum reservado y hoy inalcanzable | — |
| Primera instancia | La convocatoria congeló la cohorte y salieron los avisos | El operador abre la segunda instancia |
| Segunda instancia | Apertura manual, con su lote de avisos | Se prepara el cierre |
| Cerrando | El operador entró a la etapa de cierre | El cierre del libro |
| Cerrado | El libro viejo se cerró y se abrió el siguiente | Terminal |

| Estado de la presentación | Cómo se entra | Cómo se sale |
|---|---|---|
| Pendiente | La convocatoria creó la fila: convocado que no presentó | El vecino envía, el operador carga la presencial, o el lote de bajas del §4.7 |
| Presentada | Wizard público o carga presencial | Validación, observación o rechazo |
| Observada | El operador pidió subsanar, con nota | El vecino corrige y vuelve a enviar, o el lote de bajas del §4.7 |
| Validada | Se validó y los datos se copiaron a la ficha | Terminal |
| Rechazada | El operador la rechazó | Deshacer rechazo, o el lote de bajas del §4.7 |
| Baja declarada | El lote de bajas del §4.7, desde pendiente, observada o rechazada | Terminal |

## 4.2 La cohorte se congela al convocar

Convocar crea una fila de presentación por cada adherente vigente, y **esa lista es la
cohorte para todo el proceso**: quien pase a ser adherente después no fue convocado y no le
corre nada. El criterio es una sola función, `isCohortMember`, y sus dos constantes
—categoría adherente, estados vigente y suspendido— son además las que arman la consulta
que congela la cohorte; un criterio y una consulta que digan cosas distintas dejarían fuera
del proceso a gente que el sistema después trata como convocada.

La convocatoria valida la fecha por arriba (no puede ser futura) y por abajo (no puede
dejar la primera instancia ya vencida antes de empezar), y prevalida **antes** de crear el
acta que haya libro abierto y que no haya otro proceso vivo. Convocar también suspende el
alta web por sí solo: el wizard de ASOCIATE rechaza el POST mientras el proceso esté en
primera o segunda instancia. Por eso el tablero tiene un aviso rojo si la llave de
configuración que apunta al proceso vivo no apunta a éste.

## 4.3 El wizard público y la carga presencial

El wizard de REEMPADRONATE tiene cuatro pasos: identificación por documento, datos,
documentación y declaración jurada. Tres diferencias de fondo con el alta: no hay paso de
pago, el paso 1 no crea nada (busca una ficha que ya existe) y la presentación **no toca
la ficha** hasta que la Comisión valida.

Anti-enumeración: hay un solo veredicto negativo, sin motivo, garantizado por
`lookupVerdict`; la única rama separada es la de presentación ya enviada, que ofrece el
reenvío del enlace. Un detalle que parece cosmético y no lo es: una presentación observada
**no** se puede retomar tipeando el documento en el paso 1, porque entrar por ahí rota la
llave y le mataría al vecino el enlace del buzón con el plazo corriendo.

El barrio se escribe desde una constante y no se lee del formulario, y el correo es
obligatorio porque constituye el domicilio electrónico del Art. 5° ter. `editabilityOf` es
la única función que decide si el vecino puede tocar su presentación —estado editable **y**
proceso abierto— y la comparten las tres escrituras y la pantalla de retome.

## 4.4 Validar: qué se copia y qué no

Validar copia a la ficha la fecha de nacimiento, el estado civil, la nacionalidad, la
ocupación, el domicilio completo, el teléfono y el correo. **El nombre, el documento, la
categoría, el estado y la fecha de ingreso no se escriben nunca desde una pantalla
pública**: el documento no es autenticación, es una llave que cualquiera puede tipear.

Con calle del catálogo el texto libre se limpia, para que el domicilio no tenga dos fuentes
de verdad. Si el correo cambió, la ficha vuelve a estado declarado y sale la verificación;
si el socio ya tenía cuenta, además el aviso a la casilla anterior. Todo lo posterior al
commit es best-effort: un servidor de correo caído no puede convertir una validación firme
en pantalla de error, porque el reflejo del operador sería volver a apretar Validar.

## 4.5 Dos aritméticas de plazos que no se mezclan

`reregistration/rules.ts` cuenta **días corridos**: 30 de primera instancia, 10 de segunda,
30 para interponer el recurso. El Art. 9° bis no aclara si son corridos o hábiles, y el
proyecto tomó la lectura conservadora del art. 6 del Código Civil y Comercial.
`board/business-days.ts` cuenta **días hábiles**, porque el artículo de la cartelera (5°
ter) los dice con todas las letras; hábil es lunes a viernes que no sea feriado nacional, y
los días no laborables con fines turísticos no cuentan porque son de opción. Están en
archivos separados a propósito: el módulo de días corridos no importa feriados y no tiene
por qué.

Lo que **sí** es único es el comparador de vencimiento. `hasExpired` compara día civil
contra día civil: el día del vencimiento todavía no venció. Todos los plazos devuelven un
marcador de día civil argentino, al mediodía UTC, y nunca se comparan contra el instante
crudo. Si el cómputo de días hábiles pisa un año del que la tabla de feriados no dice nada,
el sistema **falla ruidoso** con una excepción que nombra el año faltante: contarlo como si
no tuviera feriados le acortaría el plazo a un vecino.

## 4.6 La cartelera por lotes

De los 124 adherentes convocados, cien no tienen casilla de correo. Para ellos el Art. 5°
ter prevé exactamente esto: la notificación se practica publicando el aviso en la cartelera
de la sede por veinte días hábiles, con idéntico efecto. El papel pegado en la pared **es**
la notificación fehaciente.

Por eso la unidad de trabajo es el cartel entero y no el socio: el sistema arma la lista de
quienes no tienen casilla utilizable, se imprime un cartel y el operador asienta **una**
fecha de fijación que estampa todas las filas de golpe. Las filas individuales existen como
trazabilidad (REG-09).

Dos consecuencias operativas. La nómina es **viva** hasta que se asienta la fijación: si se
asienta tres días después, a los vecinos a los que mientras tanto les cargaron el correo el
sistema los deja fuera del lote aunque su nombre esté impreso en la pared. Y la fecha que
acredita es la de **cumplimiento** del plazo, veinte días hábiles después, no la de
fijación, que le comería al vecino veinte días hábiles de su defensa.

Un correo que no salió **no estampa nada**: ni un bloqueo por lista blanca de correo ni un
envío fallido acreditan notificación, y sin notificación no hay resolución oponible ni
ventana de recurso corriendo.

## 4.7 Cierre del libro

Un acto irreversible se corta en etapas, y sólo la última es una transacción: checklist,
bajas en lote con su acta, cierre.

El checklist releva cuatro condiciones y **dos bloquean**: presentaciones sin resolver y
cohorte que no llegó a estado terminal; las otras dos —cesanteables por mora hoy y avisos de
cartelera en curso— advierten. Las bloqueantes están enumeradas y no derivadas de una
negación, para que un tipo nuevo caiga del lado que no frena hasta que alguien decida a mano
que frena.

`closeBook` corre en una única transacción **sin una sola llamada de red** y revalida
adentro las precondiciones que la vista previa ya miró, porque entre la vista previa y el
commit puede caerse el último socio vigente y ahí abriría un libro vacío. Esas
precondiciones son `where` compartidos con el checklist, no reglas copiadas.

La foto del libro se escribe **por conjuntos**: una actualización masiva por cada
combinación de estado y categoría —las dieciocho del enum, no sólo las vistas en una lectura
previa— más un conteo de completitud que **falla cerrado**. El plan original daba por
sentado que 278 actualizaciones fila por fila entraban en los cinco segundos de Prisma;
medido contra MariaDB, los viajes de ida y vuelta solos se comían el presupuesto y todo
cierre abortaba.

La renumeración sale de `planMigration` y de ningún otro lado: ordena por **día civil
argentino** de la fecha de ingreso, con desempate por número del libro viejo y después por
identificador de la fila. El día civil no es cosmética: colapsa en un empate los ingresos
del mismo día para que no los ordene la hora en que un administrativo cargó la ficha. Antes
de escribir nada, `assertDensePlan` reverifica densidad y unicidad.

El módulo deja escritas, con su medición, dos ventanas de concurrencia conocidas y
aceptadas: un alta aprobada en el instante exacto del cierre puede caer en el libro viejo, y
la foto puede leer una versión distinta de la que lee la decisión de migrar. El acta con la
que se firma el cierre dejó además una lección de interfaz, que está en el §6.2.

## 4.8 Dónde está en el código

- `src/lib/reregistration/rules.ts` — plazos en días corridos, cohorte y veredicto
- `src/lib/reregistration/presentation-rules.ts` — qué puede tocar el vecino
- `src/lib/reregistration/close.ts` — precondiciones, plan de migración y presupuesto
- `src/lib/reregistration/close-book.ts` — la transacción del cierre
- `src/lib/reregistration/withdrawals.ts` — el lote de bajas y sus estados de origen
- `src/lib/board/business-days.ts` — días hábiles y las dos excepciones de feriados
- `src/lib/board/notice.ts` — el aviso de cartelera como lote
- `src/app/(public)/reempadronate/` — el wizard público
- `src/app/admin/reempadronamiento/` — tablero, cola, cartelera y cierre

# 5. Reportes

El Módulo 7 recibe dos cosas distintas del vecino, y la diferencia atraviesa todo el copy:
un **reclamo** se presenta ante un organismo; una **iniciativa** la trata la Comisión
Directiva (Art. 6, Derechos 2). Prometerle un organismo a quien propuso una idea es prometer
algo que la asociación no va a hacer, y el copy hubo que corregirlo cuatro veces.

## 5.1 Máquina de estados

| Estado | Cómo se entra | Cómo se sale |
|---|---|---|
| Borrador | El paso 1 crea la fila y acuña la llave | El envío, o la purga a las 48 horas |
| Recibido | El vecino envió: ahí se asigna el número público | Se presenta ante el organismo (o la Comisión la trata, si es iniciativa), o se desestima |
| Presentado | El operador lo presentó (o la Comisión lo trató, si es iniciativa) | Terminal |
| Desestimado | El operador lo desestimó con motivo | Terminal |

Las tres transiciones son actualizaciones condicionales que llevan el estado de origen en
su filtro, igual que el consumo de un token: dos administradores que aprietan a la vez no
producen dos asientos. **Por eso no hay mutex**: habría sido una cerradura de proceso para
una invariante que la base ya sostiene. Y cuando no se actualizó ninguna fila, el mensaje es
el mismo para "ya está resuelto" y para "no existe": distinguirlos delataría si existe.

## 5.2 El borrador con llave

El wizard público arranca creando la fila en borrador y acuñando una llave de 32 bytes, de
la que se persiste sólo el resumen criptográfico. De ahí en más la llave es la credencial
para subir, borrar, guardar y enviar. El captcha va **únicamente en el paso 1**, el único
que puede crear filas desde afuera: la misma regla que ya valía para las rutas que se abren
con un token de un solo uso.

Corolario que costó una ola de arreglos: el retome rehidrata por render del servidor, así
que **ningún formulario del paso 3 puede anidar otro**, y la tecla Enter en un campo de una
línea no envía nada.

## 5.3 Imágenes: sharp antes del disco

Toda imagen de un vecino se re-codifica con sharp **antes** de tocar el disco, y la columna
de tipo de archivo es una constante porque no existe el archivo "tal cual llegó". No es una
validación de formato —eso lo hacen los magic bytes— sino de **contenido**: una foto sacada
del celular en la esquina del problema trae el GPS en los metadatos. Las caras del documento
de los otros dos wizards todavía se guardan tal cual: deuda anotada en `docs/08`.

## 5.4 La validación compartida

`validateSubmission` es una sola función y la comparten el wizard y el servicio: ubicación
obligatoria en un reclamo salvo la categoría "Otro reporte", identidad completa, las dos
caras del documento. El socio autenticado no declara identidad ni sube documento, y la
revalidación del envío lee contra la **base**. Un punto fuera del barrio avisa pero **deja
enviar**.

## 5.5 El número público

El número que se muestra es una serie corrida sin huecos, asignada recién al enviar, con la
misma mecánica que los recibos: una fila contador pedida tarde y dentro de la transacción del
envío. Existe porque la fila nace en borrador en el paso 1, así que el identificador interno
le regalaba un número a cada wizard abandonado: en producción el primer reporte real salió
como "N° 16", y la migración lo renumeró como N° 1.

El costo del candado importa para quien toque el envío: el bloqueo sobre la única fila del
contador no se suelta al volver, sino recién cuando commitea la transacción del llamador.

## 5.6 La purga dentro del cron que ya corría

La retención es de 360 días para las caras del documento, contados desde que el reporte se
presenta o se desestima, y de 48 horas para los borradores que nunca se enviaron. La purga
corre como **primer paso** del resumen diario, y corre **todos** los días, también los
tranquilos: si corriera después de decidir si hay novedades, un día sin novedades saltearía
una obligación legal, y no se agregó una línea al crontab a propósito. El lote está topeado
en `PURGE_BATCH`, 200 filas por corrida y por paso, y se audita sólo cuando hubo algo que
purgar: la auditoría es el rastro de un hecho, no un latido.

## 5.7 El PDF, el mapa y su CSP

La ficha del admin ofrece el reporte en PDF y un mapa con los reportes filtrados. Las tres
rutas de archivos y PDF exportan su política de seguridad de contenido como constante, y la
configuración de Next la repite; un test verifica que digan lo mismo y que las entradas por
ruta estén declaradas **después** de la global, porque Next copia esas cabeceras con un
método que reemplaza. Tras cambiarla hay que reiniciar el servidor antes de medir.

## 5.8 Dónde está en el código

- `src/lib/reports/rules.ts` — límites, textos únicos y la validación compartida
- `src/lib/reports/claim.ts` — la llave del borrador
- `src/lib/reports/storage.ts` — el almacenamiento con re-codificación
- `src/lib/reports/number.ts` — la serie del número público
- `src/lib/reports/retention.ts` — la purga
- `src/lib/reports/catalog.ts` — categorías, tipos y organismos
- `src/app/(public)/reportes/` — el wizard público
- `src/app/mi/solicitudes/reportes/` — la lista del socio
- `src/app/admin/solicitudes/reportes/` — la bandeja del operador

# 6. Actas

Un acta es la constancia del acto de la Comisión: sin ella no hay alta, ni baja, ni cambio
de categoría, ni valor de cuota nuevo, ni cierre de libro. Tiene dos tipos, Comisión
Directiva y Asamblea, y es única por el par tipo y número.

## 6.1 Nombrar un acta

Un acta se nombra por **tipo y número**, nunca por su identificador de fila: `minuteName`
devuelve "Comisión Directiva N° 124". El identificador es a dónde lleva el enlace, y
confundirlos no es teórico: "Acta N° 16" sobre lo que el libro llama Comisión Directiva
N° 124 señala otro documento, que suele existir.

## 6.2 El selector compartido y su valor por omisión

Todo el panel elige acta con el mismo selector, de dos modos: acta existente o acta nueva
cargada en línea. El modo por omisión es "acta existente" con la más reciente
preseleccionada, y ya sorprendió tres veces: la última costó el asiento del cierre del
Libro 1 bajo el acta de las bajas de minutos antes, porque la confirmación tampoco nombraba
el acta elegida. La regla que dejó el incidente: un control preseleccionado es una decisión
que nadie tomó, y en un acto irreversible el valor por omisión tiene que ser el caso normal
y la confirmación tiene que nombrar el acta.

## 6.3 El acta huérfana

Un acta nueva se crea **antes** de que la acción que la usa termine, así que puede quedar un
acta sin uso si la acción falla. `discardUnusedMinute` la borra, pero sólo si no la
referencia nada: movimientos, libros, solicitudes, procesos de re-empadronamiento, valores
de cuota, exenciones y reportes presentados —el mismo conjunto de referentes que la ficha
agrupa en pantalla—. La regla que dejó la exención de cuota es **pre-validar lo barato y
frecuente antes de crear el acta**.

## 6.4 Exportación

La ficha exporta el acta en PDF y en Word por una ruta autenticada, y cada exportación queda
auditada. La salida de Word usa `docx`, JavaScript puro y sin binarios: el mismo criterio de
servidor que el generador de PDF.

## 6.5 Dónde está en el código

- `src/lib/members/labels.ts` — el nombre canónico del acta
- `src/lib/members/minute-form.ts` — el selector, su esquema y el descarte
- `src/lib/minutes/references.ts` — qué referencia un acta
- `src/lib/minutes/export-pdf.ts` — la salida en PDF
- `src/lib/minutes/export-docx.ts` — la salida en Word
- `src/app/admin/actas/` — lista, ficha y edición

# 7. Contenido institucional

## 7.1 Noticias

Una noticia tiene dos estados, borrador y publicada, y se identifica públicamente por su
dirección derivada del título. El cuerpo se guarda ya saneado y tiene dos topes: uno en
caracteres para el editor y otro en bytes para la columna. La portada es la excepción
documentada a la regla de archivos del proyecto: vive en `UPLOADS_DIR/news/` —fuera del
repositorio y de la carpeta pública— pero se sirve por un route handler **público, sin
autenticación** y con caché inmutable. La regla de ruta autenticada sigue valiendo entera
para la documentación personal.

## 7.2 Actividades

Una actividad tiene nombre, espacio de la sede, días de la semana, rango horario y
visibilidad. Las validaciones son tres: que los días sean válidos, que el rango no termine
antes de empezar, y que el espacio no quede sobrevendido en ninguna franja. Lo tercero **no
es un solape**, es una **capacidad**: el aula admite tres actividades simultáneas y los demás
espacios una. La grilla pública sale de las mismas funciones puras.

## 7.3 Documentos institucionales

Cuatro tipos: normas, memorias, balances y otros. Memorias y balances llevan año y son
únicos por tipo y año; el título se deriva solo ("Memoria 2025"). Las normas pueden marcarse
como destacada, y esa marca es exclusiva: al encender una se apaga la anterior. Un POST
forjado no puede colarla fuera de las normas.

El estatuto vigente es la norma destacada y llegó por un script de importación. Desde el
02/09/2026 el panel del socio lo rotula "Estatuto" y **no** "Norma vigente", porque la
reforma sigue pendiente de la IGJ. Los documentos se sirven por ruta autenticada pero
**sin** asiento por visualización.

## 7.4 Las dos carteleras

El proyecto llama "cartelera" a dos cosas distintas, y el modelo de noticias lo advierte en
su propio comentario. La **cartelera digital** del sitio público es la sección de noticias
del §7.1. La **cartelera física** es el corcho de la sede y no tiene pantalla propia: lo que
el sistema produce para ella es el cartel en PDF, sus destinatarios y las filas que acreditan
la notificación fehaciente del capítulo 4 — la única de las dos que acredita.

## 7.5 Dónde está en el código

- `src/lib/news/` — saneado, direcciones amigables, imágenes y consultas
- `src/lib/activities/rules.ts` — días, horarios, capacidad y grilla
- `src/lib/institutional-documents/rules.ts` — tipos, años y la marca de destacada
- `src/app/admin/noticias/` — el ABM de noticias
- `src/app/admin/actividades/` — el ABM de actividades
- `src/app/admin/documentos/` — el ABM de documentos institucionales

# 8. Usuarios y roles

Los roles son tres y **acumulables**: superadmin, admin y socio. Una cuenta es una fila de
`User`; la vinculación con el padrón es la referencia que la ficha del socio guarda hacia
ella.

## 8.1 Las tres guardas y su latencia

La navegación del panel y las tarjetas del tablero filtran por los roles del **token**, y
eso es display: puede quedar hasta ocho horas desactualizado tras una degradación, porque el
token de sesión dura ocho horas de inactividad. La autorización real va siempre en la ruta y
en cada server action, y resuelve contra la fila viva de la cuenta.

Hay tres guardas ligadas, construidas con la misma fábrica y el mismo orden de
verificaciones, que se diferencian sólo en el mensaje: la de admin, la de superadmin para
configuración y `requireSuperadminUsers` para la pantalla de cuentas —que habla de cuentas y
roles, porque ahí el otro mensaje mentiría.

## 8.2 Alta, invitación y canje

El alta de una cuenta de gestión pide nombre y correo. Dos guardas de dominio la frenan: el
correo ya tiene cuenta, o el correo es el de la ficha de un socio. La segunda importa: crear
una cuenta de gestión con la dirección de un socio le rompería el canje de su invitación de
socio, así que el mensaje indica la salida correcta.

La cuenta nace con un hash de 32 bytes aleatorios que nadie conoce, calculado **fuera** de
la transacción, y se le emite un token de invitación de siete días. El canje consume el
token **dentro** de la transacción y hace el trabajo costoso afuera; si la cuenta está
desactivada, hace **rollback** a propósito para conservar el enlace. Un bloqueo por la lista
blanca de correo **no** cuenta como fallo de envío.

## 8.3 Degradación y desactivación

Las guardas de dominio son cuatro: nadie puede quitarse su propio rol de superadmin, nadie
puede desactivar su propia cuenta, el sistema no puede quedar sin ningún superadmin activo,
y el estado de una cuenta con socio vinculado lo gobierna el ciclo del socio. La última es
la que sorprende: dar de baja a un socio desactiva su cuenta dentro de la misma transacción
y el reingreso la vuelve a activar, mientras que la suspensión no toca la cuenta —ahí el
bloqueo lo aplica la guarda del panel.

## 8.4 Dónde está en el código

- `src/lib/auth/require-admin.ts` — las tres guardas y su fábrica común
- `src/lib/users/service.ts` — las guardas de dominio y sus textos
- `src/lib/users/admin-access.ts` — el canje del enlace de invitación
- `src/lib/users/labels.ts` — estado de cuenta y etiquetas de auditoría
- `src/app/admin/usuarios/` — lista, ficha y las siete acciones

# 9. Padrón electoral

Es la exportación que la asociación le entrega a la Junta Electoral (REG-31). Se genera para
una **fecha que es parámetro**, nunca el reloj del servidor.

## 9.1 Tres bloques, no una lista filtrada

La enmienda del operador del 23/08/2026 cambió la forma del resultado. El Código Civil y
Comercial deja al moroso purgar su deuda hasta una hora antes del acto, así que el padrón
**no lo excluye**: lo lista aparte, con cuántas cuotas debe y cuánto tiene que pagar en la
mesa. De ahí los tres bloques: habilitados, con deuda a purgar, y —desde el 27/08/2026— los
que no alcanzan la antigüedad mínima.

## 9.2 Las reglas

| Regla | Qué dice |
|---|---|
| Categorías | Votan activos, adherentes, colaboradores, honorarios y vitalicios; el cadete no integra el padrón |
| Antigüedad | Mínimo 90 días desde la fecha de ingreso (REG-30) |
| Exención de antigüedad | Honorarios y vitalicios votan sin el piso: son las que la asamblea otorga por trayectoria |
| Mora | "Sin deuda" es requisito sólo de activos y colaboradores; los adherentes votan igual |
| Reingreso | No reinicia la antigüedad: la readmisión no toca la fecha de ingreso |

La definición de mora es la que no es obvia: se mide sobre períodos **anteriores** al mes de
la elección, no sobre lo que está al cobro; con la otra definición el padrón se vaciaría de
activos todos los meses.

## 9.3 El Excel y la auditoría

La exportación es una ruta de superadmin con su propio asiento. Y el **render con resultado
también se audita**, con sólo metadatos: la fecha usada y el tamaño de los tres bloques,
**nunca una fila**. Queda registrado que alguien miró un listado de personas, sin copiarlo al
registro. En la misma pantalla vive la llave de elecciones en curso, que bloquea los cambios
de categoría durante el acto eleccionario.

## 9.4 Dónde está en el código

- `src/lib/members/electoral.ts` — categorías, antigüedad y mora
- `src/lib/members/electoral-export.ts` — la planilla
- `src/app/admin/padron-electoral/` — la pantalla, la exportación y la llave

# Documentos relacionados

De esta serie: **T1 — Visión y panorama** (los tres públicos, el mapa de rutas y el
glosario); **T2 — Arquitectura y código** (las capas y los patrones transversales);
**T4 — Modelo de datos** (el esquema, los enums y las invariantes que viven en código);
**T5 — Tesorería y Mercado Pago** (la cuota de ingreso, los recibos y el circuito de cobro);
**T7 — Seguridad, privacidad y calidad** (tokens, cupos, captcha, archivos, auditoría y
Ley 25.326); y los manuales **M1** y **M3**, que cuentan las mismas pantallas desde el
mostrador y desde afuera.

De la documentación original: `docs/02-marco-estatutario.md` (el texto completo de cada
regla citada acá), `docs/04-modelo-de-datos.md`, `docs/05-flujos-funcionales.md`,
`docs/07-plan-de-etapas.md` y `docs/08-seguridad-y-privacidad.md`, donde está anotada la
deuda sobre las imágenes de documento.
