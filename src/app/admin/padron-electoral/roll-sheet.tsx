// El cuerpo del padrón electoral, separado de la página para poder renderizarlo
// en un test sin Prisma ni sesión (mismo recurso que `ManualCollectionSheet`).
//
// Esta hoja SALE del sistema: se imprime y se la lleva la Junta Electoral, que
// es un cuerpo de vecinos y no la Comisión. Por eso las columnas son las de
// REG-31 y ni una más —número, nombre, categoría— con la fecha de ingreso, que
// es la prueba de los 90 días y lo único que contesta el "¿y éste por qué está?"
// que se pregunta en voz alta en la mesa. **Sin DNI**: es el dato más sensible
// del padrón y no hace falta para tomar lista.
//
// Los dos bloques no son una lista filtrada en dos pedazos: son dos documentos
// distintos. "Habilitados" se lee de corrido en la mesa; "Con deuda a purgar" es
// una lista de cobro, y por eso es el único que lleva plata y el único que suma
// —lo que hay que recaudar en la puerta para que voten todos—.
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatARS, formatDateAR, formatDateTimeAR } from "@/lib/format";
import type { ElectoralRoll, ElectoralRow } from "@/lib/members/electoral";
import { ELECTORAL_MIN_DAYS } from "@/lib/members/electoral";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import { periodLabel } from "@/lib/treasury/periods";

// A4 vertical: son cuatro columnas de texto corto y el nombre entra holgado. La
// regla vive acá y no en `globals.css` porque `@page` no se puede acotar por
// ruta (mismo motivo que la hoja de gestión manual, que sí va apaisada).
const PAGE_CSS = "@page { size: A4 portrait; margin: 14mm 12mm; }";

// Con `table-fixed` el navegador reparte exactamente esto. El nombre se queda
// con la mitad de la hoja: es lo único que se busca con el dedo en la mesa.
const W = {
  number: "w-[10%]",
  name: "w-[46%]",
  category: "w-[18%]",
  joined: "w-[16%]",
  fees: "w-[10%]",
  amount: "w-[16%]",
} as const;

function RollBlock({ title, note, rows, showDebt, empty, totals }: {
  title: string;
  note: string;
  rows: ElectoralRow[];
  showDebt: boolean;
  empty: string;
  totals?: { fees: number; amount: number; valued: boolean };
}) {
  return (
    // `break-inside-avoid-page` sólo en el encabezado: un bloque de 160 filas no
    // entra en una hoja y forzarlo dejaría la primera en blanco.
    <section className="space-y-2">
      <div className="space-y-1 break-after-avoid-page">
        <h2 className="text-sm font-semibold tracking-widest uppercase">
          {title} <span className="font-mono tabular-nums">({rows.length})</span>
        </h2>
        <p className="max-w-prose text-xs text-muted-foreground">{note}</p>
      </div>

      {rows.length === 0 ? (
        // Nunca un thead sin filas.
        <EmptyState size="card" description={empty} />
      ) : (
        <div className="print:[&_[data-slot=table-container]]:overflow-visible">
          <Table className="table-fixed print:text-[9pt] print:[&_td]:px-1 print:[&_th]:px-1">
            <TableHeader>
              <TableRow className="[&_th]:whitespace-normal [&_th]:align-bottom">
                <TableHead className={W.number}>N°</TableHead>
                <TableHead className={W.name}>Socio</TableHead>
                <TableHead className={W.category}>Categoría</TableHead>
                <TableHead className={W.joined}>Ingreso</TableHead>
                {showDebt && <TableHead className={`${W.fees} text-right`}>Cuotas</TableHead>}
                {showDebt && <TableHead className={`${W.amount} text-right`}>A purgar</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                // Una fila partida entre dos hojas deja el nombre de un vecino
                // separado de su número.
                <TableRow key={r.memberId} className="break-inside-avoid [&_td]:align-top">
                  <TableCell className={`${W.number} font-mono tabular-nums`}>
                    {r.memberNumber ?? "—"}
                  </TableCell>
                  <TableCell className={`${W.name} whitespace-normal`}>{r.fullName}</TableCell>
                  <TableCell className={`${W.category} whitespace-normal`}>
                    {CATEGORY_LABELS[r.category]}
                  </TableCell>
                  <TableCell className={`${W.joined} font-mono tabular-nums`}>
                    {formatDateAR(r.joinedAt)}
                  </TableCell>
                  {showDebt && (
                    <TableCell className={`${W.fees} text-right font-mono tabular-nums`}>
                      {r.arrears}
                    </TableCell>
                  )}
                  {showDebt && (
                    <TableCell className={`${W.amount} text-right font-mono tabular-nums`}>
                      {r.debt === null ? "—" : formatARS(r.debt)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
            {/* El total es lo que hay que recaudar en la puerta para que voten
                todos: es el número que la Junta lleva a la mesa de cobro. */}
            {totals && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4}>Total a purgar</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{totals.fees}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {totals.valued ? formatARS(totals.amount) : "—"}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}
    </section>
  );
}

export function ElectoralRollSheet({ roll, valued, pastDate, generatedAt }: {
  roll: ElectoralRoll;
  /** Si había un valor de cuota vigente al generar. Sin él la deuda en pesos no
   *  se puede calcular y la hoja lo dice, en vez de imprimir un cero. */
  valued: boolean;
  /** Si la fecha pedida ya pasó. La hoja mezcla entonces dos relojes y tiene que
   *  decirlo EN PAPEL: ver el aviso de abajo. */
  pastDate: boolean;
  generatedAt: Date;
}) {
  return (
    <div className="space-y-6">
      {/* La cabecera del documento, y sólo en papel: en pantalla estos datos ya
          están en el encabezado y en el formulario. Una hoja impresa el martes y
          usada el domingo tiene que decir de cuándo son sus números — el padrón
          se regenera y la versión de la mañana de la elección es otra. */}
      <div className="hidden print:block print:space-y-1">
        <h2 className="text-base font-semibold">
          Padrón electoral — elección del {formatDateAR(roll.at)}
        </h2>
        <p className="text-[9pt]">
          {roll.enabled.length} habilitados · {roll.toPurge.length} con deuda a purgar ·
          generado el {formatDateTimeAR(generatedAt)}
        </p>
        {/* El orden se dice EN PAPEL: el que toma lista busca por apellido y
            tiene que saber que la hoja lo acompaña. El socio sin número va
            primero, fuera del orden, y eso también hay que avisarlo o se lee
            como un error de la hoja. */}
        <p className="text-[9pt]">
          Ambos bloques en orden alfabético por apellido. El socio sin número de socio asentado
          figura primero, antes del orden.
        </p>
      </div>

      {/* Se imprime a propósito (no lleva `print:hidden`): el que lee el papel
          meses después es quien más necesita saberlo. */}
      {pastDate && (
        <FormMessage kind="warning" box>
          Esta fecha ya pasó y la hoja mezcla dos relojes: la <strong>antigüedad</strong> se mide al{" "}
          {formatDateAR(roll.at)}, pero la <strong>mora</strong> y la{" "}
          <strong>condición de socio</strong> se leen como están al generarla (
          {formatDateTimeAR(generatedAt)}). El que pagó después de la elección figura acá como
          habilitado, y el que se dio de baja después no figura en ningún bloque. No es el padrón de
          aquel día: no sirve para resolver una impugnación.
        </FormMessage>
      )}

      {!valued && (
        <FormMessage kind="warning" box>
          No hay un valor de cuota vigente: la deuda en pesos no se puede calcular. Registralo en
          Tesorería → Valores y volvé a generar el padrón.
        </FormMessage>
      )}

      <FormMessage kind="neutral" box role="none">
        El socio con deuda <strong>no está excluido</strong>: puede saldarla hasta una hora antes del
        acto y votar. Por eso figura acá, con lo que tiene que pagar en la mesa. Volvé a generar el
        padrón después del cierre de caja para tener la lista definitiva.
      </FormMessage>

      <RollBlock
        title="Habilitados"
        note={`Votan sin trámite previo: no registran mora exigible y reúnen ${ELECTORAL_MIN_DAYS} días de antigüedad — salvo honorarios y vitalicios, a quienes el estatuto exime de ese piso (REG-30).`}
        rows={roll.enabled}
        showDebt={false}
        empty="Ningún socio queda habilitado a esta fecha."
      />

      <RollBlock
        title="Con deuda a purgar"
        note="Activos y colaboradores con cuotas impagas anteriores al mes de la elección. Votan si pagan lo que figura acá, hasta una hora antes del acto."
        rows={roll.toPurge}
        showDebt
        empty="Ningún socio del padrón registra mora: no hay nada que purgar."
        totals={{ fees: roll.purgeFees, amount: roll.purgeAmount, valued }}
      />

      <p className="text-xs text-muted-foreground">
        La deuda se valúa al valor de cuota vigente y se cuenta sobre los períodos anteriores a{" "}
        {periodLabel(roll.period)}: la cuota del mes en curso todavía no es mora.
      </p>

      {/* Último hijo a propósito: un `<style>` cuenta para el selector `* + *`
          de `space-y-6` y puesto primero correría todo un renglón hacia abajo. */}
      <style>{PAGE_CSS}</style>
    </div>
  );
}
