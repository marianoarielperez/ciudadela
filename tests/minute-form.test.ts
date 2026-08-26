import { describe, expect, it } from "vitest";

import {
  createsNewMinute, describeMinuteSelection, discardUnusedMinute, minuteSelectionSchema,
  resolveMinuteId,
} from "@/lib/members/minute-form";

describe("minuteSelectionSchema", () => {
  it("accepts an existing minute id", () => {
    const r = minuteSelectionSchema.safeParse({ minuteId: "7" });
    expect(r.success).toBe(true);
    if (r.success && "minuteId" in r.data) expect(r.data.minuteId).toBe(7);
  });
  it("accepts a new minute", () => {
    const r = minuteSelectionSchema.safeParse({
      minuteNew: "1", minuteType: "board", minuteNumber: "12", minuteDate: "2026-08-20",
    });
    expect(r.success).toBe(true);
  });
  it("rejects when neither is given", () => {
    const r = minuteSelectionSchema.safeParse({});
    expect(r.success).toBe(false);
    // El mensaje se muestra tal cual en el formulario: nunca en inglés.
    if (!r.success) expect(r.error.issues[0].message).toMatch(/acta/i);
  });
  it("rejects a new minute without a date", () => {
    const r = minuteSelectionSchema.safeParse({ minuteNew: "1", minuteType: "board", minuteNumber: "12" });
    expect(r.success).toBe(false);
  });
});

// La pantalla de confirmación tiene que decir en qué acta se va a asentar la
// decisión SIN crearla: el acta se escribe recién cuando la acción se ejecuta,
// o volver atrás dejaría un asiento fantasma en el libro que se presenta a la IGJ.
describe("describeMinuteSelection", () => {
  it("describes an existing minute from the database, never from the form", async () => {
    const db = {
      minute: {
        findUnique: async () => ({ type: "assembly", number: 12, date: new Date("2026-08-12T12:00:00Z") }),
      },
    };
    const label = await describeMinuteSelection(db as never, { minuteId: 3 });
    expect(label).toBe("Asamblea N° 12 — 12/08/2026");
  });

  it("describes a minute that does not exist yet without creating it", async () => {
    const db = {
      minute: {
        findUnique: async () => null,
        create: async () => { throw new Error("no debería crear nada"); },
      },
    };
    const label = await describeMinuteSelection(db as never, {
      minuteNew: "1" as const, minuteType: "board" as const, minuteNumber: 48,
      minuteDate: "2026-08-20", minuteDescription: undefined,
    });
    expect(label).toContain("Comisión Directiva N° 48 — 20/08/2026");
    // El operador tiene que saber que ese número de acta todavía no existe.
    expect(label).toMatch(/acta nueva/i);
  });

  it("refuses an existing minute that is gone, in Spanish", async () => {
    const db = { minute: { findUnique: async () => null } };
    await expect(describeMinuteSelection(db as never, { minuteId: 3 }))
      .rejects.toThrow("El acta seleccionada no existe.");
  });

  it("rejects an impossible date before the operator confirms", async () => {
    const db = { minute: { findUnique: async () => null } };
    await expect(describeMinuteSelection(db as never, {
      minuteNew: "1" as const, minuteType: "board" as const, minuteNumber: 48,
      minuteDate: "2026-02-31", minuteDescription: undefined,
    })).rejects.toThrow("La fecha del acta no existe.");
  });
});

describe("resolveMinuteId", () => {
  it("creates the minute at civil noon UTC", async () => {
    const created: Record<string, unknown>[] = [];
    const db = {
      minute: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: 99, ...data };
        },
      },
    };
    const id = await resolveMinuteId(db as never, {
      minuteNew: "1" as const, minuteType: "board" as const, minuteNumber: 12,
      minuteDate: "2026-08-12", minuteDescription: undefined,
    }, 1);
    expect(id).toBe(99);
    expect((created[0].date as Date).toISOString()).toBe("2026-08-12T12:00:00.000Z");
  });

  // El regex del schema deja pasar un día que no existe o un año mal tipeado
  // ("0202"): sin esta guarda, `civilDateUtc` los desbordaría en silencio.
  // Mismo criterio que `parseBirthDate`, ver `minute-date.ts`.
  it("rejects a day that does not exist, in Spanish", async () => {
    const db = { minute: { create: async () => { throw new Error("no debería crear nada"); } } };
    await expect(
      resolveMinuteId(db as never, {
        minuteNew: "1" as const, minuteType: "board" as const, minuteNumber: 12,
        minuteDate: "2026-02-31", minuteDescription: undefined,
      }, 1),
    ).rejects.toThrow("La fecha del acta no existe.");
  });

  it("reports a duplicate type+number in Spanish", async () => {
    const db = {
      minute: {
        create: async () => {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        },
      },
    };
    await expect(
      resolveMinuteId(db as never, {
        minuteNew: "1" as const, minuteType: "board" as const, minuteNumber: 12,
        minuteDate: "2026-08-12", minuteDescription: undefined,
      }, 1),
    ).rejects.toThrow(/Ya existe el acta/);
  });

  it("passes through an existing id after checking it exists", async () => {
    const asked: unknown[] = [];
    const db = {
      minute: {
        findUnique: async (args: unknown) => {
          asked.push(args);
          return { id: 7 };
        },
      },
    };
    expect(await resolveMinuteId(db as never, { minuteId: 7 }, 1)).toBe(7);
    expect(asked).toHaveLength(1);
  });

  it("rejects an id that does not exist, in Spanish", async () => {
    const db = { minute: { findUnique: async () => null } };
    await expect(resolveMinuteId(db as never, { minuteId: 404 }, 1)).rejects.toThrow(
      /El acta seleccionada no existe/,
    );
  });
});

describe("createsNewMinute", () => {
  it("is false when reusing an existing minute", () => {
    expect(createsNewMinute({ minuteId: 7 })).toBe(false);
  });
  it("is true when the form carries a new minute", () => {
    expect(createsNewMinute({
      minuteNew: "1", minuteType: "board", minuteNumber: 12,
      minuteDate: "2026-08-20", minuteDescription: undefined,
    })).toBe(true);
  });
});

describe("discardUnusedMinute", () => {
  type Counts = {
    movements: number;
    books: number;
    applications?: number;
    /** Procesos de re-empadronamiento que usan el acta COMO CONVOCATORIA. */
    callProcesses?: number;
    /** Procesos que la usan COMO ACTA DE CIERRE (la relación opcional). */
    closeProcesses?: number;
    feeValues?: number;
  };

  function makeDb(counts: Counts, minuteId = 42) {
    const deleted: number[] = [];
    const db = {
      movement: { count: async () => counts.movements },
      book: { count: async () => counts.books },
      application: { count: async () => counts.applications ?? 0 },
      // El fake mira el `where` en vez de devolver un número fijo: así una
      // guarda que chequeara sólo `callMinuteId` fallaría el caso del acta de
      // cierre en vez de pasar por casualidad.
      reregistrationProcess: {
        count: async ({ where }: { where: { OR: Record<string, number>[] } }) => {
          const asksCall = where.OR.some((c) => c.callMinuteId === minuteId);
          const asksClose = where.OR.some((c) => c.closeMinuteId === minuteId);
          return (asksCall ? counts.callProcesses ?? 0 : 0) + (asksClose ? counts.closeProcesses ?? 0 : 0);
        },
      },
      feeValue: { count: async () => counts.feeValues ?? 0 },
      minute: {
        delete: async ({ where }: { where: { id: number } }) => {
          deleted.push(where.id);
          return { id: where.id };
        },
      },
    };
    return { db, deleted };
  }

  it("deletes a minute nobody used", async () => {
    const { db, deleted } = makeDb({ movements: 0, books: 0 });
    await discardUnusedMinute(db as never, 42);
    expect(deleted).toEqual([42]);
  });

  it("keeps a minute that already has a movement", async () => {
    const { db, deleted } = makeDb({ movements: 1, books: 0 });
    await discardUnusedMinute(db as never, 42);
    expect(deleted).toEqual([]);
  });

  it("keeps a minute that opens or closes a book", async () => {
    const { db, deleted } = makeDb({ movements: 0, books: 1 });
    await discardUnusedMinute(db as never, 42);
    expect(deleted).toEqual([]);
  });

  // Un RECHAZO no asienta movimientos: su acta tiene cero movimientos y cero
  // libros, asi que sin este tercer chequeo "parece" sin usar. Y como
  // `Application.minuteId` es `onDelete: SetNull`, el borrado no falla: se lleva
  // la constancia en actas del rechazo en silencio (Art. 5 inc. 7).
  it("keeps a minute that already backs a decided application", async () => {
    const { db, deleted } = makeDb({ movements: 0, books: 0, applications: 1 });
    await discardUnusedMinute(db as never, 42);
    expect(deleted).toEqual([]);
  });

  // El acta de convocatoria es OBLIGATORIA en el proceso: la base rechazaría el
  // borrado y quedaría un acta fantasma con un error técnico encima.
  it("keeps a minute that called a re-registration process", async () => {
    const { db, deleted } = makeDb({ movements: 0, books: 0, callProcesses: 1 });
    await discardUnusedMinute(db as never, 42);
    expect(deleted).toEqual([]);
  });

  // El acta de CIERRE es opcional y su relación es `SetNull`: sin este chequeo
  // el borrado sale bien y el proceso pierde, en silencio, la constancia del
  // cierre del Libro N° 1 ante la IGJ. Es el mismo agujero que `Application`.
  it("keeps a minute that closes a re-registration process", async () => {
    const { db, deleted } = makeDb({ movements: 0, books: 0, closeProcesses: 1 });
    await discardUnusedMinute(db as never, 42);
    expect(deleted).toEqual([]);
  });

  // `FeeValue.minuteId` también es `SetNull`: borrar el acta dejaría al valor de
  // cuota vigente sin la constancia de la decisión que lo fijó (REG-34).
  it("keeps a minute that backs a fee value", async () => {
    const { db, deleted } = makeDb({ movements: 0, books: 0, feeValues: 1 });
    await discardUnusedMinute(db as never, 42);
    expect(deleted).toEqual([]);
  });

  it("never throws: the caller already has a real error to report", async () => {
    const db = {
      movement: { count: async () => { throw new Error("db down"); } },
      book: { count: async () => 0 },
      application: { count: async () => 0 },
      minute: { delete: async () => ({ id: 1 }) },
    };
    await expect(discardUnusedMinute(db as never, 42)).resolves.toBeUndefined();
  });
});
