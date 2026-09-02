// Pestaña "Reportes": la cola de reclamos e iniciativas del M7 (spec §5.3).
//
// Tres decisiones que no son cosméticas:
//
// 1. Los chips y la lista salen del MISMO `where` (`reports-query.ts`): el
//    número del chip y las filas que aparecen al clickearlo son la misma
//    consulta con otro `select`.
// 2. El estado se nombra SIEMPRE con `statusLabel(kind, status)`: un reclamo se
//    "presenta" y una iniciativa se "trata", y `dismissed` tiene género. Leer
//    `STATUS_LABELS[status]` a mano le dice "Presentado" a una iniciativa.
// 3. `requireAdmin()` propio, primero: el layout de la sección NO autoriza (ver
//    su comentario) — sólo evita filtrarle el tamaño de la cola a alguien que
//    el panel ya bloqueó. Esta pantalla muestra reportes de vecinos que no son
//    socios (Ley 25.326) y no puede heredar el chequeo de un layout que ya
//    renderizó.
//
// Sin miga de navegación, igual que sus dos pestañas hermanas (Altas y De
// socios): las pestañas de `layout.tsx` ya están arriba, y una última miga
// "Reportes" debajo de un <h1> "Reportes" repite el título (CLAUDE.md). La
// ficha y el mapa sí la llevan: ahí la miga vuelve a algún lado.
import { Map as MapIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FilterChips } from "@/components/admin/filter-chips";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { ReportKindIcon } from "@/components/admin/report-kind-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SELECT_CLASS } from "@/lib/admin/field-styles";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { pageHref, paginate, parsePage } from "@/lib/admin/pagination";
import {
  countByView, REPORT_LIST_SELECT, REPORT_THUMBS, reportPhotos, reportPlaceLabel, reportWhere,
} from "@/lib/admin/reports-query";
import {
  parseReportFilters, parseReportView, REPORT_VIEWS, reportFiltersHref, reportFiltersQuery,
  reportKindParam, REPORTS_BASE, reportView,
} from "@/lib/admin/reports-queue";
import { reportKindBadgeVariant, reportStatusBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatDateAR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  categoryLabel, CLAIM_CATEGORIES, INITIATIVE_CATEGORIES, KIND_LABELS, statusLabel, subtypeLabel,
} from "@/lib/reports/catalog";
import { cn } from "@/lib/utils";
import type { ReportStatus } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reportes — SIGeV" };

const PAGE_SIZE = 50;

// Tipado como `Record<ReportStatus, …>` y no un objeto suelto: si el enum suma
// un estado, el build falla en vez de dejar la tarjeta sin riel. `draft` no se
// lista en ninguna vista, pero necesita un valor para que el tipo cierre.
const RAIL: Record<ReportStatus, string> = {
  draft: "border-l-border",
  received: "border-l-primary",
  filed: "border-l-success",
  dismissed: "border-l-border",
};

const NO_FILTERS = { kind: null, category: null, q: null } as const;

export default async function ReportesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Reportes" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const view = parseReportView(sp.estado);
  const filters = parseReportFilters(sp);
  const where = reportWhere(view, filters);
  // El total de la paginación es el contador de ESTA vista, no una quinta
  // consulta con el mismo `where`: `countByView` ya lo contó. Con dos `count`
  // separados, la línea "1–50 de N" podía discrepar del chip por una fila que
  // entró entre una consulta y la otra.
  const counts = await countByView(prisma, filters);
  const total = counts[view];
  const { page, pageCount, skip, take } = paginate(total, parsePage(sp), PAGE_SIZE);
  const rows = total === 0 ? [] : await prisma.report.findMany({
    where,
    // El desempate por id no es adorno: `submittedAt` puede repetirse (dos
    // envíos en el mismo segundo) y sin él la fila salta de página.
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: REPORT_LIST_SELECT,
  });

  const hasFilters = filters.kind !== null || filters.category !== null || filters.q !== null;
  const clearHref = reportFiltersHref(NO_FILTERS, view);
  const mapHref = `${REPORTS_BASE}/mapa${reportFiltersQuery(filters, view)}`;

  // El `<select>` de categorías es kind-aware: con un tipo elegido muestra sólo
  // SU catálogo (elegir una categoría que ese tipo no tiene deja el filtro en
  // nada, ver `parseReportFilters`). Sin tipo van los dos, y `other` —que
  // existe en los dos catálogos con etiquetas distintas ("Otro reporte" y
  // "Otra")— aparece UNA sola vez, fuera de los grupos y con un nombre propio:
  // dos <option> con el mismo value serían la misma consulta escrita dos veces,
  // y el navegador preseleccionaría siempre la primera.
  type CategoryOption = { slug: string; label: string };
  const claimOptions: readonly CategoryOption[] = filters.kind === "initiative" ? [] : CLAIM_CATEGORIES;
  const initiativeOptions: readonly CategoryOption[] = filters.kind === "claim" ? [] : INITIATIVE_CATEGORIES;
  const sharedOther = filters.kind === null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reportes"
        actions={
          <Button asChild variant="outline" className="min-h-11">
            <Link href={mapHref}><MapIcon aria-hidden className="size-4" /> Mapa</Link>
          </Button>
        }
      >
        <p className="max-w-3xl text-sm text-muted-foreground">
          Reclamos e iniciativas de vecinos y socios. Lo que está sin presentar es la cola de trabajo.
        </p>
      </PageHeader>

      <FilterChips
        label="Estado de los reportes"
        active={view}
        chips={REPORT_VIEWS.map((v) => ({
          key: v.key,
          label: v.label,
          href: reportFiltersHref(filters, v.key),
          count: counts[v.key],
        }))}
      />

      {/* GET plano: los filtros viven en la URL, así que el deep link y el
          botón atrás salen solos. La vista viaja en un hidden para que filtrar
          no devuelva al operador a "Sin presentar". */}
      <form className="flex flex-wrap items-end gap-2" method="get">
        {view !== "pendientes" && <input type="hidden" name="estado" value={view} />}
        <select
          name="tipo"
          defaultValue={reportKindParam(filters.kind) ?? ""}
          className={cn(SELECT_CLASS, "min-h-11")}
          aria-label="Tipo de reporte"
        >
          <option value="">Reclamos e iniciativas</option>
          <option value="reclamo">Reclamos</option>
          <option value="iniciativa">Iniciativas</option>
        </select>
        <select
          name="categoria"
          defaultValue={filters.category ?? ""}
          className={cn(SELECT_CLASS, "min-h-11")}
          aria-label="Categoría"
        >
          <option value="">Todas las categorías</option>
          {sharedOther && <option value="other">Otro / Otra</option>}
          {claimOptions.length > 0 && (
            <optgroup label="Reclamos">
              {claimOptions
                .filter((c) => !(sharedOther && c.slug === "other"))
                .map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </optgroup>
          )}
          {initiativeOptions.length > 0 && (
            <optgroup label="Iniciativas">
              {initiativeOptions
                .filter((c) => !(sharedOther && c.slug === "other"))
                .map((c) => <option key={`i-${c.slug}`} value={c.slug}>{c.label}</option>)}
            </optgroup>
          )}
        </select>
        <Input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="N°, calle, texto o nombre"
          aria-label="Buscar"
          className="min-h-11 w-full sm:w-56"
        />
        <Button type="submit" variant="secondary" className="min-h-11">Filtrar</Button>
        {hasFilters && (
          <Button asChild variant="ghost" className="min-h-11">
            <Link href={clearHref}>Limpiar</Link>
          </Button>
        )}
      </form>

      {rows.length === 0 ? (
        // El texto del vacío por filtros dice que el problema son los filtros;
        // el de la vista limpia es el de `REPORT_VIEWS` (uno por vista: "no hay
        // reportes esperando" no es lo mismo que "ninguno fue desestimado").
        <EmptyState
          description={hasFilters ? "Ningún reporte coincide con esos filtros." : reportView(view).empty}
          action={hasFilters ? (
            <Button asChild variant="outline" className="min-h-11">
              <Link href={clearHref}>Limpiar filtros</Link>
            </Button>
          ) : undefined}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{skip + 1}–{skip + rows.length} de {total}</p>
          <ul className="space-y-3">
            {rows.map((r) => {
              // El número del libro ABIERTO: un socio migrado tiene también el
              // del libro cerrado, y ése ya no lo identifica.
              const number = r.member?.memberships.find((m) => m.book.status === "open")?.memberNumber;
              const what = r.kind === "claim" && r.subtype
                ? `${categoryLabel("claim", r.category)} › ${subtypeLabel(r.category, r.subtype)}`
                : categoryLabel(r.kind, r.category);
              const place = reportPlaceLabel(r);
              const photos = reportPhotos(r.files);
              return (
                <li key={r.id}>
                  <Card className={cn("border-l-4", RAIL[r.status])}>
                    <CardHeader>
                      <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="flex items-center gap-2">
                          <span className="font-mono tabular-nums text-muted-foreground">N° {r.id}</span>
                          <Badge variant={reportKindBadgeVariant(r.kind)}>
                            <ReportKindIcon kind={r.kind} /> {KIND_LABELS[r.kind]}
                          </Badge>
                        </span>
                        {/* El asunto entra en el <h2> sólo para el lector de
                            pantalla: navegando por encabezados, "N° 14 ·
                            Reclamo" no dice de qué es el reporte, y meterlo a
                            la vista duplicaría el link que ya está abajo. */}
                        <span className="sr-only"> · {what}</span>
                        <Badge variant={reportStatusBadgeVariant(r.status)}>
                          {statusLabel(r.kind, r.status)}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Link
                        href={`${REPORTS_BASE}/${r.id}`}
                        className={cn(INLINE_LINK, "inline-flex min-h-11 items-center font-medium")}
                      >
                        {what}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {place || "Sin ubicación"} · {r.submittedAt ? formatDateAR(r.submittedAt) : "—"}
                        {" · "}
                        {r.memberId ? `Socio N° ${number ?? "—"}` : "Vecino"}
                      </p>
                      <p className="flex flex-wrap gap-1.5">
                        {/* "Reservado" es lo que se omite ANTE EL ORGANISMO: la
                            asociación siempre sabe quién reportó, y el operador
                            lo ve en la ficha. El `title` es para el mouse y el
                            `sr-only` para el lector de pantalla — el badge solo
                            diría "Reservado" sin decir reservado ante quién. */}
                        {r.anonymous && (
                          <Badge variant="outline" title="Identidad reservada ante el organismo">
                            Reservado<span className="sr-only">: identidad reservada ante el organismo</span>
                          </Badge>
                        )}
                        {r.outsideBoundary && (
                          <Badge variant="outline" title="El punto cae fuera del barrio">Fuera del barrio</Badge>
                        )}
                        {r.scplTicket && (
                          <Badge variant="outline" title="Número de reclamo ante la SCPL">SCPL {r.scplTicket}</Badge>
                        )}
                        {photos.length > 0 && (
                          <Badge variant="outline">{photos.length} {photos.length === 1 ? "foto" : "fotos"}</Badge>
                        )}
                      </p>
                      {/* Tira de hasta dos miniaturas (spec §6.3). Se sirven por
                          la ruta AUTENTICADA `/api/admin/reportes/[id]/archivos/
                          [fileId]`, que entrega JPEG inline con su CSP: no hay
                          una sola foto de un vecino bajo `public/`. `alt=""`
                          porque son decorativas —la cuenta accesible es el badge
                          "N fotos" de arriba, que ya la dice con palabras— y un
                          `alt` con el asunto le repetiría el título al lector de
                          pantalla dos veces por tarjeta. `<img>` y no
                          `next/image`: ese componente cachearía y republicaría
                          como asset público un archivo que la ruta entrega con
                          `no-store` (docs/08, mismo motivo que los dos visores
                          de documentos del panel). */}
                      {photos.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5">
                          {photos.slice(0, REPORT_THUMBS).map((f) => (
                            <li key={f.id}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/admin/reportes/${r.id}/archivos/${f.id}`}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                width={64}
                                height={64}
                                className="size-16 rounded-md border border-border bg-muted object-cover"
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
          <PaginationNav
            page={page}
            pageCount={pageCount}
            href={(n) => pageHref(REPORTS_BASE, {
              estado: view === "pendientes" ? undefined : view,
              tipo: reportKindParam(filters.kind),
              categoria: filters.category ?? undefined,
              q: filters.q ?? undefined,
            }, n)}
            label="Páginas de reportes"
          />
        </>
      )}
    </div>
  );
}
