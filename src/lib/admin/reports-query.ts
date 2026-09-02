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

import {
  civilYearOf, civilYearStartUtc, REPORT_VIEWS, reportView,
  type ReportFilters, type ReportViewKey,
} from "./reports-queue";

/** El techo de `Report.id`: la columna es un `Int` de Prisma, o sea un INT con
 *  signo de MariaDB. Un valor por encima no es "ningún reporte": es un literal
 *  que la base rechaza. */
const INT_MAX = 2147483647;

export function reportWhere(view: ReportViewKey, f: ReportFilters): Prisma.ReportWhereInput {
  // Los estados salen SIEMPRE de la vista: `draft` no está en ninguna, así que
  // un borrador que el vecino nunca envió no puede colarse ni en "Todos".
  const where: Prisma.ReportWhereInput = { status: { in: reportView(view).statuses } };
  if (f.kind) where.kind = f.kind;
  if (f.category) where.category = f.category;
  if (f.year) {
    // El año es el CIVIL ARGENTINO, no el que dice el UTC guardado: un reporte
    // enviado el 31/12 a las 23:00 hora argentina es de ESE año aunque en UTC
    // ya sea el 1/1 del siguiente (UTC-3 sin DST). Por eso los bordes son las
    // 03:00 UTC del 1/1 —la medianoche civil de acá— y no las 00:00 UTC. Con el
    // corte en UTC crudo, los últimos tres días de cada diciembre se le
    // adjudicarían al año siguiente, que es justo cuando el operador arma el
    // informe anual.
    //
    // `gte`/`lt` y no `gte`/`lte`: el 1/1 del año siguiente a las 00:00 en punto
    // pertenece al año siguiente, y con `lte` estaría en los dos.
    where.submittedAt = { gte: civilYearStartUtc(f.year), lt: civilYearStartUtc(f.year + 1) };
  }
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
    // menciona "14" en la descripción. Tres condiciones, y las tres importan:
    // entero y `> 0` porque el id lo es, y `<= 2147483647` porque la columna es
    // un INT con signo de MariaDB — un `q` de 19 dígitos pasa `Number.isInteger`
    // (es un float redondo, no un entero exacto) y llega a la base como un
    // literal fuera de rango. OJO: `Number("14e3")` da 14000 y SÍ es un entero
    // positivo, así que esta guarda no lo descarta; lo descarta el tope de 80
    // caracteres y nada más, y ese caso es inofensivo (busca el reporte 14000).
    const n = Number(f.q);
    if (Number.isInteger(n) && n > 0 && n <= INT_MAX) or.push({ id: n });
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

/** Los años que ofrece el desplegable: del actual (civil argentino) hacia atrás
 *  hasta el del PRIMER envío. Un `aggregate` con `_min` y no un `groupBy` por
 *  año ni un `distinct`: lo que hace falta es un piso, y el piso es una sola
 *  fila leída por índice — un `groupBy` traería un año por fila enviada para
 *  después descartarlos casi todos, y encima habría que agruparlos por el
 *  calendario de acá y no por el UTC de la columna.
 *
 *  Los años SIN reportes quedan igual en la lista: un desplegable con huecos
 *  ("2026, 2024") le hace creer al operador que 2025 no existe, cuando lo que
 *  pasa es que ese año no entró nada — y eso lo dice mejor la lista vacía.
 *
 *  Prisma se INYECTA, como en el resto del módulo: el test es puro y corre sin
 *  `DATABASE_URL`. */
export async function availableYears(
  db: Pick<PrismaClient, "report">,
  now: Date = new Date(),
): Promise<number[]> {
  const current = civilYearOf(now);
  // `submittedAt: { not: null }` es la misma frontera que `REPORT_VIEWS`: un
  // borrador que el vecino nunca envió no aporta un año al desplegable.
  const agg = await db.report.aggregate({
    where: { submittedAt: { not: null } },
    _min: { submittedAt: true },
  });
  const first = agg._min.submittedAt ? civilYearOf(agg._min.submittedAt) : current;
  // El piso nunca puede ser posterior al año en curso: con una fecha futura
  // cargada a mano, el `for` no daría ninguna vuelta y el desplegable quedaría
  // con "Todos los años" y nada más. Al menos el año actual siempre se ofrece.
  const floor = Math.min(first, current);
  const years: number[] = [];
  for (let y = current; y >= floor; y--) years.push(y);
  return years;
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
  // Sólo las fotos, y de cada una su id y su tipo. El `where` es la guarda que
  // vale —la cara del DNI no sale de la base— y el `kind` es la que se ve:
  // `reportPhotos` vuelve a filtrar en el llamador, así que borrar el `where`
  // por descuido deja la lista igual en vez de publicar un DNI en una miniatura.
  files: {
    where: { kind: "photo" as const },
    select: { id: true, kind: true },
    orderBy: { id: "asc" as const },
  },
  member: { select: { memberships: { select: { memberNumber: true, book: { select: { status: true } } } } } },
} satisfies Prisma.ReportSelect;

/** Cuántas miniaturas entran en una tarjeta (spec §6.3). */
export const REPORT_THUMBS = 2;

/** Las fotos de una tarjeta, y NADA más: la cara del DNI no se muestra en una
 *  lista de trabajo. De acá salen el contador ("3 fotos") y la tira de
 *  miniaturas, así que no pueden decir cosas distintas. */
export function reportPhotos<T extends { kind: string }>(files: readonly T[]): T[] {
  return files.filter((f) => f.kind === "photo");
}

/** Qué dice la línea de ubicación de la tarjeta. La calle cuando está; si no,
 *  el hecho de que haya un punto en el mapa —un reporte cargado desde el mapa
 *  del wizard no tiene calle y decía "Sin ubicación" teniendo coordenadas—; y
 *  recién ahí, nada. Puro: `lat`/`lng` llegan como `Decimal | null` de Prisma y
 *  acá sólo se pregunta si existen. */
export function reportPlaceLabel(r: {
  streetName: string | null;
  addressDetail: string | null;
  lat: unknown;
  lng: unknown;
}): string {
  const street = [r.streetName, r.addressDetail].filter(Boolean).join(" ").trim();
  if (street) return street;
  if (r.lat != null && r.lng != null) return "Punto en el mapa";
  return "Sin ubicación";
}
