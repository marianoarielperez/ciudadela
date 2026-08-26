// Civil dates (no meaningful time-of-day) are stored as UTC noon so that
// rendering in UTC-3 can never shift the day.
export function civilDateUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

// ExcelJS yields date cells as JS Dates at UTC midnight.
export function excelDateToCivilUtc(d: Date): Date {
  return civilDateUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export type CivilDateResult = { ok: true; value: Date } | { ok: false; error: string };

// Parses a "YYYY-MM-DD" string into a civil-noon-UTC Date, rejecting what a
// shape-only regex (`/^\d{4}-\d{2}-\d{2}$/`) lets through but `civilDateUtc`
// would silently roll over: a day that doesn't exist ("2026-02-31" becomes
// 2026-03-03) or a mistyped four-digit year ("0202", "2062"). Every screen
// that parses a hand-typed civil date shares this one guard instead of
// re-deriving it — see `parseBirthDate` (card-edit.ts) and `parseMinuteDate`
// (minute-date.ts).
export function parseCivilDate(
  iso: string,
  opts: { minYear?: number; maxDate?: Date; invalidError: string; rangeError?: string },
): CivilDateResult {
  const [y, m, d] = iso.split("-").map(Number);
  const value = civilDateUtc(y, m, d);
  const rolled =
    value.getUTCFullYear() !== y || value.getUTCMonth() + 1 !== m || value.getUTCDate() !== d;
  if (rolled) return { ok: false, error: opts.invalidError };
  const minYear = opts.minYear ?? 1900;
  if (y < minYear || (opts.maxDate !== undefined && value.getTime() > opts.maxDate.getTime())) {
    return { ok: false, error: opts.rangeError ?? opts.invalidError };
  }
  return { ok: true, value };
}

// El año civil ARGENTINO de un instante, no el del reloj UTC del server: entre
// las 21 y las 24 del 31 de diciembre el server ya está en enero, y una
// pantalla que se para en "el año en curso" mostraría el año que viene mientras
// el vecino —y el ejercicio de la asociación— todavía están en el anterior.
//
// Vive acá, y no en /actividades donde nació, porque el mismo hecho lo necesitan
// dos cosas sin relación entre sí: el calendario público y el ejercicio anual de
// Tesorería. Es un helper de fecha civil, que es lo que este módulo junta.
export function currentYearAR(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
    }).format(now),
  );
}

// El día de la semana ARGENTINO (lunes=1 … domingo=7), por el mismo motivo que
// currentYearAR: cerca de la medianoche el reloj UTC del server ya está en el
// día siguiente. Mismo esquema de numeración que Activity.weekdays.
export function currentWeekdayAR(now: Date = new Date()): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[short] ?? 1;
}

// El año por defecto de una barra de años: el año en curso manda por sobre el
// más reciente cargado. Si ya hay algo cargado del año que viene, el que entra
// hoy tiene que ver el de hoy, no el que todavía no empezó.
export function fallbackYear(years: number[], current: number): number {
  return years.includes(current) ? current : (years[0] ?? current);
}
