import { describe, expect, it, vi } from "vitest";
import {
  fetchPadron, fetchPadronCounts, fetchPadronPage, PADRON_PAGE_SIZE, padronWhere,
  parsePadronFilters, parsePadronPage,
} from "@/lib/members/query";

describe("parsePadronFilters", () => {
  it("keeps only known values", () => {
    expect(parsePadronFilters({ q: "perez", category: "adherent", status: "nope", email: "sin", dni: "con" }))
      .toEqual({ q: "perez", category: "adherent", email: "sin", dni: "con" });
  });
});

describe("padronWhere", () => {
  it("always scopes to the open book", () => {
    expect(padronWhere({})).toMatchObject({ book: { status: "open" } });
  });
  it("searches by name, dni or member number", () => {
    const w = padronWhere({ q: "123" });
    expect(JSON.stringify(w)).toContain("123");
    expect(JSON.stringify(w)).toContain("memberNumber");
  });
  it("maps email filter", () => {
    expect(JSON.stringify(padronWhere({ email: "verificado" }))).toContain("verified");
    expect(JSON.stringify(padronWhere({ email: "sin" }))).toContain("none");
  });
});

describe("fetchPadron", () => {
  // El export a Excel (Task 16) necesita el nombre de la calle de catálogo, no
  // sólo el streetId: si esta relación se deja de traer, `member.street` vuelve
  // a ser `undefined` y el domicilio de los socios del barrio se exporta vacío
  // en silencio.
  it("includes the catalog street relation on member", async () => {
    const findMany = vi.fn(async () => []);
    const db = { membership: { findMany } } as never;
    await fetchPadron(db, {});
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { member: { include: { street: true } } } }),
    );
  });
});

// ── Paginación (Brecha 3) ─────────────────────────────────────────────────────
//
// El listado pagina; el export a Excel NO. Los dos comparten `padronWhere`, pero
// NO pueden compartir el `skip`/`take`: si la paginación se metiera adentro de
// `fetchPadron`, el archivo que la asociación presenta como padrón saldría con
// las primeras 50 filas y sin ninguna señal de que falta el resto. Por eso son
// dos funciones, y por eso el primer test de acá vigila que `fetchPadron` siga
// sin paginar.
describe("fetchPadron — nunca pagina", () => {
  it("never sends skip/take: the Excel export shares this function and needs every row", async () => {
    const findMany = vi.fn<(args: Record<string, unknown>) => Promise<never[]>>(async () => []);
    const db = { membership: { findMany } } as never;
    await fetchPadron(db, {});
    const [arg] = findMany.mock.calls[0] ?? [{}];
    expect(arg).not.toHaveProperty("skip");
    expect(arg).not.toHaveProperty("take");
  });
});

describe("parsePadronPage", () => {
  it("defaults to page 1 and ignores junk", () => {
    expect(parsePadronPage({})).toBe(1);
    expect(parsePadronPage({ page: "abc" })).toBe(1);
    expect(parsePadronPage({ page: "0" })).toBe(1);
    expect(parsePadronPage({ page: "-3" })).toBe(1);
    expect(parsePadronPage({ page: "4" })).toBe(4);
  });
});

describe("parsePadronFilters — la página no es un filtro", () => {
  // El link de "Exportar Excel" se arma con los filtros. Si `page` entrara ahí,
  // volvería a acoplar el archivo al listado por la puerta de atrás.
  it("does not absorb the page number", () => {
    expect(parsePadronFilters({ q: "perez", page: "3" })).toEqual({ q: "perez" });
  });
});

describe("fetchPadronPage", () => {
  function fakeDb(total: number) {
    const count = vi.fn<(args: Record<string, unknown>) => Promise<number>>(async () => total);
    const findMany = vi.fn<(args: Record<string, unknown>) => Promise<never[]>>(async () => []);
    return { db: { membership: { count, findMany } } as never, count, findMany };
  }

  it("asks only for the requested slice, with the same filters as the export", async () => {
    const { db, findMany, count } = fakeDb(283);
    const res = await fetchPadronPage(db, { status: "active" }, 3);
    expect(count).toHaveBeenCalledWith({ where: padronWhere({ status: "active" }) });
    const [arg] = findMany.mock.calls[0] ?? [{}];
    expect(arg.where).toEqual(padronWhere({ status: "active" }));
    expect(arg.skip).toBe(2 * PADRON_PAGE_SIZE);
    expect(arg.take).toBe(PADRON_PAGE_SIZE);
    expect(res.total).toBe(283);
    expect(res.page).toBe(3);
    expect(res.pageCount).toBe(Math.ceil(283 / PADRON_PAGE_SIZE));
  });

  it("keeps the catalog street relation the export depends on", async () => {
    const { db, findMany } = fakeDb(1);
    await fetchPadronPage(db, {}, 1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { member: { include: { street: true } } } }),
    );
  });

  // Un `?page=99` tipeado a mano (o un filtro que achica el padrón mientras se
  // navega) no puede devolver una tabla vacía sin explicación.
  it("clamps a page beyond the end back to the last one", async () => {
    const { db, findMany } = fakeDb(60);
    const res = await fetchPadronPage(db, {}, 99);
    expect(res.page).toBe(2);
    expect((findMany.mock.calls[0] ?? [{}])[0].skip).toBe(PADRON_PAGE_SIZE);
  });

  it("reports one empty page when nothing matches", async () => {
    const { db, findMany } = fakeDb(0);
    const res = await fetchPadronPage(db, { q: "nadie" }, 1);
    expect(res).toMatchObject({ total: 0, page: 1, pageCount: 1, rows: [] });
    expect((findMany.mock.calls[0] ?? [{}])[0].skip).toBe(0);
  });
});

// ── Resumen del libro abierto (chips del listado) ─────────────────────────────
//
// Los cinco números se leen como un DESGLOSE ("160 vigentes = 36 activos + 124
// adherentes"), y por eso el groupBy cruza estado × categoría en vez de contar
// cada eje por separado: con dos conteos sueltos, "Activos" se llevaría también
// a las bajas de categoría activa y la suma dejaría de cerrar.
describe("fetchPadronCounts", () => {
  type Group = { status: string; category: string; _count: number };
  function fakeDb(groups: Group[]) {
    const groupBy = vi.fn<(args: Record<string, unknown>) => Promise<Group[]>>(async () => groups);
    return { db: { member: { groupBy } } as never, groupBy };
  }

  it("counts the open book once, crossing status and category", async () => {
    const { db, groupBy } = fakeDb([]);
    await fetchPadronCounts(db);
    expect(groupBy).toHaveBeenCalledTimes(1);
    const [arg] = groupBy.mock.calls[0] ?? [{}];
    expect(arg.by).toEqual(["status", "category"]);
    // El resumen es del libro ABIERTO: sin este `where`, los socios que
    // quedaron en libros cerrados sumarían en los chips del padrón vigente.
    expect(arg.where).toEqual({ memberships: { some: { book: { status: "open" } } } });
  });

  it("derives the five numbers: vigentes = active + suspended, and the breakdown lives inside them", async () => {
    const { db } = fakeDb([
      { status: "active", category: "active", _count: 36 },
      { status: "active", category: "adherent", _count: 122 },
      { status: "suspended", category: "adherent", _count: 2 },
      { status: "withdrawn", category: "active", _count: 40 },
      { status: "withdrawn", category: "adherent", _count: 78 },
    ]);
    expect(await fetchPadronCounts(db)).toEqual({
      vigentes: 160, activos: 36, adherentes: 124, suspendidos: 2, bajas: 118,
    });
  });

  it("ignores categories that are neither active nor adherent, without losing them from vigentes", async () => {
    const { db } = fakeDb([
      { status: "active", category: "honorary", _count: 3 },
      { status: "suspended", category: "cadet", _count: 1 },
    ]);
    expect(await fetchPadronCounts(db)).toEqual({
      vigentes: 4, activos: 0, adherentes: 0, suspendidos: 1, bajas: 0,
    });
  });

  it("reports zeros on an empty book instead of throwing", async () => {
    const { db } = fakeDb([]);
    expect(await fetchPadronCounts(db)).toEqual({
      vigentes: 0, activos: 0, adherentes: 0, suspendidos: 0, bajas: 0,
    });
  });
});
