import { describe, expect, it, vi } from "vitest";

// El módulo arma el singleton cacheado contra el prisma real al importarse y
// sin DATABASE_URL eso revienta antes del primer test. Acá se ejercita la
// FACTORY con un fake, así que el cliente real no hace falta.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeActivityQueries } from "@/lib/activities/query";

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Gimnasia mujeres",
  room: "historic",
  weekdays: [1, 3],
  startTime: "18:00",
  endTime: "19:30",
  year: 2026,
  active: true,
  ...over,
});

type Call = { method: string; args: Record<string, unknown> };

function fakeDb(rows: ReturnType<typeof row>[]) {
  // Se guardan los argumentos reales: un fake que siempre devuelve las mismas
  // filas no distingue una consulta bien filtrada de una rota.
  const calls: Call[] = [];
  const db = {
    activity: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ method: "findMany", args });
        return rows;
      },
    },
  } as never;
  const argsFor = (method: string) => {
    const call = calls.find((c) => c.method === method);
    if (!call) throw new Error(`no hubo ningún llamado a ${method}`);
    return call.args;
  };
  return { db, calls, argsFor };
}

describe("makeActivityQueries", () => {
  it("forYear: filtra por año Y activas en SQL, ordena por nombre", async () => {
    const { db, argsFor } = fakeDb([row()]);
    const items = await makeActivityQueries(db).forYear(2026);
    expect(items).toHaveLength(1);
    const args = argsFor("findMany");
    expect(args.where).toEqual({ year: 2026, active: true });
    expect(args.orderBy).toEqual({ name: "asc" });
  });

  it("forYear: NO filtra por día en la base (Prisma/MariaDB no sabe filtrar paths JSON)", async () => {
    const { db, argsFor } = fakeDb([row()]);
    await makeActivityQueries(db).forYear(2026);
    expect(JSON.stringify(argsFor("findMany"))).not.toContain("weekdays");
  });

  it("forYear: devuelve un DTO plano y serializable con los weekdays del JSON", async () => {
    const { db } = fakeDb([row()]);
    const [slot] = await makeActivityQueries(db).forYear(2026);
    expect(slot).toEqual({
      id: 1,
      name: "Gimnasia mujeres",
      room: "historic",
      weekdays: [1, 3],
      startTime: "18:00",
      endTime: "19:30",
      year: 2026,
      active: true,
    });
    // unstable_cache serializa a JSON: nada de Dates ni valores no clonables.
    expect(JSON.parse(JSON.stringify(slot))).toEqual(slot);
  });

  it("forYear: un weekdays JSON corrupto (null u objeto) no rompe la grilla", async () => {
    for (const weekdays of [null, {}, "1,3", undefined]) {
      const { db } = fakeDb([row({ weekdays })]);
      const [slot] = await makeActivityQueries(db).forYear(2026);
      expect(slot.weekdays).toEqual([]);
    }
  });

  it("years: años distintos de actividades activas, descendente", async () => {
    const { db, argsFor } = fakeDb([row({ year: 2026 }), row({ year: 2025 })]);
    const years = await makeActivityQueries(db).years();
    expect(years).toEqual([2026, 2025]);
    const args = argsFor("findMany");
    expect(args.where).toEqual({ active: true });
    expect(args.select).toEqual({ year: true });
    expect(args.distinct).toEqual(["year"]);
    expect(args.orderBy).toEqual({ year: "desc" });
  });

  it("allForAdmin: con año filtra por año y SIN filtrar por activa (el panel ve las apagadas)", async () => {
    const { db, argsFor } = fakeDb([row({ active: false })]);
    const rows = await makeActivityQueries(db).allForAdmin(2026);
    expect(rows[0].active).toBe(false);
    const args = argsFor("findMany");
    expect(args.where).toEqual({ year: 2026 });
    // El `id` final desempata: sin él, dos actividades con mismo año, salón y
    // horario salen en orden indefinido y el listado del panel baila.
    expect(args.orderBy).toEqual([
      { year: "desc" },
      { room: "asc" },
      { startTime: "asc" },
      { id: "asc" },
    ]);
  });

  it("allForAdmin: sin año no manda where (trae todos los años)", async () => {
    const { db, argsFor } = fakeDb([row()]);
    await makeActivityQueries(db).allForAdmin();
    expect(argsFor("findMany").where).toBeUndefined();
  });

  it("allForAdmin: el año 0 filtra por 0, no se confunde con 'sin año'", async () => {
    const { db, argsFor } = fakeDb([row({ year: 0 })]);
    await makeActivityQueries(db).allForAdmin(0);
    expect(argsFor("findMany").where).toEqual({ year: 0 });
  });
});
