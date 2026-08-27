import { describe, expect, it, vi } from "vitest";
import { fetchBookRows, fetchBooks } from "@/lib/members/books";

// Fila cruda como la devuelve Prisma: la membresía con su socio adentro.
function membership(over: {
  memberNumber: number;
  id?: number;
  fullName?: string;
  dni?: string | null;
  status?: string;
  category?: string;
  statusAtClose?: string | null;
  categoryAtClose?: string | null;
}) {
  return {
    memberNumber: over.memberNumber,
    statusAtClose: over.statusAtClose ?? null,
    categoryAtClose: over.categoryAtClose ?? null,
    member: {
      id: over.id ?? over.memberNumber,
      fullName: over.fullName ?? `Socio ${over.memberNumber}`,
      dni: over.dni === undefined ? "20000000" : over.dni,
      status: over.status ?? "active",
      category: over.category ?? "adherent",
    },
  };
}

const OPEN_BOOK = {
  id: 1,
  number: 1,
  status: "open",
  openedAt: new Date("2015-02-27T12:00:00Z"),
  closedAt: null,
  openingMinuteId: null,
  closingMinuteId: null,
  _count: { memberships: 2 },
};

const CLOSED_BOOK = {
  ...OPEN_BOOK,
  status: "closed",
  closedAt: new Date("2026-12-31T12:00:00Z"),
  closingMinuteId: 7,
};

function makeDb(book: unknown, rows: unknown[]) {
  const findUnique = vi.fn().mockResolvedValue(book);
  const findMany = vi.fn().mockResolvedValue(rows);
  return { db: { book: { findUnique }, membership: { findMany } } as never, findUnique, findMany };
}

describe("fetchBookRows", () => {
  it("returns null for a book number that does not exist", async () => {
    const { db, findMany } = makeDb(null, []);
    expect(await fetchBookRows(db, 99)).toBeNull();
    // Sin libro no se piden las filas: un 404 no cuesta una segunda consulta.
    expect(findMany).not.toHaveBeenCalled();
  });

  it("asks for the memberships of that book, ordered by member number", async () => {
    const { db, findMany } = makeDb(OPEN_BOOK, []);
    await fetchBookRows(db, 1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ book: { number: 1 } });
    expect(arg.orderBy).toEqual({ memberNumber: "asc" });
  });

  it("keeps the order the query returns and carries the summary of the book", async () => {
    const { db } = makeDb(OPEN_BOOK, [
      membership({ memberNumber: 3, fullName: "Perez, Ana" }),
      membership({ memberNumber: 14, fullName: "Gomez, Luis", dni: null }),
    ]);
    const result = await fetchBookRows(db, 1);
    expect(result?.book).toMatchObject({ id: 1, number: 1, status: "open", membershipCount: 2 });
    expect(result?.rows.map((r) => r.memberNumber)).toEqual([3, 14]);
    expect(result?.rows[1]).toMatchObject({ fullName: "Gomez, Luis", dni: null });
  });

  it("shows the LIVE status and category of an open book", async () => {
    const { db } = makeDb(OPEN_BOOK, [
      membership({ memberNumber: 1, status: "suspended", category: "active" }),
    ]);
    const result = await fetchBookRows(db, 1);
    expect(result?.rows[0]).toMatchObject({ status: "suspended", category: "active" });
  });

  it("prefers the closing snapshot when the membership has one", async () => {
    const { db } = makeDb(CLOSED_BOOK, [
      membership({
        memberNumber: 1,
        // Lo VIVO de la ficha cambió después de cerrar el libro…
        status: "withdrawn",
        category: "adherent",
        // …pero el libro cerrado tiene que seguir diciendo lo de aquel día.
        statusAtClose: "active",
        categoryAtClose: "active",
      }),
    ]);
    const result = await fetchBookRows(db, 1);
    expect(result?.rows[0]).toMatchObject({ status: "active", category: "active" });
  });

  it("falls back to the live values when a closed book has no snapshot yet", async () => {
    const { db } = makeDb(CLOSED_BOOK, [
      membership({ memberNumber: 1, status: "withdrawn", category: "adherent" }),
    ]);
    const result = await fetchBookRows(db, 1);
    expect(result?.rows[0]).toMatchObject({ status: "withdrawn", category: "adherent" });
    expect(result?.book).toMatchObject({ status: "closed", closingMinuteId: 7 });
  });
});

describe("fetchBooks", () => {
  it("lists the books newest first, with how many members each one holds", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { ...CLOSED_BOOK, id: 1, number: 1, _count: { memberships: 279 } },
    ]);
    const db = { book: { findMany } } as never;
    const books = await fetchBooks(db);
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ number: "desc" });
    expect(books).toEqual([
      {
        id: 1,
        number: 1,
        status: "closed",
        openedAt: CLOSED_BOOK.openedAt,
        closedAt: CLOSED_BOOK.closedAt,
        openingMinuteId: null,
        closingMinuteId: 7,
        membershipCount: 279,
      },
    ]);
  });
});
