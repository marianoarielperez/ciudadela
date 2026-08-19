import { describe, expect, it } from "vitest";

import { minuteSelectionSchema, resolveMinuteId } from "@/lib/members/minute-form";

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
      minuteDate: "2026-08-20", minuteDescription: undefined,
    }, 1);
    expect(id).toBe(99);
    expect((created[0].date as Date).toISOString()).toBe("2026-08-20T12:00:00.000Z");
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
        minuteDate: "2026-08-20", minuteDescription: undefined,
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
