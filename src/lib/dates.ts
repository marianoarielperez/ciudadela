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
