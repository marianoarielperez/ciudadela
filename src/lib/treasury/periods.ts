// Períodos mensuales de la cuenta corriente: "YYYY-MM". Puro, sin Prisma.
// La zona de negocio es la de Argentina (UTC-3, sin DST): el "mes actual" se
// decide ahí y no en UTC, o el cron de las 00:30 del día 1 devengaría el mes
// equivocado.
import { civilDateUtc } from "@/lib/dates";

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

// El año/mes/día que marca el calendario argentino en ese instante. Es el único
// lugar del proyecto que traduce un instante de reloj a una fecha civil, y por
// eso `periodOf` y `civilDayOf` salen los dos de acá: si alguna vez cambia la
// zona de negocio, cambia una línea.
function civilPartsOf(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function periodOf(date: Date): Period {
  const { year, month } = civilPartsOf(date);
  return build(year, month);
}

export function currentPeriod(now: Date = new Date()): Period {
  return periodOf(now);
}

/** El día civil ARGENTINO de `date`, como el mediodía UTC con el que el
 *  proyecto guarda toda fecha civil (`civilDateUtc`).
 *
 *  Existe para comparar un instante de reloj contra una columna de fecha civil
 *  sin que la hora del día decida. El mediodía UTC son las 09:00 argentinas,
 *  así que un `validFrom <= new Date()` crudo deja al valor invisible entre las
 *  00:00 y las 08:59 del propio día en que empieza a regir: el superadmin que
 *  registra un valor "desde hoy" y recarga a la mañana leería que no rige
 *  ninguno, arriba de la fila que acaba de crear. Comparando contra el mediodía
 *  del día argentino, el valor rige el día entero.
 *
 *  El día se resuelve en Argentina y no en UTC a propósito: a las 23:00 de acá
 *  UTC ya está en el día siguiente, y ese valor todavía no tiene que regir. */
export function civilDayOf(date: Date = new Date()): Date {
  const { year, month, day } = civilPartsOf(date);
  return civilDateUtc(year, month, day);
}

/** ¿El día civil ARGENTINO de `at` es el 1° del mes? Lo pregunta el cron de
 *  devengo, que corre a las 00:30 y tiene que decidir con el calendario de acá:
 *  a esa hora UTC ya está en el día siguiente desde las 21:00 de la víspera. */
export function isFirstCivilDayOfMonth(at: Date = new Date()): boolean {
  return civilDayOf(at).getUTCDate() === 1;
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
