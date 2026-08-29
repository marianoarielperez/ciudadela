// Filtros del LISTADO de /admin/actas, puros y sin Prisma: la pantalla los usa
// para armar el `where` y los links; el test los ejercita sin base.
//
// Regla dura del rediseño (mapa de riesgo): esta es la query de la PANTALLA.
// Los diez MinutePicker del panel tienen su propia consulta
// (`orderBy [{date:"desc"},{id:"desc"}], take: 30`) y NO comparten nada de acá.
import type { MinuteType } from "@/generated/prisma/client";

export const ACTAS_BASE = "/admin/actas";
export const ACTAS_PAGE_SIZE = 20;

export type ActasFilters = {
  tipo: MinuteType | null;
  anio: number | null;
  q: string | null;
};

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseActasFilters(
  sp: Record<string, string | string[] | undefined>,
): ActasFilters {
  const tipoRaw = one(sp.tipo);
  const tipo = tipoRaw === "board" || tipoRaw === "assembly" ? tipoRaw : null;
  const anioN = Number(one(sp.anio));
  const anio = Number.isInteger(anioN) && anioN >= 1900 && anioN <= 2100 ? anioN : null;
  const qRaw = (one(sp.q) ?? "").trim();
  const q = qRaw === "" ? null : qRaw.slice(0, 100);
  return { tipo, anio, q };
}

/** El `where` de la pantalla. Las fechas de las actas se guardan al MEDIODÍA
 *  UTC del día civil argentino (`parseMinuteDate`), así que el año civil ES el
 *  año UTC y el filtro por año no necesita aritmética de zona horaria. */
export function actasWhere(f: ActasFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (f.tipo) where.type = f.tipo;
  if (f.anio) {
    where.date = {
      gte: new Date(Date.UTC(f.anio, 0, 1)),
      lt: new Date(Date.UTC(f.anio + 1, 0, 1)),
    };
  }
  if (f.q) {
    // Un número busca el N° del acta y también el texto ("124" puede estar en
    // una descripción); texto puro sólo busca la descripción.
    where.OR = /^\d+$/.test(f.q)
      ? [{ number: Number(f.q) }, { description: { contains: f.q } }]
      : [{ description: { contains: f.q } }];
  }
  return where;
}

/** Para `pageHref`: la paginación conserva los filtros vigentes. */
export function actasFilterParams(f: ActasFilters): Record<string, string | undefined> {
  return {
    tipo: f.tipo ?? undefined,
    anio: f.anio ? String(f.anio) : undefined,
    q: f.q ?? undefined,
  };
}

/** Qué chip está prendido, mirando los filtros YA parseados (regla del padrón:
 *  cada chip filtra exactamente lo que cuenta). Con búsqueda o año activos no
 *  se prende ninguno: el conteo del chip es global y ya no coincide. */
export function activeChip(f: ActasFilters): "todas" | MinuteType | null {
  if (f.q || f.anio) return null;
  return f.tipo ?? "todas";
}

export function yearOf(date: Date): number {
  return date.getUTCFullYear();
}

/** Agrupa filas YA ordenadas por fecha descendente en bloques por año civil.
 *  No reordena: el orden lo decide la query de la pantalla. */
export function groupByYear<T extends { date: Date }>(
  rows: T[],
): Array<{ year: number; rows: T[] }> {
  const groups: Array<{ year: number; rows: T[] }> = [];
  for (const row of rows) {
    const year = yearOf(row.date);
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.rows.push(row);
    else groups.push({ year, rows: [row] });
  }
  return groups;
}
