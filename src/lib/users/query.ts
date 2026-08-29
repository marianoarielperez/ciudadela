// Lecturas de /admin/usuarios. El cliente de Prisma se INYECTA, no se importa:
// `@/lib/prisma` tira al evaluarse si falta DATABASE_URL y este módulo lo
// importan tests puros (patrón de applications/query.ts).
import type { MemberStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import { paginate, parsePage } from "@/lib/admin/pagination";
import {
  accountState, hasManagedRole, MANAGED_ROLES, type UserAccountState,
} from "@/lib/users/labels";

export type UsersDb = Pick<PrismaClient, "user" | "auditLog" | "userRole">;

// Dos preguntas PARECIDAS y distintas, cada una con su `where`. La primera es
// «¿queda alguien con el rol?» y la segunda «¿queda alguien que pueda entrar
// HOY?». Se separaron a propósito (verificación en vivo, 29/08/2026): una
// cuenta de gestión recién creada nace `active: true`, con
// `passwordChangedAt: null` y un hash de bytes aleatorios que nadie conoce, así
// que otorgarle superadmin suma para la primera pregunta y no para la segunda.
// Mezclarlas hacía que la alerta del tablero se apagara con una red que no
// existe.

/** "Superadmin ACTIVO": tiene el rol y su cuenta no está desactivada. Es el
 *  criterio de las GUARDAS del dominio —`revokeRole` y `setUserActive` cuentan
 *  con él después de escribir y dentro de la transacción (`service.ts`)— y el
 *  que el veredicto de la ficha lee para deshabilitar «quitar superadmin». Ahí
 *  la pregunta es si queda alguien con el rol: una cuenta activa sin contraseña
 *  puede recuperar el acceso, así que no dejarla contar cerraría operaciones
 *  legítimas. Con un `where` por camino alcanza con que uno se olvide del
 *  `user: { active: true }` para que la pantalla y la guarda no cuenten lo
 *  mismo (la lección de coverageFloor). */
export const ACTIVE_SUPERADMINS_WHERE: Prisma.UserRoleWhereInput = {
  role: { name: "superadmin" },
  user: { active: true },
};

/** El conteo de la pregunta «¿queda alguien con el rol?», para el consumidor que
 *  lo necesita fuera de una transacción: la ficha de la cuenta. */
export function countActiveSuperadmins(db: Pick<PrismaClient, "userRole">): Promise<number> {
  return db.userRole.count({ where: ACTIVE_SUPERADMINS_WHERE });
}

/** "Superadmin que YA PUEDE ENTRAR": activo y con contraseña creada. Es el
 *  criterio de la ALERTA de /admin/salud, que promete una red de seguridad —si
 *  se pierde una cuenta queda otra— y por eso sólo puede contar a quien entra
 *  hoy. Un segundo superadmin sin contraseña ni invitación viva sólo entraría
 *  por «olvidé mi contraseña», y sólo si controla esa casilla: si el email
 *  tiene un dedazo, no entra nadie y el tablero estaría diciendo que el sistema
 *  está cubierto.
 *
 *  Deliberadamente NO es el `where` de las guardas: éstas impiden quedarse en
 *  cero con el rol, y ahí una cuenta recuperable sí cuenta. */
export const SIGN_IN_READY_SUPERADMINS_WHERE: Prisma.UserRoleWhereInput = {
  role: { name: "superadmin" },
  user: { active: true, passwordChangedAt: { not: null } },
};

/** El conteo de la pregunta «¿queda alguien que pueda entrar hoy?», para el
 *  tablero de salud. */
export function countSignInReadySuperadmins(db: Pick<PrismaClient, "userRole">): Promise<number> {
  return db.userRole.count({ where: SIGN_IN_READY_SUPERADMINS_WHERE });
}

export type UserChip = "gestion" | "socios" | "inactivas" | "todas";
export type UserListFilters = { vista?: Exclude<UserChip, "todas">; q?: string };

// La lista vive en `labels.ts` (módulo puro): el chip, el conteo, el estado de
// la cuenta y las guardas del dominio deciden todos con la MISMA definición.
const MANAGED_ROLE_NAMES: string[] = [...MANAGED_ROLES];

// Un `where` por chip, COMPARTIDO entre el conteo y el filtro: cada chip
// filtra exactamente lo que cuenta (regla de /admin/socios). "todas" no está:
// es la ausencia de filtro.
export const CHIP_WHERE: Record<Exclude<UserChip, "todas">, Prisma.UserWhereInput> = {
  gestion: { roles: { some: { role: { name: { in: MANAGED_ROLE_NAMES } } } } },
  socios: {
    AND: [
      { roles: { some: { role: { name: "socio" } } } },
      { roles: { none: { role: { name: { in: MANAGED_ROLE_NAMES } } } } },
    ],
  },
  inactivas: { active: false },
};

const CHIP_KEYS = ["gestion", "socios", "inactivas"] as const;

/** Solo claves con valor válido: `?vista=basura` no filtra nada y no prende
 *  ningún chip (mismo criterio que parsePadronFilters). */
export function parseUserFilters(
  sp: Record<string, string | string[] | undefined>,
): UserListFilters {
  const filters: UserListFilters = {};
  const vista = Array.isArray(sp.vista) ? sp.vista[0] : sp.vista;
  if ((CHIP_KEYS as readonly string[]).includes(vista ?? "")) {
    filters.vista = vista as Exclude<UserChip, "todas">;
  }
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim();
  if (q) filters.q = q;
  return filters;
}

export function usersWhere(f: UserListFilters): Prisma.UserWhereInput {
  const parts: Prisma.UserWhereInput[] = [];
  if (f.vista) parts.push(CHIP_WHERE[f.vista]);
  if (f.q) parts.push({ OR: [{ name: { contains: f.q } }, { email: { contains: f.q } }] });
  return parts.length > 0 ? { AND: parts } : {};
}

export type UserCounts = Record<UserChip, number>;

export async function fetchUserCounts(db: UsersDb): Promise<UserCounts> {
  const [gestion, socios, inactivas, todas] = await Promise.all([
    db.user.count({ where: CHIP_WHERE.gestion }),
    db.user.count({ where: CHIP_WHERE.socios }),
    db.user.count({ where: CHIP_WHERE.inactivas }),
    db.user.count(),
  ]);
  return { gestion, socios, inactivas, todas };
}

export type UserRow = {
  id: number;
  email: string;
  name: string | null;
  lastLoginAt: Date | null;
  roles: string[];
  member: { id: number; status: MemberStatus } | null;
  state: UserAccountState;
};

const PAGE_SIZE = 50;

// La invitación de gestión más reciente por cuenta: alcanza para derivar el
// estado (viva / vencida / canjeada) sin una segunda consulta.
const LAST_INVITATION = {
  where: { purpose: "admin_invitation" as const },
  orderBy: { createdAt: "desc" as const },
  take: 1,
  select: { expiresAt: true, usedAt: true, createdAt: true },
};

export async function fetchUsersPage(
  db: UsersDb,
  filters: UserListFilters,
  sp: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
) {
  const where = usersWhere(filters);
  const total = await db.user.count({ where });
  const { page, pageCount, skip, take } = paginate(total, parsePage(sp), PAGE_SIZE);
  const users = await db.user.findMany({
    where,
    orderBy: { email: "asc" },
    skip,
    take,
    select: {
      id: true, email: true, name: true, active: true,
      passwordChangedAt: true, lastLoginAt: true,
      roles: { select: { role: { select: { name: true } } } },
      member: { select: { id: true, status: true } },
      actionTokens: LAST_INVITATION,
    },
  });
  const rows: UserRow[] = users.map((u) => {
    const roles = u.roles.map((r) => r.role.name);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      lastLoginAt: u.lastLoginAt,
      roles,
      member: u.member,
      // Los roles entran al estado: sin ellos, una cuenta de gestión sin
      // invitación (revocada, o borrada al cambiarle el email) se pintaba de
      // verde como "Activa" sin poder entrar.
      state: accountState(u, u.actionTokens[0] ?? null, hasManagedRole(roles), now),
    };
  });
  return { rows, total, page, pageCount, pageSize: PAGE_SIZE };
}

// Lo que la cuenta HIZO con su acceso (el resto de la actividad se busca por
// entity/entityId: son las acciones hechas SOBRE la cuenta).
const OWN_ACTIONS = [
  "login", "login_failed",
  "password_reset_requested", "password_reset_completed", "password_reset_failed",
  "admin_password_set", "member_user_created", "member_password_set",
];

export type UserActivityRow = {
  id: bigint;
  action: string;
  detail: unknown;
  createdAt: Date;
  /** Quién ejecutó la acción (nombre o email del actor), null si el asiento no
   *  tiene actor o el actor es la propia cuenta. */
  actor: string | null;
};

export type UserDetail = {
  id: number;
  email: string;
  name: string | null;
  active: boolean;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  roles: string[];
  member: { id: number; status: MemberStatus } | null;
  state: UserAccountState;
  invitation: { expiresAt: Date; createdAt: Date } | null;
  /** Cuántos superadmins ACTIVOS hay en total: la pantalla deshabilita "quitar
   *  superadmin" cuando el target es el último (lo mismo que la guarda de la
   *  transacción rechaza — patrón debit-adhesion). */
  activeSuperadmins: number;
  activity: UserActivityRow[];
};

export async function getUserDetail(
  db: UsersDb,
  id: number,
  now: Date = new Date(),
): Promise<UserDetail | null> {
  const u = await db.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, active: true,
      passwordChangedAt: true, lastLoginAt: true,
      roles: { select: { role: { select: { name: true } } } },
      member: { select: { id: true, status: true } },
      actionTokens: LAST_INVITATION,
    },
  });
  if (!u) return null;
  const [activeSuperadmins, activity] = await Promise.all([
    countActiveSuperadmins(db),
    db.auditLog.findMany({
      where: {
        OR: [
          { entity: "user", entityId: String(id) },
          { userId: id, action: { in: OWN_ACTIONS } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, action: true, detail: true, createdAt: true, userId: true,
        user: { select: { name: true, email: true } },
      },
    }),
  ]);
  const last = u.actionTokens[0] ?? null;
  const roles = u.roles.map((r) => r.role.name);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    active: u.active,
    lastLoginAt: u.lastLoginAt,
    passwordChangedAt: u.passwordChangedAt,
    roles,
    member: u.member,
    state: accountState(u, last, hasManagedRole(roles), now),
    invitation: last && last.usedAt === null
      ? { expiresAt: last.expiresAt, createdAt: last.createdAt }
      : null,
    activeSuperadmins,
    activity: activity.map((a) => ({
      id: a.id,
      action: a.action,
      detail: a.detail,
      createdAt: a.createdAt,
      actor: a.userId !== null && a.userId !== id
        ? (a.user?.name ?? a.user?.email ?? null)
        : null,
    })),
  };
}
