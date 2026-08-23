import { describe, expect, it, vi } from "vitest";
// El módulo inyecta Prisma, pero el singleton del final del archivo se evalúa
// al importarlo: sin este mock el test se cae por falta de DATABASE_URL.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import {
  incomeWhere,
  makeOtherIncome,
  MAX_INCOME_AMOUNT,
  OtherIncomeError,
  recordOtherIncome,
} from "@/lib/treasury/other-income";

const NOON = new Date("2026-08-23T12:00:00.000Z"); // 23/08/2026 civil argentino

function uniqueViolation() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

describe("recordOtherIncome", () => {
  it("escribe el monto como string de dos decimales y recorta el texto libre", async () => {
    const create = vi.fn(async () => ({ id: 7 }));
    const db = { otherIncome: { create } } as never;
    const r = await recordOtherIncome(db, {
      amount: 45000,
      receivedAt: NOON,
      concept: "  Alquiler del salón  ",
      method: "cash",
      note: null,
      actorId: 9,
    });
    expect(r).toEqual({ kind: "recorded", id: 7 });
    expect(create).toHaveBeenCalledWith({
      data: {
        // Decimal(10,2): string con dos decimales, nunca un float.
        amount: "45000.00",
        receivedAt: NOON,
        concept: "Alquiler del salón",
        method: "cash",
        mpPaymentId: null,
        note: null,
        registeredById: 9,
      },
      select: { id: true },
    });
  });

  it("un concepto vacío se rechaza en castellano y no escribe", async () => {
    const create = vi.fn();
    const db = { otherIncome: { create } } as never;
    await expect(
      recordOtherIncome(db, { amount: 1000, receivedAt: NOON, concept: "   ", method: "cash", actorId: 9 }),
    ).rejects.toThrow("Ingresá a qué corresponde el ingreso.");
    expect(create).not.toHaveBeenCalled();
  });

  it("un monto de cero o negativo se rechaza en castellano", async () => {
    const db = { otherIncome: { create: vi.fn() } } as never;
    const base = { receivedAt: NOON, concept: "Rifa", method: "cash" as const, actorId: 9 };
    await expect(recordOtherIncome(db, { ...base, amount: 0 })).rejects.toThrow(
      "El monto tiene que ser mayor a cero.",
    );
    await expect(recordOtherIncome(db, { ...base, amount: -5 })).rejects.toThrow(
      "El monto tiene que ser mayor a cero.",
    );
  });

  it("un monto que no es un número se rechaza antes de tocar la base", async () => {
    const create = vi.fn();
    const db = { otherIncome: { create } } as never;
    await expect(
      recordOtherIncome(db, { amount: Number.NaN, receivedAt: NOON, concept: "Rifa", method: "cash", actorId: 9 }),
    ).rejects.toThrow("El monto no es válido.");
    expect(create).not.toHaveBeenCalled();
  });

  it("el techo es el de Decimal(10,2): el máximo entra y un peso más no", async () => {
    const create = vi.fn(async () => ({ id: 1 }));
    const db = { otherIncome: { create } } as never;
    await expect(
      recordOtherIncome(db, { amount: MAX_INCOME_AMOUNT, receivedAt: NOON, concept: "Legado", method: "cash", actorId: 9 }),
    ).resolves.toEqual({ kind: "recorded", id: 1 });
    await expect(
      recordOtherIncome(db, { amount: MAX_INCOME_AMOUNT + 1, receivedAt: NOON, concept: "Legado", method: "cash", actorId: 9 }),
    ).rejects.toBeInstanceOf(OtherIncomeError);
  });

  it("una fecha inválida se rechaza en castellano", async () => {
    const db = { otherIncome: { create: vi.fn() } } as never;
    await expect(
      recordOtherIncome(db, { amount: 100, receivedAt: new Date("nada"), concept: "Rifa", method: "cash", actorId: 9 }),
    ).rejects.toThrow("La fecha del ingreso no es válida.");
  });

  it("el choque de la unique de mpPaymentId devuelve already_recorded, no un error", async () => {
    // Mismo criterio que `unmatched.record`: el segundo evento del mismo cobro
    // no es una falla, es el mismo hecho llegando dos veces.
    const create = vi.fn(async () => {
      throw uniqueViolation();
    });
    const findUnique = vi.fn(async () => ({ id: 42 }));
    const db = { otherIncome: { create, findUnique } } as never;
    const r = await recordOtherIncome(db, {
      amount: 12000,
      receivedAt: NOON,
      concept: "Alquiler",
      method: "mp",
      mpPaymentId: "mp-1",
      actorId: 9,
    });
    expect(r).toEqual({ kind: "already_recorded", id: 42 });
    expect(findUnique).toHaveBeenCalledWith({ where: { mpPaymentId: "mp-1" }, select: { id: true } });
  });

  it("un P2002 sin mpPaymentId se propaga: no hay a qué culpar y taparlo escondería el bug", async () => {
    const db = {
      otherIncome: {
        create: vi.fn(async () => {
          throw uniqueViolation();
        }),
      },
    } as never;
    await expect(
      recordOtherIncome(db, { amount: 1, receivedAt: NOON, concept: "X", method: "cash", actorId: 9 }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("incomeWhere", () => {
  it("sin filtros no restringe nada", () => {
    expect(incomeWhere({})).toEqual({});
  });

  it("el rango se compara contra el DÍA CIVIL argentino, no contra el mediodía UTC", () => {
    // Un cobro de MP de las 20:00 del 23/08 se guarda como 23/08 23:00 UTC: con
    // un `lte` al mediodía quedaba afuera del rango que lo incluye, y la suma
    // del período mentía por abajo. El día civil D va de D 03:00 a D+1 03:00 UTC.
    const w = incomeWhere({ from: new Date("2026-08-01T12:00:00.000Z"), to: NOON });
    expect(w.receivedAt).toEqual({
      gte: new Date("2026-08-01T03:00:00.000Z"),
      lt: new Date("2026-08-24T03:00:00.000Z"),
    });
  });

  it("medio y texto arman el where esperado", () => {
    expect(incomeWhere({ method: "mp", q: "salón" })).toEqual({
      method: "mp",
      concept: { contains: "salón" },
    });
  });
});

describe("makeOtherIncome().list", () => {
  function listDb(overrides: {
    count?: number;
    groups?: Array<{ method: string; _sum: { amount: unknown }; _count: { _all: number } }>;
    rows?: unknown[];
  } = {}) {
    const count = vi.fn(async () => overrides.count ?? 0);
    const groupBy = vi.fn(async () => overrides.groups ?? []);
    const findMany = vi.fn(async () => overrides.rows ?? []);
    return { spies: { count, groupBy, findMany }, db: { otherIncome: { count, groupBy, findMany } } as never };
  }

  it("la suma EXCLUYE los anulados y los muestra igual en la lista", async () => {
    const { spies, db } = listDb({
      count: 2,
      groups: [{ method: "cash", _sum: { amount: "45000.00" }, _count: { _all: 1 } }],
      rows: [
        {
          id: 2, amount: "45000.00", receivedAt: NOON, concept: "Alquiler del salón", method: "cash",
          mpPaymentId: null, note: null, voidedAt: null, voidReason: null,
          registeredBy: { name: "Mariano" }, voidedBy: null,
        },
        {
          id: 1, amount: "10000.00", receivedAt: NOON, concept: "Rifa", method: "cash",
          mpPaymentId: null, note: null, voidedAt: NOON, voidReason: "Cargado dos veces",
          registeredBy: { name: "Mariano" }, voidedBy: { name: "Mariano" },
        },
      ],
    });
    const r = await makeOtherIncome(db).list({}, 1);
    // Las dos filas se ven; sólo la vigente suma.
    expect(r.total).toBe(2);
    expect(r.rows).toHaveLength(2);
    expect(r.sum).toBe(45000);
    // "$ 45.000 en 2 ingresos" sería falso con un anulado adentro: `counted` es
    // el que va en la frase.
    expect(r.counted).toBe(1);
    expect(r.rows[1]).toMatchObject({ id: 1, amount: 10000, voidReason: "Cargado dos veces" });
    // El anulado se excluye en la BASE y no en memoria: si se filtrara acá, la
    // suma sería la de la página y no la del período.
    expect(spies.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["method"], where: { voidedAt: null } }),
    );
    // El conteo, en cambio, es sobre todo el filtro: los anulados se listan.
    expect(spies.count).toHaveBeenCalledWith({ where: {} });
  });

  it("separa la suma por medio y redondea a centavos", async () => {
    const { db } = listDb({
      count: 2,
      groups: [
        { method: "cash", _sum: { amount: "0.10" }, _count: { _all: 1 } },
        { method: "mp", _sum: { amount: "0.20" }, _count: { _all: 1 } },
      ],
    });
    const r = await makeOtherIncome(db).list({}, 1);
    expect(r.byMethod).toEqual({ cash: 0.1, mp: 0.2 });
    // Sin el redondeo explícito, 0.1 + 0.2 son 0.30000000000000004 pesos.
    expect(r.sum).toBe(0.3);
  });

  it("pagina acotando la página pedida al rango real", async () => {
    const { spies, db } = listDb({ count: 3 });
    await makeOtherIncome(db).list({ method: "cash" }, 99);
    expect(spies.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { method: "cash" }, skip: 0, take: 50 }),
    );
  });
});

describe("makeOtherIncome().void", () => {
  function voidDb(count: number, row: unknown = null) {
    const updateIncome = vi.fn(async () => ({ count }));
    const findUnique = vi.fn(async () => row);
    const updateRow = vi.fn(async () => ({ count: 1 }));
    const tx = {
      otherIncome: { updateMany: updateIncome, findUnique },
      mpUnmatchedPayment: { updateMany: updateRow },
    };
    const db = {
      ...tx,
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as never;
    return { spies: { updateIncome, findUnique, updateRow }, db };
  }

  it("anula con motivo y deja al operador que lo hizo", async () => {
    const { spies, db } = voidDb(1, { mpPaymentId: null });
    const r = await makeOtherIncome(db).void({ id: 3, actorId: 9, reason: "Se cargó dos veces" });
    expect(r).toEqual({ kind: "voided", reopened: false });
    expect(spies.updateIncome).toHaveBeenCalledWith({
      // El `voidedAt: null` en el where es la barrera contra dos anulaciones a
      // la vez: la segunda no matchea y no pisa el motivo de la primera.
      where: { id: 3, voidedAt: null },
      data: expect.objectContaining({ voidedById: 9, voidReason: "Se cargó dos veces" }),
    });
    expect(spies.updateRow).not.toHaveBeenCalled();
  });

  it("si vino de la bandeja, la fila vuelve a Pendientes en la MISMA transacción", async () => {
    // Regla del núcleo: una fila nunca queda apuntando a un registro anulado.
    const { spies, db } = voidDb(1, { mpPaymentId: "mp-9" });
    const r = await makeOtherIncome(db).void({ id: 3, actorId: 9, reason: "Era de un socio" });
    expect(r).toEqual({ kind: "voided", reopened: true });
    expect(spies.updateRow).toHaveBeenCalledWith({
      where: { mpPaymentId: "mp-9", status: "other_income" },
      data: { status: "open", resolvedById: null, resolvedAt: null },
    });
  });

  it("es idempotente: anular dos veces no vuelve a escribir ni miente", async () => {
    const { spies, db } = voidDb(0, { mpPaymentId: null });
    const r = await makeOtherIncome(db).void({ id: 3, actorId: 9, reason: "Otra vez" });
    expect(r).toEqual({ kind: "already_voided" });
    expect(spies.updateRow).not.toHaveBeenCalled();
  });

  it("un id que no existe se distingue de uno ya anulado", async () => {
    const { db } = voidDb(0, null);
    expect(await makeOtherIncome(db).void({ id: 404, actorId: 9, reason: "X" })).toEqual({ kind: "not_found" });
  });

  it("sin motivo no anula nada", async () => {
    const { spies, db } = voidDb(1, { mpPaymentId: null });
    await expect(makeOtherIncome(db).void({ id: 3, actorId: 9, reason: "  " })).rejects.toThrow(
      "Indicá el motivo de la anulación.",
    );
    expect(spies.updateIncome).not.toHaveBeenCalled();
  });
});
