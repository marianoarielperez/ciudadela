import { describe, expect, it, vi } from "vitest";
import {
  APPLICATIONS_PAGE_SIZE, applicationsWhere, makeApplicationQueries,
  parseApplicationFilters, parseApplicationsPage, showsReentryBadge,
} from "@/lib/applications/query";

describe("parseApplicationFilters", () => {
  it("acepta estados válidos y descarta basura", () => {
    expect(parseApplicationFilters({ status: "pending_board" })).toEqual({ status: "pending_board" });
    expect(parseApplicationFilters({ status: "nope" })).toEqual({});
  });

  it("recorta la búsqueda y descarta la que queda vacía", () => {
    expect(parseApplicationFilters({ q: "  pérez  " })).toEqual({ q: "pérez" });
    expect(parseApplicationFilters({ q: "   " })).toEqual({});
    expect(parseApplicationFilters({})).toEqual({});
  });

  // Next entrega `string[]` cuando el parámetro viene repetido (`?q=a&q=b`), y
  // un array llegaría entero al `where` de Prisma. Se toma la primera ocurrencia,
  // igual que `parsePadronFilters`.
  it("toma el primer valor cuando el parámetro viene repetido", () => {
    expect(parseApplicationFilters({ q: ["301", "999"], status: ["started", "rejected"] }))
      .toEqual({ q: "301", status: "started" });
  });

  it("acepta los siete estados del enum", () => {
    for (const status of [
      "started", "pending_payment", "approved_pending_minute", "pending_board",
      "completed", "rejected", "expired",
    ]) {
      expect(parseApplicationFilters({ status })).toEqual({ status });
    }
  });
});

describe("applicationsWhere", () => {
  it("sin filtros no restringe nada", () => {
    expect(applicationsWhere({})).toEqual({});
  });

  it("q numérica busca por DNI con prefijo; q de texto por nombre", () => {
    expect(applicationsWhere({ q: "301" })).toEqual({ dni: { startsWith: "301" } });
    expect(applicationsWhere({ q: "pérez" })).toEqual({ fullName: { contains: "pérez" } });
  });

  it("el OR de búsqueda convive con el filtro de estado", () => {
    expect(applicationsWhere({ q: "301", status: "started" })).toEqual({
      dni: { startsWith: "301" }, status: "started",
    });
  });

  it("un DNI parcial con puntos no se toma como número", () => {
    // "30.111.222" no es \d+: cae en la rama de nombre y no devuelve nada, que es
    // preferible a mandar los puntos a un startsWith de DNI (que tampoco matchea).
    expect(applicationsWhere({ q: "30.111.222" })).toEqual({ fullName: { contains: "30.111.222" } });
  });
});

describe("parseApplicationsPage", () => {
  it("cae a 1 con basura, vacío o números no positivos", () => {
    expect(parseApplicationsPage({})).toBe(1);
    expect(parseApplicationsPage({ page: "abc" })).toBe(1);
    expect(parseApplicationsPage({ page: "0" })).toBe(1);
    expect(parseApplicationsPage({ page: "-3" })).toBe(1);
    expect(parseApplicationsPage({ page: "1.5" })).toBe(1);
  });

  it("honra una página válida, incluso repetida", () => {
    expect(parseApplicationsPage({ page: "3" })).toBe(3);
    expect(parseApplicationsPage({ page: ["2", "9"] })).toBe(2);
  });
});

describe("makeApplicationQueries.fetchPage", () => {
  type Args = Record<string, unknown>;
  function db(rows: unknown[], total: number) {
    const findMany = vi.fn<(args: Args) => Promise<unknown[]>>(async () => rows);
    const count = vi.fn<(args: Args) => Promise<number>>(async () => total);
    return { db: { application: { findMany, count } } as never, findMany, count };
  }

  it("pagina con el mismo where que cuenta, y ordena por fecha descendente", async () => {
    const { db: client, findMany, count } = db([], 120);
    await makeApplicationQueries(client).fetchPage({ status: "pending_board" }, 2);

    const [arg] = findMany.mock.calls[0];
    expect(arg.where).toEqual({ status: "pending_board" });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.skip).toBe(APPLICATIONS_PAGE_SIZE);
    expect(arg.take).toBe(APPLICATIONS_PAGE_SIZE);
    expect(count.mock.calls[0][0].where).toEqual({ status: "pending_board" });
  });

  // La bandeja muestra el DNI y el nombre, pero NO tiene por qué traerse el
  // domicilio, el teléfono ni el hash del token de retome: `select` explícito.
  it("selecciona sólo las columnas que la tabla muestra", async () => {
    const { db: client, findMany } = db([], 0);
    await makeApplicationQueries(client).fetchPage({}, 1);

    const select = findMany.mock.calls[0][0].select as Record<string, unknown>;
    expect(Object.keys(select).sort()).toEqual([
      "createdAt", "dni", "emailVerifiedAt", "fullName", "id", "memberId",
      "requestedCategory", "status", "wantsDebit",
    ]);
    expect(select).not.toHaveProperty("resumeTokenHash");
    expect(select).not.toHaveProperty("ip");
  });

  // Un `?page=99` tipeado a mano —o un filtro que achica la bandeja mientras se
  // navega— devolvería una tabla vacía sin explicar por qué. Se acota al final,
  // igual que el padrón (`fetchPadronPage`).
  it("acota una página más allá del final y nunca dice 'página 1 de 0'", async () => {
    const { db: client, findMany } = db([], 3);
    const empty = await makeApplicationQueries(client).fetchPage({}, 99);
    expect(empty.page).toBe(1);
    expect(empty.pageCount).toBe(1);
    expect(findMany.mock.calls[0][0].skip).toBe(0);

    const { db: c2 } = db([], 0);
    const none = await makeApplicationQueries(c2).fetchPage({}, 1);
    expect(none.pageCount).toBe(1);
    expect(none.total).toBe(0);
  });

  it("devuelve el total del filtro, no el de la página", async () => {
    const { db: client } = db([{ id: 1 }], 120);
    const res = await makeApplicationQueries(client).fetchPage({}, 1);
    expect(res.total).toBe(120);
    expect(res.pageCount).toBe(3);
    expect(res.pageSize).toBe(APPLICATIONS_PAGE_SIZE);
    expect(res.rows).toHaveLength(1);
  });
});

// El asiento le escribe `memberId` a TODA solicitud que completa (contrato de la
// Task 15: de ahí cuelga la verificación tardía de email), así que después del
// asiento ese campo NO distingue un alta de un reingreso. La bandeja llegó a
// mostrar "Alta completada · Reingreso" sobre una solicitud que acababa de CREAR
// al socio que decía estar readmitiendo — en la pantalla con la que la Comisión
// prepara el acta.
describe("showsReentryBadge", () => {
  it("una solicitud viva con ficha matcheada SÍ es un reingreso por venir (REG-25)", () => {
    for (const status of ["pending_payment", "approved_pending_minute", "pending_board"] as const) {
      expect(showsReentryBadge({ status, memberId: 99 })).toBe(true);
    }
  });

  it("sin ficha matcheada nunca", () => {
    expect(showsReentryBadge({ status: "pending_board", memberId: null })).toBe(false);
  });

  // Asentada, la bandeja no puede afirmarlo con esta fila: la señal real es el
  // Movement (`admission` vs `readmission`) y eso es una consulta por fila. El
  // detalle la hace; el listado se calla.
  it("una vez asentada, la bandeja no lo afirma", () => {
    expect(showsReentryBadge({ status: "completed", memberId: 306 })).toBe(false);
  });

  it("el rechazo conserva la señal: ahí `memberId` sigue siendo la ficha matcheada", () => {
    expect(showsReentryBadge({ status: "rejected", memberId: 99 })).toBe(true);
  });
});
