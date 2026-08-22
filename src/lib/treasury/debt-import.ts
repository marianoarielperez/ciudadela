// Planificador PURO del import de deuda.xlsx (spec §4.2): traduce "N cuotas
// impagas en el año Y" a los períodos concretos que hay que devengar. Sin
// Prisma y sin ExcelJS a propósito — la regla que decide en qué MES cae cada
// cuota es la parte del import que no se puede revisar mirando un total, así
// que se prueba entera con una tabla de casos.
//
// La regla: las N cuotas son los N ÚLTIMOS meses que ese año llegó a devengar
// para ese socio, contando hacia atrás desde un "ancla":
//   - diciembre, en un año ya cerrado;
//   - el mes del egreso, en el año en que el socio se dio de baja (el Excel
//     dice "8" en 2025 para las 111 bajas del 31/08/2025: es enero..agosto, no
//     mayo..diciembre);
//   - el mes en curso, en el año que todavía no terminó (el Excel del
//     21/08/2026 dice "8" en 2026: enero..agosto). Anclar en diciembre ahí
//     inventaría cuotas de meses que todavía no se devengaron, que aparecerían
//     como deuda vencida meses antes de existir.
import { civilDateUtc } from "@/lib/dates";
import {
  addMonths, comparePeriods, lastPeriodsOfYear, periodMonth, periodOf, periodRange, type Period,
} from "./periods";

/** El día en que se MIDIÓ datos/deuda.xlsx. Es el `now` que tiene que usar el
 *  import: el ancla del año en curso sale de la foto y no del reloj de la
 *  corrida, o el mismo archivo se re-fecha solo en cada ejecución (la deuda
 *  2026 de siete socios se corre un mes por mes de demora, y en 2027 el "8 en
 *  2026" pasa a leerse mayo..diciembre). Los totales de control no lo detectan:
 *  siguen dando 3076 cuotas en los tres casos.
 *
 *  Vive acá, junto a la regla que alimenta, para que se pueda probar sin
 *  importar el script (que abre Prisma al evaluarse). Si alguna vez se re-mide
 *  el padrón de deuda, se cambian juntos el archivo, esta fecha y los totales
 *  de control de `scripts/import-deuda.ts`. */
export const DEBT_SNAPSHOT_DATE = civilDateUtc(2026, 8, 21);

export type DebtRow = {
  memberNumber: number;
  dni: string;
  /** Cuotas impagas por año calendario. `null` = celda vacía = no corresponde
   *  (un adherente nunca devengó), que NO es lo mismo que un 0. */
  counts: Partial<Record<number, number | null>>;
  leftAt: Date | null;
};

export type DebtPlan = { memberNumber: number; dni: string; periods: Period[] };

export function planDebtImport(
  rows: DebtRow[],
  now: Date = new Date(),
): { plans: DebtPlan[]; errors: string[] } {
  const plans: DebtPlan[] = [];
  const errors: string[] = [];
  const current = periodOf(now);

  for (const row of rows) {
    const periods: Period[] = [];
    const leftPeriod = row.leftAt ? periodOf(row.leftAt) : null;
    let rowFailed = false;

    for (const [yearKey, n] of Object.entries(row.counts)) {
      const year = Number(yearKey);
      if (n === null || n === undefined || n === 0) continue;
      if (!Number.isInteger(n) || n < 0 || n > 12) {
        errors.push(`socio ${row.memberNumber}: cuotas_deuda_${year} = ${n} no es un entero entre 0 y 12`);
        rowFailed = true;
        continue;
      }

      const yearStart: Period = `${year}-01`;
      const yearEnd: Period = `${year}-12`;
      // El ancla es el mínimo entre fin de año, mes de la baja y mes en curso.
      let anchor = yearEnd;
      if (leftPeriod && comparePeriods(leftPeriod, anchor) < 0) anchor = leftPeriod;
      if (comparePeriods(current, anchor) < 0) anchor = current;

      // El ancla cayó antes de enero de ese año: el año entero es imposible.
      if (comparePeriods(anchor, yearStart) < 0) {
        errors.push(
          leftPeriod && comparePeriods(leftPeriod, yearStart) < 0
            ? `socio ${row.memberNumber}: cuotas_deuda_${year} = ${n}, pero la baja es de ${leftPeriod} — ` +
              `después de la baja no se devengan cuotas`
            : `socio ${row.memberNumber}: cuotas_deuda_${year} = ${n}, pero ${year} todavía no devengó ` +
              `ninguna cuota (el período en curso es ${current})`,
        );
        rowFailed = true;
        continue;
      }

      // Cuántos meses de ese año llegaron a devengar PARA ESTE SOCIO. Si el
      // Excel pide más, las cuotas sobrantes se irían al año anterior sin que
      // nadie se entere: es un error del archivo, no algo para acomodar.
      const available = periodMonth(anchor);
      if (n > available) {
        errors.push(
          `socio ${row.memberNumber}: cuotas_deuda_${year} = ${n}, pero ${year} devengó a lo sumo ` +
            `${available} cuotas para este socio (hasta ${anchor})`,
        );
        rowFailed = true;
        continue;
      }

      // Con el ancla en diciembre la regla es literalmente "los últimos N meses
      // del año": se usa el helper de `periods.ts`, que ya está probado.
      periods.push(
        ...(anchor === yearEnd ? lastPeriodsOfYear(year, n) : periodRange(addMonths(anchor, -(n - 1)), anchor)),
      );
    }

    // Un plan a medias es peor que ninguno: cargaría deuda incompleta sobre un
    // socio real y el faltante no volvería a aparecer (la re-corrida saltea a
    // los socios que ya tienen deuda importada).
    if (rowFailed || periods.length === 0) continue;
    plans.push({
      memberNumber: row.memberNumber,
      dni: row.dni,
      periods: periods.sort(comparePeriods),
    });
  }

  return { plans, errors };
}
