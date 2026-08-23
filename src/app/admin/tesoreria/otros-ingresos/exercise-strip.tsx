// La cinta del ejercicio: doce meses en una fila, bajo una sola regla continua.
//
// El ejercicio de la asociación es el año calendario, así que la unidad de esta
// pantalla no es "un rango" sino "un año partido en doce". La cinta es esa
// forma: la regla de arriba es el año entero, y de ella cuelga lo que entró
// cada mes. Cuelga y no crece desde abajo a propósito —la plata ENTRA— y así
// los doce importes quedan alineados abajo, que es lo que se compara leyendo.
//
// Es hermana de `period-strip.tsx` (la cuenta corriente del socio) y hereda sus
// lecciones, que salieron de defectos reales:
//   — tabla semántica, no un canvas: se imprime y se lee con lector de pantalla;
//   — el `sr-only` va en un <span> DENTRO de la celda, nunca sobre el <th>: un
//     `sr-only` posiciona absoluto y una celda de tabla posicionada sale del
//     flujo, corriendo toda la fila de encabezados;
//   — el estado no puede codificarse sólo por color, porque el navegador imprime
//     sin fondos. Acá el canal primario es el importe escrito; la barra es el
//     segundo, y el mes vacío lleva un "—" visible además del punteado.
// Se diferencia en una cosa: aquéllas son doce obligaciones sueltas y van
// separadas; acá es un año continuo y por eso los doce comparten una regla.
import Link from "next/link";
import { formatARS } from "@/lib/format";
import type { ExerciseMonth, ExerciseSummary } from "@/lib/treasury/other-income";
import { monthName } from "@/lib/treasury/periods";
import { cn } from "@/lib/utils";

/** El nombre del mes que ya escribe el resto del proyecto, recortado. Una sola
 *  fuente de los doce nombres: no hay una tabla de abreviaturas acá. */
function monthAbbr(month: number): string {
  return monthName(month).slice(0, 3);
}

/** Lo que oye el lector de pantalla en cada celda. El color y la altura de la
 *  barra no le llegan: la celda tiene que decirse entera. */
export function monthCellLabel(
  cell: ExerciseMonth,
  opts: { current?: boolean; selected?: boolean } = {},
): string {
  const name = monthName(cell.month);
  const head =
    cell.count === 0
      ? `${name}: sin ingresos`
      : `${name}: ${formatARS(cell.amount)} en ${cell.count === 1 ? "1 ingreso" : `${cell.count} ingresos`}`;
  return [head, opts.current ? "mes en curso" : null, opts.selected ? "mes filtrado" : null]
    .filter(Boolean)
    .join(", ");
}

/** Alto de la barra en % de la pista. El piso de 8 es para que un mes flaco al
 *  lado de uno muy grande siga siendo una barra y no una línea invisible. */
function barPercent(amount: number, max: number): number {
  if (max <= 0 || amount <= 0) return 0;
  return Math.max(8, Math.round((amount / max) * 100));
}

export function ExerciseStrip({
  summary,
  currentMonth,
  selectedMonth,
  monthHref,
  yearHref,
}: {
  summary: ExerciseSummary;
  /** El mes en curso, sólo si el ejercicio que se mira es el que corre. */
  currentMonth: number | null;
  /** El mes al que está acotada la lista de abajo, si hay uno. */
  selectedMonth: number | null;
  /** Adónde va la celda de un mes con movimiento. */
  monthHref: (month: number) => string;
  /** Adónde vuelve la celda del mes ya seleccionado: al ejercicio entero. */
  yearHref: string;
}) {
  return (
    // La cinta no se comprime: con doce importes de peso completo abajo de
    // 54rem las cifras se cortan, y una cifra cortada es peor que un scroll.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[54rem] border-separate border-spacing-0">
        <caption className="sr-only">
          Ingresos por mes del ejercicio {summary.year}. Los meses con movimiento acotan la lista.
        </caption>
        <thead>
          <tr>
            {summary.months.map((cell) => {
              const current = cell.month === currentMonth;
              return (
                <th
                  key={cell.month}
                  scope="col"
                  aria-label={monthName(cell.month)}
                  className="w-[4.5rem] border-b border-border pb-1.5 align-bottom text-center"
                >
                  {/* El mes en curso va en negrita ADEMÁS del relleno: en gris
                      de impresora el relleno se pierde y el peso no. */}
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-[11px] uppercase tracking-widest",
                      current
                        ? "bg-primary font-bold text-primary-foreground [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                        : "font-medium text-muted-foreground",
                    )}
                  >
                    {monthAbbr(cell.month)}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            {summary.months.map((cell) => {
              const selected = cell.month === selectedMonth;
              const label = monthCellLabel(cell, {
                current: cell.month === currentMonth,
                selected,
              });
              const pct = barPercent(cell.amount, summary.max);
              const body = (
                <>
                  {/* La pista es de alto fijo: por eso los doce importes quedan
                      a la misma altura y se leen como una columna. */}
                  <span aria-hidden="true" className="flex h-14 items-start justify-center px-1.5">
                    {cell.count === 0 ? (
                      // El mes vacío no es un cero chiquito: es un hueco, y se
                      // dibuja como tal. Punteado, que imprime.
                      <span className="w-full border-t-2 border-dotted border-border" />
                    ) : (
                      <span
                        className="w-full rounded-b-sm bg-primary [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                        style={{ height: `${pct}%` }}
                      />
                    )}
                  </span>
                  {/* `whitespace-nowrap`: `formatARS` mete un espacio después
                      del "$", y sin esto un mes grande parte la cifra en dos
                      renglones y la fila de importes deja de estar alineada —
                      que es justamente lo que se lee de la cinta. La tabla es
                      de ancho automático: se estira para que entren y, si no
                      entran, scrollea. */}
                  <span
                    className={cn(
                      "block whitespace-nowrap px-1 pb-1.5 text-center font-mono text-[11px] tabular-nums",
                      cell.count === 0 ? "text-muted-foreground" : "font-medium",
                      selected && "font-semibold",
                    )}
                  >
                    {cell.count === 0 ? "—" : formatARS(cell.amount)}
                  </span>
                  <span className="sr-only">{label}</span>
                </>
              );
              return (
                <td key={cell.month} className="p-0 align-top">
                  {cell.count === 0 ? (
                    <span className="block pt-1">{body}</span>
                  ) : (
                    <Link
                      href={selected ? yearHref : monthHref(cell.month)}
                      aria-current={selected ? "page" : undefined}
                      className={cn(
                        "block rounded-b-md pt-1 outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                        selected ? "bg-muted ring-1 ring-primary" : "hover:bg-muted",
                      )}
                    >
                      {body}
                    </Link>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
