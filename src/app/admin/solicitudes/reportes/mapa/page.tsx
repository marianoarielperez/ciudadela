// Vista MAPA de la cola de reportes (spec §5.3): los mismos reportes que la
// lista, con la ubicación como eje. Cuatro decisiones que no son cosméticas:
//
// 1. Los filtros son EXACTAMENTE los de la lista y viajan en los dos sentidos:
//    esta pantalla lee `estado/tipo/categoria/q` con `parseReportView` y
//    `parseReportFilters`, arma su `where` con `reportWhere` —la misma función
//    que la lista— y el botón "Lista" devuelve a la lista con los filtros
//    puestos. Con un `where` propio, el chip diría 7 y el mapa mostraría otra
//    cosa (la lección de `coverageFloor`, y la razón de ser de `reports-query`).
// 2. Un reporte SIN punto no desaparece: se cuenta y se dice ("N sin
//    ubicación"). Un mapa que muestra 4 de 12 sin avisarlo es un mapa que
//    miente, y el reporte por teléfono o cargado desde el panel no tiene
//    coordenadas por diseño.
// 3. Al cliente NO viaja un solo dato de identidad ni el escrito: el `select`
//    es {id, kind, status, category, lat, lng} y el punto que se serializa se
//    arma acá (Ley 25.326, mismo criterio que `REPORT_LIST_SELECT`). El nombre
//    de quien reportó vive en la ficha, detrás del link del popup.
// 4. Los marcadores de Leaflet son de PUNTERO. La alternativa de teclado y de
//    lector de pantalla es la lista `sr-only` que se renderiza acá, en el
//    servidor, con un link por reporte: no es una concesión, es la única forma
//    de llegar a estos reportes sin mouse.
import { List } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FilterChips } from "@/components/admin/filter-chips";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { countByView, reportWhere } from "@/lib/admin/reports-query";
import {
  parseReportFilters, parseReportView, REPORT_VIEWS, reportFiltersHref, reportFiltersQuery,
  REPORTS_BASE, reportView,
} from "@/lib/admin/reports-queue";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { categoryLabel, KIND_LABELS, statusLabel } from "@/lib/reports/catalog";
import ReportsMap, { type MapPoint } from "./reports-map-loader";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mapa de reportes — SIGeV" };

const MAPA_BASE = `${REPORTS_BASE}/mapa`;

/** Tope de pines. No es una paginación: un mapa con más de esto es una mancha,
 *  y el operador que necesita ver TODO tiene la lista. Cuando el recorte muerde
 *  se dice en pantalla — un recorte silencioso es la misma mentira que esconder
 *  los reportes sin ubicación. */
const MAX_POINTS = 500;

const NO_FILTERS = { kind: null, category: null, q: null } as const;

/** El `where` se compone con `AND` y no con spread: `reportWhere` YA usa `OR`
 *  cuando hay texto de búsqueda, así que `{ ...base, OR: [...] }` le pisaría la
 *  búsqueda al operador sin que nada falle. */
function withPoint(base: Prisma.ReportWhereInput): Prisma.ReportWhereInput {
  return { AND: [base, { lat: { not: null }, lng: { not: null } }] };
}

function withoutPoint(base: Prisma.ReportWhereInput): Prisma.ReportWhereInput {
  return { AND: [base, { OR: [{ lat: null }, { lng: null }] }] };
}

export default async function ReportesMapaPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Primero y por su cuenta: el layout de Solicitudes NO autoriza (ver su
  // comentario), y esta pantalla muestra reportes de vecinos que no son socios.
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Mapa de reportes" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const view = parseReportView(sp.estado);
  const filters = parseReportFilters(sp);
  const where = reportWhere(view, filters);

  const [counts, noPointCount, rows] = await Promise.all([
    countByView(prisma, filters),
    prisma.report.count({ where: withoutPoint(where) }),
    prisma.report.findMany({
      where: withPoint(where),
      // El `select` más angosto del proyecto después del de la deuda: lo que
      // dibuja un pin y lo que rotula su popup. Ni `description` ni
      // `reporterName` ni `reporterEmail` — no es que no se muestren: no se
      // leen de la base.
      select: { id: true, kind: true, status: true, category: true, lat: true, lng: true },
      // El desempate no es adorno: con el tope de `MAX_POINTS`, un orden no
      // determinista haría que dos recargas dibujen conjuntos distintos.
      orderBy: [{ id: "desc" }],
      take: MAX_POINTS,
    }),
  ]);

  const points: MapPoint[] = rows.map((r) => ({
    id: r.id,
    // `lat`/`lng` llegan como `Decimal` de Prisma: al cliente va un number.
    lat: Number(r.lat),
    lng: Number(r.lng),
    status: r.status as MapPoint["status"],
    title: `N° ${r.id} · ${KIND_LABELS[r.kind]} · ${categoryLabel(r.kind, r.category)}`,
    // `statusLabel` y no `STATUS_LABELS[status]`: una iniciativa se "trata" y
    // "Desestimada" tiene género (spec §2).
    state: statusLabel(r.kind, r.status),
    href: `${REPORTS_BASE}/${r.id}`,
  }));

  const total = counts[view];
  // Cuántos tienen punto según los CONTADORES (no `rows.length`, que ya está
  // recortado): así se sabe si el tope mordió.
  const withPointCount = total - noPointCount;
  const clipped = withPointCount > points.length;

  const hasFilters = filters.kind !== null || filters.category !== null || filters.q !== null;
  const listHref = reportFiltersHref(filters, view);
  const chipHref = (key: (typeof REPORT_VIEWS)[number]["key"]) =>
    `${MAPA_BASE}${reportFiltersQuery(filters, key)}`;

  const empty =
    noPointCount > 0
      ? {
          description: `Ninguno de los ${noPointCount} reportes de esta vista tiene punto en el mapa. Se ven en la lista.`,
          action: "Ver la lista",
          href: listHref,
        }
      : hasFilters
        ? {
            description: "Ningún reporte coincide con esos filtros.",
            action: "Limpiar filtros",
            // Limpiar filtros NO saca del mapa: la pantalla que el operador
            // eligió es ésta.
            href: `${MAPA_BASE}${reportFiltersQuery(NO_FILTERS, view)}`,
          }
        : { description: reportView(view).empty, action: "Ver la lista", href: listHref };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mapa de reportes"
        breadcrumb={[
          { label: "Solicitudes", href: "/admin/solicitudes" },
          { label: "Reportes", href: REPORTS_BASE },
          { label: "Mapa" },
        ]}
        actions={
          <Button asChild variant="outline" className="min-h-11">
            <Link href={listHref}><List aria-hidden className="size-4" /> Lista</Link>
          </Button>
        }
      >
        <p className="max-w-3xl text-sm text-muted-foreground">
          Celeste: sin presentar · verde: presentados · gris: desestimados.
          {" "}
          {points.length === 1 ? "1 reporte en el mapa" : `${points.length} reportes en el mapa`}
          {noPointCount > 0 && ` · ${noPointCount} sin ubicación`}
          {clipped && ` · se dibujan los ${MAX_POINTS} más recientes de ${withPointCount}`}
          .
        </p>
      </PageHeader>

      {/* Los chips son los MISMOS de la lista —mismo `countByView`, mismo
          `where`— para que el operador vea un solo juego de números al ir y
          volver; por eso cuentan también a los que no tienen punto y el rótulo
          lo dice: acá el chip no promete pines, promete reportes de esa vista. */}
      <FilterChips
        label="Estado de los reportes (el contador incluye los que no tienen ubicación)"
        active={view}
        chips={REPORT_VIEWS.map((v) => ({
          key: v.key,
          label: v.label,
          href: chipHref(v.key),
          count: counts[v.key],
        }))}
      />

      {points.length === 0 ? (
        // Tres vacíos distintos, porque son tres problemas distintos: los hay
        // pero ninguno tiene punto (y la salida es la lista), los filtros no
        // dejan ninguno (y la salida es limpiarlos, SIN salir del mapa), o no
        // hay reportes. El primero es el que confunde si se lo dice como los
        // otros dos.
        <EmptyState description={empty.description} action={
          <Button asChild variant="outline" className="min-h-11">
            <Link href={empty.href}>{empty.action}</Link>
          </Button>
        } />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl ring-1 ring-foreground/10">
            <ReportsMap points={points} />
          </div>
          {/* La alternativa al mapa, en el servidor: los pines de Leaflet son
              de puntero (ver `keyboard: false` en el componente) y sin esto la
              pantalla no tendría ninguna ruta de teclado a estos reportes.
              `sr-only` y no `hidden`: tiene que estar en el árbol accesible. */}
          <section aria-labelledby="mapa-lista-titulo" className="sr-only">
            <h2 id="mapa-lista-titulo">Reportes dibujados en el mapa</h2>
            <ul>
              {points.map((p) => (
                <li key={p.id}>
                  <Link href={p.href} className={INLINE_LINK}>{p.title} · {p.state}</Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
