// Task 17 (6C): la transacción que CIERRA el Libro de Registro de Asociados y
// abre el siguiente. Es el acto más delicado del módulo: irreversible salvo
// restaurando un backup, y los números que salen de acá son los números de
// socio definitivos del libro nuevo.
//
// Lo que se fija:
//   - que la transacción RE-VALIDE adentro: un bloqueo aparecido después de la
//     vista previa aborta el cierre entero y no escribe nada;
//   - que la numeración nueva sea EXACTAMENTE la de `planMigration` (densa,
//     por antigüedad) y que una numeración rota no llegue a la base;
//   - que el libro nuevo sea `número + 1` del que cierra — con el Libro 2
//     cerrándose, se abre el 3: el operador repite esto en dos años;
//   - que la foto alcance a TODAS las membresías del libro viejo, bajas
//     históricas incluidas;
//   - que `joinedAt` no se toque: la antigüedad es de la persona, no del libro;
//   - que la configuración del proceso quede limpia;
//   - que dos operadores apretando "cerrar" a la vez terminen con UN solo
//     libro nuevo y un error legible para el segundo.
//
// El doble de base HONRA LITERALMENTE las condiciones que recibe —la lección
// que esta rama pagó dos veces—: los `where` se evalúan de verdad contra las
// filas, los uniques del schema se hacen cumplir, y un `where` con una forma
// que el doble no entiende REVIENTA en vez de devolver de más o de menos.
// `@/lib/prisma` se mockea porque el módulo exporta también su singleton
// (mismo criterio que `withdrawals.ts` y `board/notice.ts`).
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import type { MemberCategory, MemberStatus, PresentationStatus } from "@/generated/prisma/client";
import { civilDateUtc } from "@/lib/dates";
import { CONFIG_KEYS } from "@/lib/config-keys";
import { assertDensePlan, makeCloseBook } from "@/lib/reregistration/close-book";
import type { MigrationEntry } from "@/lib/reregistration/close";

// ── El estado del doble ──────────────────────────────────────────────────────

type FakeMember = {
  id: number;
  fullName: string;
  status: MemberStatus;
  category: MemberCategory;
  joinedAt: Date;
};
type FakeMembership = {
  id: number;
  bookId: number;
  memberId: number;
  memberNumber: number;
  statusAtClose: MemberStatus | null;
  categoryAtClose: MemberCategory | null;
};
type FakeBook = {
  id: number;
  number: number;
  status: "open" | "closed";
  openedAt: Date;
  closedAt: Date | null;
  openingMinuteId: number | null;
  closingMinuteId: number | null;
};
type FakePresentation = { id: number; processId: number; status: PresentationStatus; memberId: number };
type State = {
  processes: Array<{
    id: number;
    status: string;
    secondEndsAt: Date | null;
    bookId: number;
    closeMinuteId: number | null;
  }>;
  books: FakeBook[];
  members: FakeMember[];
  memberships: FakeMembership[];
  presentations: FakePresentation[];
  minutes: Array<{ id: number; date: Date }>;
  configuration: Array<{ key: string; value: unknown }>;
  movements: Array<Record<string, unknown>>;
};

// Evaluadores LITERALES de las condiciones. Una forma de `where` que el doble
// no conoce tira, en vez de ignorarla: ignorarla es exactamente cómo un doble
// hace pasar en verde una consulta que en producción devuelve otra cosa.
function matchScalar(actual: unknown, cond: unknown): boolean {
  if (typeof cond === "string" || typeof cond === "number") return actual === cond;
  if (cond !== null && typeof cond === "object") {
    if ("in" in cond) return (cond.in as unknown[]).includes(actual);
    if ("notIn" in cond) return !(cond.notIn as unknown[]).includes(actual);
  }
  throw new Error(`condición no soportada por el doble: ${JSON.stringify(cond)}`);
}

function matchesPresentation(state: State, row: FakePresentation, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "processId") {
      if (!matchScalar(row.processId, cond)) return false;
    } else if (key === "status") {
      if (!matchScalar(row.status, cond)) return false;
    } else if (key === "member") {
      const member = state.members.find((m) => m.id === row.memberId);
      if (!member) return false;
      for (const [mk, mc] of Object.entries(cond as Record<string, unknown>)) {
        if (mk === "category") {
          if (!matchScalar(member.category, mc)) return false;
        } else if (mk === "status") {
          if (!matchScalar(member.status, mc)) return false;
        } else {
          throw new Error(`campo no soportado por el doble: member.${mk}`);
        }
      }
    } else {
      throw new Error(`campo no soportado por el doble: ${key}`);
    }
  }
  return true;
}

function matchesMembership(state: State, row: FakeMembership, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "bookId") {
      if (!matchScalar(row.bookId, cond)) return false;
    } else if (key === "statusAtClose") {
      // El único uso es `statusAtClose: null` (la guarda de completitud de la
      // foto); cualquier otra forma revienta antes que mentir.
      if (cond !== null) throw new Error(`condición no soportada por el doble: statusAtClose ${JSON.stringify(cond)}`);
      if (row.statusAtClose !== null) return false;
    } else if (key === "member") {
      const member = state.members.find((m) => m.id === row.memberId);
      if (!member) return false;
      for (const [mk, mc] of Object.entries(cond as Record<string, unknown>)) {
        if (mk === "category") {
          if (!matchScalar(member.category, mc)) return false;
        } else if (mk === "status") {
          if (!matchScalar(member.status, mc)) return false;
        } else {
          throw new Error(`campo no soportado por el doble: member.${mk}`);
        }
      }
    } else {
      throw new Error(`campo no soportado por el doble: ${key}`);
    }
  }
  return true;
}

function makeDb(state: State) {
  let nextId = 1000;
  const models = {
    reregistrationProcess: {
      findUnique: async ({ where }: { where: { id: number } }) => {
        const p = state.processes.find((x) => x.id === where.id);
        if (!p) return null;
        const book = state.books.find((b) => b.id === p.bookId);
        return {
          id: p.id,
          status: p.status,
          secondEndsAt: p.secondEndsAt,
          bookId: p.bookId,
          book: book ? { id: book.id, number: book.number, status: book.status } : null,
        };
      },
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const p = state.processes.find((x) => x.id === where.id);
        if (!p) throw new Error("proceso inexistente");
        Object.assign(p, data);
        return p;
      },
    },
    minute: {
      findUnique: async ({ where }: { where: { id: number } }) =>
        state.minutes.find((m) => m.id === where.id) ?? null,
    },
    presentation: {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        state.presentations.filter((r) => matchesPresentation(state, r, where)).length,
    },
    membership: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        for (const key of Object.keys(where)) {
          if (key !== "bookId") throw new Error(`campo no soportado por el doble: ${key}`);
        }
        return state.memberships
          .filter((m) => m.bookId === where.bookId)
          .map((m) => {
            const member = state.members.find((mm) => mm.id === m.memberId);
            if (!member) throw new Error("membresía sin socio");
            return {
              id: m.id,
              memberNumber: m.memberNumber,
              member: {
                id: member.id,
                fullName: member.fullName,
                status: member.status,
                category: member.category,
                joinedAt: member.joinedAt,
              },
            };
          });
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rows = state.memberships.filter((m) => matchesMembership(state, m, where));
        for (const m of rows) Object.assign(m, data);
        return { count: rows.length };
      },
      count: async ({ where }: { where: Record<string, unknown> }) =>
        state.memberships.filter((m) => matchesMembership(state, m, where)).length,
      createMany: async ({ data }: { data: Array<{ bookId: number; memberId: number; memberNumber: number }> }) => {
        for (const d of data) {
          // Los DOS uniques del schema, hechos cumplir: [bookId, memberNumber]
          // y [memberId, bookId]. Un plan con un número repetido tiene que
          // reventar acá aunque alguien borre la guarda previa.
          if (state.memberships.some((m) => m.bookId === d.bookId && m.memberNumber === d.memberNumber)) {
            throw new Error(`unique violation: memberships [bookId, memberNumber] (${d.memberNumber})`);
          }
          if (state.memberships.some((m) => m.bookId === d.bookId && m.memberId === d.memberId)) {
            throw new Error(`unique violation: memberships [memberId, bookId] (${d.memberId})`);
          }
          state.memberships.push({ id: nextId++, statusAtClose: null, categoryAtClose: null, ...d });
        }
        return { count: data.length };
      },
    },
    book: {
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const b = state.books.find((x) => x.id === where.id);
        if (!b) throw new Error("libro inexistente");
        Object.assign(b, data);
        return b;
      },
      create: async ({ data }: { data: Omit<FakeBook, "id" | "closedAt" | "closingMinuteId"> }) => {
        // El unique de books.number, hecho cumplir: sin él, el test de
        // concurrencia podría pasar con dos Libros 2.
        if (state.books.some((b) => b.number === data.number)) {
          throw new Error(`unique violation: books.number (${data.number})`);
        }
        const book: FakeBook = { id: nextId++, closedAt: null, closingMinuteId: null, ...data };
        state.books.push(book);
        return book;
      },
    },
    movement: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        state.movements.push(...data);
        return { count: data.length };
      },
    },
    configuration: {
      deleteMany: async ({ where }: { where: { key: string } }) => {
        const before = state.configuration.length;
        state.configuration = state.configuration.filter((c) => c.key !== where.key);
        return { count: before - state.configuration.length };
      },
    },
  };
  return {
    ...models,
    // Transacción con rollback DE VERDAD: si el callback tira, el estado vuelve
    // exactamente a como estaba. Sin esto, un test de aborto podría pasar
    // mientras el módulo deja escrituras a medias.
    $transaction: async <T>(fn: (tx: typeof models) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(state);
      try {
        return await fn(models);
      } catch (e) {
        Object.assign(state, snapshot);
        throw e;
      }
    },
  };
}

// ── Semillas ─────────────────────────────────────────────────────────────────

const d = civilDateUtc;
const MINUTE_ID = 77;
const MINUTE_DATE = d(2026, 11, 10);
const NOW = () => new Date("2026-11-10T15:00:00Z"); // la 2ª instancia ya venció

function seed(over: Partial<State> = {}): State {
  return {
    processes: [{ id: 5, status: "second_instance", secondEndsAt: d(2026, 8, 1), bookId: 1, closeMinuteId: null }],
    books: [
      { id: 1, number: 1, status: "open", openedAt: d(1961, 1, 1), closedAt: null, openingMinuteId: null, closingMinuteId: null },
    ],
    members: [
      // El orden de carga NO es el de antigüedad, a propósito: la numeración
      // nueva tiene que salir de `joinedAt`, no del orden de la consulta.
      { id: 3, fullName: "Carla Cruz", status: "suspended", category: "active", joinedAt: d(2010, 5, 20) },
      { id: 1, fullName: "Ana Aguirre", status: "active", category: "active", joinedAt: d(1990, 3, 15) },
      { id: 2, fullName: "Beto Barrios", status: "active", category: "adherent", joinedAt: d(2000, 12, 1) },
      // Bajas: Dora es histórica (anterior al proceso), Evo cayó en la etapa B.
      { id: 4, fullName: "Dora Díaz", status: "withdrawn", category: "adherent", joinedAt: d(1995, 7, 7) },
      { id: 6, fullName: "Evo Escobar", status: "withdrawn", category: "adherent", joinedAt: d(2015, 2, 2) },
    ],
    memberships: [
      { id: 11, bookId: 1, memberId: 1, memberNumber: 40, statusAtClose: null, categoryAtClose: null },
      { id: 12, bookId: 1, memberId: 2, memberNumber: 7, statusAtClose: null, categoryAtClose: null },
      { id: 13, bookId: 1, memberId: 3, memberNumber: 120, statusAtClose: null, categoryAtClose: null },
      { id: 14, bookId: 1, memberId: 4, memberNumber: 60, statusAtClose: null, categoryAtClose: null },
      { id: 15, bookId: 1, memberId: 6, memberNumber: 90, statusAtClose: null, categoryAtClose: null },
    ],
    presentations: [
      { id: 21, processId: 5, status: "validated", memberId: 2 },
      { id: 22, processId: 5, status: "withdrawn", memberId: 6 },
    ],
    minutes: [{ id: MINUTE_ID, date: MINUTE_DATE }],
    configuration: [
      { key: CONFIG_KEYS.reregistrationProcessId, value: "5" },
      { key: "asociate_activo", value: true },
    ],
    movements: [],
    ...over,
  };
}

function service(state: State) {
  return makeCloseBook({ db: makeDb(state) as never, now: NOW });
}

const INPUT = { processId: 5, minuteId: MINUTE_ID, actorId: 9 };

// ── El cierre feliz ──────────────────────────────────────────────────────────

describe("closeBook — la transacción de cierre", () => {
  it("cierra el libro viejo, abre el N+1 y renumera por antigüedad", async () => {
    const state = seed();
    const result = await service(state).closeBook(INPUT);

    expect(result).toMatchObject({ ok: true, migrated: 3, withdrawnCount: 1, newBookNumber: 2, oldBookNumber: 1 });

    const oldBook = state.books.find((b) => b.number === 1);
    expect(oldBook).toMatchObject({ status: "closed", closingMinuteId: MINUTE_ID });
    expect(oldBook?.closedAt).toEqual(NOW());

    const newBook = state.books.find((b) => b.number === 2);
    expect(newBook).toMatchObject({ status: "open", openingMinuteId: MINUTE_ID, closedAt: null });
    if (!result.ok) throw new Error("unreachable");
    expect(result.newBookId).toBe(newBook?.id);

    // La numeración: Ana (1990) → 1, Beto (2000) → 2, Carla (2010, suspendida
    // pero VIGENTE: migra suspendida) → 3. Las bajas no cruzan.
    const migrated = state.memberships
      .filter((m) => m.bookId === newBook?.id)
      .map((m) => ({ memberId: m.memberId, memberNumber: m.memberNumber }))
      .sort((a, b) => a.memberNumber - b.memberNumber);
    expect(migrated).toEqual([
      { memberId: 1, memberNumber: 1 },
      { memberId: 2, memberNumber: 2 },
      { memberId: 3, memberNumber: 3 },
    ]);
  });

  it("asienta un movimiento book_migration por migrado, con el acta de cierre y su fecha", async () => {
    const state = seed();
    await service(state).closeBook(INPUT);

    expect(state.movements).toHaveLength(3);
    for (const mv of state.movements) {
      expect(mv).toMatchObject({ type: "book_migration", minuteId: MINUTE_ID, createdById: 9 });
      // La fecha del movimiento es la del ACTA (docs/04: "hereda el acta de
      // cierre"), no la del reloj de la corrida.
      expect(mv.date).toEqual(MINUTE_DATE);
    }
    expect(new Set(state.movements.map((m) => m.memberId))).toEqual(new Set([1, 2, 3]));
  });

  it("congela la foto en TODAS las membresías del libro viejo, bajas históricas incluidas", async () => {
    const state = seed();
    await service(state).closeBook(INPUT);

    const photo = (memberId: number) =>
      state.memberships.find((m) => m.bookId === 1 && m.memberId === memberId);
    // Los vigentes, con su estado vivo del momento del cierre.
    expect(photo(1)).toMatchObject({ statusAtClose: "active", categoryAtClose: "active" });
    expect(photo(3)).toMatchObject({ statusAtClose: "suspended", categoryAtClose: "active" });
    // Las bajas: la histórica y la del proceso. Es lo que hace consultable el
    // libro cerrado para siempre.
    expect(photo(4)).toMatchObject({ statusAtClose: "withdrawn", categoryAtClose: "adherent" });
    expect(photo(6)).toMatchObject({ statusAtClose: "withdrawn", categoryAtClose: "adherent" });
    // Las membresías NUEVAS nacen sin foto: el Libro 2 está abierto.
    const newBook = state.books.find((b) => b.number === 2);
    for (const m of state.memberships.filter((x) => x.bookId === newBook?.id)) {
      expect(m.statusAtClose).toBeNull();
      expect(m.categoryAtClose).toBeNull();
    }
  });

  it("no toca joinedAt: la antigüedad es de la persona, no del libro", async () => {
    const state = seed();
    const before = structuredClone(state.members);
    await service(state).closeBook(INPUT);
    // El doble ni siquiera expone `member.update`: si el módulo lo llamara,
    // reventaría. Esto asegura además que ningún otro campo del socio cambió.
    expect(state.members).toEqual(before);
  });

  it("cierra el proceso, referencia el acta y limpia SOLO la clave del proceso", async () => {
    const state = seed();
    await service(state).closeBook(INPUT);

    expect(state.processes[0]).toMatchObject({ status: "closed", closeMinuteId: MINUTE_ID });
    expect(state.configuration.map((c) => c.key)).toEqual(["asociate_activo"]);
  });

  it("REUTILIZACIÓN: con el Libro 2 cerrándose, abre el 3 — nada hardcodea el 2", async () => {
    const state = seed({
      books: [
        { id: 1, number: 1, status: "closed", openedAt: d(1961, 1, 1), closedAt: d(2026, 11, 10), openingMinuteId: null, closingMinuteId: 70 },
        { id: 2, number: 2, status: "open", openedAt: d(2026, 11, 10), closedAt: null, openingMinuteId: 70, closingMinuteId: null },
      ],
      processes: [{ id: 5, status: "second_instance", secondEndsAt: d(2026, 8, 1), bookId: 2, closeMinuteId: null }],
      memberships: [
        { id: 11, bookId: 2, memberId: 1, memberNumber: 1, statusAtClose: null, categoryAtClose: null },
        { id: 12, bookId: 2, memberId: 2, memberNumber: 2, statusAtClose: null, categoryAtClose: null },
      ],
    });
    const result = await service(state).closeBook(INPUT);

    expect(result).toMatchObject({ ok: true, newBookNumber: 3, oldBookNumber: 2 });
    expect(state.books.find((b) => b.number === 3)).toMatchObject({ status: "open" });
    // El Libro 1, cerrado hace rato, no se toca.
    expect(state.books.find((b) => b.number === 1)?.closingMinuteId).toBe(70);
  });
});

// ── La re-validación de adentro ──────────────────────────────────────────────

describe("closeBook — re-valida DENTRO de la transacción", () => {
  it("una presentación aparecida después de la vista previa aborta el cierre ENTERO", async () => {
    const state = seed();
    const svc = service(state);

    // La vista previa dice que se puede…
    const preview = await svc.preview(5);
    expect(preview.blockers).toEqual([]);

    // …y entre la vista previa y el botón, un vecino se presenta a último
    // momento (el mostrador valida una presentación, entra una por el wizard).
    state.presentations.push({ id: 30, processId: 5, status: "submitted", memberId: 3 });

    const result = await svc.closeBook(INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/cambió|envejeci|apareci/i);
    expect(result.error).toContain("presentaci");

    // Nada se escribió: ni cierre, ni libro nuevo, ni foto, ni movimientos, ni
    // limpieza de la configuración.
    expect(state.books).toHaveLength(1);
    expect(state.books[0].status).toBe("open");
    expect(state.memberships.every((m) => m.statusAtClose === null)).toBe(true);
    expect(state.movements).toHaveLength(0);
    expect(state.processes[0].status).toBe("second_instance");
    expect(state.configuration.some((c) => c.key === CONFIG_KEYS.reregistrationProcessId)).toBe(true);
  });

  it("un cohortado vigente que volvió a quedar sin desenlace también aborta", async () => {
    const state = seed();
    // Beto (adherente vigente) pierde su validación: su presentación vuelve a
    // `observed`. La cohorte ya no está terminal.
    state.presentations[0].status = "observed";

    const result = await service(state).closeBook(INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("desenlace");
    expect(state.books[0].status).toBe("open");
  });
});

// ── Las etapas equivocadas ───────────────────────────────────────────────────

describe("closeBook — precondiciones de etapa", () => {
  it("rechaza un proceso inexistente", async () => {
    const result = await service(seed()).closeBook({ ...INPUT, processId: 99 });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("no existe") });
  });

  it("rechaza un proceso que no llegó a la segunda instancia", async () => {
    const state = seed();
    state.processes[0].status = "first_instance";
    state.processes[0].secondEndsAt = null;
    const result = await service(state).closeBook(INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("segunda instancia");
  });

  it("rechaza mientras el plazo de la segunda instancia todavía corre", async () => {
    const state = seed();
    state.processes[0].secondEndsAt = d(2026, 12, 20); // vence después de NOW
    const result = await service(state).closeBook(INPUT);
    expect(result.ok).toBe(false);
    expect(state.books[0].status).toBe("open");
  });

  it("rechaza un proceso ya cerrado — el doble clic no cierra dos veces", async () => {
    const state = seed();
    state.processes[0].status = "closed";
    const result = await service(state).closeBook(INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("ya");
  });

  it("rechaza si el libro que referencia el proceso ya está cerrado", async () => {
    const state = seed();
    state.books[0].status = "closed";
    const result = await service(state).closeBook(INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("cerrado");
    // Y no abrió ningún libro nuevo sobre un cierre viejo.
    expect(state.books).toHaveLength(1);
  });

  it("rechaza un acta de cierre inexistente sin escribir nada", async () => {
    const result = await service(seed()).closeBook({ ...INPUT, minuteId: 404 });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("acta") });
  });
});

// ── Concurrencia ─────────────────────────────────────────────────────────────

describe("closeBook — dos operadores a la vez", () => {
  it("uno cierra, el otro recibe un error legible, y hay UN solo libro nuevo", async () => {
    const state = seed();
    const svc = service(state);

    const [a, b] = await Promise.all([svc.closeBook(INPUT), svc.closeBook(INPUT)]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    if (!failed || failed.ok) throw new Error("unreachable");
    expect(failed.error).toMatch(/ya/);

    // Un solo Libro 2, una sola tanda de membresías, una sola de movimientos.
    expect(state.books.filter((b2) => b2.number === 2)).toHaveLength(1);
    const newBookId = state.books.find((b2) => b2.number === 2)?.id;
    expect(state.memberships.filter((m) => m.bookId === newBookId)).toHaveLength(3);
    expect(state.movements).toHaveLength(3);
  });
});

// ── La guarda del plan ───────────────────────────────────────────────────────

describe("assertDensePlan — la numeración rota no llega a la base", () => {
  const entry = (memberId: number, newNumber: number): MigrationEntry => ({ memberId, oldNumber: memberId, newNumber });

  it("acepta un plan denso 1..N", () => {
    expect(() => assertDensePlan([entry(1, 1), entry(2, 2), entry(3, 3)], 3)).not.toThrow();
    expect(() => assertDensePlan([], 0)).not.toThrow();
  });

  it("rechaza un salto en la numeración", () => {
    expect(() => assertDensePlan([entry(1, 1), entry(2, 3)], 2)).toThrow(/numeración/);
  });

  it("rechaza un número repetido", () => {
    expect(() => assertDensePlan([entry(1, 1), entry(2, 1)], 2)).toThrow(/numeración/);
  });

  it("rechaza un plan que perdió o duplicó gente", () => {
    expect(() => assertDensePlan([entry(1, 1)], 2)).toThrow(/numeración/);
    expect(() => assertDensePlan([entry(1, 1), entry(1, 2)], 2)).toThrow(/numeración/);
  });
});

// ── La vista previa ──────────────────────────────────────────────────────────

describe("preview — lo que el operador mira antes del botón", () => {
  it("trae el mapeo ordenado por número nuevo, con nombre y categoría", async () => {
    const preview = await service(seed()).preview(5);

    expect(preview.newBookNumber).toBe(2);
    expect(preview.withdrawnCount).toBe(1);
    expect(preview.blockers).toEqual([]);
    expect(preview.migrants).toEqual([
      { memberId: 1, fullName: "Ana Aguirre", oldNumber: 40, newNumber: 1, category: "active", status: "active" },
      { memberId: 2, fullName: "Beto Barrios", oldNumber: 7, newNumber: 2, category: "adherent", status: "active" },
      { memberId: 3, fullName: "Carla Cruz", oldNumber: 120, newNumber: 3, category: "active", status: "suspended" },
    ]);
  });

  it("muestra los bloqueos con los MISMOS where que la transacción re-valida", async () => {
    const state = seed();
    // Beto (adherente vigente) vuelve a `submitted`: cuenta en las DOS
    // bloqueantes a la vez — espera decisión Y no tiene desenlace.
    state.presentations[0].status = "submitted";
    const preview = await service(state).preview(5);

    expect(preview.blockers).toEqual([
      { kind: "unresolved_presentations", count: 1 },
      { kind: "cohort_not_terminal", count: 1 },
    ]);
  });

  it("con un proceso inexistente tira, no adivina", async () => {
    await expect(service(seed()).preview(99)).rejects.toThrow(/no existe/);
  });
});
