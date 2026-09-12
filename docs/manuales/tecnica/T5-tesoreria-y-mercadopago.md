---
title: Tesorería y Mercado Pago
subtitle: Cuotas, cobros, recibos, webhook y conciliación
series: Serie técnica — Documento 5 de 7
docx: SIGeV-T5-Tesoreria-y-mercadopago
version: 1.0
date: 11/09/2026
---

# Para quién es y qué da por sabido

Este documento es para el desarrollador que hereda SIGeV y tiene que tocar el dominio del
dinero: cuotas sociales, cobros en efectivo, links de pago, débito automático de Mercado
Pago, recibos numerados y conciliación diaria.

Da por sabido lo que traen los documentos anteriores: qué es la asociación y qué procesos
digitaliza el sistema (T1), cómo está organizado el proyecto (T2) y el esquema de la base
(T4). No repite el modelo de datos: lo nombra y sigue. Y da por sabido que acá la plata es
de un vecino: ninguna prueba de cobro se hace contra producción.

# Cómo leer este documento

Los capítulos 2 a 6 describen el dominio propio: la cuota, su valor, los caminos por los
que entra plata y las dos figuras que no son cuota social. Los capítulos 7 y 8 describen
lo que el sistema hace contra Mercado Pago y contra el reloj. Los capítulos 9 y 10 cierran
con los correos y con cómo se prueba todo esto.

Cada capítulo termina con "Dónde está en el código": las rutas que hay que abrir para ver
el detalle. Este documento explica qué invariante sostiene cada pieza y por qué está donde
está; no transcribe código.

La verdad es el código. Donde este documento y `docs/` difieren, gana el código: las
diferencias detectadas están anotadas en el archivo de hallazgos del relevamiento.

# 1. Vocabulario

| Término | Qué significa en SIGeV |
|---|---|
| Período | Un mes calendario argentino, escrito `"YYYY-MM"`. Es la unidad de todo el dominio |
| Cuota | Una fila de `fees`: un socio y un período. **No lleva monto**: se valúa al cobrarse |
| Devengo | El proceso mensual que crea las filas del mes ya vencido, para quien devenga |
| Piso de cobertura | El primer período que un socio puede deber |
| Valor vigente | El monto de cuota que rige el día del cobro |
| Imputación | A qué períodos se aplica un cobro. Siempre a los más viejos primero |
| Recibo | El comprobante numerado de un cobro. Nunca se borra ni se renumera: se anula |
| Serie | La numeración `"AAAA-NNNNN"`, con un contador por año |
| Débito automático | El cobro mensual que Mercado Pago ejecuta sobre una tarjeta adherida |
| Suscripción | El objeto de Mercado Pago que lo habilita (un *preapproval*), con espejo local |
| Link de pago | Una preferencia de Checkout Pro por `n` cuotas. No se persiste y vence a las 72 h |
| Bandeja sin conciliar | La cola de cobros que entraron y no se pudieron imputar, con su motivo |
| Reparto | Asignar un solo cobro de Mercado Pago a varios socios, en partes que suman exacto |
| Conciliación | La corrida diaria que busca lo que el webhook no avisó y lo aplica igual |
| Exención | No cobrarle la cuota a un socio activo por hasta 24 meses (Art. 7 inc. a.4) |

## Dónde está en el código

El dominio propio vive en `src/lib/treasury`; lo que habla con Mercado Pago, en
`src/lib/mp`. El esquema, en `prisma/schema.prisma`.

# 2. Ciclo de vida de una cuota

## 2.1 El calendario

Todo el dominio del dinero razona en períodos `"YYYY-MM"` y **decide en hora argentina**,
no en UTC. `civilPartsOf` es el único lugar del proyecto que traduce un instante a fecha
civil argentina, y de ahí salen las demás piezas: el período de una fecha, el corrimiento
de meses, la comparación, el rango inclusivo en los dos extremos y las etiquetas.

Dos de ellas deciden si un cron actúa. `isFirstCivilDayOfMonth` lo pregunta el devengo, que
corre a las 00:30 argentinas —una hora a la que el reloj UTC ya está en el día siguiente
desde las 21:00 de la víspera—; su gemela para el último día del mes la pregunta el
recordatorio, y se resuelve sumando veinticuatro horas al mediodía y mirando si cambió el
mes, así febrero sale solo.

La tercera pieza transversal es `civilDayOf`, el mediodía UTC del día civil argentino: sirve
para comparar un instante contra una columna de fecha civil sin que la hora decida.

## 2.2 El nacimiento de la fila: el devengo

El devengo trabaja con un **modelo de dos niveles**: la cuota del mes M nace al cobro el día
1 de M, pero su **fila** se crea recién el 1 de M+1, cuando ya es mora. Por eso el tope del
devengo es el mes **vencido** y no el corriente, y por eso los más de veinte puntos que
cuentan filas pendientes a secas —deudores, mora, cesantía, deuda congelada al dar de baja—
son correctos sin restar el mes en curso.

La corrida calcula el mes tope; busca los socios que devengan (estado activo o suspendido,
y categoría dentro de `ACCRUING_CATEGORIES`, que son activo y colaborador); trae en dos
consultas de lote las cuotas que ya tienen y el movimiento de readmisión más nuevo de cada
uno; y por socio inserta los períodos que faltan.

**El adherente no devenga**, porque su aporte es voluntario; **el suspendido sí**, porque la
suspensión es disciplinaria y no una eximición; y el reingreso sale del movimiento y no de
la fecha de ingreso, porque la fecha de ingreso es la del acta de admisión (REG-11) y el
reingreso no la toca (REG-29). La inserción saltea
duplicados, pero eso **no reemplaza a la lectura previa** —la que respeta que una cuota
importada o ya pagada manden sobre el devengo—: cubre la carrera con un pago simultáneo.

## 2.3 El piso de cobertura

`coverageFloor` decide desde qué período puede deber un socio, y tiene **tres términos:
gana el más nuevo**.

1. El piso del padrón importado: el mes siguiente al de la foto de deuda del 21/08/2026,
   o sea 2026-09, porque esa foto cubre hasta agosto inclusive.
2. El mes siguiente al del alta, porque la cuota de ingreso cubre el mes del alta (REG-14).
3. Para un reingreso, el mes siguiente al de la readmisión.

Esta función **la comparten el devengo, el recordatorio de vencimiento y la imputación**:
no es una regla escrita tres veces. La revisión de la fase 4C encontró que el recordatorio
le reclamaba septiembre a quien se había asociado en septiembre, justamente porque no
aplicaba el piso, y el arreglo fue compartir la función en vez de reimplementarla.

## 2.4 Cuánto vale lo que se debe

La cuota no guarda monto. La deuda es una **cantidad** de cuotas pendientes y se valúa al
valor vigente el día que se cobra: eso es REG-16 generalizado desde el Módulo 4, y aplica
igual a un socio al día que a un cesante que vuelve.

`feeAmountFor` traduce categoría más valor vigente a un importe: el activo paga el monto de
activo; el adherente y el colaborador, el compartido; cadete, honorario y vitalicio no pagan.
La función que responde "esta categoría paga cuota" se **deriva** de la anterior con montos
centinela, porque un importe nulo llega por dos motivos opuestos: la categoría no paga, o
todavía no hay ningún valor registrado.

Sobre la cantidad de pendientes se calcula el nivel de mora, con los umbrales de REG-15:
aviso desde la segunda cuota, cesantía habilitada desde la cuarta. La lista de deudores
agrupa las pendientes de los socios vigentes: **la baja no entra**, porque a un ex socio no
se lo puede declarar cesante otra vez.

## 2.5 A qué se imputa el cobro

`allocate` es la única aritmética de imputación del sistema. Recibe la cantidad de cuotas
pagadas y devuelve qué períodos cubre: **primero las pendientes más viejas**; si la
cantidad sobra, sigue con los primeros períodos sin fila a partir del piso de cobertura,
creándolos ya pagados.

El parámetro que marca desde dónde seguir se llama `startAt` a propósito, para que la
semántica vieja —"desde el mes corriente"— no se pueda pasar por accidente: el 23/08/2026 un
socio del padrón sin deuda pagó y el sistema le cobró agosto de nuevo.

Lo alimentan dos funciones de `fee-allocation.ts`: una lee el contexto del socio en dos
consultas paralelas y la otra imputa con el piso correcto. **Las dos las comparten el núcleo
que asienta el cobro y la vista previa del reparto**, así que lo que la pantalla anticipa no
puede divergir de lo que el cobro imputa.

## 2.6 El recibo

El número se pide **tarde y dentro de la transacción**. `nextReceiptSeq` incrementa el
contador del año con un `INSERT … ON DUPLICATE KEY UPDATE`, y el lock exclusivo sobre esa
fila **no se suelta al volver: se suelta al commit del llamador**. De ahí las dos reglas que
sostienen REG-33: pedir el número lo último, para que un rollback no consuma serie, y
**nunca escribir el PDF adentro de la transacción**, porque el lock se sostendría mientras
se toca el disco y el tiempo máximo de transacción de Prisma es de cinco segundos. El año de
la serie se calcula en hora argentina: un efectivo cargado el 31 de diciembre a las 22:00
pertenece al año viejo aunque en UTC ya sea 1° de enero.

El **concepto se congela** en la fila del recibo al emitirlo, recortado a doscientos
caracteres con tres puntos ASCII y no con el carácter de puntos suspensivos, porque el
generador del PDF sólo admite WinAnsi y ese carácter se convertiría en un signo de
pregunta. Congelarlo no es cosmética: derivar el concepto de las cuotas del pago lo borraba
justo al anular, que es cuando saber qué se cobró importa más.

Después del commit se escribe el PDF, en modo *best-effort*: si falla, el cobro ya quedó
asentado y el recibo es **regenerable**, porque su contenido es determinístico a partir de la
fila. La ruta también lo es, y la expresión regular que la valida corre **en el punto donde
se toca el disco**. El PDF lleva tres leyendas condicionales —admisión pendiente, cobro
compartido y la marca ANULADO— y las tres se **omiten** cuando no aplican, en vez de pasarse
en falso, para que el recibo de siempre siga byte-idéntico.

## 2.7 El camino feliz, paso a paso

1. Llega un cobro por cualquiera de los seis caminos, con su importe y su cantidad de
   cuotas.
2. El núcleo valida importe y cantidad, sin tocar la base.
3. Se serializa por socio con un mutex en memoria.
4. Fuera de la transacción se prepara la parte: socio, contexto de cuotas, imputación y
   concepto congelado.
5. Abre la transacción. **El pago es la primera escritura**: si choca el identificador de
   Mercado Pago, muere antes de pedir número.
6. Se crean las cuotas nuevas ya pagadas y se actualizan las existentes, con el estado
   pendiente en la condición y control de las filas afectadas.
7. Se cierra la fila de la bandeja, si la había, **dentro de la misma transacción**.
8. Se pide el número y se emite el recibo. Commit.
9. Después del commit se escribe el PDF y se manda el recibo por correo.

## 2.8 Anulación y reembolso

`revertCore` es **el mismo movimiento** para las dos salidas: la anulación de mostrador —que
deja el pago anulado y registra qué operador lo hizo— y el reembolso que avisa Mercado Pago,
que lo deja reembolsado y no tiene operador. Se lee lo mínimo afuera del mutex, sólo para saber
sobre qué socio serializar; **adentro** se relee el recibo y se controla que no esté ya
anulado, porque con la lectura afuera dos anulaciones simultáneas pasaban las dos. Los
períodos se parten en dos: los menores o iguales al corriente vuelven a pendiente y los
futuros **se borran**, porque una cuota futura pendiente contaría como deuda antes de tiempo.
Las dos escrituras llevan el identificador del pago en la condición: es la guarda que impide
devolver a pendiente una cuota que se reimputó a **otro** pago con recibo válido.

La fila de la bandeja se reabre **por grupo**: si no queda ninguna parte aplicada vuelve a
abierta; si queda alguna, pasa a parcial. Su bloqueo se toma como **primer statement** de
la transacción, igual que en el reparto, y ese orden fijo evita el interbloqueo entre los
dos. El reembolso de un cobro repartido junta el portador y sus partes aplicadas y revierte
**una vez por parte**: es idempotente por parte, así que si falla a mitad el reintento de
Mercado Pago revierte lo que faltaba.

## Dónde está en el código

`src/lib/treasury/periods.ts`, `accrual.ts`, `rules.ts`, `fee-allocation.ts`, `account.ts`,
`debtors.ts`, `receipt-number.ts`, `receipt-pdf.ts`, `receipts-dir.ts` y `service.ts`.

# 3. El valor de la cuota

La tabla `fee_values` es la **única fuente de montos** del sistema (REG-34). El devengo no
la lee —la cuota no lleva monto—, pero sí la leen el cálculo de deuda, el efectivo, el link
de pago y el monto que se le empuja a una suscripción. Desde la fase 4B los planes de
Mercado Pago dejaron de ser registro y quedaron como **referencia**: su único consumidor es
el aviso de divergencia de la conciliación diaria.

Cada fila guarda dos montos —el de socio activo y el compartido de adherente y
colaborador—, la fecha desde la que rige y, opcionalmente, el acta que lo resolvió. El
vigente es el de mayor vigencia menor o igual a hoy. Dos detalles que no son cosméticos:

1. **La vigencia se guarda al mediodía UTC del día civil argentino**, y la lectura compara
   contra el mediodía civil de hoy y no contra el instante. Sin eso, un valor que rige
   "desde hoy" no existiría hasta las 09:00 argentinas y un cobro de mostrador de la mañana
   abortaría por falta de monto sobre un valor que la Comisión ya fijó.
2. **Un valor nunca se edita**: se registra otro encima, como un acta.

Sin ningún valor vigente, los caminos que necesitan un monto **abortan** con un mensaje
único —"No hay un valor de cuota vigente: registralo en Configuración → Tesorería antes de
continuar"— en vez de inventar un cero.

El alta se hace desde Configuración → Tesorería (`/admin/configuracion`) y está reservada al
superadmin; el historial se consulta en Tesorería → Valores de cuota. El tope de cuatro
actualizaciones por año de REG-34 **no lo controla el sistema**: lo controla la Comisión,
como el resto de los límites del estatuto.

## Dónde está en el código

`src/lib/treasury/fee-values.ts` y la pantalla de `src/app/admin/configuracion`.

# 4. Los seis caminos de cobro y el núcleo

## 4.1 El núcleo, partido en cuatro piezas

Hay **un solo escritor** de pago, cuotas y recibo. El reparto de la fase 4D necesitaba
repetirlo varias veces dentro de una transacción, así que se partió **sin cambio de
comportamiento**: la suite vieja pasó sin tocar una aserción.

| Pieza | Cuándo corre | Qué hace |
|---|---|---|
| `validateInput` | Antes de todo | Importe positivo y bajo el techo de la columna decimal; cantidad de cuotas entera entre cero y sesenta |
| `preparePart` | Antes de la transacción | Socio, contexto de cuotas, recorte del cesante, imputación, concepto y año de la serie |
| `writePaymentAndFees` | En la transacción | El pago **primero**; después las cuotas nuevas y las existentes |
| `issueReceipt` | Al final | El número y la fila del recibo |

El recorte del cesante tiene dos modos, y es una decisión de producto: en el camino de
siempre se recorta **en silencio**, porque desde un webhook no hay a quién avisarle; en el
reparto se rechaza con mensaje, porque hay un operador enfrente. Alrededor, el núcleo
encadena dos barreras de idempotencia y un reintento: una consulta
previa por el identificador de Mercado Pago, que es la barrera **barata**; la captura del
choque de su unique, que es la **real**; y un **reintento único** ante el choque de la
unique de socio más período, que es la carrera con el devengo del día 1. Ese reintento está
acotado a su índice **por nombre**: la unique de Mercado Pago no se reintenta nunca.

La serialización es un mutex en memoria por socio —o por solicitud, en la cuota de ingreso—,
lo que ata el sistema a la premisa de un solo proceso de PM2.

## 4.2 Los seis caminos

| Camino | Quién lo dispara | Entrada | Núcleo | Salida |
|---|---|---|---|---|
| Efectivo | El operador, desde Efectivo o desde la ficha | Cuotas o un aporte | `registerCashPayment` | Recibo y correo |
| Link de pago | El operador desde la ficha, o el socio desde Mi cuenta | Aviso con la referencia del link | `registerPayment` | Recibo y correo |
| Débito | Mercado Pago, al cobrar el mes | Aviso de pago o de cargo autorizado | `registerPayment` | Recibo y correo |
| Cuota de ingreso | Mercado Pago, en el primer cobro del alta web | Aviso con la referencia de la solicitud | `registerPayment` | Recibo con leyenda de admisión pendiente |
| Vinculación de suscripción | El operador, desde Suscripciones | Las filas abiertas de la bandeja | `registerPayment`, una vez por fila | Un recibo por fila |
| Reparto | El operador, desde Sin conciliar | Un cobro y hasta cinco partes | `registerSplitPayment` | Un recibo por parte |

El tipo que queda escrito en el pago cambia por camino: efectivo asienta cuota o aporte; el
link, de tipo `link`; el débito y la vinculación, una cuota por cobro; la cuota de ingreso,
sin cuotas. **El débito por webhook no tiene sección propia acá**: a quién se imputa lo
decide el capítulo 7.4, y lo que escribe es el mismo núcleo de 4.1.

## 4.3 Efectivo

Tiene guardas propias **antes** de llamar al núcleo. Al cesante se le pueden cobrar **cuotas**
—REG-16 le exige saldar la deuda a valores vigentes para poder ser readmitido, así que
exigirle el reingreso primero invertía la regla— pero **no** aportes. Los conceptos
habilitados salen de `cashConceptsFor`, la misma función que usa el reparto: quien devenga
puede pagar cuotas y los dos aportes; el adherente, sólo los aportes; el resto, sólo el
extraordinario. El importe se calcula con el valor vigente y la categoría, y sin valor vigente
**aborta**; al cesante se le controla además que no pague más cuotas que las que debe, esta
vez **con mensaje**.

## 4.4 Link de pago

Es una preferencia de Checkout Pro por `n` cuotas, validadas entre uno y sesenta **antes** de
leer el valor y de tocar Mercado Pago. Si la categoría no paga cuota no hay link. Tres
decisiones de diseño:

1. **La referencia es `pago:{memberId}:{n}`.** La última parte es una cantidad de cuotas y
   no una lista de períodos: qué cuotas cubre lo decide la imputación cuando el pago llega.
2. **La preferencia no se persiste y vence a las 72 horas.** El vencimiento va por
   duplicado, en dos campos distintos, porque uno sin el otro no hace nada. Sin
   vencimiento, el link congelaría el precio del día en que se generó.
3. **Lleva un sello HMAC** sobre el socio, la cantidad, el importe y la URL. Sin él, un POST
   armado a mano podía mandarle al socio A un enlace cuya referencia acredita al socio B.

Cuando el pago entra, el procesador compara en centavos el importe esperado contra el
cobrado y, si difieren, deja un asiento `link_amount_mismatch`. **La cuota se imputa
igual**: la plata entró. El socio se lo genera solo desde Mi cuenta (`/mi/cuenta`), y el
suspendido también: pagar es la única acción que el modo lectura le permite. El limitador
de intentos corre **antes** del parseo, porque lo que se raciona es el llamado a Mercado
Pago.

## 4.5 Vinculación de una suscripción existente

Cuando una suscripción se creó a mano en el panel de Mercado Pago, sus cobros vienen cayendo
en la bandeja. Vincularla a un socio crea la fila local con los datos frescos de Mercado Pago
y, **fuera de esa transacción**, aplica una por una las filas abiertas de la bandeja de esa
suscripción, cada una con su cobro y su recibo.

Que vayan afuera no es descuido: cada cobro abre su transacción, pide número de recibo —que
serializa por año— y escribe un PDF, así que meterlos todos en una transacción externa
sostendría ese lock durante varios cobros y se comería el tiempo máximo de Prisma. Y no hace
falta: la vinculación vale por sí sola, y una fila que no se pudo aplicar sigue esperando en
la bandeja, que es donde el operador la ve. La pantalla de confirmación avisa **antes** si
ese socio ya tiene otra suscripción que sigue cobrando, contándolas con `countChargeable`:
vincular una segunda le duplicaría el débito del mes.

## 4.6 Reparto de la bandeja

Un cobro repartido entre socios es **un pago por socio**: uno solo —el portador— lleva el
identificador de Mercado Pago, y los demás apuntan a él. Que un pago tenga ese identificador
**o** un portador, nunca los dos, lo garantiza el núcleo por tipos y no la base.

1. Validaciones puras: entre una y cinco partes, sin socios repetidos, cada importe
   positivo y bajo el techo, y cantidad de cuotas sólo para el concepto de cuotas.
2. Mutex anidado: **la fila afuera** y **los socios adentro, en orden ascendente**. El orden
   fijo evita que dos repartos cruzados se traben. Las guardas por parte reusan las mismas
   funciones que los otros caminos: conceptos por categoría, recorte del cesante y exención.
3. La transacción abre con el bloqueo `SELECT … FOR UPDATE` sobre la fila de la bandeja como
   **primer statement**, relee con la fila bloqueada, revalida que el cobro no esté
   reembolsado y que las partes sumen **exacto en centavos** lo que falta asignar, escribe una
   parte por socio y pide los números al final. El `catch` distingue por **nombre de índice**:
   el choque de la unique de Mercado Pago es "otro escritor ganó el cobro"; el de socio más
   período dispara el reintento único.

El estado de la fila se **deriva** del grupo y lo escribe el núcleo: abierta si no hay nada
asignado, conciliada si lo asignado alcanza el total, parcial en el medio. La aritmética vive
en una sola función compartida por la pantalla y la lista; el núcleo no la reimplementa, pero
**rederiva el estado después de escribir**, contra lo que quedó en la base. Anular una parte
recalcula el grupo, y la fila que se reabre se puede volver a aplicar. La leyenda "pago
compartido" del recibo aparece **sólo cuando ese pago cubre menos que el cobro**, y no cuenta
socios, para que el texto no envejezca al reasignar una parte.

## Dónde está en el código

`src/lib/treasury/service.ts` y los tres módulos del reparto; en `src/lib/mp`, el link, su
sello y el vinculador.

# 5. Ingresos no societarios

No toda la plata que entra es cuota social: el alquiler del salón, las rifas y los eventos
se registran en Tesorería → Otros ingresos (`/admin/tesoreria/otros-ingresos`). El módulo es
**independiente del núcleo**: no lo importa, no comparte transacción y no toca pagos, cuotas
ni recibos. La tabla no tiene **ninguna** clave foránea al núcleo del dinero, y eso es
deliberado: **la serie numerada es la de las cuotas sociales**, armada alrededor del socio
(REG-33). Un ingreso no societario no lleva recibo.

1. La primitiva que registra el ingreso es una función suelta y no un método de la factory,
   porque la bandeja la llama **dentro de su propia transacción**. Un choque de la unique
   del identificador de Mercado Pago devuelve "ya registrado"; sin ese identificador, el
   choque **se propaga**, porque taparlo escondería un bug propio.
2. Los bordes del ejercicio se calculan en **hora argentina** y en intervalo medio abierto.
   Con el corte en UTC, un alquiler de las 22:00 del 31 de diciembre caía en el ejercicio
   siguiente.
3. La edición sólo toca concepto y nota. Existe porque para un ingreso de Mercado Pago el
   camino "anular y registrar de nuevo" **no está disponible**: la unique del identificador
   no se libera al anular.
4. **No hay filtro por texto del concepto**, a propósito: los filtros viajan por GET, y un
   `?q=` con el nombre de un vecino queda en el registro de accesos de Nginx y de
   Cloudflare, fuera del circuito de retención de la auditoría.

La anulación es idempotente: lleva la condición en el `where` en vez de decidir sobre una
lectura previa, y **reabre la fila de la bandeja** dentro de la misma transacción.

## Dónde está en el código

`src/lib/treasury/other-income.ts`.

# 6. Exención de cuota (Art. 7 inc. a.4)

## 6.1 Filas materializadas, no un flag

La exención se asienta con acta en Tesorería → Exenciones (`/admin/tesoreria/exenciones`) y
se **materializa** como cuotas con estado `exempt` y origen de exención, de todo el rango. El
núcleo las trata bien **por omisión**: el devengo saltea el mes porque ya hay fila, y la deuda
no la cuenta porque pregunta por estado pendiente a secas. Esa garantía es **estructural**, no
una línea que diga "exento", y por eso el módulo entero no modificó ni un archivo existente
del dominio del dinero ni del de Mercado Pago al cerrarse, en agosto de 2026 (hoy la fase 4D,
posterior, importa la exención desde el reparto). Antes de escribir un flag en el núcleo,
conviene preguntarse si la fila que ya existe alcanza.

## 6.2 Una sola fuente para las guardas

`activeExemption` es **la** función compartida: una exención de ese socio, sin anular, que
llegue hasta el período en curso o más allá. La usan las **cinco guardas de cobro** —efectivo,
generación del link, reenvío del link, pago desde el panel del socio y adhesión al débito— y
todas las pantallas que muestran el hecho. Misma lección que el piso de cobertura: con un `where`
propio por camino, alcanza con que uno se olvide de excluir las anuladas para que a un vecino
se le siga bloqueando el pago después de que se la anularon. El predicado de vigencia
**incluye a la que todavía no empezó**, y no es un descuido: el "no entra ni un peso" rige
desde que la Comisión lo decidió.

## 6.3 Asiento y anulación

El asiento revalida **seis guardas dentro de una transacción sin una sola llamada de red**:
ficha existente de categoría y estado activos; socio al día; sin débito cobrable; sin otra
exención vigente; rango de uno a veinticuatro meses que empiece en el período corriente o
después; y acta existente. Las cuotas se crean **sin saltear duplicados**, lo inverso al
devengo: si el cron insertara una pendiente del rango, el salteo la dejaría pasar en
silencio.

Las tres guardas baratas y frecuentes —ficha, categoría y exención ya vigente— se miran
**antes** de crear el acta, porque es por donde se rechaza casi siempre; el resto se compensa
descartando el acta sin usar, y los textos salen del dominio.

La anulación lleva un cerrojo optimista —el `updateMany` exige que no esté ya anulada— y
**además revalida la vigencia adentro de la transacción**. El cerrojo cubre la carrera pero
**no ve la vencida**, que llega con su marca de anulación en nulo desde una pestaña vieja:
sin la revalidación se estampaba en la ficha un movimiento de exención anulada **con su
acta** por un hecho que nunca ocurrió, porque esa exención no se levantó, se terminó sola. El
borrado de las cuotas futuras lleva cuatro acotaciones, y las transcurridas no se tocan.

Un límite conocido: la base **no** tiene una unique de "una vigente por socio", porque MySQL
no tiene uniques parciales. La invariante se sostiene en la transacción, y la lectura ordena
por identificador descendente: ante dos, gana la más nueva.

## Dónde está en el código

`src/lib/treasury/exemptions.ts` y `src/app/admin/tesoreria/exenciones`.

# 7. Mercado Pago

## 7.1 El gateway

Todo lo que habla con Mercado Pago pasa por una factory propia, `makeMpGateway()`, que no
recibe argumentos y lee el token del entorno de forma diferida. **El dominio nunca ve el
SDK**, y los tests mockean esa interfaz: ni SDK ni red. Mismo criterio para cualquier
proveedor que venga después. Hoy expone doce métodos.

| Método | Transporte | Para qué |
|---|---|---|
| `getPlan` | SDK | Monto de referencia del plan; su único consumidor es el aviso de divergencia |
| `createPreapproval` | SDK | Crea la suscripción **sin plan**, con monto en línea y referencia obligatoria |
| `cancelPreapproval` | SDK | Cancela la suscripción |
| `updatePreapprovalAmount` | SDK | Empuja el monto nuevo (lote de REG-34) |
| `getPreapproval` | SDK | Estado y monto de una suscripción |
| `getPayment` | SDK | Un pago |
| `getAuthorizedPayment` | `fetch` | Un cargo autorizado; no está en el SDK |
| `searchPreapprovals` | `fetch` paginado | Busca suscripciones |
| `searchAuthorizedPayments` | `fetch` paginado | Cargos de una suscripción |
| `searchPayments` | `fetch` paginado | Pagos aprobados por fecha de aprobación |
| `ownAccountId` | `fetch` | La cuenta propia, cacheada por proceso |
| `createPreference` | SDK | La preferencia de Checkout Pro con su vencimiento |

Cinco detalles medidos que viven en el código y no son perillas sueltas:

1. **La búsqueda de cargos autorizados rechaza un tamaño de página alto** y devolvía 400 en
   silencio, así que va sin ese parámetro. La búsqueda de pagos acepta cien.
2. **El preapproval del pago viaja dentro del propio pago**, en los datos de la transacción.
   Una cadena vacía se trata como ausente, porque resolvería contra una fila inexistente.
3. `httpFailure` cuelga el código de estado **del objeto de error** y no sólo del texto: es
   lo único que hace reconocible un 429 para el reintento. Además **drena el cuerpo** que no
   va a leer, porque sin eso el cliente HTTP no devuelve el socket al pool y rehace el TLS
   durante la ráfaga limitada.
4. **El reintento ante 429 envuelve sólo las lecturas.** Las cuatro escrituras quedan afuera
   a propósito: reintentar puede duplicar el efecto, y eso es plata de un vecino. Su
   presupuesto **es el del peor llamador**: el webhook responde de forma síncrona y Mercado
   Pago lo da por caído a los veintidós segundos.
5. El jitter va **siempre**, porque la cuota del 429 es compartida entre clientes y con
   esperas fijas los que chocaron juntos se despertarían sincronizados.

## 7.2 Planes y suscripciones

Los dos identificadores de plan **no son variables de entorno**: viven en la tabla de
configuración. Desde la fase 4B son **opcionales**, porque el alta web, la recategorización
y el lote de actualización leen el monto del historial de valores; el único uso que les
queda es el aviso de divergencia, que no corre si no están cargados.

Las suscripciones se crean **sin plan**, con el monto en línea. Y hay un hecho medido contra
la API que conviene no olvidar: **un preapproval ignora la URL de notificación**. Mercado
Pago acepta el campo y lo descarta en silencio, así que los avisos de suscripción dependen
**enteramente** de la configuración de webhooks del panel; si eso se rompe, los débitos
dejan de avisar **sin ninguna señal** y la única red es la conciliación diaria.

## 7.3 El webhook: la ruta

La ruta corre en Node —necesita comparación de tiempo constante y buffers— y hace las cosas
en un orden que importa:

1. Sin secreto de webhook configurado, responde 500.
2. Detecta la **IPN legacy** *antes* de parsear el JSON, porque llega con el cuerpo vacío y
   moriría en el catch de JSON mal formado. Si no parsea y es legacy, deja un asiento propio
   y responde **200 "recibido, no procesado"**; si no es legacy, 400.
3. Sólo audita el intento cuando vienen **las dos** cabeceras de firma: la auditoría corre
   antes de autenticar, o sea que es un canal de escritura anónimo sobre esa tabla.
4. Normaliza y valida el identificador del dato contra una expresión que admite letras,
   dígitos y guiones. Un filtro de sólo dígitos habría rechazado **todos** los webhooks de
   suscripción, porque esos identificadores son hexadecimales de treinta y dos caracteres.
5. Valida la firma `x-Signature` con HMAC-SHA256 sobre una cadena armada con ese
   identificador, el de la petición y la marca de tiempo, con cinco minutos de tolerancia de
   reloj. Si falla, 401 **sin persistir el payload**.
6. Registra el evento. **La unique de origen más identificador de evento es la idempotencia
   de la ruta.** El identificador sale del cuerpo, que Mercado Pago **sí** manda y es distinto
   del identificador del pago; el respaldo lleva además la acción, porque sin ese
   discriminador la creación y la actualización del mismo pago se pisaban y el cobro no se
   procesaba nunca. Un duplicado ya procesado responde 200; uno sin procesar se reprocesa.
7. Delega en el procesador y responde 200. Una excepción se loguea con las direcciones
   enmascaradas y responde **500 para que Mercado Pago reintente**.

La IPN legacy y las órdenes de comercio responden 200 y no 4xx a propósito: son
notificaciones legítimas en un formato que no implementamos, y un 4xx sostenido es algo que
Mercado Pago puede terminar deshabilitando —y ahí se perdería también la buena—. Un POST sin
tópico sigue dando 400 y sin auditar, para que los escáneres no inflen la tabla.

## 7.4 El webhook: el procesador

**El procesador nunca falla por una regla de negocio.** Todo lo que no se puede aplicar
termina en un resultado tipado y, cuando corresponde, en la bandeja con su motivo. El 500 queda
para los fallos técnicos, que es cuando conviene que Mercado Pago reintente. La unión de los
veinte resultados está duplicada como un registro que el compilador exige completo, así que uno
nuevo no puede quedarse afuera.

Atiende tres tópicos. El de **pago** aplica el cobro pasándole el preapproval que viene
dentro del propio pago: eso es lo que hace que la notificación de un débito **se baste sola**.
El de **suscripción** sincroniza el espejo local. El de **cargo autorizado** resuelve el pago
subyacente y lo aplica con el preapproval del cargo.

Dentro de la aplicación de un pago el orden es: reembolso o contracargo primero —y un rechazo
de negocio ahí se traga, porque no puede volverse un 500—; después el rechazo, que dispara el
aviso al socio; después cualquier estado que no sea aprobado, que se ignora; y recién entonces
el mutex, la carga de contexto y la tabla de resolución.

El aviso de cobro rechazado resuelve al socio por el link o por el preapproval, **nunca por
el correo del pagador**, que es la casilla de la cuenta de Mercado Pago y puede ser de un
tercero. Tiene ocho desenlaces, y el asiento va **siempre y fuera del try**: hoy en
producción, con la lista blanca puesta, el envío falla por diseño y el asiento es lo único
que queda. La deduplicación busca un aviso ya enviado cuyo resumen empiece con un prefijo
que **incluye un espacio final**: sin él, el cobro 77 haría match con el 777.

La cuota de ingreso es el único camino con **dos escrituras que no comparten transacción**,
así que no corta cuando la transición de la solicitud no encuentra nada. Son dos
actualizaciones condicionales y no una: la segunda afirma sin leer y sin carrera que la
solicitud estaba vencida, porque el pago manda sobre el vencimiento, y su asiento es
**estricto** porque *es* la señal de que hay que rehacer el débito a mano.

## 7.5 La tabla de resolución

`resolve.ts` es una función **pura** de nueve reglas sobre los hechos del pago y el contexto
leído. Su regla de oro es **la suscripción manda sobre la referencia**, con una excepción.

| # | Condición | Desenlace |
|---|---|---|
| 1 | Ya existe un pago con ese identificador | Ya procesado |
| 2 | La solicitud tiene marcado **ese** cobro como pago de ingreso | Cuota de ingreso |
| 3 | Hay preapproval y suscripción con socio | Débito |
| 4 | Hay suscripción sin socio, pero con solicitud | Cuota de ingreso, o bandeja por ingreso duplicado |
| 5 | Referencia de link | Link con socio; sin socio, bandeja: sin referencia |
| 6 | Referencia de solicitud, y la solicitud existe | Ingreso, débito si ya tiene socio, o ingreso duplicado |
| 7 | Solicitud inexistente, pero la suscripción de esa referencia tiene socio | Débito |
| 8 | Preapproval desconocido | Bandeja: sin suscripción |
| 9 | Nada | Bandeja: sin referencia |

La regla 2 se antepone a todo por REG-14: si el proceso murió entre la marca y la escritura
del pago, y después la Comisión asentó el acta, la regla 3 tomaría ese cobro como débito y
esos pesos de la **cuota de ingreso** se imputarían como cuota social.

Los seis motivos de la bandeja están cerrados en una constante: sin referencia, sin
suscripción, solicitud ausente, ingreso duplicado, cesante sin pendientes y rechazo del
dominio. El registro de una fila nueva devuelve "ya existe" ante un choque, **pero si el
segundo evento trae el preapproval y la fila sigue abierta sin uno, se lo completa**: el caso
real es el débito de una suscripción creada a mano, cuyo pago llega sin referencia.

## 7.6 Tres semánticas de "suscripción viva"

No son dos, y deliberadamente no se aplanan.

| Función | Forma | Pregunta que responde | Ante un estado desconocido |
|---|---|---|---|
| `canStillCharge` | Lista **blanca** de tres estados | ¿Puede salir plata por acá? | **No** afirma |
| `isNotCancelled` | Lista **negra** de un valor | ¿Puedo afirmar que acá no hay débito? | **Sí** avisa |
| `isCharging` | **Un** valor | ¿De acá está saliendo plata ahora? | — |

Las dos primeras fallan hacia lados **opuestos**, y hay un test dedicado a que no sean
complementarias: no prometer un débito que no existe pesa distinto que no saber, que es peor
que avisar de más. Antes había cinco definiciones repartidas, y dos costaban plata.

Hay además dos preguntas que **no** usan ninguna de las tres: el lote de actualización de
monto pregunta por el estado autorizado a secas, y el efecto de cancelar tiene cuatro
desenlaces con una frase cada uno, en tercera persona para el operador y en segunda para el
socio.

## 7.7 La conciliación diaria

Corre a las 03:17 y es **la red**: reutiliza el mismo procesador que el webhook, así que el
resultado de un aviso perdido es idéntico al del aviso recibido. Un registro asocia cada
resultado a una clasificación —aplicado, bandeja, salteado— y el archivo **no compila** hasta
que alguien decida qué es un resultado nuevo. Cinco pasos:

1. **Pagos aprobados de las últimas 72 horas.** Primero resuelve la cuenta propia; si eso
   falla, el paso **no corre**, porque sin identificador propio no hay contra qué comparar.
   Por cada pago pregunta **antes que nada** si es una cobranza propia; si ya lo conoce
   localmente o está en la bandeja, sigue de largo; si no, se lo pasa al procesador junto
   con el preapproval del propio pago.
2. **Cargos autorizados, una suscripción por vez**, con un ritmo fijo entre una y otra. Es
   la red que no depende de la ventana de 72 horas. Sólo corre para suscripciones **con
   socio**. Un cobro ya asentado localmente lo frena igual que en el paso 1, pero **a
   diferencia del paso 1, una fila abierta de la bandeja no lo frena**: acá el cron llega con
   algo que el webhook no tenía, el preapproval, así que puede resolver lo que quedó sin
   imputar.
3. **Sincronización del espejo** de cada suscripción viva. La deriva exige dos condiciones:
   que el estado remoto difiera del local **y** que no sea el autorizado, porque un alta en
   vuelo que sigue pendiente y un alta que llegó a autorizada son los dos casos sanos.
4. **Preapprovals huérfanos.** Los que ya tienen fila local se saltean; **las canceladas
   también**, porque no cobran nunca más. Sin referencia parseable se cuentan; con solicitud
   viva se **recrea** la fila local con su socio; con solicitud muerta se cancelan.
5. **Divergencias de monto** de la suscripción y de los planes de referencia contra el valor
   vigente.

Responde 200 si no hubo ningún error y **207 si corrió entera con alguno**: es la única señal
de que la red se rompió. Los errores van topeados en cantidad y en largo, y los identificadores
ya **no** van al resumen —se comían el recorte y dejaban el error sin diagnóstico—: van al log
completo.

## 7.8 Pagos ajenos

La búsqueda de pagos devuelve también **lo que la cuenta pagó**: la factura mensual de Mercado
Pago por cargos de operar llega aprobada, sin identificador de cobrador ni pagador, y el cron
la mandaba a la bandeja como un cobro sin referencia. Medido sobre los trece
pagos productivos desde julio de 2026: los diez cobros reales traen el identificador propio
como entero, y las tres facturas no traen nada. **La señal es la ausencia**, así que la regla
es "propio o nada" y falla cerrada. Dos decisiones:

1. **El identificador propio sale del token**, con una consulta cacheada por proceso. Una
   variable de entorno o una fila de configuración pueden quedar desactualizadas; el token
   no.
2. **La guarda vive en el cron y no en el núcleo, a propósito.** Como la señal es una
   ausencia, un cambio de payload la dispararía para todo: en el cron eso apaga la red de
   forma visible; en el procesador apagaría el asiento de los cobros reales sin ninguna
   alerta.

Un pago ajeno **no va a la bandeja** —que es plata que entró— sino a un contador y a un
asiento **único por pago**.

## Dónde está en el código

Todo `src/lib/mp`; la ruta, en `src/app/api/webhooks/mp/route.ts`.

# 8. Los crons del dinero y los avisos

Los cinco están declarados en un registro cuya clave es igual a su valor, para que un error
de tipeo no compile. La guarda es común: sin `CRON_SECRET` responden **503**; con un bearer
que no coincide, **401**, con comparación de tiempo constante y el largo chequeado antes,
porque la comparación segura falla si los largos difieren.

| Ruta | Horario | Qué hace | Cuándo saltea | Respuestas |
|---|---|---|---|---|
| `/api/cron/reconcile` | 03:17 | La conciliación de cinco pasos | Nunca | 200 / 207 / 500 |
| `/api/cron/applications` | 08:05 | Recordatorio de pago a los tres días y expiración a los siete | Nunca | 200 / 207 / 500 |
| `/api/cron/accrual` | 00:30 | El devengo del mes vencido | Todos los días salvo el 1° | 200 / 207 / 400 / 500 |
| `/api/cron/digest` | 07:30 | La purga de retención y, con novedades, el resumen a la Comisión | Sin novedades (la purga corre igual) | 200 / 207 / 500 |
| `/api/cron/reminder` | 10:00 | El recordatorio de vencimiento de la cuota | Todos los días salvo el último del mes | 200 / 207 / 400 / 500 |

Cinco reglas transversales:

1. **Un cron que decide no actuar no es una corrida.** La decisión vive en el **módulo**,
   nunca en la ruta; la ruta sólo la consulta para no abrir una fila vacía. Un día que no
   corresponde responde 200 con la marca de salteado y **no escribe nada**.
2. **207 y no 200** cuando hubo errores por ítem: es la única señal de que algo se rompió
   sin tumbar la corrida.
3. **Escotilla manual** en el devengo y el recordatorio, detrás del mismo secreto, con lista
   blanca de valores: cualquier otra cosa es un **400** y no un silencio, porque un cero
   leído como fuerza sería lo contrario de lo que escribió el operador. El devengo acepta
   además un mes tope, validado contra un rango **derivado** de las constantes del dominio.
   Los parámetros se validan **antes** de mirar el calendario.
4. **La marca de forzado va siempre en el resumen**, también cuando es falsa: si sólo
   apareciera al forzar, la pantalla no podría separar una corrida automática de una fila
   vieja sin el campo. El resumen a la Comisión **no tiene escotilla**: su ventana es el día
   civil anterior, así que forzarlo sería remandar el mismo correo.

La pantalla de salud (`/admin/salud`) mide cada cron con **su propia vara**: veinticuatro
horas para la conciliación y las solicitudes, **treinta y un días** para el devengo y el
recordatorio —que actúan una vez por mes— y una semana para el resumen. Medirlos a los cinco
con la misma vara pintaría de rojo dos de ellos veintinueve días de cada treinta. Marca
*stale* recién al **doble** del período esperado, y *colgado* si una corrida quedó sin
terminar hace más de dos horas.

## 8.1 El recordatorio, en detalle

El período que reclama lo decide el calendario: el último día civil del mes reclama **el mes
en curso**; cualquier otro día —sólo alcanzable forzando— reclama **el mes anterior**, que es
el último que ya venció. **El texto del correo también lo decide el calendario y no el
parámetro**: "vence mañana" o "venció y quedó impaga". Por socio, en orden: se saltea a quien tenga el piso de cobertura por encima del período —el
mismo piso que el devengo, sin el cual el vecino que se asoció el 25 recibía el 30 un reclamo
por ese mes—; se saltea a quien ya lo pagó o lo tiene exento; se deduplica contra los avisos
ya mandados del mismo período; se cuenta aparte a quien no tiene casilla utilizable; y se
pide lugar al presupuesto de correos, difiriendo si no hay.

**Un bloqueo por lista blanca de correo no es un fallo**: se cuenta aparte y **devuelve el
lugar** al presupuesto, porque el correo nunca tocó la red. Si contara como error, la corrida
del último día de cada mes cerraría en 207 para siempre mientras la lista esté puesta.

Las cuotas atrasadas que el correo menciona se cuentan con los períodos **anteriores** al
reclamado y no con el estado pendiente a secas: sin eso se colaba la del mes en curso —la que
deja la reversión al anular un recibo— y el correo nombraba dos veces la misma cuota.

Un límite conocido y sin pantalla: **lo diferido no lo levanta la corrida siguiente**, porque
para entonces el período ya es otro, y el contador del resumen es la única señal. Lo mismo
vale para lo diferido de la conciliación; se resuelve a mano desde la pantalla de salud, con
"Reenviar por email".

## Dónde está en el código

`src/lib/cron/auth.ts`, las rutas de `src/app/api/cron`, y los módulos
`src/lib/treasury/accrual.ts`, `src/lib/treasury/reminder.ts`, `src/lib/applications/cron.ts`,
`src/lib/admin/digest.ts` y `src/lib/mp/reconcile.ts`. Las varas, en `src/lib/admin/health.ts`.

# 9. Los correos

## 9.1 La cañería

El transporte se arma una sola vez. Con las cuatro variables de Brevo y el remitente
configurados es SMTP real; si falta alguna, es un transporte de consola, así que el entorno
de desarrollo no se bloquea y ningún correo sale. Si `EMAIL_ALLOWLIST` está definida, el
transporte **se envuelve** con una guarda que lanza un error con un código propio y loguea
**sin la dirección**; vive en el transporte y no en los llamadores, así que cubre el wizard
público, el panel y los crons por igual.

Por encima está el mailer, con tres bocas —socio, solicitud y reporte— y **un solo punto de
escritura** de la fila de notificación. Un envío exitoso la escribe como enviada; un fallo,
como fallida con el **código** del error y nunca la dirección (Ley 25.326). **El bloqueo por
lista blanca no escribe nada**: es el entorno de prueba andando, no un fallo. Si contara, en
producción una sola corrida dejaría alrededor de ciento sesenta filas rojas y la pantalla de
salud nacería inservible.

El tope de correos es un **presupuesto inyectado por corrida** y no un contador de módulo: el
procesador del webhook es un singleton de proceso, y un contador global lo habría dejado mudo
después de cincuenta correos hasta el próximo reinicio de PM2. El cupo **vuelve** cuando el
envío termina sin correo, así que el tope cuenta correos **mandados** y no intentos. Un cero
o un valor basura en `MAIL_BATCH_CAP` **no apagan los avisos**: caen al valor por defecto.

## 9.2 Las veintisiete plantillas

Todos los asuntos salvo la alerta a la Comisión terminan con "— Vecinal Ciudadela"; la
tabla lo omite. La última columna dice si el envío deja una fila de notificación.

| Plantilla | Asunto | Disparador | Destinatario | Deja constancia |
|---|---|---|---|---|
| `verificationEmail` | Verificá tu email | Doble opt-in de ASOCIATE (REG-08) | Solicitud | Sí |
| `invitationEmail` | Creá tu contraseña | Cuerpo del envoltorio del portal | Socio | Sí |
| `portalInvite` | (envoltorio del anterior) | Alta de cuenta de socio | Socio | Sí |
| `passwordResetEmail` | Restablecé tu contraseña | Recuperación de contraseña | Usuario | **No** |
| `loginEmailMovedNotice` | Cambió la dirección de acceso de tu cuenta | Cambio del email de acceso | Dirección anterior | **No** |
| `loginEmailVerification` | Confirmá tu nueva dirección de acceso | Ídem | Dirección nueva | Sí |
| `applicationReceivedEmail` | Recibimos tu solicitud | Alta de adherente sin débito | Solicitud | Sí |
| `applicationAcceptedEmail` | Recibimos tu solicitud y tu pago | Acuse tras el pago de ingreso | Solicitud | Sí |
| `applicationRejectedEmail` | Sobre tu solicitud de asociación | Rechazo con acta | Solicitud | Sí |
| `applicationResumeEmail` | Retomá tu solicitud | Reenvío del enlace de retome | Solicitud | Sí |
| `paymentReminderEmail` | Tu solicitud está esperando el pago | Cron de solicitudes, a los 3 días | Solicitud | Sí |
| `feeReminderEmail` | Tu cuota de {mes} vence mañana | Cron del recordatorio | Socio | Sí |
| `boardDigestEmail` | Resumen del {día} | Cron del resumen, con novedades | La Comisión | Sí |
| `receiptEmail` | Recibo {número} | Emisión del recibo, con PDF adjunto | Socio o solicitud | Sí |
| `paymentLinkEmail` | Tu link para pagar la cuota | El operador manda el link | Socio | Sí |
| `paymentRejectedEmail` | No pudimos cobrar tu cuota | Cobro rechazado, con su motivo | Socio vigente | Sí |
| `memberRequestDecided` | Tu solicitud de {tipo} fue {resultado} | La Comisión decide, con acta | Socio | Sí |
| `reregistrationCallEmail` | Re-empadronamiento de socios adherentes — tenés tiempo hasta el {fecha} | Primera instancia | Convocado | Sí |
| `reregistrationSecondEmail` | Último plazo para re-empadronarte — hasta el {fecha} | Segunda instancia | Convocado | Sí |
| `presentationReceivedEmail` | Recibimos tu re-empadronamiento | Envío de la presentación | Presentante | Sí |
| `presentationObservedEmail` | Tenemos que pedirte una corrección en tu re-empadronamiento | La Comisión observa | Presentante | Sí |
| `presentationRejectedEmail` | Tu re-empadronamiento no fue aceptado | La Comisión rechaza | Presentante | Sí |
| `withdrawalDeclaredEmail` | Tu baja como socio | Baja declarada con acta | Socio | Sí |
| `adminInvitationEmail` | Tu acceso al panel de administración | Invitación de gestión | Usuario de gestión | Sí |
| `reportReceivedEmail` | Recibimos tu {reclamo} N° {n} | Envío del reporte | Quien reportó | Sí |
| `reportFiledEmail` | Presentamos tu reporte N° {n} / Tratamos tu iniciativa N° {n} | Presentación ante el organismo, o tratamiento en Comisión | Quien reportó | Sí |
| `reportBoardAlertEmail` | Nuevo reporte — {Reclamo o Iniciativa} N° {n}: {categoría › subtipo} | Alerta al recibirse | La Comisión | Sí |

El copy por **tipo de reporte** se revisa en todas las superficies: un **reclamo** se
presenta ante un organismo, y una **iniciativa** la trata la Comisión Directiva (Art. 6,
Derechos 2). Las tres plantillas de reportes distinguen los dos casos en asunto y cuerpo.

## 9.3 El envío del recibo

Es *best-effort* y nunca lanza. Sus resultados están tipados: enviado, sin casilla,
**anulado** y error con código. Cinco reglas:

1. **Un recibo anulado no se manda**: el PDF ya no representa nada cobrado.
2. **La ficha manda sobre la solicitud**: si el socio existe y no tiene casilla utilizable, el
   recibo **no se desvía** a la dirección de la solicitud vieja.
3. Si el PDF no está en disco, **se regenera**.
4. El concepto sale de la fila del recibo, que lo tiene congelado, y no de las cuotas.
5. El resumen que se guarda en la notificación lo arma un módulo **sin una sola importación**,
   porque es el **único nexo** entre el aviso y el recibo —la fila no guarda el identificador—
   y una deriva entre quien escribe y quien lee rompería la deduplicación en silencio.

La marca de "enviado" se sella en su propio `try`: si eso falla, el envío **no** se reporta
como fallido, porque el socio ya lo tiene y un reenvío le duplicaría el PDF.

## Dónde está en el código

`src/lib/email/transport.ts`, `index.ts`, `batch-cap.ts` y `templates.ts`; el envío del
recibo, en `src/lib/treasury/receipt-email.ts`.

# 10. Cómo se prueba

## 10.1 Sandbox de Mercado Pago

**Nunca se prueban cobros en producción**: ahí la plata es de un vecino. El circuito se
prueba en un sandbox local, y armarlo tiene cinco pasos aprendidos midiendo.

1. **Cuenta de prueba propia, y una aplicación dentro de ella.** Las "credenciales de prueba"
   de la aplicación productiva **no** son un sandbox: el token empieza con `TEST-` pero la
   consulta de la cuenta devuelve la cuenta real y opera sobre ella. El 23/08/2026 eso hizo
   que la pantalla de suscripciones listara las dos suscripciones vivas de producción, y el
   paso siguiente del plan era el lote que les cambia el monto del débito. Lo correcto es
   crear la aplicación **dentro** del usuario de prueba vendedor y usar su token.
2. **Túnel público.** Mercado Pago rechaza `localhost` tanto en la URL de vuelta como en la de
   notificación. El dominio del túnel cambia en cada corrida y hay dos lugares que actualizar
   cada vez: los orígenes permitidos del servidor de desarrollo y la URL del webhook.
3. **Los orígenes permitidos no son opcionales.** Entrando por el túnel, el servidor de
   desarrollo bloquea sus propios chunks estáticos y la página llega sin JavaScript: el
   captcha no se monta y el ingreso responde "credenciales inválidas".
4. **Webhook en las dos solapas del panel**, con la misma URL y la misma clave, y esa clave en
   la variable de entorno. El token de una aplicación de cuenta de prueba dispara los avisos
   por la solapa de **modo productivo**, no por la de prueba; con sólo la solapa de prueba
   configurada el silencio es total. Costó dos adhesiones medirlo.
5. **La URL de autenticación apuntando al túnel** mientras dure la prueba.

Y cuatro cosas que no hay que hacer: probar cobros contra el dominio productivo; mezclar
mundos (comprador de prueba con vendedor de prueba); usar identificadores de plan
productivos con un token de sandbox, porque los planes pertenecen a la cuenta que los creó;
y dejar datos de prueba vivos.

## 10.2 Tests unitarios y de integración

El grueso del dominio se prueba sin red y sin base, por dos patrones. **El gateway es una
interfaz propia**, así que los tests le pasan un doble y ejercitan el procesador, la
conciliación y el lote de montos sin SDK. Y **en los módulos puros el cliente de Prisma se
inyecta y no se importa**, porque el compartido lanza al evaluarse si falta la URL de la
base. La tabla de resolución, el piso de cobertura, la imputación, la reversión, el
calendario, los predicados de suscripción viva y la aritmética del reparto son funciones
puras, cada una con su archivo de test.

Dos advertencias que este dominio ya pagó: **el doble de base tiene que honrar el `where` que
recibe** —uno que reimplementa el filtro deja cláusulas sin ejercitar y el test pasa igual—,
y **la única prueba de que una guarda se está probando es borrarla y ver el test en rojo**.

Cuatro archivos corren contra una MariaDB de verdad, con la variable de base de pruebas
apuntando a una base migrada. Verifican lo que ningún doble puede: que el pago es la primera
escritura y el que pierde la unique muere antes de pedir número; que **un rollback no consume
número**, a diferencia de un autoincremento; que el nombre del índice violado llega donde el
código lo busca; y el reparto bajo concurrencia real. Corren **en serie entre sí**, y no por
convención: dos archivos que tocan la serie del mismo año se pisan y producen el síntoma que
REG-33 prohíbe, un hueco en la numeración, sin que haya ningún bug. Dentro de cada archivo el
paralelismo sigue intacto: la serie se verificó con veinte recibos concurrentes.

## 10.3 Medir antes de suponer

Es la regla que más plata ahorró en este dominio: tres pasadas contra la API real de Mercado
Pago dispararon **cinco arreglos de código que ningún test podía ver**, uno por commit.

1. La búsqueda de cargos autorizados mandaba un tamaño de página que ese endpoint rechaza, así
   que devolvía 400 **siempre y en silencio**: el paso 2 de la conciliación **nunca había
   funcionado**.
2. El gateway no leía el preapproval que viene **dentro del propio pago**, así que la
   notificación de un débito nunca resolvía sola.
3. Las notificaciones que no atendemos respondían 4xx y Mercado Pago las reintentaba.
4. Un identificador sembrado que Mercado Pago no puede parsear hacía que el cron devolviera 207
   en toda corrida local, y un cron que siempre falla un poco es un cron cuyos errores nadie
   mira.
5. El concepto congelado del recibo no llegaba a la cuenta corriente, así que la fila tachada
   de un pago revertido decía "Cuota social" a secas.

La misma lección se cobró después **contra el driver de la base**: con el adaptador de
MariaDB **no existe el campo donde la documentación de Prisma dice que viaja el nombre del
unique violado**. Una guarda escrita contra ese campo **pasa todos los tests y nunca
coincide en producción**, porque el doble de los tests es el que miente. Por eso la lectura
del índice está centralizada, soporta las dos formas y **falla cerrada**.

La pregunta siguiente después de "¿responde?" es "¿responde **sólo** lo nuestro?": de ahí
salió el arreglo de los pagos ajenos.

## Dónde está en el código

Los tests del dominio están en `tests/` con los prefijos `treasury-` y `mp-`; los de
integración, en `tests/integration`. El instructivo del sandbox es la Parte J de
`docs/11-preparacion-mp-sandbox-turnstile.md`.

# Documentos relacionados

| Documento | Qué aporta a este |
|---|---|
| T1 — Visión y panorama | Los roles, el mapa del sitio y el estado de cada módulo |
| T2 — Arquitectura y código | Las capas y los patrones transversales del proyecto |
| T3 — Instalación y operación | El crontab, las variables de entorno, los backups y la salud |
| T4 — Modelo de datos | Las tablas, enums, uniques y migraciones que acá se nombran |
| T6 — Módulos de dominio | Altas, socios y libros, re-empadronamiento, reportes y actas |
| T7 — Seguridad y calidad | Tokens, limitadores, cabeceras, Ley 25.326 y auditoría |

Y en `docs/`: `02-marco-estatutario.md` para los REG-xx citados,
`06-integracion-mercadopago.md` para el diseño original de la integración,
`07-plan-de-etapas.md` para la historia de las fases 4A a 4D y
`11-preparacion-mp-sandbox-turnstile.md` para el sandbox y el crontab.
