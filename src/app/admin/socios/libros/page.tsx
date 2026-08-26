// Pestaña "Libros": el Libro de Registro de Asociados, que es el documento
// estatutario que la asociación presenta ante la IGJ. Hoy hay uno solo (el
// Libro N° 1, abierto), y hasta esta pantalla no había forma de verlo desde el
// panel: se sabía que existía porque el padrón filtraba por él.
//
// Una tarjeta por libro y nada más — no es una lista que crezca (un libro dura
// años), así que no lleva filtros, buscador ni paginación.
import Link from "next/link";
import { BookMarked } from "lucide-react";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/require-admin";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { formatDateAR } from "@/lib/format";
import { fetchBooks, type BookSummary } from "@/lib/members/books";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata = { title: "Libros — SIGeV" };

// Un renglón del `<dl>`: la fecha, y el acta que la respalda cuando la hay. El
// libro importado (el N° 1) no tiene acta de apertura cargada, así que el link
// tiene que poder faltar sin dejar un hueco raro.
function BookDate({ label, date, minuteId }: {
  label: string;
  date: Date | null;
  minuteId: number | null;
}) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="text-sm">
        {date ? formatDateAR(date) : "—"}
        {minuteId !== null && (
          <>
            {" · "}
            <Link className={INLINE_LINK} href={`/admin/actas/${minuteId}`}>Ver acta</Link>
          </>
        )}
      </dd>
    </div>
  );
}

function BookCard({ book }: { book: BookSummary }) {
  const open = book.status === "open";
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="flex items-center gap-2">
            <BookMarked className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {/* El número del libro NO va en mono: `tabular-nums` le mete el
                ancho de una cifra de más y en el título se lee como un hueco
                entre "N°" y el número (mismo tropiezo que documenta la tarjeta
                del padrón). Es un dígito, no una columna que alinear. */}
            Libro N° {book.number}
          </span>
          {/* Un libro abierto es el que está en uso: se ve de lejos. El cerrado
              es un documento terminado, no una alarma — gris, nunca rojo. */}
          <Badge variant={open ? "success" : "secondary"}>{open ? "Abierto" : "Cerrado"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-3">
          <BookDate label="Apertura" date={book.openedAt} minuteId={book.openingMinuteId} />
          <BookDate label="Cierre" date={book.closedAt} minuteId={book.closingMinuteId} />
        </dl>
        <p className="text-sm text-muted-foreground">
          {/* Sólo el número va en mono, como en las tarjetas del padrón: con la
              palabra adentro el espacio queda tabulado y se abre un hueco. */}
          <span className="font-mono tabular-nums">{book.membershipCount}</span>
          {book.membershipCount === 1 ? " asentado" : " asentados"}
        </p>
        <Button asChild variant="outline">
          <Link href={`/admin/socios/libros/${book.number}`}>Ver libro</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default async function LibrosPage() {
  // La pantalla se autoriza a sí misma aunque `admin/layout.tsx` ya bloquee, por
  // el mismo motivo que la bandeja de solicitudes: el libro es el registro de
  // socios (nombres y números — Ley 25.326) y `requireAdmin` resuelve contra la
  // fila viva de `User`, mientras que el layout mira el token, que puede estar
  // hasta 8 h desactualizado tras una degradación de rol.
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Libros" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const books = await fetchBooks(prisma);

  return (
    <div className="space-y-4">
      <PageHeader title="Libros" />
      {books.length === 0 ? (
        // Imposible en la práctica —el Libro 1 vino con el padrón importado—,
        // pero una lista vacía nunca se dibuja como una grilla sin tarjetas.
        <EmptyState size="list" description="Todavía no hay ningún libro abierto." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {books.map((book) => <BookCard key={book.id} book={book} />)}
        </div>
      )}
    </div>
  );
}
