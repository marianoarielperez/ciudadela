import Link from "next/link";
import { Suspense } from "react";
import { BookOpen, ChartColumn, Files, Scale } from "lucide-react";
import type { InstitutionalDocument, InstitutionalDocumentType } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { initialDocumentosTab, type DocumentosTabId } from "@/lib/admin/documentos-tabs";
import { documentFeaturedBadgeVariant } from "@/lib/admin/status-badges";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DocumentosTabs } from "./documentos-tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documentos — SIGeV" };

type Row = InstitutionalDocument & { uploadedBy: { name: string | null } | null };

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// La tira de estado del molde de Configuración: cero queries nuevas, todo sale
// del listado que la página ya trajo.
function StatusStrip({ rows }: { rows: Row[] }) {
  const featured = rows.find((r) => r.featured);
  const lastMemoria = rows.filter((r) => r.type === "annual_report")[0];
  const lastBalance = rows.filter((r) => r.type === "balance")[0];
  // La cuarta tarjeta NO linkea: su valor es el total de las cuatro pestañas, y
  // cualquier destino sería un subconjunto — un clic en un total que aterriza en
  // una parte contradice la etiqueta. Sin `href` tampoco lleva el gesto del link
  // estirado (`after:absolute`), que sin ancla adentro no hace nada.
  const items: {
    href?: string;
    icon: typeof Scale;
    label: string;
    value: string;
    warning: boolean;
  }[] = [
    {
      href: "?tab=normas", icon: Scale, label: "Norma vigente",
      value: featured ? featured.title : "Sin norma vigente", warning: !featured,
    },
    {
      href: "?tab=memorias", icon: BookOpen, label: "Última memoria",
      value: lastMemoria ? lastMemoria.title : "Ninguna cargada", warning: !lastMemoria,
    },
    {
      href: "?tab=balances", icon: ChartColumn, label: "Último balance",
      value: lastBalance ? lastBalance.title : "Ninguno cargado", warning: !lastBalance,
    },
    {
      icon: Files, label: "Total de documentos",
      value: `${rows.length}`, warning: false,
    },
  ];
  return (
    <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.label}>
          <Card
            size="sm"
            className={cn("relative h-full", item.href && "transition-shadow hover:shadow-md")}
          >
            <CardContent className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <item.icon aria-hidden className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="outline-hidden after:absolute after:inset-0 after:rounded-xl after:ring-ring after:ring-inset focus-visible:after:ring-2"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    item.label
                  )}
                </div>
                <div
                  title={item.value}
                  className={cn("truncate text-sm font-medium", item.warning && "text-warning")}
                >
                  {item.value}
                </div>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

// Chips de año para memorias/balances: links server-side (deep-link y botón
// atrás gratis) que conservan la pestaña en el href.
function YearChips({ tab, years, selected }: { tab: string; years: number[]; selected?: number }) {
  // Con menos de dos años distintos los chips no filtran nada. Pero si HAY un
  // filtro puesto tienen que dibujarse igual: "Todos" es la única salida del
  // callejón cuando el `?anio=` no matchea ninguna fila de la pestaña.
  if (years.length < 2 && selected === undefined) return null;
  const chip = (active: boolean) =>
    cn(
      // ≥44px como el resto de los controles del panel (misma medida que la
      // barra hermana de filtros por URL, `treasury-tabs`).
      "inline-flex min-h-11 items-center rounded-full border px-3 text-sm outline-hidden",
      "focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "border-primary bg-primary/10 font-semibold text-primary"
        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
    );
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por año">
      {/* `aria-current="page"`, el idioma del repo para links que filtran por
          URL (`treasury-tabs`): sin él el chip activo se anuncia igual que los
          demás, porque hoy sólo cambian el color y el peso tipográfico. */}
      <Link
        href={`?tab=${tab}`}
        aria-current={selected === undefined ? "page" : undefined}
        className={chip(selected === undefined)}
      >
        Todos
      </Link>
      {years.map((y) => (
        <Link
          key={y}
          href={`?tab=${tab}&anio=${y}`}
          aria-current={selected === y ? "page" : undefined}
          className={chip(selected === y)}
        >
          {y}
        </Link>
      ))}
    </div>
  );
}

function DocumentsTable({ rows, tab, emptyText }: {
  rows: Row[];
  // La pestaña del panel: viaja en el alta para que el formulario preseleccione
  // el tipo. Cada estado vacío lleva la SUYA, no la que esté activa.
  tab: DocumentosTabId;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        description={emptyText}
        action={
          <Button asChild>
            <Link href={`/admin/documentos/nuevo?tab=${tab}`}>Subir documento</Link>
          </Button>
        }
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Título</TableHead><TableHead>Año</TableHead>
          <TableHead>Tamaño</TableHead><TableHead>Subido</TableHead>
          <TableHead>Por</TableHead>
          <TableHead><span className="sr-only">Acciones</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => (
          <TableRow key={d.id}>
            <TableCell>
              <span className="flex items-center gap-2">
                <Link className="text-primary hover:underline" href={`/admin/documentos/${d.id}`}>
                  {d.title}
                </Link>
                {d.featured && (
                  <Badge variant={documentFeaturedBadgeVariant(d.featured)}>Vigente</Badge>
                )}
              </span>
              {d.description && (
                <span className="block text-xs text-muted-foreground">{d.description}</span>
              )}
            </TableCell>
            <TableCell>
              {d.year === null ? "—" : <Badge variant="outline">{d.year}</Badge>}
            </TableCell>
            <TableCell>{formatSize(d.size)}</TableCell>
            <TableCell>{formatDateAR(d.createdAt)}</TableCell>
            <TableCell>{d.uploadedBy?.name ?? "—"}</TableCell>
            <TableCell>
              <span className="flex items-center gap-3">
                <a
                  className="text-sm text-primary hover:underline"
                  href={`/api/admin/documentos/${d.id}`}
                  target="_blank"
                  rel="noopener"
                >
                  Ver PDF
                </a>
                <Link className="text-sm text-primary hover:underline" href={`/admin/documentos/${d.id}`}>
                  Editar
                </Link>
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Firma explícita, como el resto de las páginas del panel: el tipo global
// `PageProps<"...">` solo existe después de que Next genera los tipos de rutas,
// así que `tsc --noEmit` en frío no lo encuentra.
export default async function AdminDocumentsPage(props: {
  searchParams: Promise<{ tab?: string | string[]; anio?: string | string[] }>;
}) {
  const sp = await props.searchParams;
  const rows: Row[] = await prisma.institutionalDocument.findMany({
    orderBy: [{ year: "desc" }, { createdAt: "desc" }],
    include: { uploadedBy: { select: { name: true } } },
  });
  const anio = typeof sp.anio === "string" && /^\d{4}$/.test(sp.anio) ? Number(sp.anio) : undefined;
  const activeTab = initialDocumentosTab(sp);

  const byType = (type: InstitutionalDocumentType) => rows.filter((r) => r.type === type);
  // Descendente y explícito: heredar el orden del `orderBy` de la consulta ata
  // el orden de los chips a un detalle de la query.
  const yearsOf = (type: InstitutionalDocumentType) =>
    [...new Set(byType(type).map((r) => r.year).filter((y): y is number => y !== null))]
      .sort((a, b) => b - a);

  const panel = (
    tab: "memorias" | "balances",
    type: InstitutionalDocumentType,
    noun: string,
    emptyText: string,
  ) => {
    // El `?anio=` es de la pestaña ACTIVA y de ninguna otra. Aplicado a los
    // paneles ocultos daba un vacío FALSO: Radix cambia de panel al instante y
    // el `router.replace` que borra el parámetro llega después, así que un clic
    // en Balances desde `?tab=memorias&anio=2025` mostraba "Todavía no hay
    // balances cargados" aunque hubiera balances de otros años.
    const year = tab === activeTab ? anio : undefined;
    const shown = byType(type).filter((r) => year === undefined || r.year === year);
    return (
      <div className="space-y-3">
        <YearChips tab={tab} years={yearsOf(type)} selected={year} />
        <DocumentsTable
          rows={shown}
          tab={tab}
          // Con un filtro puesto, "todavía no hay memorias" es mentira si las
          // hay de otro año: el vacío tiene que hablar del AÑO filtrado.
          emptyText={year === undefined ? emptyText : `No hay ${noun} de ${year}.`}
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Documentos"
        actions={
          <Button asChild>
            {/* La pestaña activa viaja al alta: el formulario preselecciona el
                tipo con ella. */}
            <Link href={`/admin/documentos/nuevo?tab=${activeTab}`}>Subir documento</Link>
          </Button>
        }
      >
        <p className="max-w-3xl text-sm text-muted-foreground">
          Lo que se sube acá lo ven los socios en su panel, en Documentos.
        </p>
      </PageHeader>
      <StatusStrip rows={rows} />
      <Suspense fallback={null}>
        <DocumentosTabs
          initial={activeTab}
          normas={
            <DocumentsTable
              rows={byType("norm")}
              tab="normas"
              emptyText="Todavía no hay normas. El estatuto y los reglamentos internos van acá."
            />
          }
          memorias={panel("memorias", "annual_report", "memorias", "Todavía no hay memorias cargadas.")}
          balances={panel("balances", "balance", "balances", "Todavía no hay balances cargados.")}
          otros={
            <DocumentsTable
              rows={byType("other")}
              tab="otros"
              emptyText="Todavía no hay otros documentos."
            />
          }
        />
      </Suspense>
    </div>
  );
}
