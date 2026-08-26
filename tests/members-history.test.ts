import { describe, expect, it, vi } from "vitest";

import {
  fetchHistoryPage, HISTORY_PAGE_SIZE, parseHistoryFilters, reentryVerdict,
} from "@/lib/members/history";

// ── El veredicto de reingreso ─────────────────────────────────────────────────
//
// La pregunta que el mostrador hace todo el tiempo ("¿este señor puede volver a
// asociarse?") hoy se contesta cruzando a mano tres datos que viven en tres
// lugares. El ORDEN de evaluación es lo que codifica el estatuto, así que cada
// caso de abajo prueba también que el veredicto anterior GANA sobre el
// siguiente: sin eso, un expulsado con deuda saldada saldría "puede
// reasociarse" y la tabla seguiría pasando.
const NOW = new Date("2026-08-26T15:00:00Z");

function input(over: Partial<Parameters<typeof reentryVerdict>[0]> = {}) {
  return {
    status: "withdrawn" as const,
    reentryBlocked: false,
    withdrawalReason: null,
    rejectedUntil: null,
    pendingFees: 0,
    now: NOW,
    ...over,
  };
}

describe("reentryVerdict", () => {
  it("no aplica al socio vigente", () => {
    expect(reentryVerdict(input({ status: "active" }))).toEqual({ kind: "member" });
  });

  it("no aplica al suspendido: sigue siendo socio (REG-17)", () => {
    expect(reentryVerdict(input({ status: "suspended" }))).toEqual({ kind: "member" });
  });

  it("el vigente con deuda sigue siendo socio, no un caso de reingreso", () => {
    expect(reentryVerdict(input({ status: "active", pendingFees: 12 }))).toEqual({ kind: "member" });
  });

  // La pregunta del mostrador NO APLICA a una persona fallecida: la respuesta
  // no es "sí". Por eso sale antes que todos los bloqueos y no después.
  it("no aplica a la persona fallecida", () => {
    expect(reentryVerdict(input({ withdrawalReason: "death" }))).toEqual({ kind: "deceased" });
  });

  // El caso que prueba el ORDEN: si el fallecimiento se evaluara después de la
  // deuda, la pantalla le reclamaría al familiar del mostrador que salde 34
  // cuotas para reingresar.
  it("el fallecimiento gana sobre la deuda viva", () => {
    expect(reentryVerdict(input({ withdrawalReason: "death", pendingFees: 34 })))
      .toEqual({ kind: "deceased" });
  });

  it("bloquea para siempre al que tiene el flag de reingreso", () => {
    expect(reentryVerdict(input({ reentryBlocked: true }))).toEqual({ kind: "blocked_forever" });
  });

  // El doble criterio de `canReadmit` (rules.ts:45): hay fichas viejas con el
  // motivo de expulsión y el flag en `false`. Cualquiera de las dos señales
  // alcanza; si sólo mirara el flag, el expulsado importado a mano volvería a
  // pasar por la puerta.
  it("bloquea para siempre por el MOTIVO aunque el flag venga apagado", () => {
    expect(reentryVerdict(input({ withdrawalReason: "expulsion", reentryBlocked: false })))
      .toEqual({ kind: "blocked_forever" });
  });

  it("el bloqueo definitivo gana sobre el rechazo con fecha y sobre la deuda", () => {
    expect(reentryVerdict(input({
      withdrawalReason: "expulsion",
      rejectedUntil: new Date("2027-01-01T12:00:00Z"),
      pendingFees: 9,
    }))).toEqual({ kind: "blocked_forever" });
  });

  it("devuelve la fecha desde la que puede reintentar (REG-05)", () => {
    const until = new Date("2026-12-01T12:00:00Z");
    expect(reentryVerdict(input({ rejectedUntil: until }))).toEqual({ kind: "blocked_until", until });
  });

  it("el plazo de rechazo YA VENCIDO no bloquea nada", () => {
    expect(reentryVerdict(input({ rejectedUntil: new Date("2026-01-01T12:00:00Z") })))
      .toEqual({ kind: "clear" });
  });

  it("el plazo de rechazo vigente gana sobre la deuda", () => {
    const until = new Date("2026-12-01T12:00:00Z");
    expect(reentryVerdict(input({ rejectedUntil: until, pendingFees: 7 })))
      .toEqual({ kind: "blocked_until", until });
  });

  it("con deuda viva tiene que saldar antes de reingresar (REG-16)", () => {
    expect(reentryVerdict(input({ withdrawalReason: "arrears", pendingFees: 34 })))
      .toEqual({ kind: "must_settle" });
  });

  // REG-16: lo que bloquea es la deuda VIVA de la cuenta corriente. La marca
  // histórica `debtAtWithdrawal` dice que el socio tenía deuda el día de la
  // baja, no que la siga teniendo — por eso no es un dato de entrada de esta
  // función. Un cesante que pagó todo queda libre aunque la marca siga puesta.
  it("sin cuotas pendientes puede reasociarse aunque haya sido baja por mora", () => {
    expect(reentryVerdict(input({ withdrawalReason: "arrears", pendingFees: 0 })))
      .toEqual({ kind: "clear" });
  });

  it("la baja común sin deuda ni bloqueos puede reasociarse", () => {
    expect(reentryVerdict(input({ withdrawalReason: "resignation" }))).toEqual({ kind: "clear" });
  });
});

// ── Filtros ───────────────────────────────────────────────────────────────────

describe("parseHistoryFilters", () => {
  it("se queda sólo con los valores conocidos", () => {
    expect(parseHistoryFilters({ q: "castillo", status: "withdrawn", reason: "arrears" }))
      .toEqual({ q: "castillo", status: "withdrawn", reason: "arrears" });
  });

  it("descarta un estado o un motivo que no existen", () => {
    expect(parseHistoryFilters({ status: "vigentes", reason: "mora" })).toEqual({});
  });

  it("recorta la búsqueda y descarta la que quedó vacía", () => {
    expect(parseHistoryFilters({ q: "  Perez  " })).toEqual({ q: "Perez" });
    expect(parseHistoryFilters({ q: "   " })).toEqual({});
  });

  it("toma el primer valor cuando el querystring repite la clave", () => {
    expect(parseHistoryFilters({ status: ["withdrawn", "active"] })).toEqual({ status: "withdrawn" });
  });
});

// ── La página del histórico ───────────────────────────────────────────────────

function member(over: Record<string, unknown> = {}) {
  return {
    id: 284,
    fullName: "Castillo Nestor",
    dni: "28456757",
    category: "active",
    status: "withdrawn",
    withdrawalReason: "arrears",
    leftAt: new Date("2025-08-31T12:00:00Z"),
    joinedAt: new Date("2015-02-27T12:00:00Z"),
    rejectedUntil: null,
    reentryBlocked: false,
    memberships: [{ memberNumber: 1, book: { number: 1 } }],
    _count: { fees: 34 },
    ...over,
  };
}

function makeDb(rows: unknown[], total = rows.length) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const count = vi.fn().mockResolvedValue(total);
  return { db: { member: { findMany, count } } as never, findMany, count };
}

describe("fetchHistoryPage", () => {
  it("consulta desde Member, sin exigir membresía en el libro abierto", async () => {
    const { db, findMany } = makeDb([]);
    await fetchHistoryPage(db, {}, 1);
    // Sin filtros el `where` no recorta nada: el histórico incluye a los que
    // quedaron en libros cerrados y a los que todavía no fueron asentados en el
    // abierto (el lapso del cierre de libro, `electoral.ts:56-63`).
    expect(findMany.mock.calls[0][0].where).toEqual({});
  });

  it("cuenta la deuda viva en la MISMA consulta, no una por socio", async () => {
    const { db, findMany } = makeDb([member()]);
    const { rows } = await fetchHistoryPage(db, {}, 1);
    expect(findMany.mock.calls[0][0].select._count)
      .toEqual({ select: { fees: { where: { status: "pending" } } } });
    expect(rows[0].pendingFees).toBe(34);
  });

  it("aplana las membresías a libro + número", async () => {
    const { db } = makeDb([member({
      memberships: [
        { memberNumber: 1, book: { number: 1 } },
        { memberNumber: 4, book: { number: 2 } },
      ],
    })]);
    const { rows } = await fetchHistoryPage(db, {}, 1);
    expect(rows[0].memberships).toEqual([
      { bookNumber: 1, memberNumber: 1 },
      { bookNumber: 2, memberNumber: 4 },
    ]);
  });

  it("busca por nombre O por DNI", async () => {
    const { db, findMany } = makeDb([]);
    await fetchHistoryPage(db, { q: "castillo" }, 1);
    expect(findMany.mock.calls[0][0].where.OR).toEqual([
      { fullName: { contains: "castillo" } },
      { dni: { contains: "castillo" } },
    ]);
  });

  it("cruza la búsqueda con los demás filtros en vez de reemplazarlos", async () => {
    const { db, findMany } = makeDb([]);
    await fetchHistoryPage(db, { q: "perez", status: "withdrawn", reason: "expulsion" }, 1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe("withdrawn");
    expect(where.withdrawalReason).toBe("expulsion");
    expect(where.OR).toHaveLength(2);
  });

  it("cuenta el total con el MISMO where que las filas", async () => {
    const { db, findMany, count } = makeDb([], 118);
    const { total } = await fetchHistoryPage(db, { status: "withdrawn" }, 1);
    expect(total).toBe(118);
    expect(count.mock.calls[0][0].where).toEqual(findMany.mock.calls[0][0].where);
  });

  it("ordena por nombre con el id de desempate: sin él, dos homónimos se mueven entre páginas", async () => {
    const { db, findMany } = makeDb([]);
    await fetchHistoryPage(db, {}, 1);
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ fullName: "asc" }, { id: "asc" }]);
  });

  it("pagina de a 50 y saltea las páginas anteriores", async () => {
    const { db, findMany } = makeDb([], 279);
    const page = await fetchHistoryPage(db, {}, 3);
    expect(findMany.mock.calls[0][0].skip).toBe(2 * HISTORY_PAGE_SIZE);
    expect(findMany.mock.calls[0][0].take).toBe(HISTORY_PAGE_SIZE);
    expect(page).toMatchObject({ page: 3, pageCount: 6 });
  });

  it("acota una página pedida más allá del final", async () => {
    const { db, findMany } = makeDb([], 279);
    const page = await fetchHistoryPage(db, {}, 99);
    expect(page.page).toBe(6);
    expect(findMany.mock.calls[0][0].skip).toBe(5 * HISTORY_PAGE_SIZE);
  });

  it("la lista vacía es la página 1 de 1, nunca 'página 1 de 0'", async () => {
    const { db } = makeDb([], 0);
    expect(await fetchHistoryPage(db, { q: "nadie" }, 1)).toMatchObject({ page: 1, pageCount: 1, total: 0 });
  });
});
