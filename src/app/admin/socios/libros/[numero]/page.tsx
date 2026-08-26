// El libro asentado, entero. No hay filtros ni paginación a propósito: un libro
// de registro se lee de corrido y se exporta completo — es el documento que la
// asociación presenta ante la IGJ, no una bandeja de trabajo.
//
// Dos presentaciones de las MISMAS filas, igual que el padrón: tabla en desktop
// y una tarjeta por socio en móvil. Una tabla de 5 columnas en 375px se lee
// empujando la pantalla de costado.
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/require-admin";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { formatDateAR } from "@/lib/format";
import { fetchBookRows, type BookRow } from "@/lib/members/books";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata = { title: "Libro — SIGeV" };

export default async function LibroPage(props: { params: Promise<{ numero: string }> }) {
  // Guarda propia, como el listado de Libros: la pantalla muestra nombres, DNIs
  // y números de socio (Ley 25.326), y el rol del token puede estar hasta 8 h
  // desactualizado.
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Libro" breadcrumb={[{ label: "Libros", href: "/admin/socios/libros" }]} />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const { numero } = await props.params;
  // El número llega de la URL: con "abc" o "1e9" Number() da NaN/no entero y
  // Prisma tiraría un error técnico en inglés en vez de un 404.
  const bookNumber = Number(numero);
  if (!Number.isInteger(bookNumber) || bookNumber <= 0) notFound();

  const result = await fetchBookRows(prisma, bookNumber);
  if (!result) notFound();
  const { book, rows } = result;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Libro N° ${book.number}`}
        breadcrumb={[
          { label: "Socios", href: "/admin/socios" },
          { label: "Libros", href: "/admin/socios/libros" },
          { label: `Libro ${book.number}` },
        ]}
        actions={
          // `<a>` y no `<Link>`: es una descarga, no una navegación del router.
          <Button asChild variant="outline">
            <a href={`/api/admin/libros/${book.number}/export`}>Exportar Excel</a>
          </Button>
        }
      />

      {/* Un libro cerrado es una foto: lo que se lee no sigue a la ficha viva
          del socio (REG-36). Decirlo evita que el operador crea que la pantalla
          quedó desactualizada. */}
      {book.status === "closed" && (
        <FormMessage kind="neutral" box>
          {`Este libro está cerrado: lo que ves es la foto al ${
            book.closedAt ? formatDateAR(book.closedAt) : "cierre"
          }.`}
        </FormMessage>
      )}

      {rows.length === 0 ? (
        // Nunca un thead sin filas. Imposible en la práctica: un libro se abre
        // con socios adentro.
        <EmptyState size="list" description="Este libro no tiene ningún socio asentado." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono tabular-nums">{rows.length}</span>
            {rows.length === 1 ? " socio asentado" : " socios asentados"}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.memberId}>
                    <TableCell className="font-mono tabular-nums">{row.memberNumber}</TableCell>
                    <TableCell>
                      {/* La ficha es la del socio HOY, aunque el libro sea una
                          foto: es la misma persona (REG-29). */}
                      <Link className={INLINE_LINK} href={`/admin/socios/${row.memberId}`}>
                        {row.fullName}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono">{row.dni ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{CATEGORY_LABELS[row.category]}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={memberStatusBadgeVariant(row.status)}>
                        {STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {rows.map((row) => <BookRowCard key={row.memberId} row={row} />)}
          </div>
        </>
      )}
    </div>
  );
}

// Molde `MemberCard` del padrón: el `flex-wrap … justify-between` deja caer el
// badge abajo cuando el nombre no entra, en vez de empujar la tarjeta de costado.
function BookRowCard({ row }: { row: BookRow }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <Link className={INLINE_LINK} href={`/admin/socios/${row.memberId}`}>{row.fullName}</Link>
          <Badge variant={memberStatusBadgeVariant(row.status)}>{STATUS_LABELS[row.status]}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          N° <span className="font-mono tabular-nums">{row.memberNumber}</span>
          {" · "}
          <span className="font-mono">{row.dni ?? "sin DNI"}</span>
          {" · "}
          {CATEGORY_LABELS[row.category]}
        </p>
      </CardContent>
    </Card>
  );
}
