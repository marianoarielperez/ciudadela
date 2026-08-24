// El cuerpo de la hoja imprimible, separado de la página para poder renderizarlo
// en un test sin Prisma ni sesión (mismo recurso que `ExerciseStrip`).
//
// Qué lleva la hoja y por qué, que es la decisión de fondo (Ley 25.326, docs/08):
// número y nombre para identificar al vecino en el Libro; categoría, que dice de
// un vistazo si es activo o adherente —cambia cómo se le habla y si es
// cesanteable (REG-15)—; domicilio y teléfono, que son los dos canales —el
// domicilio entró por enmienda del operador del 24/08/2026: la visita es el
// único canal que le queda al que no tiene ni teléfono ni casilla—; cuántas
// cuotas debe y cuánto, que es lo que se dice en la llamada; la fecha del último
// pago, que distingue al socio que se atrasó del que nunca pagó; y una columna
// en blanco para anotar a mano cómo salió.
//
// NO lleva DNI ni email: el DNI no hace falta para llamar ni para tocar un
// timbre y es el dato más sensible del padrón, y la casilla no existe o rebota
// en todas estas filas por definición.
//
// La categoría se sacó una vez —era deducible de los otros dos números, porque
// `debtAmount` es lineal y deuda ÷ cuotas da el valor de la categoría— y el
// operador la repuso el 24/08/2026: nadie divide en una reunión, y el dato
// decide el tono de la llamada. El ancho salió de la columna de gestión, no del
// nombre ni del domicilio: un nombre partido en dos renglones cuesta más que un
// renglón de anotación más corto.
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import type { DebtorRow } from "@/lib/treasury/debtors";

export type SheetFeeValue = { validFrom: Date } | null;

// A4 apaisado (decisión del operador, spec §5): en vertical, nueve columnas
// aprietan el nombre y el domicilio hasta volverlos ilegibles. La regla vive
// acá y no en `globals.css` porque `@page` no se puede acotar por ruta: en la
// hoja de estilos global daría vuelta el papel de TODO el panel.
const PAGE_CSS = "@page { size: A4 landscape; margin: 12mm 10mm; }";

// Los anchos se fijan a mano y no se dejan al azar: con `table-fixed` el
// navegador reparte exactamente esto, y sobre los 277 mm útiles de un A4
// apaisado con márgenes de 10 mm dan los milímetros de la tabla del reporte. El
// nombre y la columna de gestión —la que se escribe a mano— se quedan con más
// de un 40% de la hoja entre las dos.
//
// Las columnas mono (teléfono, deuda, fecha) son las que no pueden fallar:
// vienen con `whitespace-nowrap` de `TableCell`, así que con `table-fixed` un
// texto más ancho que su celda no envuelve — se derrama sobre la vecina. Están
// dimensionadas contra el peor caso real del padrón: "$ 138.000,00" (el socio
// con 23 cuotas impagas) mide ~23 mm a 9 pt, y su columna deja 28,5 mm netos.
//
// El 6% de categoría salió del 22% que tenía gestión (enmienda del operador):
// son 16,6 mm, 14,5 mm netos, y "Adherente" mide ~14,9 mm a 9 pt. Por eso la
// celda envuelve en vez de recortarse: la etiqueta larga se parte en dos
// renglones y no se derrama. Partirla no cuesta nada — la fila ya mide
// `print:h-12` por el renglón que se escribe a mano, no por su texto.
const W = {
  number: "w-[5%]",
  name: "w-[19%]",
  category: "w-[6%]",
  address: "w-[17%]",
  phone: "w-[10%]",
  fees: "w-[6%]",
  debt: "w-[11%]",
  lastPaid: "w-[10%]",
  notes: "w-[16%]",
} as const;

export function ManualCollectionSheet({ rows, feeValue, printedAt }: {
  rows: DebtorRow[];
  feeValue: SheetFeeValue;
  printedAt: Date;
}) {
  const total = rows.reduce((acc, r) => acc + (r.debt ?? 0), 0);
  // El que no tiene ni teléfono ni domicilio es el único que queda sin ningún
  // canal: al que tiene domicilio se lo visita, y para eso está la columna.
  const unreachable = rows.filter((r) => r.phone === null && r.address === null).length;

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
        {` · datos al ${formatDateAR(printedAt)}`}. La última columna queda en blanco para anotar a
        mano cómo salió la gestión.
      </p>

      {/* El contenedor de `Table` scrollea en pantalla; en papel no hay scroll,
          así que lo que sobresale se recorta. En la hoja se muestra entero. */}
      <div className="print:[&_[data-slot=table-container]]:overflow-visible">
        {/* En papel el relleno horizontal baja de 8 px a 4 px por lado: son
            38 mm repartidos entre nueve columnas, y esos 38 mm son la diferencia
            entre que la deuda entre en su celda o se derrame sobre la vecina. */}
        <Table className="table-fixed print:text-[9pt] print:[&_td]:px-1 print:[&_th]:px-1">
          <TableHeader>
            {/* Los encabezados envuelven: `TableHead` viene con `whitespace-nowrap`
                y "Último pago" no entra en su 10% sin partirse en dos líneas. */}
            <TableRow className="[&_th]:whitespace-normal [&_th]:align-bottom">
              <TableHead className={W.number}>N°</TableHead>
              <TableHead className={W.name}>Socio</TableHead>
              {/* Va pegada al nombre y no junto a la deuda: es identidad del
                  socio, no plata. */}
              <TableHead className={W.category}>Categoría</TableHead>
              <TableHead className={W.address}>Domicilio</TableHead>
              <TableHead className={W.phone}>Teléfono</TableHead>
              <TableHead className={`${W.fees} text-right`}>Cuotas</TableHead>
              <TableHead className={`${W.debt} text-right`}>Deuda</TableHead>
              <TableHead className={W.lastPaid}>Último pago</TableHead>
              {/* La línea vertical separa lo que el sistema sabe de lo que se
                  escribe encima: de un vistazo se ve dónde empieza el trabajo. */}
              <TableHead className={`${W.notes} border-l`}>Gestión</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              // Una fila partida entre dos hojas deja el teléfono separado del
              // nombre: quien llama marcaría el número del vecino de arriba.
              // `print:h-12` es el renglón para escribir a mano: en una tabla,
              // `height` funciona como mínimo y la fila crece si el texto pide más.
              <TableRow key={r.memberId} className="break-inside-avoid [&_td]:align-top print:h-12">
                <TableCell className={`${W.number} font-mono tabular-nums`}>{r.memberNumber ?? "—"}</TableCell>
                {/* El nombre y el domicilio envuelven en vez de recortarse: con
                    `table-fixed`, `whitespace-nowrap` deja "Fernández Ordóñez,
                    María" cortada a la mitad de la celda. */}
                <TableCell className={`${W.name} whitespace-normal`}>{r.fullName}</TableCell>
                {/* La etiqueta sale de `CATEGORY_LABELS`, que es lo que nombra
                    el Libro en papel: la hoja y la ficha no pueden llamar
                    distinto a la misma categoría. */}
                <TableCell className={`${W.category} whitespace-normal`}>{CATEGORY_LABELS[r.category]}</TableCell>
                {/* Sin domicilio ni teléfono queda un guión y no una celda
                    vacía: en papel, una celda vacía se lee como un error de
                    impresión. */}
                <TableCell className={`${W.address} whitespace-normal`}>{r.address ?? "—"}</TableCell>
                <TableCell className={`${W.phone} font-mono tabular-nums`}>{r.phone ?? "—"}</TableCell>
                <TableCell className={`${W.fees} text-right font-mono tabular-nums`}>{r.pendingCount}</TableCell>
                <TableCell className={`${W.debt} text-right font-mono tabular-nums`}>
                  {r.debt !== null ? formatARS(r.debt) : "—"}
                </TableCell>
                <TableCell className={`${W.lastPaid} font-mono tabular-nums`}>
                  {r.lastPaidAt ? formatDateAR(r.lastPaidAt) : "—"}
                </TableCell>
                {/* En blanco a propósito: es el renglón donde se escribe "llamé
                    12/9, paga el 20". La gestión NO se registra en el sistema
                    (decisión del operador, dos veces). */}
                <TableCell className={`${W.notes} border-l`} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* El socio sin ningún canal NO desaparece de la hoja: es el que hay que
          ir a buscar por la cartelera, y la hoja tiene que decir que existe en
          vez de dejarlo afuera en silencio. */}
      {unreachable > 0 && (
        <p className="text-sm text-muted-foreground">
          {unreachable === 1
            ? "Un socio de la lista no tiene teléfono ni domicilio cargado: a ese sólo se lo puede buscar por la cartelera."
            : `${unreachable} socios de la lista no tienen teléfono ni domicilio cargado: a esos sólo se los puede buscar por la cartelera.`}
        </p>
      )}

      {/* Último hijo a propósito: un `<style>` cuenta para el selector `* + *`
          de `space-y-3`, y puesto primero correría todo lo demás un renglón
          hacia abajo. Acá no empuja nada — no se pinta. */}
      <style>{PAGE_CSS}</style>
    </div>
  );
}
