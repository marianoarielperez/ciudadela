// Otros ingresos: la plata que entra a la vecinal y NO es de un socio —alquiler
// del salón, eventos, rifas, donaciones—. Hasta esta pantalla, ese dinero no
// tenía dónde registrarse: por Mercado Pago caía en la bandeja sin conciliar,
// donde la única salida era descartarlo (que declara que no se le imputa a
// nadie: falso, entró y es de la asociación), y en efectivo no quedaba en
// ningún lado.
//
// Es un REGISTRO y no contabilidad (docs/01): no emite recibo, no hay plan de
// cuentas y no hay egresos. Lo que la Comisión necesita saber es cuánto entró y
// a qué corresponde, y eso es exactamente lo que la pantalla contesta: arriba a
// la izquierda se carga, arriba a la derecha se lee el total del período, abajo
// está el detalle.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería. La guarda
// tampoco se hereda de él (Next renderiza layout y página en paralelo).
import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageHref, paginate, parsePage } from "@/lib/admin/pagination";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseCivilDate } from "@/lib/dates";
import { formatARS, formatDateAR } from "@/lib/format";
import { INCOME_METHOD_LABELS } from "@/lib/treasury/labels";
import {
  INCOME_PAGE_SIZE,
  otherIncome,
  type IncomeFilters,
} from "@/lib/treasury/other-income";
import { civilDayOf } from "@/lib/treasury/periods";
import { RegisterIncomeForm, VoidIncomeForm } from "./income-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Otros ingresos — SIGeV" };

const BASE = "/admin/tesoreria/otros-ingresos";

/** "AAAA-MM-DD" del día civil argentino: `civilDayOf` devuelve el mediodía UTC
 *  de ese día, así que el ISO recortado no puede correrse de fecha. */
function isoCivilDay(at: Date = new Date()): string {
  return civilDayOf(at).toISOString().slice(0, 10);
}

export default async function OtrosIngresosPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  // Filtros por GET plano: quedan en la URL y se pueden compartir o recargar.
  const desde = one(sp.desde)?.trim() ?? "";
  const hasta = one(sp.hasta)?.trim() ?? "";
  const medio = one(sp.medio);
  const q = one(sp.q)?.trim() ?? "";

  // Una fecha ilegible en la URL no se ignora en silencio: sin el aviso, el
  // operador leería un total que no es el del rango que creyó pedir.
  const from = desde ? parseCivilDate(desde, { minYear: 2015, invalidError: "x" }) : null;
  const to = hasta ? parseCivilDate(hasta, { minYear: 2015, invalidError: "x" }) : null;
  const badDates = (from && !from.ok) || (to && !to.ok);
  const fromDate = from?.ok ? from.value : null;
  const toDate = to?.ok ? to.value : null;

  const filters: IncomeFilters = {};
  if (fromDate) filters.from = fromDate;
  if (toDate) filters.to = toDate;
  if (medio === "cash" || medio === "mp") filters.method = medio;
  if (q) filters.q = q;
  const filtered = Object.keys(filters).length > 0;

  const page = parsePage(sp);
  const { rows, total, counted, sum, byMethod } = await otherIncome.list(filters, page);
  const pg = paginate(total, page, INCOME_PAGE_SIZE);
  const params = {
    desde: fromDate ? desde : undefined,
    hasta: toDate ? hasta : undefined,
    medio: filters.method,
    q: filters.q,
  };

  // El desglose por medio es lo único que la tabla no puede resumir, y es
  // justamente la distinción que esta pantalla vino a cubrir: la plata entra
  // por el mostrador o por Mercado Pago. Con un solo medio en juego, una barra
  // completa no diría nada: no se dibuja.
  const split = byMethod.cash > 0 && byMethod.mp > 0;
  const cashPct = split ? Math.round((byMethod.cash / sum) * 100) : 0;

  return (
    <div className="space-y-4">
      {one(sp.registrado) === "1" && (
        <FormMessage kind="success" box>Ingreso registrado.</FormMessage>
      )}
      {one(sp.anulado) === "1" && (
        <FormMessage kind="success" box>
          Ingreso anulado. Si venía de Mercado Pago, su fila volvió a Pendientes en{" "}
          <Link className="underline" href="/admin/tesoreria/sin-conciliar">Sin conciliar</Link>.
        </FormMessage>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Registrar un ingreso</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <RegisterIncomeForm today={isoCivilDay()} />
            <p className="text-sm text-muted-foreground">
              Esto es para la plata que <strong>no</strong> es de un socio. Si un socio paga su
              cuota o hace un aporte,{" "}
              <Link
                className="text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                href="/admin/tesoreria/efectivo"
              >
                cobrale en Efectivo
              </Link>{" "}
              para que salga con recibo.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{filtered ? "Total del período filtrado" : "Total registrado"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* El titular es la plata, con la misma tipografía monoespaciada con
                que el panel escribe todos los importes. */}
            <p className="font-mono text-3xl tabular-nums">{formatARS(sum)}</p>
            <p className="text-sm text-muted-foreground">
              {counted === 1 ? "1 ingreso" : `${counted} ingresos`}
              {total > counted && ` · ${total - counted} anulado${total - counted === 1 ? "" : "s"} que no suma${total - counted === 1 ? "" : "n"}`}
              {(fromDate || toDate) && (
                <>
                  {" · "}
                  {fromDate && toDate
                    ? `del ${formatDateAR(fromDate)} al ${formatDateAR(toDate)}`
                    : fromDate
                      ? `desde el ${formatDateAR(fromDate)}`
                      : `hasta el ${formatDateAR(toDate!)}`}
                </>
              )}
              .
            </p>
            {split && (
              <div className="space-y-2">
                {/* Las cifras están escritas abajo: la barra es sólo la
                    proporción, y por eso no la anuncia el lector de pantalla. */}
                <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="bg-primary" style={{ width: `${cashPct}%` }} />
                  <div className="bg-primary/40" style={{ width: `${100 - cashPct}%` }} />
                </div>
                <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                  <span>
                    <span aria-hidden className="mr-1 inline-block size-2 rounded-full bg-primary align-middle" />
                    {INCOME_METHOD_LABELS.cash} <span className="font-mono tabular-nums">{formatARS(byMethod.cash)}</span>
                  </span>
                  <span>
                    <span aria-hidden className="mr-1 inline-block size-2 rounded-full bg-primary/40 align-middle" />
                    {INCOME_METHOD_LABELS.mp} <span className="font-mono tabular-nums">{formatARS(byMethod.mp)}</span>
                  </span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <div className="space-y-1">
          <Label htmlFor="desde">Desde</Label>
          <Input id="desde" name="desde" type="date" defaultValue={desde} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hasta">Hasta</Label>
          <Input id="hasta" name="hasta" type="date" defaultValue={hasta} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="medio">Medio</Label>
          <select
            id="medio"
            name="medio"
            defaultValue={filters.method ?? ""}
            className="h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs"
          >
            <option value="">Todos</option>
            <option value="cash">{INCOME_METHOD_LABELS.cash}</option>
            <option value="mp">{INCOME_METHOD_LABELS.mp}</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="q">Concepto</Label>
          <Input id="q" name="q" defaultValue={q} className="w-52" placeholder="Alquiler, rifa…" />
        </div>
        <Button type="submit" variant="secondary">Filtrar</Button>
        {filtered && (
          <Button asChild variant="ghost"><Link href={BASE}>Limpiar</Link></Button>
        )}
      </form>

      {badDates && (
        <FormMessage kind="warning" box>
          Una de las fechas del filtro no es válida y no se aplicó. El total es el de todo lo que
          quedó en el rango.
        </FormMessage>
      )}

      {total === 0 ? (
        // Nunca un thead sin filas.
        <EmptyState
          description={
            filtered
              ? "Ningún ingreso coincide con el filtro."
              : "Todavía no se registró ningún ingreso no societario. Los alquileres del salón, las rifas y los eventos se cargan desde el formulario de arriba."
          }
          action={filtered ? <Button asChild variant="outline"><Link href={BASE}>Ver todos</Link></Button> : undefined}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead>Medio</TableHead>
                <TableHead>Registró</TableHead>
                <TableHead><span className="sr-only">Acción</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const voided = r.voidedAt !== null;
                return (
                  <TableRow key={r.id} className={voided ? "text-muted-foreground" : undefined}>
                    <TableCell>{formatDateAR(r.receivedAt)}</TableCell>
                    <TableCell className={`text-right font-mono tabular-nums ${voided ? "line-through" : ""}`}>
                      {formatARS(r.amount)}
                    </TableCell>
                    <TableCell>
                      {/* Concepto y nota son texto libre del operador y pueden
                          nombrar a un tercero: se leen acá, que es panel de
                          admin, y no viajan a la auditoría ni al log. */}
                      <span className={voided ? "line-through" : undefined}>{r.concept}</span>
                      {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                      {voided && (
                        <span className="block text-xs">
                          Anulado el {formatDateAR(r.voidedAt!)}
                          {r.voidedBy && ` por ${r.voidedBy}`}
                          {r.voidReason && `: ${r.voidReason}`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{INCOME_METHOD_LABELS[r.method]}</TableCell>
                    <TableCell>{r.registeredBy ?? "—"}</TableCell>
                    <TableCell>
                      {voided ? (
                        <Badge variant="destructive">Anulado</Badge>
                      ) : (
                        <VoidIncomeForm incomeId={r.id} concept={r.concept} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <PaginationNav
            page={pg.page}
            pageCount={pg.pageCount}
            href={(n) => pageHref(BASE, params, n)}
            label="Páginas de otros ingresos"
          />
        </>
      )}
    </div>
  );
}
