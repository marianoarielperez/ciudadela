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

// El color NO puede ser el único canal. El navegador imprime por defecto SIN
// fondos ("imprimir gráficos de fondo" viene apagado), así que una celda que
// solo era un rectángulo de color salía en blanco: la hoja decía exactamente lo
// contrario de la verdad —pagadas, pendientes y anuladas idénticas, y las
// únicas visibles eran las "sin cuota" del contorno punteado—. Cada estado lleva
// ahora un glifo visible; el color queda como segundo canal.
const STATE_GLYPH: Record<GridCell["state"], string> = {
  paid: "✓",
  pending: "•",
  pending_import: "L", // Libro 1: la deuda que se cargó del papel, no la que devengó el sistema
  exempt: "E", // exenta
  voided: "A", // anulada
  none: "",
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
  none: "border border-dashed border-border",
};

// `print-color-adjust: exact` para el que SÍ prende los fondos: sin esto el
// navegador puede seguir descartando el relleno al imprimir. No reemplaza al
// glifo, lo acompaña.
// Sin clase de display: la pone cada uso (`flex` en la celda, `inline-flex`
// en la referencia). Dos utilidades de display en el mismo string las resuelve
// el orden de la hoja generada, no el del atributo.
const SWATCH = "items-center justify-center rounded-sm font-semibold leading-none [-webkit-print-color-adjust:exact] [print-color-adjust:exact]";

const LEGEND: Array<[GridCell["state"], string]> = [
  ["paid", "pagada"],
  ["pending", "pendiente"],
  ["pending_import", "pendiente importada del Libro 1"],
  ["exempt", "exenta"],
  ["voided", "anulada"],
  ["none", "sin cuota"],
];

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
            {/* La celda del año se queda; lo que se esconde es su CONTENIDO. Un
                `sr-only` sobre el `<th>` lo posiciona absoluto, y una celda de
                tabla posicionada sale del flujo: la fila de encabezados quedaba
                con 12 celdas contra las 13 de cada fila del cuerpo, así que
                "E" caía sobre la columna del año, "F" sobre enero, y la
                asociación columna/celda del árbol de accesibilidad se corría
                igual. Mismo patrón que las columnas de acciones del panel. */}
            <th scope="col"><span className="sr-only">Año</span></th>
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
                  // Sin `title`: el mismo texto en `title` y en el `sr-only` hacía
                  // que varios lectores de pantalla lo anunciaran dos veces (uno
                  // como nombre y otro como descripción). Queda el `sr-only`, que
                  // es el que sí llega siempre y también al teclado.
                  <span className={cn(SWATCH, "flex size-8 sm:size-7", STATE_CLASS[cell.state])}>
                    <span aria-hidden="true">{STATE_GLYPH[cell.state]}</span>
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
        {LEGEND.map(([state, label]) => (
          <li key={state} className="flex items-center gap-1">
            <span aria-hidden="true" className={cn(SWATCH, "inline-flex size-4 text-[10px]", STATE_CLASS[state])}>
              {STATE_GLYPH[state]}
            </span>
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
