// Listado de cuentas de acceso (módulo de usuarios). Mismo molde que
// /admin/socios: chips segmentados que filtran EXACTAMENTE lo que cuentan,
// búsqueda GET plana, tabla en desktop (`hidden md:block`) y una tarjeta por
// cuenta en móvil (`md:hidden`).
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { pageHref } from "@/lib/admin/pagination";
import { userAccountBadgeVariant, userRoleBadgeVariant } from "@/lib/admin/status-badges";
import { requireSuperadminUsers } from "@/lib/auth/require-admin";
import { formatDateAR } from "@/lib/format";
import { ACCOUNT_STATE_LABELS, ROLE_LABELS } from "@/lib/users/labels";
import {
  fetchUserCounts, fetchUsersPage, parseUserFilters,
  type UserChip, type UserListFilters, type UserRow,
} from "@/lib/users/query";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = { title: "Usuarios — SIGeV" };

const BASE = "/admin/usuarios";

const CHIP_BASE =
  "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_ACTIVE = "bg-background text-foreground shadow-sm";
const CHIP_INACTIVE = "text-muted-foreground hover:text-foreground";

const CHIPS: { key: UserChip; label: string; href: string }[] = [
  { key: "gestion", label: "Gestión", href: `${BASE}?vista=gestion` },
  { key: "socios", label: "Socios", href: `${BASE}?vista=socios` },
  { key: "inactivas", label: "Inactivas", href: `${BASE}?vista=inactivas` },
  { key: "todas", label: "Todas", href: BASE },
];

function activeChip(f: UserListFilters): UserChip {
  return f.vista ?? "todas";
}

export default async function UsuariosPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) {
    // Pantalla de bloqueo, no redirect: el rebote /ingresar → /redirigir →
    // /admin marearía a un admin común con sesión válida (molde Configuración).
    return (
      <div className="space-y-4">
        <PageHeader title="Usuarios" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const filters = parseUserFilters(sp);
  const [{ rows, total, page, pageCount, pageSize }, counts] = await Promise.all([
    fetchUsersPage(prisma, filters, sp),
    fetchUserCounts(prisma),
  ]);
  const hasFilters = Object.keys(filters).length > 0;
  const chip = activeChip(filters);
  const firstShown = (page - 1) * pageSize + 1;
  const lastShown = (page - 1) * pageSize + rows.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Usuarios"
        actions={
          <Button asChild className="min-h-11">
            <Link href={`${BASE}/nuevo`}>Nuevo usuario de gestión</Link>
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          Cuentas de acceso al panel y al portal de socios: roles de gestión, invitaciones y estado.
        </p>
      </PageHeader>

      {/* Los chips son LINKS: el filtro queda en la URL y se comparte, se
          recarga y se vuelve con el botón atrás. Cada uno filtra exactamente lo
          que cuenta (el `where` es el mismo de `fetchUserCounts`). */}
      <nav
        aria-label="Vistas de las cuentas"
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

      <form className="flex flex-wrap items-end gap-2" method="get">
        {/* La vista activa sobrevive a la búsqueda. */}
        {filters.vista && <input type="hidden" name="vista" value={filters.vista} />}
        <Input
          name="q"
          placeholder="Nombre o email"
          defaultValue={filters.q ?? ""}
          aria-label="Nombre o email"
          className="w-full sm:w-56"
        />
        <Button type="submit" variant="secondary" className="min-h-11">Buscar</Button>
      </form>

      {total === 0 ? (
        <EmptyState
          size="list"
          description={
            hasFilters
              ? "Ninguna cuenta coincide con esta vista o búsqueda."
              : "Todavía no hay cuentas de acceso."
          }
          action={
            hasFilters
              ? <Button asChild variant="outline"><Link href={BASE}>Limpiar filtros</Link></Button>
              : undefined
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {`${firstShown}–${lastShown} de ${total} cuentas`}
            {pageCount > 1 && ` · página ${page} de ${pageCount}`}
          </p>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Último ingreso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link className={INLINE_LINK} href={`${BASE}/${row.id}`}>
                        {row.name ?? row.email}
                      </Link>
                    </TableCell>
                    <TableCell className="break-all">{row.email}</TableCell>
                    <TableCell><RoleBadges roles={row.roles} /></TableCell>
                    <TableCell>
                      <Badge variant={userAccountBadgeVariant(row.state)}>
                        {ACCOUNT_STATE_LABELS[row.state]}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {row.lastLoginAt ? formatDateAR(row.lastLoginAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* La tabla no se scrollea de costado en el teléfono: la misma fila se
              vuelve una tarjeta. */}
          <div className="space-y-3 md:hidden">
            {rows.map((row) => <UserCard key={row.id} row={row} />)}
          </div>
        </>
      )}

      <PaginationNav
        page={page}
        pageCount={pageCount}
        href={(n) => pageHref(BASE, filters as Record<string, string | undefined>, n)}
        label="Páginas de cuentas"
      />
    </div>
  );
}

function RoleBadges({ roles }: { roles: string[] }) {
  if (roles.length === 0) return <span className="text-sm text-muted-foreground">Sin roles</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {roles.map((r) => (
        <Badge key={r} variant={userRoleBadgeVariant(r)}>{ROLE_LABELS[r] ?? r}</Badge>
      ))}
    </span>
  );
}

function UserCard({ row }: { row: UserRow }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <Link className={INLINE_LINK} href={`${BASE}/${row.id}`}>{row.name ?? row.email}</Link>
          <Badge variant={userAccountBadgeVariant(row.state)}>
            {ACCOUNT_STATE_LABELS[row.state]}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-sm break-all text-muted-foreground">{row.email}</p>
        <RoleBadges roles={row.roles} />
      </CardContent>
    </Card>
  );
}
