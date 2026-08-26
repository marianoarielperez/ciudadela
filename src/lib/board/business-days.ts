// Días HÁBILES de la cartelera de la sede. Puro: no toca Prisma ni el reloj.
//
// POR QUÉ ESTE MÓDULO VIVE SEPARADO DE `reregistration/rules.ts`. El proceso
// del Art. 9° bis mezcla dos aritméticas que NO se pueden confundir:
//   · los plazos del artículo (30 / 10 / 30 corridos, y los 90 del Art. 40) son
//     DÍAS CORRIDOS — el estatuto no lo aclara y el proyecto tomó la lectura
//     conservadora del art. 6 del CCyC. Ahí no hay feriados en juego;
//   · la cartelera son DÍAS HÁBILES, porque su artículo (5° ter) sí dice
//     "veinte (20) días hábiles" con todas las letras.
// Están en archivos distintos a propósito: `rules.ts` NO importa feriados, y
// así nadie puede mezclarlas por descuido al agregar un plazo nuevo.
//
// Hábil = lunes a viernes que no sea feriado nacional. Los días no laborables
// con fines turísticos (los "puentes") NO cuentan como feriado: son días de
// opción y no interrumpen el plazo — ver `scripts/seed-holidays.ts`.
import { civilDayOf } from "@/lib/treasury/periods";

/** Plazo de la notificación por cartelera (Art. 5° ter). */
export const BOARD_BUSINESS_DAYS = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** El cómputo pisó un año del que el calendario inyectado no dice nada. Ver el
 *  bloque "COBERTURA" de `businessDayEnd`: es un error, no un cero. */
export class HolidayCoverageError extends Error {
  readonly missingYear: number;

  constructor(missingYear: number) {
    super(
      `No hay feriados cargados para ${missingYear}: no se puede computar un plazo ` +
        `de días hábiles que entra en ese año. Cargá el año desde el ABM de feriados ` +
        `del panel (o corré scripts/seed-holidays.ts) y volvé a intentar.`,
    );
    this.name = "HolidayCoverageError";
    this.missingYear = missingYear;
  }
}

/** Los años civiles sobre los que el calendario inyectado tiene algo para
 *  decir. Se exporta para que una pantalla pueda AVISAR antes de que el
 *  operador asiente una fijación cuyo plazo se iría a un año sin cargar,
 *  en vez de comerse el error recién al guardar. */
export function holidayCoverageYears(holidays: readonly Date[]): Set<number> {
  const years = new Set<number>();
  for (const holiday of holidays) years.add(civilDayOf(holiday).getUTCFullYear());
  return years;
}

/** Fin del plazo de cartelera: `days` días HÁBILES (lunes a viernes menos los
 *  feriados inyectados) contados desde el día SIGUIENTE a la fijación. El día
 *  en que se cuelga el cartel no cuenta.
 *
 *  Los feriados se inyectan como fechas civiles (mediodía UTC, el criterio con
 *  el que el proyecto guarda TODA fecha civil): así el módulo se testea sin
 *  base y el llamador decide de dónde salen. Se pueden pasar desordenados y con
 *  repetidos. `postedAt` puede ser un instante cualquiera: el día lo resuelve
 *  `civilDayOf` con el calendario ARGENTINO, porque a las 21:00 de acá el reloj
 *  UTC del server ya está en el día siguiente y el plazo es del vecino.
 *
 *  COBERTURA — por qué esta función es más quisquillosa de lo que parece
 *  necesario. La tabla `holidays` no cubre todos los años: hoy tiene 2026 y
 *  2027, y se va cargando a mano desde el ABM del panel. Si alguien computa un
 *  plazo que entra en un año sin cargar, la lectura ingenua ("no hay filas =
 *  no hay feriados") trataría los feriados de ese año como días hábiles y le
 *  ACORTARÍA el plazo al vecino, en silencio y sin que ninguna pantalla lo
 *  muestre. Es el único modo de falla que este módulo no se puede permitir.
 *
 *  Se resuelve SIN cambiar la firma, porque el propio calendario alcanza para
 *  distinguir los dos casos: la Ley 27.399 art. 1 fija NUEVE feriados
 *  inamovibles de fecha fija —01/01, 24/03, 02/04, 01/05, 25/05, 20/06, 09/07,
 *  08/12 y 25/12—, así que un año civil argentino con CERO filas no es un año
 *  sin feriados: es un año que nadie cargó. Ante eso se lanza
 *  `HolidayCoverageError` en vez de devolver un número: falla ruidosa en vez de
 *  silenciosa, que es el criterio que el proyecto ya viene aplicando cuando la
 *  duda cuesta plata o derechos (ver `uniqueViolationTarget`, que devuelve
 *  `null` cuando no puede saber cuál unique se violó en vez de adivinar uno).
 *
 *  Lo que esta guarda NO cubre: un año cargado A MEDIAS (una sola fila de 2028
 *  lo daría por cubierto). Se aceptó a sabiendas: el sembrador carga años
 *  enteros y el ABM es para CORREGIR una fecha trasladable, no para construir
 *  un año fila por fila. La alternativa —una columna de cobertura aparte— es
 *  una tabla más que también hay que acordarse de llenar. */
export function businessDayEnd(postedAt: Date, days: number, holidays: readonly Date[]): Date {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`El plazo en días hábiles tiene que ser un entero positivo, no ${days}`);
  }

  const covered = holidayCoverageYears(holidays);
  const holidayDays = new Set<number>();
  for (const holiday of holidays) holidayDays.add(civilDayOf(holiday).getTime());

  // Mediodía UTC + 24 h sigue siendo mediodía UTC (UTC no tiene DST), así que
  // el paseo por el calendario no tiene ningún borde de horario. Y por lo mismo
  // `getUTCDay()` sobre esa fecha es el día de semana del día civil argentino.
  let cursor = civilDayOf(postedAt);
  let counted = 0;
  while (counted < days) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    const year = cursor.getUTCFullYear();
    if (!covered.has(year)) throw new HolidayCoverageError(year);
    const weekday = cursor.getUTCDay(); // 0 domingo … 6 sábado
    const isWeekend = weekday === 0 || weekday === 6;
    if (!isWeekend && !holidayDays.has(cursor.getTime())) counted++;
  }
  return cursor;
}
