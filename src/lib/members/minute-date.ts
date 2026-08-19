// Parseo compartido de la fecha de un acta ("YYYY-MM-DD" → Date civil a
// mediodía UTC). Lo usan los tres caminos que escriben `Minute.date`:
// `createMinuteAction`, `updateMinuteAction` (actas/actions.ts) y
// `resolveMinuteId` (minute-form.ts, el acta creada inline desde una acción
// societaria). Un solo lugar para que la guarda de desborde no diverja entre
// ellos — mismo criterio que `parseBirthDate` en `card-edit.ts`.
import { parseCivilDate, type CivilDateResult } from "@/lib/dates";

export function parseMinuteDate(iso: string, now: number = Date.now()): CivilDateResult {
  return parseCivilDate(iso, {
    maxDate: new Date(now),
    invalidError: "La fecha del acta no existe.",
    rangeError: "La fecha del acta tiene que estar entre 1900 y hoy.",
  });
}
