// Consultas del Libro de Registro de Asociados: la lista de libros y las fichas
// asentadas en uno. El cliente de Prisma se INYECTA (regla del proyecto: un
// módulo puro no importa `@/lib/prisma`, que tira al evaluarse si falta
// DATABASE_URL y voltearía este test sin `.env`).
import type { MemberCategory, MemberStatus, PrismaClient } from "@/generated/prisma/client";

export type BooksDb = Pick<PrismaClient, "book" | "membership">;

export type BookSummary = {
  id: number;
  number: number;
  status: "open" | "closed";
  openedAt: Date;
  closedAt: Date | null;
  openingMinuteId: number | null;
  closingMinuteId: number | null;
  membershipCount: number;
};

// Lo único que las dos pantallas necesitan del libro. `_count` lo trae Prisma en
// la misma consulta: contar las membresías aparte serían N+1 consultas para una
// lista que se lee entera de un vistazo.
const BOOK_SELECT = {
  id: true,
  number: true,
  status: true,
  openedAt: true,
  closedAt: true,
  openingMinuteId: true,
  closingMinuteId: true,
  _count: { select: { memberships: true } },
} as const;

type RawBook = {
  id: number;
  number: number;
  status: "open" | "closed";
  openedAt: Date;
  closedAt: Date | null;
  openingMinuteId: number | null;
  closingMinuteId: number | null;
  _count: { memberships: number };
};

function toSummary(book: RawBook): BookSummary {
  const { _count, ...rest } = book;
  return { ...rest, membershipCount: _count.memberships };
}

// Del más nuevo al más viejo: el libro vigente es con el que se trabaja, y
// cuando haya tres o cuatro sigue quedando primero sin que nadie baje.
export async function fetchBooks(db: BooksDb): Promise<BookSummary[]> {
  const books = await db.book.findMany({ select: BOOK_SELECT, orderBy: { number: "desc" } });
  return (books as RawBook[]).map(toSummary);
}

export type BookRow = {
  memberNumber: number;
  memberId: number;
  fullName: string;
  dni: string | null;
  /** Libro abierto: estado/categoría VIVOS de la ficha.
   *  Libro cerrado: la FOTO (statusAtClose/categoryAtClose) — hasta que el
   *  cierre de libro escriba esas columnas, un libro cerrado sin foto cae a los
   *  vivos, que hoy es el camino real: sólo existe el Libro 1 y está abierto. */
  status: MemberStatus;
  category: MemberCategory;
};

export async function fetchBookRows(
  db: BooksDb,
  bookNumber: number,
): Promise<{ book: BookSummary; rows: BookRow[] } | null> {
  const book = await db.book.findUnique({ where: { number: bookNumber }, select: BOOK_SELECT });
  if (!book) return null;

  const memberships = await db.membership.findMany({
    where: { book: { number: bookNumber } },
    select: {
      memberNumber: true,
      statusAtClose: true,
      categoryAtClose: true,
      member: { select: { id: true, fullName: true, dni: true, status: true, category: true } },
    },
    orderBy: { memberNumber: "asc" },
  });

  return {
    book: toSummary(book as RawBook),
    // La foto gana por su sola PRESENCIA, sin mirar `book.status`: esas dos
    // columnas se escriben únicamente al cerrar el libro, así que tenerlas ya
    // significa "este libro está cerrado". Condicionar además por el estado del
    // libro sería una segunda fuente para el mismo hecho, y las dos podrían
    // contradecirse.
    rows: memberships.map((m) => ({
      memberNumber: m.memberNumber,
      memberId: m.member.id,
      fullName: m.member.fullName,
      dni: m.member.dni,
      status: m.statusAtClose ?? m.member.status,
      category: m.categoryAtClose ?? m.member.category,
    })),
  };
}
