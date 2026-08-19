import { describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
import {
  MINUTE_EDIT_ERRORS, MinuteEditError, makeMinuteEditor, minuteChanges,
  minuteEditAuditDetail, minuteEditSchema, parseMinuteDate,
} from "@/lib/members/minute-edit";
import type { MinuteSnapshot } from "@/lib/members/minute-edit";

function snapshot(over: Partial<MinuteSnapshot> = {}): MinuteSnapshot {
  return {
    type: "board", number: 47, date: civilDateUtc(2026, 8, 12), description: "Reunión ordinaria",
    ...over,
  };
}

describe("minuteEditSchema", () => {
  it("coerces the number and rejects a malformed date in es-AR", () => {
    const ok = minuteEditSchema.safeParse({
      minuteId: "5", type: "assembly", number: "48", date: "2026-08-12",
    });
    expect(ok.success && ok.data).toMatchObject({ minuteId: 5, number: 48, type: "assembly" });

    const bad = minuteEditSchema.safeParse({
      minuteId: "5", type: "board", number: "48", date: "12/08/2026",
    });
    expect(bad.success).toBe(false);
    expect(bad.success === false && bad.error.issues[0]?.message).toBe("Fecha inválida");
  });
});

describe("minuteChanges", () => {
  it("reports nothing when the edit repeats what is already asentado", () => {
    expect(minuteChanges(snapshot(), snapshot())).toEqual([]);
  });

  it("compares the date by civil day, not by object identity", () => {
    // Dos `Date` distintos con el mismo mediodía UTC son el mismo día del libro:
    // sin esto, abrir y guardar sin tocar nada contaría como un cambio de fecha
    // y quedaría bloqueado por la regla de abajo.
    expect(minuteChanges(snapshot(), snapshot({ date: civilDateUtc(2026, 8, 12) }))).toEqual([]);
    expect(minuteChanges(snapshot(), snapshot({ date: civilDateUtc(2026, 8, 13) }))).toEqual(["date"]);
  });

  it("lists every field the operator touched", () => {
    expect(minuteChanges(snapshot(), snapshot({ type: "assembly", number: 74, description: null })))
      .toEqual(["type", "number", "description"]);
  });
});

describe("minuteEditAuditDetail", () => {
  // El asiento tiene que decir QUÉ cambió y de qué a qué, pero la descripción es
  // texto libre que el operador copia del libro y puede nombrar socios: va el
  // nombre del campo, nunca el contenido (Ley 25.326, mismo criterio que
  // `sanitizeFiltersForAudit`).
  it("records old and new values for type, number and date", () => {
    const before = snapshot();
    const after = snapshot({ number: 74, date: civilDateUtc(2026, 9, 1) });
    const detail = minuteEditAuditDetail(before, after, ["number", "date"]);
    expect(detail).toEqual({
      fields: ["number", "date"],
      from: { number: 47, date: "2026-08-12" },
      to: { number: 74, date: "2026-09-01" },
    });
  });

  it("never copies the description text into the audit trail", () => {
    const detail = minuteEditAuditDetail(
      snapshot(), snapshot({ description: "Baja de Perez Ana por mora" }), ["description"],
    );
    expect(detail).toEqual({ fields: ["description"], from: {}, to: {} });
    expect(JSON.stringify(detail)).not.toContain("Perez");
  });
});

// ── El editor contra una base falsa ───────────────────────────────────────────
type Deps = { minute: MinuteSnapshot | null; movements: number; books: number };

function fakeDb(deps: Deps) {
  const update = vi.fn<(args: Record<string, unknown>) => Promise<object>>(async () => ({}));
  const db = {
    // El editor corre todo dentro de una transacción: el fake se la pasa a sí
    // mismo, que es lo que hace Prisma con el cliente transaccional.
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
    minute: {
      findUnique: vi.fn(async () => deps.minute),
      update,
    },
    movement: { count: vi.fn(async () => deps.movements) },
    book: { count: vi.fn(async () => deps.books) },
  };
  return { db, update };
}

describe("makeMinuteEditor", () => {
  it("saves the corrected number and reports what changed", async () => {
    const { db, update } = fakeDb({ minute: snapshot(), movements: 3, books: 0 });
    const editor = makeMinuteEditor(db as never);
    const res = await editor.update(5, snapshot({ number: 74 }));
    expect(res.changed).toEqual(["number"]);
    expect(res.before.number).toBe(47);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 5 },
      data: expect.objectContaining({ number: 74 }),
    }));
  });

  it("does not write when nothing changed", async () => {
    const { db, update } = fakeDb({ minute: snapshot(), movements: 0, books: 0 });
    const editor = makeMinuteEditor(db as never);
    const res = await editor.update(5, snapshot());
    expect(res.changed).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an unknown minute in castellano", async () => {
    const { db } = fakeDb({ minute: null, movements: 0, books: 0 });
    const editor = makeMinuteEditor(db as never);
    await expect(editor.update(9, snapshot())).rejects.toMatchObject({
      reason: "not_found", message: MINUTE_EDIT_ERRORS.notFound,
    });
  });

  // REG-11: la fecha del acta ES la fecha de ingreso de los socios que admite
  // (y la de egreso de los que da de baja), y `joinedAt` es inmutable porque de
  // ella cuelgan el voto a los 90 días y el pase a vitalicio a los 25 años.
  // Cambiar la fecha de un acta con movimientos dejaría al padrón diciendo una
  // antigüedad y al acta que la respalda diciendo otra.
  it("refuses to move the date of a minute that already has movements", async () => {
    const { db, update } = fakeDb({ minute: snapshot(), movements: 1, books: 0 });
    const editor = makeMinuteEditor(db as never);
    await expect(editor.update(5, snapshot({ date: civilDateUtc(2026, 8, 13) })))
      .rejects.toMatchObject({ reason: "date_locked", message: MINUTE_EDIT_ERRORS.dateLocked });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to move the date of a minute that opens or closes a book", async () => {
    const { db, update } = fakeDb({ minute: snapshot(), movements: 0, books: 1 });
    const editor = makeMinuteEditor(db as never);
    await expect(editor.update(5, snapshot({ date: civilDateUtc(2026, 8, 13) })))
      .rejects.toMatchObject({ reason: "date_locked" });
    expect(update).not.toHaveBeenCalled();
  });

  // El motivo por el que el ABM existe: el número tipeado mal. Ese SÍ se corrige
  // aunque el acta ya tenga movimientos — de un número no cuelga ninguna fecha.
  it("still allows correcting the number of a minute with movements", async () => {
    const { db, update } = fakeDb({ minute: snapshot(), movements: 5, books: 1 });
    const editor = makeMinuteEditor(db as never);
    const res = await editor.update(5, snapshot({ number: 74, type: "assembly" }));
    expect(res.changed).toEqual(["type", "number"]);
    expect(update).toHaveBeenCalled();
  });

  it("lets an empty minute move its date", async () => {
    const { db, update } = fakeDb({ minute: snapshot(), movements: 0, books: 0 });
    const editor = makeMinuteEditor(db as never);
    const res = await editor.update(5, snapshot({ date: civilDateUtc(2026, 8, 13) }));
    expect(res.changed).toEqual(["date"]);
    expect(update).toHaveBeenCalled();
  });

  // UNIQUE(type, number): el choque tiene que salir en castellano, no como el
  // P2002 crudo de Prisma en medio de una corrección de tipeo.
  it("translates the unique index violation into es-AR", async () => {
    const { db } = fakeDb({ minute: snapshot(), movements: 0, books: 0 });
    db.minute.update = vi.fn(async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    }) as never;
    const editor = makeMinuteEditor(db as never);
    await expect(editor.update(5, snapshot({ number: 74 }))).rejects.toMatchObject({
      reason: "duplicate",
      message: "Ya existe el acta N° 74 de ese tipo.",
    });
  });
});

describe("MinuteEditError", () => {
  it("is an Error so the action can tell it apart from a database crash", () => {
    expect(new MinuteEditError("not_found", "x")).toBeInstanceOf(Error);
  });
});

describe("parseMinuteDate", () => {
  it("anchors the civil day at UTC noon like the rest of the system", () => {
    expect(parseMinuteDate("2026-08-12").toISOString()).toBe(civilDateUtc(2026, 8, 12).toISOString());
  });
});
