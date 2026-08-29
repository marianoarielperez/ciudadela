// El listado de actas, rediseñado (spec 2026-08-29): tarjetas agrupadas por año
// —el gesto de la pantalla: las actas SON la cronología institucional—, chips
// por tipo, búsqueda + año en un GET plano, y paginación de 20.
//
// La query es PRIVADA de esta pantalla (mapa de riesgo): los diez MinutePicker
// del panel usan su propia consulta con otro orden y `take: 30` — no compartir
// jamás. El conteo de la tarjeta suma las SIETE relaciones no solapadas (ver
// `references.ts`): un acta que respalda una exención o un valor de cuota ya no
// se muestra "vacía".
import { Gavel, Landmark } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SELECT_CLASS } from "@/lib/admin/field-styles";
import { pageHref, paginate, parsePage } from "@/lib/admin/pagination";
import { cn } from "@/lib/utils";
import { formatDateAR } from "@/lib/format";
import { minuteName } from "@/lib/members/labels";
import {
  ACTAS_BASE, ACTAS_PAGE_SIZE, actasFilterParams, actasWhere, activeChip,
  groupByYear, parseActasFilters, yearOf,
} from "@/lib/minutes/filters";
import { REFERENCE_COUNT_SELECT, referenceCount, referenceCountLabel } from "@/lib/minutes/references";
import { prisma } from "@/lib/prisma";
import type { MinuteType } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Actas — SIGeV" };

// Mismo segmented que el padrón: el chip es un LINK con el filtro en la URL.
const CHIP_BASE =
  "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_ACTIVE = "bg-background text-foreground shadow-sm";
const CHIP_INACTIVE = "text-muted-foreground hover:text-foreground";

const CHIPS: Array<{ key: "todas" | MinuteType; label: string; href: string }> = [
  { key: "todas", label: "Todas", href: ACTAS_BASE },
  { key: "board", label: "Comisión Directiva", href: `${ACTAS_BASE}?tipo=board` },
  { key: "assembly", label: "Asambleas", href: `${ACTAS_BASE}?tipo=assembly` },
];

const TYPE_ICONS = { board: Gavel, assembly: Landmark } as const;

type Search = Record<string, string | string[] | undefined>;

export default async function ActasPage(props: { searchParams: Promise<Search> }) {
  const sp = (await props.searchParams) ?? {};
  const filters = parseActasFilters(sp);
  const where = actasWhere(filters);

  const total = await prisma.minute.count({ where });
  const { page, pageCount, skip, take } = paginate(total, parsePage(sp), ACTAS_PAGE_SIZE);

  const [minutes, typeCounts, yearRows] = await Promise.all([
    prisma.minute.findMany({
      where,
      orderBy: [{ date: "desc" }, { number: "desc" }],
      skip,
      take,
      include: { _count: { select: REFERENCE_COUNT_SELECT } },
    }),
    // Conteos GLOBALES por tipo: los chips resetean búsqueda y año, así que
    // cuentan el universo entero — cada chip filtra exactamente lo que cuenta.
    prisma.minute.groupBy({ by: ["type"], _count: { _all: true } }),
    // Los años con actas, para el select. A escala de decenas esta segunda
    // consulta liviana es más simple que un raw SQL.
    prisma.minute.findMany({ select: { date: true }, orderBy: { date: "desc" } }),
  ]);

  const countByType: Record<string, number> = {};
  for (const row of typeCounts) countByType[row.type] = row._count._all;
  const chipCounts = {
    todas: (countByType.board ?? 0) + (countByType.assembly ?? 0),
    board: countByType.board ?? 0,
    assembly: countByType.assembly ?? 0,
  };
  const years = [...new Set(yearRows.map((r) => yearOf(r.date)))];
  const chip = activeChip(filters);
  const hasFilters = filters.tipo !== null || filters.anio !== null || filters.q !== null;
  const groups = groupByYear(minutes);
  const firstShown = total === 0 ? 0 : skip + 1;
  const lastShown = skip + minutes.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Actas"
        actions={<Button asChild size="lg" className="min-h-11 px-4"><Link href="/admin/actas/nueva">Nueva acta</Link></Button>}
      >
        <p className="max-w-3xl text-sm text-muted-foreground">
          El registro de lo asentado por el sistema bajo cada acta, para incorporar al libro
          de actas junto con el resto de las decisiones de la Comisión.
        </p>
      </PageHeader>

      <nav aria-label="Actas por tipo" className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1">
        {CHIPS.map(({ key, label, href }) => (
          <Link
            key={key}
            href={href}
            aria-current={chip === key ? "page" : undefined}
            className={cn(CHIP_BASE, chip === key ? CHIP_ACTIVE : CHIP_INACTIVE)}
          >
            {label}
            <span className="font-mono tabular-nums">{chipCounts[key]}</span>
          </Link>
        ))}
      </nav>

      {/* GET plano, como el resto del panel: el filtro queda en la URL y se
          puede compartir, recargar y volver con el botón atrás. */}
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input
          name="q"
          placeholder="Número o texto de la descripción"
          defaultValue={filters.q ?? ""}
          aria-label="Buscar actas"
          className="w-full sm:w-64"
        />
        <select
          name="anio"
          defaultValue={filters.anio ? String(filters.anio) : ""}
          className={cn(SELECT_CLASS, "max-w-full")}
          aria-label="Año"
        >
          <option value="">Todos los años</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {filters.tipo && <input type="hidden" name="tipo" value={filters.tipo} />}
        <Button type="submit" variant="secondary" className="min-h-11">Filtrar</Button>
        {hasFilters && (
          <Button asChild variant="outline" className="min-h-11">
            <Link href={ACTAS_BASE}>Limpiar filtros</Link>
          </Button>
        )}
      </form>

      {total === 0 ? (
        hasFilters ? (
          <EmptyState
            description="Ninguna acta coincide con ese filtro."
            action={<Button asChild variant="outline"><Link href={ACTAS_BASE}>Limpiar filtros</Link></Button>}
          />
        ) : (
          <EmptyState
            description="Todavía no hay actas cargadas. Las acciones societarias (altas, bajas, cambios de categoría) se asientan siempre en un acta."
            action={<Button asChild><Link href="/admin/actas/nueva">Nueva acta</Link></Button>}
          />
        )
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {`${firstShown}–${lastShown} de ${total === 1 ? "1 acta" : `${total} actas`}`}
            {pageCount > 1 && ` · página ${page} de ${pageCount}`}
          </p>

          {groups.map((group) => (
            <section key={group.year} aria-labelledby={`anio-${group.year}`} className="space-y-3">
              {/* El gesto de la pantalla: el año como marca tipográfica de la
                  cronología del libro. El conteo es del AÑO EN ESTA PÁGINA: un
                  año partido por la paginación repite su encabezado enfrente. */}
              <div className="flex items-baseline gap-3">
                <h2
                  id={`anio-${group.year}`}
                  className="font-heading text-3xl font-semibold tracking-tight text-muted-foreground"
                >
                  {group.year}
                </h2>
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {group.rows.length === 1 ? "1 acta" : `${group.rows.length} actas`}
                </span>
                <div aria-hidden className="h-px flex-1 bg-border" />
              </div>
              <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {group.rows.map((m) => {
                  const Icon = TYPE_ICONS[m.type];
                  const count = referenceCount(m._count);
                  return (
                    <li key={m.id}>
                      <Card size="sm" className="relative h-full transition-shadow hover:shadow-md">
                        <CardHeader className="gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Icon aria-hidden className="size-5" />
                            </span>
                            <span className="text-xs text-muted-foreground">{formatDateAR(m.date)}</span>
                          </div>
                          <CardTitle as="h3">
                            {/* Un solo link semántico, estirado a la tarjeta
                                entera (patrón del tablero /admin). */}
                            <Link
                              href={`/admin/actas/${m.id}`}
                              className="outline-hidden after:absolute after:inset-0 after:rounded-xl after:ring-ring after:ring-inset focus-visible:after:ring-2"
                            >
                              {minuteName(m)}
                            </Link>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {m.description ? (
                            <p className="line-clamp-2 text-sm text-muted-foreground">{m.description}</p>
                          ) : (
                            <p className="text-sm text-muted-foreground/70">Sin descripción.</p>
                          )}
                          <p className="text-xs font-medium text-muted-foreground">
                            {referenceCountLabel(count)}
                          </p>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <PaginationNav
            page={page}
            pageCount={pageCount}
            href={(n) => pageHref(ACTAS_BASE, actasFilterParams(filters), n)}
            label="Páginas de actas"
          />
        </>
      )}
    </div>
  );
}
