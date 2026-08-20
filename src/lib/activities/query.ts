// Consultas del calendario. Igual que las de noticias: DTOs planos (acá no
// hay Dates de todos modos) y singletons cacheados con tag para el público.
//
// Ojo con el filtro por día: `weekdays` es un JSON y Prisma sobre MariaDB no
// soporta filtros por path JSON, así que en SQL solo se filtra por año, salón
// y estado; el agrupamiento por día lo hace buildWeeklyGrid en JavaScript.
import { unstable_cache } from "next/cache";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { CACHE_TAGS } from "@/lib/cache-tags";
import type { ActivitySlot } from "@/lib/activities/rules";

type Db = Pick<PrismaClient, "activity">;

function toSlot(a: {
  id: number; name: string; room: string; weekdays: unknown;
  startTime: string; endTime: string; year: number; active: boolean;
}): ActivitySlot {
  return {
    id: a.id,
    name: a.name,
    room: a.room as "historic" | "glass",
    // El JSON viene de la base: si quedó nulo o con otra forma, la grilla se
    // dibuja vacía en vez de romper el render del calendario público.
    weekdays: Array.isArray(a.weekdays) ? (a.weekdays as number[]) : [],
    startTime: a.startTime,
    endTime: a.endTime,
    year: a.year,
    active: a.active,
  };
}

export function makeActivityQueries(db: Db) {
  return {
    async forYear(year: number): Promise<ActivitySlot[]> {
      const rows = await db.activity.findMany({ where: { year, active: true }, orderBy: { name: "asc" } });
      return rows.map(toSlot);
    },
    async years(): Promise<number[]> {
      const rows = await db.activity.findMany({
        where: { active: true },
        select: { year: true },
        distinct: ["year"],
        orderBy: { year: "desc" },
      });
      return rows.map((r) => r.year);
    },
    async allForAdmin(year?: number): Promise<ActivitySlot[]> {
      const rows = await db.activity.findMany({
        // Guard explícito contra `undefined`: `year ? …` trataría el año 0 como
        // "sin filtro". El `id` final desempata: sin él, dos actividades con el
        // mismo año, salón y horario salen en orden indefinido en el listado.
        where: year === undefined ? undefined : { year },
        orderBy: [{ year: "desc" }, { room: "asc" }, { startTime: "asc" }, { id: "asc" }],
      });
      return rows.map(toSlot);
    },
  };
}

export const activitiesQueries = makeActivityQueries(prisma);

export const getActivitiesForYear = unstable_cache(
  (year: number) => activitiesQueries.forYear(year),
  ["activities-for-year"],
  { tags: [CACHE_TAGS.activities] },
);
export const getActivityYears = unstable_cache(() => activitiesQueries.years(), ["activity-years"], {
  tags: [CACHE_TAGS.activities],
});
