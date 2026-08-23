// Navegación por EJERCICIO de Otros ingresos: qué años se ofrecen, cuál se
// muestra y en qué dirección vive cada uno.
//
// Puro, sin Prisma y sin React: la resolución de `?anio=` y `?mes=` es la misma
// decisión que toma la página y la que toman las acciones para volver a donde
// estaba el operador, y tiene que ser una sola función o se separan.
//
// El equivalente de /actividades (`activitiesYearHref`, `resolveActivitiesYear`)
// se quedó donde estaba: allá el año resuelto tiene que coincidir con el
// canonical del <head> y por eso arrastra `isCanonical`. Acá no hay SEO —es
// panel de admin— y lo único que importa es que ninguna URL rompa.
import type { IncomeMethod } from "@/generated/prisma/client";
import { fallbackYear } from "@/lib/dates";

export const INCOME_BASE = "/admin/tesoreria/otros-ingresos";

/** Los años que ofrece la barra: los que tienen ingresos MÁS el año en curso,
 *  aunque esté vacío. El ejercicio en curso es donde se carga: si el 2 de enero
 *  la barra arrancara en el año pasado, la primera carga del año iría a parar a
 *  una pantalla que el operador no está mirando. Descendente. */
export function exerciseYears(withIncome: number[], current: number): number[] {
  const all = new Set(withIncome);
  all.add(current);
  return [...all].sort((a, b) => b - a);
}

/**
 * El ejercicio que se muestra. Todo lo que no sea un año de la barra cae en el
 * default y NO rompe: basura, repetido (`?anio=2025&anio=2024` llega como
 * array), decimales, espacios ("%202025") y años sin datos.
 *
 * El `^\d+$` estricto es el mismo criterio de /actividades y de `?pagina=` en
 * /noticias: `Number()` acepta `0x7e9` y `2025e0` como año y no hay motivo para
 * que esta pantalla tenga una vara distinta.
 *
 * No hay redirect a la URL canónica —que allá existe por el canonical del
 * <head>—: acá un `?anio=abc` es un dedazo de nadie, y un redirect de más es
 * medio segundo que el operador espera para ver lo mismo.
 */
export function resolveIncomeYear(
  param: string | string[] | undefined,
  years: number[],
  current: number,
): number {
  const requested = typeof param === "string" && /^\d+$/.test(param) ? Number(param) : Number.NaN;
  // `years` siempre contiene el año en curso (`exerciseYears`), así que el
  // fallback es el año en curso; se pasa igual por `fallbackYear` para no tener
  // dos reglas del mismo default.
  return Number.isInteger(requested) && years.includes(requested)
    ? requested
    : fallbackYear(years, current);
}

/** El mes de la cinta, 1 a 12. Cualquier otra cosa es "el ejercicio entero". */
export function resolveIncomeMonth(param: string | string[] | undefined): number | null {
  if (typeof param !== "string" || !/^\d+$/.test(param)) return null;
  const m = Number(param);
  return m >= 1 && m <= 12 ? m : null;
}

export type IncomeListLocation = {
  year: number;
  month?: number | null;
  method?: IncomeMethod | null;
};

/**
 * La dirección de una vista de la lista. El año en curso vive en la URL limpia
 * y los demás en `?anio=`: una sola dirección por contenido, igual que
 * /actividades.
 *
 * Sólo enteros y el enum del medio entran acá. El concepto y la nota son texto
 * libre del operador y pueden nombrar a un tercero: no van a la URL, que queda
 * escrita en el access log de Nginx y de Cloudflare (Ley 25.326, docs/08).
 */
export function incomeListHref(loc: IncomeListLocation, currentYear: number): string {
  const qs = new URLSearchParams();
  if (loc.year !== currentYear) qs.set("anio", String(loc.year));
  if (loc.month) qs.set("mes", String(loc.month));
  if (loc.method) qs.set("medio", loc.method);
  const s = qs.toString();
  return s ? `${INCOME_BASE}?${s}` : INCOME_BASE;
}
