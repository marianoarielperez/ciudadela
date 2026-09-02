// El `where` de la cola de reportes (spec §5.3) y los contadores de los chips.
//
// La regla que sostiene esta unidad: **el contador de un chip y la lista que
// ese chip abre salen del MISMO `where`**. No es un detalle de prolijidad —
// `countByView` llama a `reportWhere(v.key, f)` con los filtros vigentes, que
// es exactamente lo que la página le pasa a `findMany`, así que "Presentados 7"
// y las 7 filas que aparecen al clickearlo son la misma consulta con otro
// `select`. Con una lista de estados para contar y otra para listar, alcanza
// con que alguien toque una (misma lección que `coverageFloor` y que
// `REPORT_VIEWS`).
//
// El cliente de Prisma se INYECTA, no se importa: `@/lib/prisma` tira al
// evaluarse si falta `DATABASE_URL`, y `tests/reports-query.test.ts` es un test
// puro sin base ni `.env`. La página pasa `prisma`; el test pasa un doble que
// HONRA el `where` que recibe. Mismo criterio que `applications/query.ts`.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { REPORT_VIEWS, reportView, type ReportFilters, type ReportViewKey } from "./reports-queue";

export function reportWhere(view: ReportViewKey, f: ReportFilters): Prisma.ReportWhereInput {
  // Los estados salen SIEMPRE de la vista: `draft` no está en ninguna, así que
  // un borrador que el vecino nunca envió no puede colarse ni en "Todos".
  const where: Prisma.ReportWhereInput = { status: { in: reportView(view).statuses } };
  if (f.kind) where.kind = f.kind;
  if (f.category) where.category = f.category;
  if (f.q) {
    // Los tres campos de texto que el operador busca (spec §5.3). `contains` a
    // secas: en MariaDB la collation ya es case-insensitive, y el `mode` de
    // Prisma es de PostgreSQL (ponerlo acá no haría nada y mentiría).
    const or: Prisma.ReportWhereInput[] = [
      { description: { contains: f.q } },
      { streetName: { contains: f.q } },
      { reporterName: { contains: f.q } },
    ];
    // Un texto todo dígitos es (también) el N° del reporte: el operador que
    // tipea "14" está buscando el reporte 14, y de paso sigue viendo el que
    // menciona "14" en la descripción. `> 0` y entero porque el id lo es;
    // `Number("14e3")` o `Number(" 14")` no llegan acá con forma de número
    // entero positivo por casualidad, así que se valida y no se confía.
    const n = Number(f.q);
    if (Number.isInteger(n) && n > 0) or.push({ id: n });
    where.OR = or;
  }
  return where;
}

/** Los cuatro contadores de los chips, con LOS MISMOS filtros que la lista.
 *  Cuatro `count` y no un `groupBy`: el `where` de cada vista es el de la
 *  lista, y un `groupBy` por estado sería una segunda definición de lo mismo. */
export async function countByView(
  db: Pick<PrismaClient, "report">,
  f: ReportFilters,
): Promise<Record<ReportViewKey, number>> {
  const entries = await Promise.all(
    REPORT_VIEWS.map(async (v) => [v.key, await db.report.count({ where: reportWhere(v.key, f) })] as const),
  );
  return Object.fromEntries(entries) as Record<ReportViewKey, number>;
}

/** Lo que la tarjeta de la lista muestra, y nada más. En particular NO trae
 *  `description` ni un solo dato de identidad del que reporta —ni el nombre,
 *  que sí es uno de los campos por los que se BUSCA—: el escrito y la persona
 *  viven en la ficha, y una lista de trabajo no necesita traerlos para
 *  imprimir "Vecino" o "Socio N° 12" (Ley 25.326, mismo criterio que la
 *  bandeja de Altas). Buscar por un campo no obliga a devolverlo. */
export const REPORT_LIST_SELECT = {
  id: true,
  kind: true,
  status: true,
  anonymous: true,
  memberId: true,
  category: true,
  subtype: true,
  streetName: true,
  addressDetail: true,
  submittedAt: true,
  outsideBoundary: true,
  scplTicket: true,
  lat: true,
  lng: true,
  files: { where: { kind: "photo" as const }, select: { id: true }, orderBy: { id: "asc" as const } },
  member: { select: { memberships: { select: { memberNumber: true, book: { select: { status: true } } } } } },
} satisfies Prisma.ReportSelect;
