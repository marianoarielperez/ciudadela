import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { requireAdmin } from "@/lib/auth/require-admin";
import { APPLICATION_STATUS_LABELS } from "@/lib/applications/labels";
import {
  makeApplicationQueries, parseApplicationFilters, parseApplicationsPage, showsReentryBadge,
} from "@/lib/applications/query";
import { RECORDABLE_STATUSES } from "@/lib/applications/record";
import { CATEGORY_LABELS, MINUTE_TYPE_LABELS } from "@/lib/members/labels";
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
import { recordApplicationsAction } from "./actions";
import { RecordForm } from "./record-form";

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
  const [{ rows, total, page, pageCount, pageSize }, minuteRows] = await Promise.all([
    makeApplicationQueries(prisma).fetchPage(filters, parseApplicationsPage(sp)),
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
  ]);
  const minutes = minuteRows.map((m) => ({
    id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));

  // Sólo estas dos pueden llegar al libro; el resto de las filas se listan pero
  // no se pueden tildar. Con ninguna asentable en la página, el formulario de
  // asiento no se muestra: sería un botón que no puede hacer nada.
  const recordable = (status: string) => (RECORDABLE_STATUSES as readonly string[]).includes(status);
  const selectableIds = rows.filter((r) => recordable(r.status)).map((r) => r.id);

  // Resultado del asiento anterior, que llega por la URL del redirect. Sólo el
  // éxito COMPLETO redirige: el parcial vuelve por el estado del formulario, que
  // es el único lugar donde entran los motivos de las que no se asentaron.
  const recorded = Number(sp.asentadas);

  // Los links de paginación conservan los filtros vigentes: sin esto, pasar a la
  // página 2 de una búsqueda devolvería la página 2 de la bandeja entera.
  const filtersQs = new URLSearchParams(
    Object.entries(filters).map(([k, v]) => [k, String(v)]),
  );
  const pageHref = (n: number) => {
    const qs = new URLSearchParams(filtersQs);
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

  // Aparte del JSX de abajo porque va envuelta o pelada según haya algo que
  // asentar: los checkboxes viven en las filas, así que el <form> del asiento
  // tiene que contener la tabla entera.
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          {selectableIds.length > 0 && (
            <TableHead className="w-10"><span className="sr-only">Seleccionar</span></TableHead>
          )}
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
            {/* Sólo las asentables se pueden tildar. El servidor lo revalida
                igual DENTRO de la transacción del asiento: esto es el cartel,
                no la cerradura. */}
            {selectableIds.length > 0 && (
              <TableCell>
                {recordable(app.status) ? (
                  // El <label> envolvente y no el input pelado: en una pantalla
                  // de selección masiva el blanco de 16px del checkbox se falla
                  // seguido, y errarle acá significa asentar en el acta a quien
                  // no correspondía. El label lo estira a la altura de la fila.
                  <label className="flex min-h-11 items-center">
                    <input
                      type="checkbox" name="ids" value={app.id} className="size-4"
                      aria-label={`Asentar la solicitud N° ${app.id}`}
                    />
                  </label>
                ) : (
                  <span className="sr-only">No se puede asentar</span>
                )}
              </TableCell>
            )}
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
                  operador tiene que verlo desde la bandeja, sin abrir. Ya
                  asentada, la bandeja no lo afirma: ver `showsReentryBadge`. */}
              {showsReentryBadge(app) && (
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
  );

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

      {Number.isInteger(recorded) && recorded > 0 && (
        <FormMessage kind="success" box>
          {`${recorded} ${recorded === 1 ? "solicitud asentada" : "solicitudes asentadas"} en acta.`}
        </FormMessage>
      )}

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

          {selectableIds.length > 0 ? (
            <RecordForm
              action={recordApplicationsAction}
              minutes={minutes}
              selectableIds={selectableIds}
              filters={pageHref(page).split("?")[1] ?? ""}
            >
              {table}
            </RecordForm>
          ) : (
            table
          )}
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
