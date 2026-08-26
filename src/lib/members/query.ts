// Shared padron query: listing page and Excel export use the same filters.
import type {
  Member, MemberCategory, MemberStatus, Prisma, PrismaClient, Street,
} from "@/generated/prisma/client";

// OJO: `vigentes` NO es un valor de `MemberStatus` y no hay que "corregirlo"
// agregándolo al enum. El enum del Libro tiene tres estados (`active`,
// `suspended`, `withdrawn`) y "vigente" del padrón son DOS de ellos: el
// suspendido sigue siendo socio (REG-17). Es un valor del FILTRO, no del
// dominio, y existe porque el chip "Vigentes 160" del listado tiene que llevar
// exactamente a esas 160 filas: sin él, el único destino posible era el padrón
// sin filtrar (279 filas) y el número prometido no coincidía con la lista.
export type PadronStatusFilter = MemberStatus | "vigentes";

// Los dos estados que componen "vigente". Un solo lugar: lo comparten el filtro
// de acá y el resumen de `fetchPadronCounts` más abajo.
const VIGENTE_STATUSES = ["active", "suspended"] as const satisfies readonly MemberStatus[];

export type PadronFilters = {
  q?: string;
  category?: MemberCategory;
  status?: PadronStatusFilter;
  email?: "con" | "sin" | "verificado";
  dni?: "con" | "sin";
};

const CATEGORIES = ["active", "adherent", "collaborator", "cadet", "honorary", "lifetime"];
const STATUS_FILTERS = [
  ...VIGENTE_STATUSES, "withdrawn", "vigentes",
] as const satisfies readonly PadronStatusFilter[];

// Predicado en vez de `includes` + `as`: el `as` taparía el día en que alguien
// agregue un estado al enum y se olvide de esta lista.
function isStatusFilter(v: string): v is PadronStatusFilter {
  return STATUS_FILTERS.some((s) => s === v);
}

export function parsePadronFilters(sp: Record<string, string | string[] | undefined>): PadronFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const f: PadronFilters = {};
  const q = one(sp.q)?.trim();
  if (q) f.q = q;
  const category = one(sp.category);
  if (category && CATEGORIES.includes(category)) f.category = category as MemberCategory;
  const status = one(sp.status);
  if (status && isStatusFilter(status)) f.status = status;
  const email = one(sp.email);
  if (email === "con" || email === "sin" || email === "verificado") f.email = email;
  const dni = one(sp.dni);
  if (dni === "con" || dni === "sin") f.dni = dni;
  return f;
}

export function padronWhere(f: PadronFilters): Prisma.MembershipWhereInput {
  const member: Prisma.MemberWhereInput = {};
  if (f.category) member.category = f.category;
  // "vigentes" se resuelve acá y no en la pantalla: el listado y la exportación
  // a Excel comparten esta función, así que el archivo sale con el mismo
  // recorte que el operador está mirando.
  if (f.status === "vigentes") member.status = { in: [...VIGENTE_STATUSES] };
  else if (f.status) member.status = f.status;
  if (f.email === "con") member.email = { not: null };
  if (f.email === "sin") member.emailStatus = "none";
  if (f.email === "verificado") member.emailStatus = "verified";
  if (f.dni === "con") member.dni = { not: null };
  if (f.dni === "sin") member.dni = null;

  const where: Prisma.MembershipWhereInput = { book: { status: "open" }, member };
  if (f.q) {
    // La búsqueda es un OR de tres campos, pero cada rama tiene que arrastrar los
    // demás filtros: si no, buscar un nombre con "Estado: vigente" puesto
    // devolvería también las bajas que matchean el nombre.
    const or: Prisma.MembershipWhereInput[] = [
      { member: { ...member, fullName: { contains: f.q } } },
      { member: { ...member, dni: { contains: f.q } } },
    ];
    const asNumber = Number(f.q);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      or.push({ member, memberNumber: asNumber });
    }
    return { book: { status: "open" }, OR: or };
  }
  return where;
}

// El domicilio de un socio del barrio vive en el catálogo de calles
// (member.streetId -> Street), no como texto en el propio Member: el listado
// no lo necesita para mostrar la tabla, pero la exportación a Excel sí
// (Task 16), así que la relación se trae siempre acá — un solo lugar del que
// cuelgan listado y export, en vez de dos queries que puedan divergir.
export type PadronRow = { memberNumber: number; member: Member & { street: Street | null } };

export async function fetchPadron(db: PrismaClient, f: PadronFilters): Promise<PadronRow[]> {
  const rows = await db.membership.findMany({
    where: padronWhere(f),
    include: { member: { include: { street: true } } },
    orderBy: { memberNumber: "asc" },
  });
  return rows.map((r) => ({
    memberNumber: r.memberNumber,
    member: r.member as Member & { street: Street | null },
  }));
}

// ── Paginación del listado ────────────────────────────────────────────────────
//
// `fetchPadron` de arriba NO pagina y no puede empezar a hacerlo: la exportación
// a Excel (`/api/admin/padron-export`) la usa para armar el archivo que la
// asociación presenta como padrón, y un `skip`/`take` adentro dejaría el archivo
// truncado en silencio — sin error, sin aviso, con las primeras filas nomás.
// Por eso la paginación vive en una función aparte que sólo usa la pantalla, y
// `tests/members-query.test.ts` vigila que `fetchPadron` siga sin `skip`/`take`.
//
// 50 filas por página: entran de sobra en una pantalla con scroll y el padrón
// completo (283) queda en 6 páginas. "Paginación simple", como pide la spec §6.
export const PADRON_PAGE_SIZE = 50;

// La página NO es un filtro y por eso no entra en `PadronFilters`: el link de
// "Exportar Excel" se arma con los filtros, y si `page` viajara ahí adentro el
// archivo volvería a quedar acoplado al listado por la puerta de atrás.
export function parsePadronPage(sp: Record<string, string | string[] | undefined>): number {
  const raw = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export type PadronPage = {
  rows: PadronRow[];
  total: number;
  /** Página efectiva: puede diferir de la pedida si venía más allá del final. */
  page: number;
  pageCount: number;
  pageSize: number;
};

export async function fetchPadronPage(
  db: Pick<PrismaClient, "membership">,
  f: PadronFilters,
  page: number,
): Promise<PadronPage> {
  const where = padronWhere(f);
  const total = await db.membership.count({ where });
  // Con 0 resultados sigue habiendo una página (vacía): así la pantalla nunca
  // dice "página 1 de 0".
  const pageCount = Math.max(1, Math.ceil(total / PADRON_PAGE_SIZE));
  // Un `?page=99` tipeado a mano —o un filtro que achica el padrón mientras se
  // navega— devolvería una tabla vacía sin explicar por qué. Se acota al final.
  const current = Math.min(Math.max(1, page), pageCount);
  const rows = await db.membership.findMany({
    where,
    include: { member: { include: { street: true } } },
    orderBy: { memberNumber: "asc" },
    skip: (current - 1) * PADRON_PAGE_SIZE,
    take: PADRON_PAGE_SIZE,
  });
  return {
    rows: rows.map((r) => ({
      memberNumber: r.memberNumber,
      member: r.member as Member & { street: Street | null },
    })),
    total,
    page: current,
    pageCount,
    pageSize: PADRON_PAGE_SIZE,
  };
}

// ── Resumen del libro abierto (chips del listado) ─────────────────────────────
//
// Los cinco números que el listado muestra arriba de los filtros. NO se
// recalculan con los filtros puestos: son el resumen del LIBRO, no del
// resultado. Si bajaran al filtrar, el operador perdería la única referencia
// contra la que compara lo que está mirando ("38 de 160", no "38 de 38").
//
// Una sola pasada, y el `groupBy` cruza estado × categoría a propósito: los
// chips se leen como un DESGLOSE —"160 vigentes = 36 activos + 124 adherentes",
// que es como la asociación cuenta su padrón— y eso obliga a contar activos y
// adherentes DENTRO de los vigentes. Con dos conteos sueltos (uno por estado,
// otro por categoría) "Activos" se llevaría también a las bajas de categoría
// activa y la suma dejaría de cerrar contra "Vigentes".
export type PadronDb = Pick<PrismaClient, "member">;

export type PadronCounts = {
  vigentes: number; activos: number; adherentes: number;
  suspendidos: number; bajas: number;
};

export async function fetchPadronCounts(db: PadronDb): Promise<PadronCounts> {
  const groups = await db.member.groupBy({
    by: ["status", "category"],
    // El libro CERRADO tiene sus propios socios (REG-29: la misma persona con
    // otro número). Sin este `where` el padrón vigente los contaría a todos.
    where: { memberships: { some: { book: { status: "open" } } } },
    _count: true,
  });

  const counts: PadronCounts = {
    vigentes: 0, activos: 0, adherentes: 0, suspendidos: 0, bajas: 0,
  };
  for (const g of groups) {
    const n = typeof g._count === "number" ? g._count : 0;
    // "Vigente" es del padrón, no del enum: el suspendido sigue siendo socio
    // (REG-17), así que suma acá y además en su propio chip. La lista de
    // estados es la MISMA que usa el filtro `status=vigentes` (VIGENTE_STATUSES,
    // arriba): si divergieran, el chip volvería a prometer un número que su
    // propia lista no muestra.
    if (VIGENTE_STATUSES.some((st) => st === g.status)) {
      counts.vigentes += n;
      if (g.category === "active") counts.activos += n;
      if (g.category === "adherent") counts.adherentes += n;
    }
    if (g.status === "suspended") counts.suspendidos += n;
    if (g.status === "withdrawn") counts.bajas += n;
  }
  return counts;
}
