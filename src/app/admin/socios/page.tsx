import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fetchPadronPage, parsePadronFilters, parsePadronPage } from "@/lib/members/query";
import { CATEGORY_LABELS, EMAIL_STATUS_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Socios — SIGeV" };

export default async function SociosPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const filters = parsePadronFilters(sp);
  // La página se lee aparte de los filtros a propósito: `exportQs` se arma con
  // los filtros y el export tiene que seguir trayendo el padrón completo.
  const { rows, total, page, pageCount, pageSize } = await fetchPadronPage(
    prisma, filters, parsePadronPage(sp),
  );
  const exportQs = new URLSearchParams(
    Object.entries(filters).map(([k, v]) => [k, String(v)]),
  ).toString();
  // Los links de paginación conservan los filtros vigentes: sin esto, pasar a la
  // página 2 de una búsqueda devolvería la página 2 del padrón entero.
  const pageHref = (n: number) => {
    const qs = new URLSearchParams(
      Object.entries(filters).map(([k, v]) => [k, String(v)]),
    );
    if (n > 1) qs.set("page", String(n));
    const s = qs.toString();
    return s ? `/admin/socios?${s}` : "/admin/socios";
  };
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = (page - 1) * pageSize + rows.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Socios — Libro 1"
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/admin/padron-export?${exportQs}`}>Exportar Excel</a>
            </Button>
            <Button asChild><Link href="/admin/socios/nuevo">Alta manual</Link></Button>
          </>
        }
      />

      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input name="q" placeholder="Nombre, DNI o número" defaultValue={filters.q ?? ""} className="w-56" />
        <select name="category" defaultValue={filters.category ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Categoría (todas)</option>
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Estado (todos)</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="email" defaultValue={filters.email ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Email (todos)</option>
          <option value="con">Con email</option>
          <option value="sin">Sin email</option>
          <option value="verificado">Verificado</option>
        </select>
        <select name="dni" defaultValue={filters.dni ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">DNI (todos)</option>
          <option value="con">Con DNI</option>
          <option value="sin">Sin DNI</option>
        </select>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>

      {total === 0 ? (
        <EmptyState
          description="Ningún socio coincide con el filtro."
          action={<Button asChild variant="outline"><Link href="/admin/socios">Limpiar filtros</Link></Button>}
        />
      ) : (
        <>
          {/* El total es el del padrón filtrado, no el de la página: el operador
              tiene que poder leer "160 socios" aunque en pantalla haya 50. */}
          <p className="text-sm text-muted-foreground">
            {`${firstShown}–${lastShown} de ${total} socios`}
            {pageCount > 1 && ` · página ${page} de ${pageCount}`}
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead><TableHead>Apellido y nombre</TableHead>
                <TableHead>DNI</TableHead><TableHead>Categoría</TableHead>
                <TableHead>Estado</TableHead><TableHead>Email</TableHead>
                <TableHead>Débito</TableHead><TableHead><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ memberNumber, member }) => (
                <TableRow key={member.id}>
                  <TableCell>{memberNumber}</TableCell>
                  <TableCell>
                    <Link className="text-primary hover:underline" href={`/admin/socios/${member.id}`}>{member.fullName}</Link>
                  </TableCell>
                  <TableCell>{member.dni ?? "—"}</TableCell>
                  <TableCell>{CATEGORY_LABELS[member.category]}</TableCell>
                  <TableCell>
                    <Badge variant={memberStatusBadgeVariant(member.status)}>
                      {STATUS_LABELS[member.status]}
                    </Badge>
                    {member.status === "withdrawn" && member.debtAtWithdrawal && (
                      <Badge variant="destructive" className="ml-1">Deuda</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {member.email ? `${member.email} · ${EMAIL_STATUS_LABELS[member.emailStatus]}` : "—"}
                  </TableCell>
                  <TableCell>{member.autoDebit ? "Sí" : "No"}</TableCell>
                  <TableCell>
                    <Link className="text-sm text-primary hover:underline" href={`/admin/socios/carga/${memberNumber}`}>
                      Cargar ficha
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {/* Paginación simple (spec §6). El export a Excel sigue llevándose el
          padrón filtrado COMPLETO: usa `fetchPadron`, que no pagina. */}
      {pageCount > 1 && (
        <nav className="flex items-center gap-2" aria-label="Paginación del padrón">
          {page > 1 ? (
            <Button asChild variant="outline"><Link href={pageHref(page - 1)}>← Anterior</Link></Button>
          ) : (
            <Button variant="outline" disabled>← Anterior</Button>
          )}
          <span className="text-sm text-muted-foreground">Página {page} de {pageCount}</span>
          {page < pageCount ? (
            <Button asChild variant="outline"><Link href={pageHref(page + 1)}>Siguiente →</Link></Button>
          ) : (
            <Button variant="outline" disabled>Siguiente →</Button>
          )}
        </nav>
      )}
    </div>
  );
}
