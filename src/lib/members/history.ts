// Histórico: TODA persona que alguna vez pasó por la vecinal —las 160 vigentes y
// las 119 bajas— con su recorrido por los libros y, sobre todo, con la respuesta
// a la pregunta que el mostrador hace todo el tiempo: "¿este señor puede volver
// a asociarse?". Hoy esa respuesta no existe en ninguna pantalla: hay que cruzar
// a mano el motivo de baja, la fecha del último rechazo y la deuda viva.
//
// La consulta arranca en `Member` y NO exige membresía en el libro abierto, al
// revés que el padrón. No es una simplificación: el mismo caso que documenta
// `electoral.ts:56-63` —al abrir el Libro 2 por re-empadronamiento (REG-28) hay
// un lapso en el que un socio vigente todavía no fue asentado— dejaría fuera del
// histórico justo a las personas por las que se pregunta durante el cierre. Y
// una persona que quedó sólo en un libro cerrado (REG-29) tiene que figurar
// igual: la antigüedad no se reinicia, es la misma persona con otro número.
//
// Prisma inyectado (regla del proyecto: un módulo puro no importa `@/lib/prisma`,
// que tira al evaluarse si falta DATABASE_URL y voltearía el test sin `.env`).
import type {
  MemberCategory, MemberStatus, Prisma, PrismaClient, WithdrawalReason,
} from "@/generated/prisma/client";
import { paginate } from "@/lib/admin/pagination";

// ── Veredicto de reingreso ────────────────────────────────────────────────────

export type ReentryVerdict =
  | { kind: "member" }                     // vigente: no aplica
  | { kind: "blocked_forever" }            // expulsión / reentryBlocked
  | { kind: "blocked_until"; until: Date } // rejectedUntil futuro (REG-05)
  | { kind: "must_settle" }                // cesante con cuotas pendientes (REG-16)
  | { kind: "clear" };                     // puede reingresar por el proceso común

/** El orden de evaluación ES la regla estatutaria, no una preferencia de
 *  presentación: cada veredicto gana sobre los que siguen.
 *
 *  1. El socio vigente (activo o suspendido: el suspendido sigue siendo socio,
 *     REG-17) no es un caso de reingreso, tenga o no deuda.
 *  2. `reentryBlocked || withdrawalReason === "expulsion"` es el DOBLE criterio
 *     de `canReadmit` (`src/lib/members/rules.ts:45`), y por el mismo motivo:
 *     la prohibición del expulsado es absoluta, así que no puede colgar de un
 *     solo flag. Hay fichas viejas —import, arreglos a mano— con el motivo
 *     puesto y el flag en `false`; mirar sólo el flag reabriría la puerta en
 *     silencio.
 *  3. Un rechazo con plazo vigente (REG-05) es un "todavía no", con fecha.
 *  4. REG-16: lo que bloquea es la DEUDA VIVA de la cuenta corriente, no la
 *     marca histórica `debtAtWithdrawal` —que dice que el socio debía el día de
 *     la baja, no que siga debiendo—. Por eso la marca ni siquiera es un dato de
 *     entrada de esta función: quien pagó todo queda libre aunque siga marcada.
 */
export function reentryVerdict(input: {
  status: MemberStatus;
  reentryBlocked: boolean;
  withdrawalReason: WithdrawalReason | null;
  rejectedUntil: Date | null;
  pendingFees: number;
  now: Date;
}): ReentryVerdict {
  if (input.status === "active" || input.status === "suspended") return { kind: "member" };
  if (input.reentryBlocked || input.withdrawalReason === "expulsion") {
    return { kind: "blocked_forever" };
  }
  if (input.rejectedUntil && input.rejectedUntil > input.now) {
    return { kind: "blocked_until", until: input.rejectedUntil };
  }
  if (input.pendingFees > 0) return { kind: "must_settle" };
  return { kind: "clear" };
}

// ── Filtros ───────────────────────────────────────────────────────────────────

export type HistoryFilters = { q?: string; status?: MemberStatus; reason?: WithdrawalReason };

// Listas explícitas en vez de un `as` sobre el string crudo: el `as` taparía el
// día en que alguien agregue un valor al enum y se olvide de esta pantalla.
const STATUSES = ["active", "suspended", "withdrawn"] as const satisfies readonly MemberStatus[];
const REASONS = [
  "death", "resignation", "arrears", "moved_away",
  "not_reregistered", "expulsion", "duplicate_annulment", "other",
] as const satisfies readonly WithdrawalReason[];

export function parseHistoryFilters(
  sp: Record<string, string | string[] | undefined>,
): HistoryFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const f: HistoryFilters = {};
  const q = one(sp.q)?.trim();
  if (q) f.q = q;
  const status = one(sp.status);
  if (status && STATUSES.some((s) => s === status)) f.status = status as MemberStatus;
  const reason = one(sp.reason);
  if (reason && REASONS.some((r) => r === reason)) f.reason = reason as WithdrawalReason;
  return f;
}

// A diferencia de `padronWhere`, la búsqueda NO duplica los demás filtros dentro
// de cada rama del OR. Allá hacía falta porque el OR tenía que vivir en la raíz
// del `where` de `Membership` (las ramas cambiaban de relación); acá los filtros
// son campos del propio `Member`, así que quedan como AND implícito al lado del
// OR y el recorte es el mismo con la mitad del objeto.
export function historyWhere(f: HistoryFilters): Prisma.MemberWhereInput {
  const where: Prisma.MemberWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.reason) where.withdrawalReason = f.reason;
  if (f.q) where.OR = [{ fullName: { contains: f.q } }, { dni: { contains: f.q } }];
  return where;
}

// ── La página ─────────────────────────────────────────────────────────────────

export type HistoryDb = Pick<PrismaClient, "member">;

export type HistoryRow = {
  id: number;
  fullName: string;
  dni: string | null;
  category: MemberCategory;
  status: MemberStatus;
  withdrawalReason: WithdrawalReason | null;
  leftAt: Date | null;
  joinedAt: Date;
  /** Cuotas pendientes VIVAS (REG-16). Viene del `_count` de la misma consulta:
   *  una consulta de deuda por socio serían 50 idas a la base por página. */
  pendingFees: number;
  rejectedUntil: Date | null;
  reentryBlocked: boolean;
  memberships: Array<{ bookNumber: number; memberNumber: number }>;
};

export type HistoryPage = {
  rows: HistoryRow[];
  total: number;
  page: number;
  pageCount: number;
};

/** 50 por página, como el padrón: las 279 fichas quedan en 6 páginas. */
export const HISTORY_PAGE_SIZE = 50;

type RawHistoryMember = Omit<HistoryRow, "pendingFees" | "memberships"> & {
  memberships: Array<{ memberNumber: number; book: { number: number } }>;
  _count: { fees: number };
};

export async function fetchHistoryPage(
  db: HistoryDb,
  f: HistoryFilters,
  page: number,
): Promise<HistoryPage> {
  const where = historyWhere(f);
  const total = await db.member.count({ where });
  const { page: current, pageCount, skip, take } = paginate(total, page, HISTORY_PAGE_SIZE);

  const rows = await db.member.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      dni: true,
      category: true,
      status: true,
      withdrawalReason: true,
      leftAt: true,
      joinedAt: true,
      rejectedUntil: true,
      reentryBlocked: true,
      memberships: {
        select: { memberNumber: true, book: { select: { number: true } } },
        orderBy: { book: { number: "asc" } },
      },
      // La forma `_count.select.<rel>.where` está medida contra MariaDB real con
      // Prisma 7 (probe del 26/08/2026): devuelve las cuotas pendientes del
      // socio en la misma consulta. Sin ella habría que hacer un `groupBy`
      // aparte por página de ids.
      _count: { select: { fees: { where: { status: "pending" } } } },
    },
    // Alfabético por apellido, que es como se busca a una persona en el
    // mostrador. El desempate por `id` no es decorativo: con sólo `fullName`,
    // dos homónimos —existen— pueden salir en distinto orden en cada consulta y
    // uno de los dos se pierde entre dos páginas. Mismo argumento que
    // `compareForRoll` en `electoral.ts`.
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    skip,
    take,
  });

  return {
    rows: (rows as unknown as RawHistoryMember[]).map(({ _count, memberships, ...rest }) => ({
      ...rest,
      pendingFees: _count.fees,
      memberships: memberships.map((m) => ({
        bookNumber: m.book.number,
        memberNumber: m.memberNumber,
      })),
    })),
    total,
    page: current,
    pageCount,
  };
}
