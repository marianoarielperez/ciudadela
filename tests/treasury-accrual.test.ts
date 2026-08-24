import { describe, expect, it, vi } from "vitest";
// `accrual.ts` exporta el singleton `accrualCron`, que construye sobre el
// cliente real: sin este mock el módulo se cae al evaluarse si no hay
// DATABASE_URL. La regla del proyecto: mockear ANTES de importar.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeAccrualCron } from "@/lib/treasury/accrual";
import { isFirstCivilDayOfMonth } from "@/lib/treasury/periods";

// Socio del padrón: piso de cobertura = IMPORT_COVERAGE_FLOOR = 2026-09.
const PADRON = new Date("2019-03-10T12:00:00Z");

function fakeDb(members: Array<{ id: number; status: string; category: string; joinedAt: Date }>, opts?: {
  fees?: Array<{ memberId: number; period: string }>;
  readmissions?: Array<{ memberId: number; _max: { date: Date | null } }>;
  createMany?: ReturnType<typeof vi.fn>;
}) {
  const createMany = opts?.createMany ?? vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  return {
    db: {
      member: { findMany: vi.fn(async () => members) },
      movement: { groupBy: vi.fn(async () => opts?.readmissions ?? []) },
      fee: { findMany: vi.fn(async () => opts?.fees ?? []), createMany },
    },
    createMany,
  };
}

describe("isFirstCivilDayOfMonth", () => {
  it("las 00:30 argentinas del 1° son el día 1 (en UTC son las 03:30 del 1)", () => {
    expect(isFirstCivilDayOfMonth(new Date("2026-10-01T03:30:00Z"))).toBe(true);
  });
  it("las 23:00 argentinas del 30/09 NO son el día 1, aunque en UTC ya sea el 01/10", () => {
    expect(isFirstCivilDayOfMonth(new Date("2026-10-01T02:00:00Z"))).toBe(false);
  });
  it("el 15 no", () => {
    expect(isFirstCivilDayOfMonth(new Date("2026-10-15T12:00:00Z"))).toBe(false);
  });
});

describe("accrual cron", () => {
  const now = () => new Date("2026-10-01T03:30:00Z"); // 00:30 AR del 01/10

  it("willAct() sólo el día 1 del mes civil argentino", () => {
    const { db } = fakeDb([]);
    expect(makeAccrualCron({ db: db as never, now }).willAct()).toBe(true);
    expect(makeAccrualCron({ db: db as never, now: () => new Date("2026-10-15T12:00:00Z") }).willAct()).toBe(false);
  });

  it("devenga hasta el mes VENCIDO: el 01/10 crea 2026-09 y nunca 2026-10", async () => {
    const { db, createMany } = fakeDb([{ id: 1, status: "active", category: "active", joinedAt: PADRON }]);
    const s = await makeAccrualCron({ db: db as never, now }).run();
    expect(s.upTo).toBe("2026-09");
    expect(s.membersScanned).toBe(1);
    expect(s.membersAccrued).toBe(1);
    expect(s.feesCreated).toBe(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ memberId: 1, period: "2026-09", status: "pending", origin: "accrual" }],
      skipDuplicates: true,
    });
  });

  it("backfillea: primera corrida el 01/11 crea septiembre Y octubre", async () => {
    const { db } = fakeDb([{ id: 1, status: "active", category: "active", joinedAt: PADRON }]);
    const s = await makeAccrualCron({ db: db as never, now: () => new Date("2026-11-01T03:30:00Z") }).run();
    expect(s.upTo).toBe("2026-10");
    expect(s.feesCreated).toBe(2);
    expect(s.backfilled).toBe(1); // 2026-09 es anterior a upTo; 2026-10 es el mes vencido
  });

  it("correrlo dos veces el mismo día no crea nada la segunda (lectura previa)", async () => {
    const { db, createMany } = fakeDb(
      [{ id: 1, status: "active", category: "active", joinedAt: PADRON }],
      { fees: [{ memberId: 1, period: "2026-09" }] },
    );
    const s = await makeAccrualCron({ db: db as never, now }).run();
    expect(s.feesCreated).toBe(0);
    expect(s.membersAccrued).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("no trae socios que no devengan: el where filtra categoría y status", async () => {
    const { db } = fakeDb([]);
    await makeAccrualCron({ db: db as never, now }).run();
    expect(db.member.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ["active", "suspended"] }, category: { in: ["active", "collaborator"] } },
    }));
  });

  it("el reingreso se trae en LOTE, no una consulta por socio", async () => {
    const { db } = fakeDb(
      [{ id: 7, status: "active", category: "active", joinedAt: PADRON }],
      { readmissions: [{ memberId: 7, _max: { date: new Date("2026-09-20T12:00:00Z") } }] },
    );
    const s = await makeAccrualCron({ db: db as never, now }).run();
    expect(db.movement.groupBy).toHaveBeenCalledTimes(1);
    // Reingresó el 20/09: su piso es octubre y el mes vencido es septiembre.
    expect(s.feesCreated).toBe(0);
  });

  // El agujero que dejó anotado la revisión de la Task 3: `readmittedAt` es
  // OPCIONAL en la firma de `periodsToAccrue`, así que un cron que se olvidara
  // de traerlo compilaría igual y le devengaría al reingresado los meses en los
  // que estuvo de baja. Este caso lo fija.
  it("un reingresado NO devenga los meses en que estuvo de baja", async () => {
    // Corrida del 01/01/2027 → mes vencido = 2026-12. Sin `readmittedAt` el
    // piso sería el del padrón (2026-09) y se le crearían cuatro cuotas.
    const { db, createMany } = fakeDb(
      [{ id: 88, status: "active", category: "active", joinedAt: PADRON }],
      { readmissions: [{ memberId: 88, _max: { date: new Date("2026-11-15T12:00:00Z") } }] },
    );
    const s = await makeAccrualCron({ db: db as never, now: () => new Date("2027-01-01T03:30:00Z") }).run();
    expect(s.upTo).toBe("2026-12");
    expect(s.feesCreated).toBe(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ memberId: 88, period: "2026-12", status: "pending", origin: "accrual" }],
      skipDuplicates: true,
    });
    // Ni septiembre, ni octubre, ni el propio noviembre del reingreso (REG-14:
    // la cuota de reingreso cubre el mes del acta).
    const periods = createMany.mock.calls.flatMap(
      (c) => (c[0] as { data: Array<{ period: string }> }).data.map((d) => d.period),
    );
    expect(periods).not.toContain("2026-09");
    expect(periods).not.toContain("2026-10");
    expect(periods).not.toContain("2026-11");
  });

  it("un socio que falla no frena a los demás y su causa queda en errors[]", async () => {
    const createMany = vi.fn()
      .mockRejectedValueOnce(new Error("deadlock"))
      .mockResolvedValueOnce({ count: 1 });
    const { db } = fakeDb([
      { id: 1, status: "active", category: "active", joinedAt: PADRON },
      { id: 2, status: "active", category: "active", joinedAt: PADRON },
    ], { createMany });
    const s = await makeAccrualCron({ db: db as never, now }).run();
    expect(s.feesCreated).toBe(1);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain("member:1");
  });

  it("`upTo` inyectable: se puede pedir una corrida acotada sin tocar el reloj", async () => {
    const { db } = fakeDb([{ id: 1, status: "active", category: "active", joinedAt: PADRON }]);
    const s = await makeAccrualCron({ db: db as never, now }).run({ upTo: "2026-12" });
    expect(s.upTo).toBe("2026-12");
    expect(s.feesCreated).toBe(4); // 09, 10, 11 y 12
  });
});
