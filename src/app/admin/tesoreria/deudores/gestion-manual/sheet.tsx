// El cuerpo de la hoja imprimible, separado de la página para poder renderizarlo
// en un test sin Prisma ni sesión (mismo recurso que `ExerciseStrip`).
//
// Qué lleva la hoja y por qué, que es la decisión de fondo (Ley 25.326, docs/08):
// número y nombre para identificar al vecino en el Libro, categoría y cantidad de
// cuotas para poder explicar el monto, la deuda para poder decirla, el teléfono
// —que es el canal, y la razón de ser de la hoja— y la fecha del último pago, que
// distingue al socio que se atrasó del que nunca pagó. NO lleva DNI ni email: el
// DNI no hace falta para llamar y es el dato más sensible del padrón, y la casilla
// no existe o rebota en todas estas filas por definición.
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import type { DebtorRow } from "@/lib/treasury/debtors";

export type SheetFeeValue = { validFrom: Date } | null;

export function ManualCollectionSheet({ rows, feeValue, printedAt }: {
  rows: DebtorRow[];
  feeValue: SheetFeeValue;
  printedAt: Date;
}) {
  const total = rows.reduce((acc, r) => acc + (r.debt ?? 0), 0);

  if (rows.length === 0) {
    return (
      <EmptyState description="Todos los socios con deuda tienen una casilla de correo utilizable: el recordatorio les llega solo." />
    );
  }

  return (
    <div className="space-y-3">
      {!feeValue && (
        <FormMessage kind="warning" box>
          No hay un valor de cuota vigente: la deuda en pesos no se puede calcular. Registralo en
          Tesorería → Valores.
        </FormMessage>
      )}

      {/* La hoja se guarda en una carpeta y se vuelve a mirar semanas después:
          sin la fecha de impresión, una deuda de agosto se lee como la de hoy.
          El devengo suma una cuota por mes a cada fila de esta lista. */}
      <p className="text-sm text-muted-foreground">
        {`${rows.length} ${rows.length === 1 ? "socio" : "socios"} para contactar`}
        {feeValue && ` · ${formatARS(total)} en total`}
        {` · datos al ${formatDateAR(printedAt)}`}.
      </p>

      {/* El contenedor de `Table` scrollea en pantalla; en papel no hay scroll,
          así que lo que sobresale se recorta. En la hoja se muestra entero. */}
      <div className="print:[&_[data-slot=table-container]]:overflow-visible">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N°</TableHead>
              <TableHead>Socio</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead className="text-right">Cuotas</TableHead>
              <TableHead className="text-right">Deuda</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Último pago</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              // Una fila partida entre dos hojas deja el teléfono separado del
              // nombre: quien llama marcaría el número del vecino de arriba.
              <TableRow key={r.memberId} className="break-inside-avoid">
                <TableCell className="font-mono tabular-nums">{r.memberNumber ?? "—"}</TableCell>
                <TableCell>{r.fullName}</TableCell>
                <TableCell>{CATEGORY_LABELS[r.category]}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{r.pendingCount}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.debt !== null ? formatARS(r.debt) : "—"}
                </TableCell>
                {/* Sin teléfono queda un guión y no una celda vacía: en papel,
                    una celda vacía se lee como un error de impresión. */}
                <TableCell className="font-mono tabular-nums">{r.phone ?? "—"}</TableCell>
                <TableCell>{r.lastPaidAt ? formatDateAR(r.lastPaidAt) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* El socio sin teléfono NO desaparece de la hoja: es el que hay que ir a
          buscar por la cartelera o una visita, y la hoja tiene que decir que
          existe en vez de dejarlo afuera en silencio. */}
      {rows.some((r) => r.phone === null) && (
        <p className="text-sm text-muted-foreground">
          {rows.filter((r) => r.phone === null).length === 1
            ? "Un socio de la lista no tiene teléfono cargado: a ese hay que ubicarlo por la cartelera o una visita."
            : `${rows.filter((r) => r.phone === null).length} socios de la lista no tienen teléfono cargado: a esos hay que ubicarlos por la cartelera o una visita.`}
        </p>
      )}
    </div>
  );
}
