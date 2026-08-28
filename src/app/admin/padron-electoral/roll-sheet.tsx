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
// Los tres bloques no son una lista filtrada en pedazos: son documentos
// distintos. "Habilitados" se lee de corrido en la mesa; "Con deuda a purgar"
// es una lista de cobro, el único que lleva plata y el único que suma; y "No
// habilitados por antigüedad" (decisión del operador del 27/08/2026) contesta
// el "¿por qué no estoy?" del vecino nuevo — con la fecha desde la que va a
// poder votar, que no envejece ni depende de la elección.
//
// En PANTALLA cada bloque va en una Card y en móvil las filas apilan como
// tarjetas (patrón de /admin/socios). El PAPEL sigue siendo tabla plana:
// `hidden md:block print:block` muestra la tabla, `md:hidden print:hidden`
// esconde las tarjetas — sin esos `print:*`, imprimir desde un celular sacaría
// la versión de tarjetas.
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatARS, formatDateAR, formatDateTimeAR } from "@/lib/format";
import type { ElectoralRoll, ElectoralRow } from "@/lib/members/electoral";
import { ELECTORAL_MIN_DAYS, enabledFrom } from "@/lib/members/electoral";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import { periodLabel } from "@/lib/treasury/periods";

// A4 vertical. La regla vive acá y no en `globals.css` porque `@page` no se
// puede acotar por ruta (mismo motivo que la hoja de gestión manual).
const PAGE_CSS = "@page { size: A4 portrait; margin: 14mm 12mm; }";

// Con `table-fixed` el navegador reparte exactamente esto. El nombre se queda
// con la mayor parte de la hoja: es lo único que se busca con el dedo en la
// mesa. (La suma por bloque no da 100 justo; table-fixed normaliza.)
const W = {
  number: "w-[10%]",
  name: "w-[46%]",
  category: "w-[18%]",
  joined: "w-[16%]",
  fees: "w-[10%]",
  amount: "w-[16%]",
  from: "w-[16%]",
} as const;

/** La fila del bloque en móvil (patrón MemberCard de /admin/socios): tarjeta
 *  compacta, nombre + número arriba y los metadatos como fila envolvente. */
function RowCard({ r, showDebt, showEnabledFrom }: {
  r: ElectoralRow;
  showDebt?: boolean;
  showEnabledFrom?: boolean;
}) {
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-medium">{r.fullName}</span>
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            N° {r.memberNumber ?? "—"}
          </span>
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{CATEGORY_LABELS[r.category]}</span>
          <span>Ingreso {formatDateAR(r.joinedAt)}</span>
          {showEnabledFrom && <span>Vota desde el {formatDateAR(enabledFrom(r.joinedAt))}</span>}
          {showDebt && (
            <span className="font-mono tabular-nums text-foreground">
              {r.arrears} {r.arrears === 1 ? "cuota" : "cuotas"}
              {r.debt !== null && ` · ${formatARS(r.debt)}`}
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function RollBlock({ id, title, note, rows, showDebt, showEnabledFrom, empty, totals }: {
  id: string;
  title: string;
  note: string;
  rows: ElectoralRow[];
  showDebt?: boolean;
  showEnabledFrom?: boolean;
  empty: string;
  totals?: { fees: number; amount: number; valued: boolean };
}) {
  return (
    // `scroll-mt-4`: las stat cards de la página enlazan a estas anclas.
    // `break-after-avoid-page` sólo en el encabezado: un bloque de 160 filas no
    // entra en una hoja y forzarlo dejaría la primera en blanco.
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 space-y-2">
      <div className="space-y-1 break-after-avoid-page">
        <h2 id={`${id}-title`} className="text-sm font-semibold tracking-widest uppercase">
          {title} <span className="font-mono tabular-nums">({rows.length})</span>
        </h2>
        <p className="max-w-prose text-xs text-muted-foreground">{note}</p>
      </div>

      {rows.length === 0 ? (
        // Nunca un thead sin filas.
        <EmptyState size="card" description={empty} />
      ) : (
        <>
          {/* La tabla: desktop y PAPEL. La Card se desviste al imprimir. */}
          <div className="hidden md:block print:block">
            <Card className="print:rounded-none print:bg-transparent print:py-0 print:ring-0">
              <CardContent className="print:px-0 print:[&_[data-slot=table-container]]:overflow-visible">
                <Table className="table-fixed print:text-[9pt] print:[&_td]:px-1 print:[&_th]:px-1">
                  <TableHeader>
                    <TableRow className="[&_th]:whitespace-normal [&_th]:align-bottom">
                      <TableHead className={W.number}>N°</TableHead>
                      <TableHead className={W.name}>Socio</TableHead>
                      <TableHead className={W.category}>Categoría</TableHead>
                      <TableHead className={W.joined}>Ingreso</TableHead>
                      {showDebt && <TableHead className={`${W.fees} text-right`}>Cuotas</TableHead>}
                      {showDebt && <TableHead className={`${W.amount} text-right`}>A purgar</TableHead>}
                      {showEnabledFrom && (
                        <TableHead className={W.from}>Habilitado desde</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      // Una fila partida entre dos hojas deja el nombre de un
                      // vecino separado de su número.
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
                        {showEnabledFrom && (
                          <TableCell className={`${W.from} font-mono tabular-nums`}>
                            {formatDateAR(enabledFrom(r.joinedAt))}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                  {/* El total es lo que hay que recaudar en la puerta para que
                      voten todos: el número que la Junta lleva a la mesa. */}
                  {totals && (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4}>Total a purgar</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {totals.fees}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {totals.valued ? formatARS(totals.amount) : "—"}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Las tarjetas: sólo móvil, nunca papel. */}
          <div className="space-y-3 md:hidden print:hidden">
            {rows.map((r) => (
              <RowCard key={r.memberId} r={r} showDebt={showDebt} showEnabledFrom={showEnabledFrom} />
            ))}
          </div>
        </>
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
  // El socio sin número puede caer en cualquiera de los tres bloques.
  const hasUnnumbered = [...roll.enabled, ...roll.toPurge, ...roll.withoutSeniority].some(
    (r) => r.memberNumber === null,
  );
  return (
    <div className="space-y-6">
      {/* La cabecera del documento, y sólo en papel: en pantalla estos datos ya
          están en la tira de la cuenta y en la Card generadora. Una hoja
          impresa el martes y usada el domingo tiene que decir de cuándo son sus
          números — el padrón se regenera y la versión de la mañana de la
          elección es otra. */}
      <div className="hidden print:block print:space-y-1">
        <h2 className="text-base font-semibold">
          Padrón electoral — elección del {formatDateAR(roll.at)}
        </h2>
        <p className="text-[9pt]">
          {roll.enabled.length} habilitados · {roll.toPurge.length} con deuda a purgar ·{" "}
          {roll.withoutSeniority.length} no habilitados por antigüedad · generado el{" "}
          {formatDateTimeAR(generatedAt)}
        </p>
        {/* El orden se dice EN PAPEL: el que toma lista busca por apellido. El
            socio sin número va primero, fuera del orden, y eso también hay que
            avisarlo o se lee como un error de la hoja — pero SÓLO si hay
            alguno: anunciar una fila que no está manda a la Junta a buscarla
            por toda la hoja. */}
        <p className="text-[9pt]">
          Todos los bloques en orden alfabético por apellido.
          {hasUnnumbered && " El socio sin número de socio asentado figura primero, antes del orden."}
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
          habilitado, y el que se dio de baja después no figura en ningún bloque — tampoco en el de
          no habilitados por antigüedad. No es el padrón de aquel día: no sirve para resolver una
          impugnación.
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
        id="habilitados"
        title="Habilitados"
        note={`Votan sin trámite previo: no registran mora exigible y reúnen ${ELECTORAL_MIN_DAYS} días de antigüedad — salvo honorarios y vitalicios, a quienes el estatuto exime de ese piso (REG-30).`}
        rows={roll.enabled}
        empty="Ningún socio queda habilitado a esta fecha."
      />

      <RollBlock
        id="a-purgar"
        title="Con deuda a purgar"
        note="Activos y colaboradores con cuotas impagas anteriores al mes de la elección. Votan si pagan lo que figura acá, hasta una hora antes del acto."
        rows={roll.toPurge}
        showDebt
        empty="Ningún socio del padrón registra mora: no hay nada que purgar."
        totals={{ fees: roll.purgeFees, amount: roll.purgeAmount, valued }}
      />

      <RollBlock
        id="no-habilitados"
        title="No habilitados por antigüedad"
        note={`No alcanzan los ${ELECTORAL_MIN_DAYS} días de antigüedad a la fecha de la elección (REG-30). No votan en este acto, y no hay trámite que lo modifique: la antigüedad se cumple con el tiempo.`}
        rows={roll.withoutSeniority}
        showEnabledFrom
        empty={`Todos los socios considerados alcanzan los ${ELECTORAL_MIN_DAYS} días de antigüedad.`}
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
