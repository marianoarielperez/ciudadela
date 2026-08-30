import Link from "next/link";
import { Suspense } from "react";
import { BookOpen, ChartColumn, Files, Scale } from "lucide-react";
import type { InstitutionalDocument, InstitutionalDocumentType } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { initialDocumentosTab } from "@/lib/admin/documentos-tabs";
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
  const items = [
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
      href: "?tab=otros", icon: Files, label: "Documentos publicados",
      value: `${rows.length}`, warning: false,
    },
  ];
  return (
    <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.label}>
          <Card size="sm" className="relative h-full transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <item.icon aria-hidden className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">
                  <Link
                    href={item.href}
                    className="outline-hidden after:absolute after:inset-0 after:rounded-xl after:ring-ring after:ring-inset focus-visible:after:ring-2"
                  >
                    {item.label}
                  </Link>
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
  if (years.length < 2) return null;
  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-9 items-center rounded-full border px-3 text-sm outline-hidden",
      "focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "border-primary bg-primary/10 font-semibold text-primary"
        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
    );
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por año">
      <Link href={`?tab=${tab}`} className={chip(selected === undefined)}>
        Todos
      </Link>
      {years.map((y) => (
        <Link key={y} href={`?tab=${tab}&anio=${y}`} className={chip(selected === y)}>
          {y}
        </Link>
      ))}
    </div>
  );
}

function DocumentsTable({ rows, emptyText }: { rows: Row[]; emptyText: string }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        description={emptyText}
        action={
          <Button asChild>
            <Link href="/admin/documentos/nuevo">Subir documento</Link>
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
                {d.featured && <Badge variant="success">Vigente</Badge>}
              </span>
              {d.description && (
                <span className="block text-xs text-muted-foreground">{d.description}</span>
              )}
            </TableCell>
            <TableCell>{d.year ?? "—"}</TableCell>
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

  const byType = (type: InstitutionalDocumentType) => rows.filter((r) => r.type === type);
  const yearsOf = (type: InstitutionalDocumentType) =>
    [...new Set(byType(type).map((r) => r.year).filter((y): y is number => y !== null))];

  const panel = (tab: "memorias" | "balances", type: InstitutionalDocumentType, emptyText: string) => (
    <div className="space-y-3">
      <YearChips tab={tab} years={yearsOf(type)} selected={anio} />
      <DocumentsTable
        rows={byType(type).filter((r) => anio === undefined || r.year === anio)}
        emptyText={emptyText}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Documentos"
        actions={
          <Button asChild>
            <Link href="/admin/documentos/nuevo">Subir documento</Link>
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
          initial={initialDocumentosTab(sp)}
          normas={
            <DocumentsTable
              rows={byType("norm")}
              emptyText="Todavía no hay normas. El estatuto y los reglamentos internos van acá."
            />
          }
          memorias={panel("memorias", "annual_report", "Todavía no hay memorias cargadas.")}
          balances={panel("balances", "balance", "Todavía no hay balances cargados.")}
          otros={
            <DocumentsTable
              rows={byType("other")}
              emptyText="Todavía no hay otros documentos."
            />
          }
        />
      </Suspense>
    </div>
  );
}
