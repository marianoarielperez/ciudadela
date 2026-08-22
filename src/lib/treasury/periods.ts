// Períodos mensuales de la cuenta corriente: "YYYY-MM". Puro, sin Prisma.
// La zona de negocio es la de Argentina (UTC-3, sin DST): el "mes actual" se
// decide ahí y no en UTC, o el cron de las 00:30 del día 1 devengaría el mes
// equivocado.
const TZ = "America/Argentina/Buenos_Aires";

export type Period = string;

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPeriod(s: string): boolean {
  return PERIOD_RE.test(s);
}

export function periodYear(p: Period): number {
  return Number(p.slice(0, 4));
}

export function periodMonth(p: Period): number {
  return Number(p.slice(5, 7));
}

function build(year: number, month: number): Period {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function periodOf(date: Date): Period {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" })
    .formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return build(year, month);
}

export function currentPeriod(now: Date = new Date()): Period {
  return periodOf(now);
}

export function addMonths(p: Period, n: number): Period {
  const total = periodYear(p) * 12 + (periodMonth(p) - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return build(year, month);
}

export function comparePeriods(a: Period, b: Period): number {
  // "YYYY-MM" con cero a la izquierda ordena lexicográficamente igual que en el tiempo.
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusivo en los dos extremos; vacío si `to` es anterior a `from`. */
export function periodRange(from: Period, to: Period): Period[] {
  const out: Period[] = [];
  let p = from;
  while (comparePeriods(p, to) <= 0) {
    out.push(p);
    p = addMonths(p, 1);
  }
  return out;
}

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function monthName(month: number): string {
  return MONTHS[month - 1];
}

export function periodLabel(p: Period): string {
  return `${monthName(periodMonth(p))} ${periodYear(p)}`;
}

/** Los últimos `n` meses del año (`n` = 8 → mayo..diciembre). La excepción de
 *  las bajas (el Excel dice "8" para ene..ago 2025, hasta el mes de la baja) la
 *  resuelve `debt-import.ts`, no esta función. */
export function lastPeriodsOfYear(year: number, n: number): Period[] {
  if (n <= 0) return [];
  const from = Math.max(1, 12 - n + 1);
  const out: Period[] = [];
  for (let m = from; m <= 12; m++) out.push(build(year, m));
  return out;
}
