// La cinta de períodos (spec §6.3): una fila por año, 12 celdas. Tabla
// semántica —imprime y se lee con lector de pantalla—, no un canvas.
import Link from "next/link";
import type { GridCell, GridRow } from "@/lib/treasury/account";
import { monthName, periodLabel } from "@/lib/treasury/periods";
import { cn } from "@/lib/utils";

const MONTHS = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const STATE_LABEL: Record<GridCell["state"], string> = {
  paid: "pagada", pending: "pendiente", pending_import: "pendiente (deuda importada)",
  exempt: "exenta", voided: "anulada", none: "sin cuota",
};

// La pendiente importada del Libro 1 lleva rayado además del tono más suave: el
// tesorero tiene que poder distinguir de un vistazo lo que devengó el sistema de
// lo que se cargó del papel, y el color solo no alcanza (ni en impresión gris ni
// para alguien que no distingue esos dos tonos).
const STATE_CLASS: Record<GridCell["state"], string> = {
  paid: "bg-success text-white",
  pending: "bg-warning text-white",
  pending_import: "bg-warning/70 text-white [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgb(255_255_255/.35)_3px,rgb(255_255_255/.35)_5px)]",
  exempt: "bg-muted text-muted-foreground",
  voided: "bg-muted text-muted-foreground line-through",
  // Sin cuota (antes del ingreso o todavía por devengar): contorno punteado, no
  // relleno. No es una cuota impaga, y no puede parecerlo.
  none: "border border-dashed border-border text-transparent",
};

export function periodCellLabel(cell: GridCell): string {
  const base = `${periodLabel(cell.period)}: ${STATE_LABEL[cell.state]}`;
  return cell.receiptNumber ? `${base}, recibo ${cell.receiptNumber}` : base;
}

export function PeriodStrip({ rows, receiptHref }: {
  rows: GridRow[];
  /** Link al recibo de una celda pagada, o null si esta vista no los ofrece. */
  receiptHref?: (receiptNumber: string) => string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-xs">
        <caption className="sr-only">Cuotas por mes y año</caption>
        <thead>
          <tr>
            <th scope="col" className="sr-only">Año</th>
            {MONTHS.map((m, i) => (
              // La inicial se lee sola ("M" es marzo y mayo): el nombre completo
              // va en el aria-label para el lector de pantalla.
              <th key={m + i} scope="col" className="w-8 font-normal text-muted-foreground" aria-label={monthName(i + 1)}>
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <th scope="row" className="pr-2 text-right font-mono font-normal tabular-nums text-muted-foreground">{row.year}</th>
              {row.cells.map((cell) => {
                const href = cell.receiptNumber && receiptHref ? receiptHref(cell.receiptNumber) : null;
                const box = (
                  <span
                    title={periodCellLabel(cell)}
                    className={cn("flex size-8 items-center justify-center rounded-sm sm:size-7", STATE_CLASS[cell.state])}
                  >
                    <span className="sr-only">{periodCellLabel(cell)}</span>
                  </span>
                );
                return (
                  <td key={cell.period} className="p-0">
                    {href ? <Link href={href} className="block rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{box}</Link> : box}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Referencias">
        <li><span className="mr-1 inline-block size-3 rounded-sm bg-success align-middle" /> pagada</li>
        <li><span className="mr-1 inline-block size-3 rounded-sm bg-warning align-middle" /> pendiente</li>
        <li>
          <span className="mr-1 inline-block size-3 rounded-sm bg-warning/70 align-middle [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgb(255_255_255/.35)_3px,rgb(255_255_255/.35)_5px)]" />
          {" "}pendiente importada del Libro 1
        </li>
        <li><span className="mr-1 inline-block size-3 rounded-sm border border-dashed align-middle" /> sin cuota</li>
      </ul>
    </div>
  );
}
