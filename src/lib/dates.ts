// Civil dates (no meaningful time-of-day) are stored as UTC noon so that
// rendering in UTC-3 can never shift the day.
export function civilDateUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

// ExcelJS yields date cells as JS Dates at UTC midnight.
export function excelDateToCivilUtc(d: Date): Date {
  return civilDateUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
