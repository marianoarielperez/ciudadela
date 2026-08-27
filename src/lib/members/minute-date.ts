// Parseo compartido de la fecha de un acta ("YYYY-MM-DD" → Date civil a
// mediodía UTC). Lo usan los tres caminos que escriben `Minute.date`:
// `createMinuteAction`, `updateMinuteAction` (actas/actions.ts) y
// `resolveMinuteId` (minute-form.ts, el acta creada inline desde una acción
// societaria). Un solo lugar para que la guarda de desborde no diverja entre
// ellos — mismo criterio que `parseBirthDate` en `card-edit.ts`.
import { parseCivilDate, type CivilDateResult } from "@/lib/dates";
import { civilDayOf } from "@/lib/treasury/periods";

// El tope es el DÍA civil argentino, no el instante. Las fechas civiles se
// anclan al mediodía UTC (`civilDateUtc`), que son las 09:00 de acá: comparando
// contra `new Date(now)` crudo, un acta fechada HOY se rechazaba —"tiene que
// estar entre 1900 y hoy"— hasta las 09:00 de la mañana. Es el mismo error que
// ya se había corregido en la vigencia de los valores de cuota (`current()` en
// fee-values.ts compara contra el mediodía civil de hoy y no contra el reloj), y
// acá lo destapó el acta de cierre del libro, que la pantalla propone fechada
// hoy: una ceremonia de cierre a las 8 de la mañana se caía con un error que no
// tenía nada que ver con lo que estaba pasando.
//
// No afloja el tope: mañana sigue siendo futuro y sigue rechazándose.
export function parseMinuteDate(iso: string, now: number = Date.now()): CivilDateResult {
  return parseCivilDate(iso, {
    maxDate: civilDayOf(new Date(now)),
    invalidError: "La fecha del acta no existe.",
    rangeError: "La fecha del acta tiene que estar entre 1900 y hoy.",
  });
}
