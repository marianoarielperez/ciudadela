import { describe, expect, it } from "vitest";

import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
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
  function makeDb(counts: { movements: number; books: number }) {
    const deleted: number[] = [];
    const db = {
      movement: { count: async () => counts.movements },
      book: { count: async () => counts.books },
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

  it("never throws: the caller already has a real error to report", async () => {
    const db = {
      movement: { count: async () => { throw new Error("db down"); } },
      book: { count: async () => 0 },
      minute: { delete: async () => ({ id: 1 }) },
    };
    await expect(discardUnusedMinute(db as never, 42)).resolves.toBeUndefined();
  });
});
