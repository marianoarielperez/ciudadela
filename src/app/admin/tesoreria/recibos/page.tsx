// El listado de recibos (spec §6.4): la serie completa, filtrable y paginada.
// Es el índice del libro de recibos, así que trae vigentes Y anulados: un
// anulado sigue siendo un asiento y tiene que poder encontrarse.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería.
import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageHref, parsePage } from "@/lib/admin/pagination";
import { receiptBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { PAYMENT_TYPE_LABELS } from "@/lib/treasury/labels";
import { fetchReceiptsPage, parseReceiptFilters } from "@/lib/treasury/receipts-query";
import { SELECT_CLASS } from "@/lib/admin/field-styles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recibos — SIGeV" };

const BASE = "/admin/tesoreria/recibos";

export default async function RecibosPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const sp = await props.searchParams;
  const filters = parseReceiptFilters(sp);
  const { rows, total, page, pageCount } = await fetchReceiptsPage(prisma, filters, parsePage(sp));
  const params = { q: filters.q, mes: filters.mes, medio: filters.medio, estado: filters.estado };
  const hasFilters = Object.values(params).some(Boolean);

  return (
    <div className="space-y-4">
      {/* GET plano, como el buscador del padrón: la búsqueda queda en la URL y
          se puede compartir, recargar y volver con el botón atrás. */}
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input
          name="q"
          placeholder="Número de recibo o socio"
          defaultValue={filters.q ?? ""}
          className="w-56"
          aria-label="Número de recibo o socio"
        />
        <Input name="mes" type="month" defaultValue={filters.mes ?? ""} className="w-40" aria-label="Mes" />
        <select name="medio" defaultValue={filters.medio ?? ""} className={SELECT_CLASS} aria-label="Medio de pago">
          <option value="">Medio (todos)</option>
          {Object.entries(PAYMENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="estado" defaultValue={filters.estado ?? ""} className={SELECT_CLASS} aria-label="Estado">
          <option value="">Estado (todos)</option>
          <option value="vigentes">Vigentes</option>
          <option value="anulados">Anulados</option>
        </select>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>

      {total === 0 ? (
        // Nunca un thead sin filas: el estado vacío reemplaza a la tabla entera
        // y ofrece la acción que lo resuelve.
        <EmptyState
          description={hasFilters ? "Ningún recibo coincide con el filtro." : "Todavía no se emitió ningún recibo."}
          action={hasFilters
            ? <Button asChild variant="outline"><Link href={BASE}>Limpiar filtros</Link></Button>
            : <Button asChild><Link href="/admin/tesoreria/efectivo">Registrar efectivo</Link></Button>}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "recibo" : "recibos"}{pageCount > 1 && ` · página ${page} de ${pageCount}`}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Socio</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead>Medio</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono tabular-nums">
                    <Link className="text-primary hover:underline" href={`${BASE}/${r.id}`}>{r.number}</Link>
                  </TableCell>
                  <TableCell>{formatDateAR(r.issuedAt)}</TableCell>
                  <TableCell>
                    {r.payment.member
                      ? <Link className="hover:underline" href={`/admin/socios/${r.payment.member.id}?tab=cuenta`}>{r.payment.member.fullName}</Link>
                      : "—"}
                  </TableCell>
                  {/* Congelado al emitir, no recalculado desde las cuotas: en un
                      anulado las cuotas ya no están y el detalle se perdería. */}
                  <TableCell>{r.concept}</TableCell>
                  <TableCell>{PAYMENT_TYPE_LABELS[r.payment.type]}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatARS(Number(r.payment.amount))}</TableCell>
                  <TableCell>
                    <Badge variant={receiptBadgeVariant(Boolean(r.voidedAt))}>{r.voidedAt ? "Anulado" : "Vigente"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationNav page={page} pageCount={pageCount} href={(n) => pageHref(BASE, params, n)} label="Paginación de recibos" />
        </>
      )}
    </div>
  );
}
