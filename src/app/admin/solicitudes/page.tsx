import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { requireAdmin } from "@/lib/auth/require-admin";
import { APPLICATION_STATUS_LABELS } from "@/lib/applications/labels";
import {
  makeApplicationQueries, parseApplicationFilters, parseApplicationsPage,
} from "@/lib/applications/query";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import { applicationStatusBadgeVariant } from "@/lib/admin/status-badges";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Solicitudes — SIGeV" };

export default async function SolicitudesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // La página se autoriza a sí misma aunque `admin/layout.tsx` ya bloquee: la
  // bandeja lista nombres y DNIs de gente que todavía no es socia (Ley 25.326),
  // y `requireAdmin` resuelve contra la fila viva de User — el layout mira el
  // token, que puede estar hasta 8 h desactualizado tras una degradación.
  const actor = await requireAdmin();
  if (!actor.ok) {
    // Pantalla de bloqueo y no redirect, por el mismo motivo que documenta
    // `configuracion/page.tsx`: acá no falta la sesión, falta un rol, y mandar
    // a /ingresar haría rebotar sin fin a quien tiene sesión válida.
    return (
      <div className="space-y-4">
        <PageHeader title="Solicitudes de asociación" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const filters = parseApplicationFilters(sp);
  const { rows, total, page, pageCount, pageSize } = await makeApplicationQueries(prisma)
    .fetchPage(filters, parseApplicationsPage(sp));

  // Los links de paginación conservan los filtros vigentes: sin esto, pasar a la
  // página 2 de una búsqueda devolvería la página 2 de la bandeja entera.
  const pageHref = (n: number) => {
    const qs = new URLSearchParams(
      Object.entries(filters).map(([k, v]) => [k, String(v)]),
    );
    if (n > 1) qs.set("page", String(n));
    const s = qs.toString();
    return s ? `/admin/solicitudes?${s}` : "/admin/solicitudes";
  };
  // `parseApplicationFilters` sólo agrega las claves que vinieron con un valor
  // válido: un objeto vacío significa "sin filtros", y ofrecer "Limpiar filtros"
  // ahí llevaría a la misma URL sin hacer nada.
  const hasFilters = Object.keys(filters).length > 0;
  const firstShown = (page - 1) * pageSize + 1;
  const lastShown = (page - 1) * pageSize + rows.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Solicitudes de asociación"
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/solicitudes/resumen">Resumen para acta</Link>
          </Button>
        }
      />

      <form className="flex flex-wrap items-end gap-2" method="get">
        {/* `aria-label` y no un <label> visible: el formulario es una fila de
            filtros sin encabezados, y un placeholder no es un nombre accesible. */}
        <Input
          name="q"
          aria-label="Buscar por nombre o DNI"
          placeholder="Nombre o DNI"
          defaultValue={filters.q ?? ""}
          className="w-56"
        />
        <select
          name="status"
          aria-label="Filtrar por estado"
          defaultValue={filters.status ?? ""}
          className="h-9 rounded-md border px-2 text-sm"
        >
          <option value="">Estado (todos)</option>
          {Object.entries(APPLICATION_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>

      {total === 0 ? (
        <EmptyState
          description={
            hasFilters
              ? "No hay solicitudes que coincidan con los filtros."
              : "Todavía no entró ninguna solicitud de asociación."
          }
          action={
            hasFilters
              ? <Button asChild variant="outline"><Link href="/admin/solicitudes">Limpiar filtros</Link></Button>
              : undefined
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {`${firstShown}–${lastShown} de ${total} solicitudes`}
            {pageCount > 1 && ` · página ${page} de ${pageCount}`}
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead><TableHead>Apellido y nombre</TableHead>
                <TableHead>DNI</TableHead><TableHead>Categoría</TableHead>
                <TableHead>Débito</TableHead><TableHead>Estado</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((app) => (
                <TableRow key={app.id}>
                  <TableCell>{app.id}</TableCell>
                  <TableCell>
                    <Link className="text-primary hover:underline" href={`/admin/solicitudes/${app.id}`}>
                      {app.fullName}
                    </Link>
                  </TableCell>
                  <TableCell>{app.dni}</TableCell>
                  <TableCell>{CATEGORY_LABELS[app.requestedCategory]}</TableCell>
                  <TableCell>{app.wantsDebit ? "Sí" : "No"}</TableCell>
                  <TableCell>
                    <Badge variant={applicationStatusBadgeVariant(app.status)}>
                      {APPLICATION_STATUS_LABELS[app.status]}
                    </Badge>
                    {/* Un reingreso no se asienta como alta nueva (REG-25): el
                        operador tiene que verlo desde la bandeja, sin abrir. */}
                    {app.memberId !== null && (
                      <Badge variant="secondary" className="ml-1">Reingreso</Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatDateAR(app.createdAt)}</TableCell>
                  <TableCell>
                    <Link className="text-sm text-primary hover:underline" href={`/admin/solicitudes/${app.id}`}>
                      Ver
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {pageCount > 1 && (
        <nav className="flex items-center gap-2" aria-label="Paginación de solicitudes">
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
