// Pestaña "Padrón": el listado del libro ABIERTO. El marco de pestañas
// (Padrón | Libros | Histórico) lo pone `socios/layout.tsx`; el `<h1>` lo pone
// esta página, y dice "Padrón" a secas — el número del libro vigente dejó de
// vivir en el título porque ahora se ve, con su estado y sus fechas, en la
// pestaña Libros.
//
// Dos presentaciones de las MISMAS filas: tabla en desktop (`hidden md:block`)
// y una tarjeta por socio en móvil (`md:hidden`). No es un `overflow-x-auto`
// disfrazado: una tabla de 7 columnas en 375px se lee empujando la pantalla de
// costado, y el padrón se consulta desde el teléfono.
import Link from "next/link";
import { Mail, MailCheck, MailX, Minus, RefreshCw } from "lucide-react";

import type { EmailStatus } from "@/generated/prisma/client";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SELECT_CLASS } from "@/lib/admin/field-styles";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { pageHref } from "@/lib/admin/pagination";
import { memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { CATEGORY_LABELS, EMAIL_STATUS_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import {
  fetchPadronCounts, fetchPadronPage, parsePadronFilters, parsePadronPage,
  type PadronCounts, type PadronFilters, type PadronRow,
} from "@/lib/members/query";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = { title: "Socios — SIGeV" };

const BASE = "/admin/socios";

// Mismo segmented que las pestañas Pendientes|Resueltas de Solicitudes: el chip
// es un LINK (no un botón con estado), así que el filtro queda en la URL y se
// comparte, se recarga y se vuelve con el botón atrás.
const CHIP_BASE =
  "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_ACTIVE = "bg-background text-foreground shadow-sm";
const CHIP_INACTIVE = "text-muted-foreground hover:text-foreground";

type ChipKey = keyof PadronCounts;
const CHIPS: { key: ChipKey; label: string; href: string }[] = [
  // "Vigentes" no tiene filtro que lo exprese —el enum de estado no tiene un
  // valor "vigente", son dos (activo y suspendido)— así que apunta al padrón
  // sin filtros de estado: es también el chip que los limpia.
  { key: "vigentes", label: "Vigentes", href: BASE },
  { key: "activos", label: "Activos", href: `${BASE}?category=active` },
  { key: "adherentes", label: "Adherentes", href: `${BASE}?category=adherent` },
  { key: "suspendidos", label: "Suspendidos", href: `${BASE}?status=suspended` },
  { key: "bajas", label: "Bajas", href: `${BASE}?status=withdrawn` },
];

/** Qué chip está prendido, mirando los filtros YA parseados y no la URL cruda:
 *  un `?category=basura` no llega a filtrar nada, y tampoco puede prender un
 *  chip. Devuelve uno solo: los chips son excluyentes entre sí, así que una
 *  combinación que ninguno representa (categoría + estado a la vez) no prende
 *  ninguno en vez de prender el que se le parezca. */
function activeChip(f: PadronFilters): ChipKey | null {
  if (f.status === "suspended" && !f.category) return "suspendidos";
  if (f.status === "withdrawn" && !f.category) return "bajas";
  if (f.status) return null;
  if (f.category === "active") return "activos";
  if (f.category === "adherent") return "adherentes";
  return f.category ? null : "vigentes";
}

// El mapa ícono→componente vive ACÁ y no en `@/lib/members/labels` por el mismo
// motivo escrito en `request-type-icon.tsx`: `labels.ts` lo importan piezas de
// dominio declaradas puras, y un `import` de lucide les arrastraría el bundle
// del cliente sin que ninguna lo necesite. Las ETIQUETAS siguen allá.
//
// La dirección de correo ya no se lista en la celda: ocupaba la mitad del ancho
// de la tabla, no se busca por ella (el buscador es nombre/DNI/N°) y es dato
// personal que se ve en la ficha. Lo que el operador barre de un vistazo es si
// puede escribirle o no.
const EMAIL_ICONS: Record<EmailStatus, { Icon: typeof Mail; className: string }> = {
  verified: { Icon: MailCheck, className: "text-success" },
  declared: { Icon: Mail, className: "text-muted-foreground" },
  bounced: { Icon: MailX, className: "text-destructive" },
  none: { Icon: Minus, className: "text-muted-foreground/60" },
};

function EmailIcon({ status }: { status: EmailStatus }) {
  const { Icon, className } = EMAIL_ICONS[status];
  return (
    <>
      <Icon className={cn("size-4", className)} aria-hidden />
      <span className="sr-only">{EMAIL_STATUS_LABELS[status]}</span>
    </>
  );
}

// Sin débito no se dibuja nada: la ausencia del ícono ES el "no", y una fila de
// guiones en la columna sólo agrega ruido. El lector de pantalla no puede leer
// una ausencia, así que ahí sí va el texto.
function DebitIcon({ on }: { on: boolean }) {
  if (!on) return <span className="sr-only">Sin débito automático</span>;
  return (
    <>
      <RefreshCw className="size-4 text-primary" aria-hidden />
      <span className="sr-only">Débito automático</span>
    </>
  );
}

export default async function SociosPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const filters = parsePadronFilters(sp);
  // La página se lee aparte de los filtros a propósito: `exportQs` se arma con
  // los filtros y el export tiene que seguir trayendo el padrón completo.
  const [{ rows, total, page, pageCount, pageSize }, counts] = await Promise.all([
    fetchPadronPage(prisma, filters, parsePadronPage(sp)),
    fetchPadronCounts(prisma),
  ]);
  const exportQs = new URLSearchParams(
    Object.entries(filters).map(([k, v]) => [k, String(v)]),
  ).toString();
  // `parsePadronFilters` sólo agrega las claves que vinieron con un valor
  // válido, así que un objeto vacío significa "sin filtros": ofrecer "Limpiar
  // filtros" ahí llevaba a la misma URL y no hacía nada.
  const hasFilters = Object.keys(filters).length > 0;
  const chip = activeChip(filters);
  const firstShown = (page - 1) * pageSize + 1;
  const lastShown = (page - 1) * pageSize + rows.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Padrón"
        actions={
          <>
            <Button asChild variant="outline">
              {/* El link del export NO se lleva la página: `parsePadronPage`
                  vive aparte de los filtros justamente para eso. */}
              <a href={`/api/admin/padron-export?${exportQs}`}>Exportar Excel</a>
            </Button>
            <Button asChild><Link href={`${BASE}/nuevo`}>Alta manual</Link></Button>
          </>
        }
      />

      {/* Los números son del LIBRO, no del resultado filtrado: bajan sólo
          cuando cambia el padrón, no cuando el operador busca un apellido. */}
      <nav
        aria-label="Resumen del padrón"
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1"
      >
        {CHIPS.map(({ key, label, href }) => (
          <Link
            key={key}
            href={href}
            aria-current={chip === key ? "page" : undefined}
            className={cn(CHIP_BASE, chip === key ? CHIP_ACTIVE : CHIP_INACTIVE)}
          >
            {label}
            <span className="font-mono tabular-nums">{counts[key]}</span>
          </Link>
        ))}
      </nav>

      {/* GET plano, como el resto del panel: el filtro queda en la URL y se
          puede compartir, recargar y volver con el botón atrás. Los `name` son
          el contrato de `parsePadronFilters` y no se tocan. */}
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input
          name="q"
          placeholder="Nombre, DNI o N°"
          defaultValue={filters.q ?? ""}
          aria-label="Nombre, DNI o número de socio"
          className="w-full sm:w-56"
        />
        <select
          name="category"
          defaultValue={filters.category ?? ""}
          className={cn(SELECT_CLASS, "max-w-full")}
          aria-label="Categoría"
        >
          <option value="">Categoría (todas)</option>
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select
          name="status"
          defaultValue={filters.status ?? ""}
          className={cn(SELECT_CLASS, "max-w-full")}
          aria-label="Estado"
        >
          <option value="">Estado (todos)</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select
          name="email"
          defaultValue={filters.email ?? ""}
          className={cn(SELECT_CLASS, "max-w-full")}
          aria-label="Email"
        >
          <option value="">Email (todos)</option>
          <option value="con">Con email</option>
          <option value="sin">Sin email</option>
          <option value="verificado">Verificado</option>
        </select>
        <select
          name="dni"
          defaultValue={filters.dni ?? ""}
          className={cn(SELECT_CLASS, "max-w-full")}
          aria-label="DNI"
        >
          <option value="">DNI (todos)</option>
          <option value="con">Con DNI</option>
          <option value="sin">Sin DNI</option>
        </select>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>

      {total === 0 ? (
        // Nunca un thead sin filas: el estado vacío reemplaza a la tabla entera.
        <EmptyState
          size="list"
          description={
            hasFilters
              ? "Ningún socio coincide con estos filtros."
              : "Todavía no hay socios cargados en el padrón."
          }
          action={
            hasFilters
              ? <Button asChild variant="outline"><Link href={BASE}>Limpiar filtros</Link></Button>
              : undefined
          }
        />
      ) : (
        <>
          {/* El total es el del padrón filtrado, no el de la página: el operador
              tiene que poder leer "160 socios" aunque en pantalla haya 50. */}
          <p className="text-sm text-muted-foreground">
            {`${firstShown}–${lastShown} de ${total} socios`}
            {pageCount > 1 && ` · página ${page} de ${pageCount}`}
          </p>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N°</TableHead>
                  <TableHead>Apellido y nombre</TableHead>
                  <TableHead>DNI</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Débito</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ memberNumber, member }) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-mono tabular-nums">{memberNumber}</TableCell>
                    <TableCell>
                      {/* El nombre ES el link a la ficha: la columna de acciones
                          que había al final apuntaba al modo carga, que la
                          propia ficha sigue ofreciendo un clic más adentro. */}
                      <Link className={INLINE_LINK} href={`${BASE}/${member.id}`}>
                        {member.fullName}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono">{member.dni ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{CATEGORY_LABELS[member.category]}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge variant={memberStatusBadgeVariant(member.status)}>
                          {STATUS_LABELS[member.status]}
                        </Badge>
                        {member.status === "withdrawn" && member.debtAtWithdrawal && (
                          <Badge variant="destructive">Deuda</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell><EmailIcon status={member.emailStatus} /></TableCell>
                    <TableCell><DebitIcon on={member.autoDebit} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {rows.map((row) => <MemberCard key={row.member.id} row={row} />)}
          </div>
        </>
      )}

      {/* Paginación compartida con las listas de tesorería. El export a Excel
          sigue llevándose el padrón filtrado COMPLETO: usa `fetchPadron`, que
          no pagina. */}
      <PaginationNav
        page={page}
        pageCount={pageCount}
        href={(n) => pageHref(BASE, filters, n)}
        label="Páginas del padrón"
      />
    </div>
  );
}

// Molde `RequestCard` de la bandeja de socios: el `flex-wrap … justify-between`
// del título deja caer el badge abajo solo cuando el nombre no entra, en vez de
// empujar la tarjeta de costado.
function MemberCard({ row: { memberNumber, member } }: { row: PadronRow }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <Link className={INLINE_LINK} href={`${BASE}/${member.id}`}>{member.fullName}</Link>
          <span className="flex flex-wrap items-center gap-1">
            <Badge variant={memberStatusBadgeVariant(member.status)}>
              {STATUS_LABELS[member.status]}
            </Badge>
            {member.status === "withdrawn" && member.debtAtWithdrawal && (
              <Badge variant="destructive">Deuda</Badge>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {/* Sólo el número va en mono: con el "N° " adentro, el espacio queda
              tabulado y se abre un hueco raro entre la abreviatura y la cifra. */}
          N° <span className="font-mono tabular-nums">{memberNumber}</span>
          {" · "}
          <span className="font-mono">{member.dni ?? "sin DNI"}</span>
          {" · "}
          {CATEGORY_LABELS[member.category]}
        </p>
        <p className="flex items-center gap-3">
          <span className="flex items-center gap-1"><EmailIcon status={member.emailStatus} /></span>
          <span className="flex items-center gap-1"><DebitIcon on={member.autoDebit} /></span>
        </p>
      </CardContent>
    </Card>
  );
}
