# Módulo de usuarios y roles — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `/admin/usuarios` (superadmin-only): listado y detalle de cuentas, otorgar/quitar `admin`/`superadmin` con guardas transaccionales, alta de cuenta de gestión con invitación por email, activar/desactivar y gestión de invitaciones — según la spec `docs/superpowers/specs/2026-08-29-usuarios-roles-design.md`.

**Architecture:** Dominio nuevo en `src/lib/users/` (factories con Prisma inyectado, mutex + revalidación en transacción), un valor nuevo de enum `TokenPurpose` (`admin_invitation`), rama por `purpose` en la ruta pública `/acceso/[token]`, y tres pantallas que heredan el molde de Configuración/Salud/Socios.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7 (`@prisma/adapter-mariadb`), Auth.js v5, zod, vitest, Tailwind + componentes del shell admin.

## Global Constraints

- UI en **es-AR** (vos); código, nombres y commits en **inglés**. Mensajes zod SIEMPRE en castellano.
- Branch de trabajo: **`usuarios-roles`** (ya existe, con la spec commiteada).
- `requireSuperadminUsers()` (mensaje propio del módulo) en las TRES rutas y en CADA server action. El proxy no protege actions.
- Auditoría: `entity: "user"`, `entityId: targetUserId`, `detail` **sin datos personales** (nunca el email — Ley 25.326).
- **Ninguna llamada de red dentro de una `$transaction`** (el email de invitación va post-commit, best-effort).
- Migraciones con `prisma migrate`, nunca `db push`.
- Accesibilidad del shell: targets `min-h-11`, `outline-hidden` + `focus-visible:ring-*` (NUNCA `outline-none`), `aria-current="page"`. Nunca un `<thead>` sin filas (`EmptyState size="list"`).
- Colores: tokens `--primary`/`--success`/`--warning`; prohibido verde/ámbar crudo de Tailwind. Números con `font-mono tabular-nums`.
- Badges en `src/lib/admin/status-badges.ts`, no ternarios por pantalla.
- **Cero cambios** en `src/lib/treasury/*`, `src/lib/mp/*` y `src/lib/members/*` (verificado con `git diff --stat` en la Task 12).
- Comandos: tests `npx vitest run <archivo>`, typecheck `npx tsc --noEmit`, build `npm run build`.
- Commits frecuentes, uno por task como mínimo.
- **Tasks 9–11 (pantallas): invocar la skill `frontend-design` ANTES de escribir el JSX** (pedido explícito del operador).

---

### Task 1: Migración `admin_invitation` + TTL del token

**Files:**
- Modify: `prisma/schema.prisma:175-179` (enum `TokenPurpose`)
- Modify: `src/lib/tokens.ts:33-37` (`TOKEN_TTL`)
- Create: `prisma/migrations/<timestamp>_add_admin_invitation_token_purpose/` (la genera Prisma)

**Interfaces:**
- Produces: el valor `"admin_invitation"` como `TokenPurpose` válido, con TTL de 7 días. `ActionToken.userId` ya existe y es el titular de este propósito.

- [ ] **Step 1: Editar el enum en `prisma/schema.prisma`**

```prisma
enum TokenPurpose {
  email_verification
  password_invitation
  password_reset
  // Invitación de una cuenta de GESTIÓN (módulo de usuarios): cuelga de
  // `userId`, no de `memberId`. Se canjea en /acceso/[token] por la rama admin.
  admin_invitation
}
```

- [ ] **Step 2: Agregar el TTL en `src/lib/tokens.ts`**

`TOKEN_TTL` es `Record<TokenPurpose, number>`: sin la entrada nueva, `tsc` falla en todo el proyecto.

```ts
export const TOKEN_TTL: Record<TokenPurpose, number> = {
  email_verification: 7 * 24 * 60 * 60 * 1000,
  password_invitation: 7 * 24 * 60 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
  admin_invitation: 7 * 24 * 60 * 60 * 1000,
};
```

- [ ] **Step 3: Correr la migración**

Run: `npx prisma migrate dev --name add_admin_invitation_token_purpose`
Expected: migración aplicada; el cliente en `src/generated/prisma` se regenera. El SQL debe ser un `ALTER TABLE action_tokens MODIFY purpose ENUM(...)` aditivo.

- [ ] **Step 4: Typecheck y suite**

Run: `npx tsc --noEmit` → sin errores. Run: `npx vitest run` → toda la suite en verde (el enum es aditivo: nada existente cambia).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/tokens.ts src/generated
git commit -m "feat(users): add admin_invitation token purpose"
```

---

### Task 2: Dominio de lectura — `labels.ts` y `query.ts`

**Files:**
- Create: `src/lib/users/labels.ts`
- Create: `src/lib/users/query.ts`
- Test: `tests/users-labels.test.ts`

**Interfaces:**
- Produces:
  - `labels.ts`: `type UserAccountState = "active" | "disabled" | "invited" | "invitation_expired"`, `accountState(user, lastInvitation, now)`, `ROLE_LABELS`, `ACCOUNT_STATE_LABELS`, `auditActionLabel(action)`.
  - `query.ts`: `type UserChip = "gestion" | "socios" | "inactivas" | "todas"`, `type UserListFilters = { vista?: Exclude<UserChip, "todas">; q?: string }`, `parseUserFilters(sp)`, `CHIP_WHERE`, `usersWhere(f)`, `fetchUserCounts(db)`, `fetchUsersPage(db, f, page)` → `{ rows: UserRow[]; total; page; pageCount; pageSize }`, `getUserDetail(db, id)` → `UserDetail | null`.
- Consumes: `paginate`/`parsePage` de `@/lib/admin/pagination`; `accountState` de `labels.ts`.

- [ ] **Step 1: Escribir el test puro (falla: los módulos no existen)**

```ts
// tests/users-labels.test.ts
import { describe, expect, it } from "vitest";
import { accountState, ACCOUNT_STATE_LABELS, auditActionLabel } from "@/lib/users/labels";
import { parseUserFilters } from "@/lib/users/query";

const NOW = new Date("2026-08-29T12:00:00Z");
const live = { expiresAt: new Date("2026-09-04T12:00:00Z"), usedAt: null };
const expired = { expiresAt: new Date("2026-08-01T12:00:00Z"), usedAt: null };
const used = { expiresAt: new Date("2026-09-04T12:00:00Z"), usedAt: NOW };

describe("accountState", () => {
  it("una cuenta desactivada es 'disabled' aunque tenga invitación viva", () => {
    expect(accountState({ active: false, passwordChangedAt: null }, live, NOW)).toBe("disabled");
  });
  it("invitación viva sin contraseña → 'invited'", () => {
    expect(accountState({ active: true, passwordChangedAt: null }, live, NOW)).toBe("invited");
  });
  it("invitación vencida sin contraseña → 'invitation_expired'", () => {
    expect(accountState({ active: true, passwordChangedAt: null }, expired, NOW)).toBe("invitation_expired");
  });
  it("token canjeado → 'active' (passwordChangedAt quedó escrito en el canje)", () => {
    expect(accountState({ active: true, passwordChangedAt: NOW }, used, NOW)).toBe("active");
  });
  it("passwordChangedAt null SIN invitación jamás emitida es 'active' (fila previa a la migración de la columna)", () => {
    expect(accountState({ active: true, passwordChangedAt: null }, null, NOW)).toBe("active");
  });
  it("todo estado tiene etiqueta", () => {
    for (const s of ["active", "disabled", "invited", "invitation_expired"] as const) {
      expect(ACCOUNT_STATE_LABELS[s]).toBeTruthy();
    }
  });
});

describe("auditActionLabel", () => {
  it("traduce las conocidas y devuelve la cruda como fallback", () => {
    expect(auditActionLabel("role_grant")).toBe("Rol otorgado");
    expect(auditActionLabel("accion_rara")).toBe("accion_rara");
  });
});

describe("parseUserFilters", () => {
  it("solo acepta vistas válidas y trimea la búsqueda", () => {
    expect(parseUserFilters({ vista: "gestion", q: "  ana " })).toEqual({ vista: "gestion", q: "ana" });
    expect(parseUserFilters({ vista: "basura" })).toEqual({});
    expect(parseUserFilters({ vista: ["gestion", "socios"] })).toEqual({ vista: "gestion" });
    expect(parseUserFilters({})).toEqual({});
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npx vitest run tests/users-labels.test.ts` → FAIL ("Cannot find module @/lib/users/labels").

- [ ] **Step 3: Escribir `src/lib/users/labels.ts`**

```ts
// Etiquetas es-AR y estado derivado de una cuenta. Módulo PURO: sin Prisma y
// sin lucide, para que lo compartan pantalla, query y tests sin arrastrar nada.

/** El estado que la pantalla muestra de una cuenta. No existe en la base: se
 *  deriva de `active` + `passwordChangedAt` + la última invitación de gestión.
 *  Ojo con el null histórico: `passwordChangedAt` nulo en una fila ANTERIOR a
 *  la migración de la columna significa "no se escribió contraseña desde que
 *  existe la columna", no "nunca tuvo" — por eso "invitación vencida" exige
 *  además que exista una invitación de gestión emitida. */
export type UserAccountState = "active" | "disabled" | "invited" | "invitation_expired";

export function accountState(
  user: { active: boolean; passwordChangedAt: Date | null },
  lastInvitation: { expiresAt: Date; usedAt: Date | null } | null,
  now: Date = new Date(),
): UserAccountState {
  if (!user.active) return "disabled";
  if (lastInvitation && lastInvitation.usedAt === null && lastInvitation.expiresAt >= now) {
    return "invited";
  }
  if (user.passwordChangedAt === null && lastInvitation) return "invitation_expired";
  return "active";
}

export const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  socio: "Socio",
};

export const ACCOUNT_STATE_LABELS: Record<UserAccountState, string> = {
  active: "Activa",
  disabled: "Desactivada",
  invited: "Invitación pendiente",
  invitation_expired: "Invitación vencida",
};

/** Traducción de los `action` de audit_log que la sección Actividad muestra.
 *  Fallback a la acción cruda: un asiento nuevo sin etiqueta se ve feo, no
 *  desaparece. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  user_create: "Cuenta creada",
  user_update: "Datos editados",
  user_disable: "Cuenta desactivada",
  user_enable: "Cuenta reactivada",
  role_grant: "Rol otorgado",
  role_revoke: "Rol quitado",
  admin_invitation_sent: "Invitación enviada",
  admin_invitation_resent: "Invitación reenviada",
  admin_invitation_revoked: "Invitación revocada",
  admin_invitation_send_failed: "El correo de invitación no salió",
  admin_password_set: "Creó su contraseña",
  member_user_created: "Creó su cuenta de socio",
  member_password_set: "Restableció su contraseña (invitación de socio)",
  login: "Ingresó al sistema",
  login_failed: "Intento de ingreso fallido",
  password_reset_requested: "Pidió restablecer la contraseña",
  password_reset_completed: "Restableció la contraseña",
  password_reset_failed: "Restablecimiento fallido",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
```

- [ ] **Step 4: Escribir `src/lib/users/query.ts`**

```ts
// Lecturas de /admin/usuarios. El cliente de Prisma se INYECTA, no se importa:
// `@/lib/prisma` tira al evaluarse si falta DATABASE_URL y este módulo lo
// importan tests puros (patrón de applications/query.ts).
import type { MemberStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import { paginate, parsePage } from "@/lib/admin/pagination";
import { accountState, type UserAccountState } from "@/lib/users/labels";

export type UsersDb = Pick<PrismaClient, "user" | "auditLog" | "userRole">;

export type UserChip = "gestion" | "socios" | "inactivas" | "todas";
export type UserListFilters = { vista?: Exclude<UserChip, "todas">; q?: string };

const MANAGED_ROLE_NAMES = ["admin", "superadmin"];

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
  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    lastLoginAt: u.lastLoginAt,
    roles: u.roles.map((r) => r.role.name),
    member: u.member,
    state: accountState(u, u.actionTokens[0] ?? null, now),
  }));
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
    db.userRole.count({ where: { role: { name: "superadmin" }, user: { active: true } } }),
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
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    active: u.active,
    lastLoginAt: u.lastLoginAt,
    passwordChangedAt: u.passwordChangedAt,
    roles: u.roles.map((r) => r.role.name),
    member: u.member,
    state: accountState(u, last, now),
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
```

- [ ] **Step 5: Correr el test y verlo pasar**

Run: `npx vitest run tests/users-labels.test.ts` → PASS. Run: `npx tsc --noEmit` → sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/users/labels.ts src/lib/users/query.ts tests/users-labels.test.ts
git commit -m "feat(users): read-side domain (account state, filters, list and detail queries)"
```

---

### Task 3: Doble de base compartido para los tests del dominio

**Files:**
- Create: `tests/helpers/fake-users-db.ts`

**Interfaces:**
- Produces: `makeFakeUsersDb(seed?)` → objeto con `user`, `userRole`, `role`, `member`, `actionToken`, `$transaction` y `state` inspeccionable. **Honra los `where` que recibe** (lección del M6: un fake que re-implementa el filtro deja cláusulas sin ejercitar) y **emula rollback**: `$transaction` toma un snapshot (`structuredClone`) y lo restaura si `fn` tira.
- Consumes: nada del código de producción (es un doble puro).

- [ ] **Step 1: Escribir el helper**

```ts
// tests/helpers/fake-users-db.ts
// Doble de base en memoria para el dominio de usuarios. Dos reglas del
// proyecto (M6): HONRA los `where` que recibe —no los re-implementa como
// constantes— y emula ROLLBACK: si el callback de $transaction tira, el estado
// vuelve al snapshot. Implementa SOLO las formas de where/include que el
// dominio usa; una forma desconocida tira, para que un test nuevo no pase por
// un filtro ignorado en silencio.

type UserRow = {
  id: number; email: string; passwordHash: string; passwordChangedAt: Date | null;
  name: string | null; active: boolean; lastLoginAt: Date | null;
};
type RoleRow = { id: number; name: string };
type UserRoleRow = { userId: number; roleId: number };
type MemberRow = { id: number; email: string | null; userId: number | null };
type TokenRow = {
  id: number; purpose: string; tokenHash: string; memberId: number | null;
  applicationId: number | null; userId: number | null;
  expiresAt: Date; usedAt: Date | null; createdAt: Date;
};

export type FakeState = {
  users: UserRow[]; roles: RoleRow[]; userRoles: UserRoleRow[];
  members: MemberRow[]; actionTokens: TokenRow[];
};

export function makeFakeUsersDb(seed?: Partial<FakeState>) {
  let state: FakeState = {
    users: [], roles: [
      { id: 1, name: "superadmin" }, { id: 2, name: "admin" }, { id: 3, name: "socio" },
    ],
    userRoles: [], members: [], actionTokens: [],
    ...seed,
  };
  let nextId = 1000;

  const roleName = (roleId: number) => state.roles.find((r) => r.id === roleId)?.name;
  const rolesOf = (userId: number) =>
    state.userRoles.filter((ur) => ur.userId === userId).map((ur) => roleName(ur.roleId)!);

  function nameMatches(name: string | undefined, filter: unknown): boolean {
    if (filter === undefined) return true;
    if (typeof filter === "string") return name === filter;
    const f = filter as { in?: string[] };
    if (Array.isArray(f.in)) return f.in.includes(name ?? "");
    throw new Error(`fake: filtro de role.name no soportado: ${JSON.stringify(filter)}`);
  }

  function matchUserRoleWhere(ur: UserRoleRow, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k === "userId") { if (ur.userId !== v) return false; }
      else if (k === "role") {
        if (!nameMatches(roleName(ur.roleId), (v as { name?: unknown }).name)) return false;
      } else if (k === "user") {
        const u = state.users.find((x) => x.id === ur.userId);
        const f = v as { active?: boolean };
        if (f.active !== undefined && u?.active !== f.active) return false;
      } else throw new Error(`fake: userRole where no soportado: ${k}`);
    }
    return true;
  }

  function matchTokenWhere(t: TokenRow, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k === "tokenHash") { if (t.tokenHash !== v) return false; }
      else if (k === "id") { if (t.id !== v) return false; }
      else if (k === "userId") { if (t.userId !== v) return false; }
      else if (k === "memberId") { if (t.memberId !== v) return false; }
      else if (k === "usedAt") { if (t.usedAt !== v) return false; }
      else if (k === "purpose") {
        const f = v as { in?: string[] } | string;
        if (typeof f === "string") { if (t.purpose !== f) return false; }
        else if (Array.isArray(f.in)) { if (!f.in.includes(t.purpose)) return false; }
        else throw new Error("fake: purpose where no soportado");
      } else throw new Error(`fake: actionToken where no soportado: ${k}`);
    }
    return true;
  }

  function userView(u: UserRow, args?: { include?: Record<string, unknown> }) {
    if (!args?.include) return { ...u };
    const out: Record<string, unknown> = { ...u };
    if (args.include.roles) {
      out.roles = state.userRoles
        .filter((ur) => ur.userId === u.id)
        .map((ur) => ({ ...ur, role: { id: ur.roleId, name: roleName(ur.roleId)! } }));
    }
    if (args.include.member) {
      const m = state.members.find((x) => x.userId === u.id);
      out.member = m ? { id: m.id } : null;
    }
    return out;
  }

  const db = {
    get state() { return state; },
    user: {
      async findUnique(args: {
        where: { id?: number; email?: string }; include?: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) {
        const u = state.users.find((x) =>
          args.where.id !== undefined ? x.id === args.where.id : x.email === args.where.email,
        );
        return u ? userView(u, args) : null;
      },
      async create(args: { data: Record<string, unknown> }) {
        const email = args.data.email as string;
        if (state.users.some((u) => u.email === email)) {
          throw { code: "P2002", meta: { driverAdapterError: { cause: { constraint: { index: "users_email_key" } } } } };
        }
        const u: UserRow = {
          id: nextId++, email,
          passwordHash: (args.data.passwordHash as string) ?? "x",
          passwordChangedAt: (args.data.passwordChangedAt as Date) ?? null,
          name: (args.data.name as string) ?? null,
          active: (args.data.active as boolean) ?? true,
          lastLoginAt: null,
        };
        state.users.push(u);
        return { ...u };
      },
      async update(args: { where: { id: number }; data: Record<string, unknown> }) {
        const u = state.users.find((x) => x.id === args.where.id);
        if (!u) throw new Error("fake: user.update sobre id inexistente");
        if (args.data.email !== undefined && args.data.email !== u.email
          && state.users.some((x) => x.email === args.data.email)) {
          throw { code: "P2002", meta: { driverAdapterError: { cause: { constraint: { index: "users_email_key" } } } } };
        }
        Object.assign(u, args.data);
        return { ...u };
      },
      async count() { return state.users.length; },
    },
    role: {
      async findUnique(args: { where: { name: string } }) {
        return state.roles.find((r) => r.name === args.where.name) ?? null;
      },
    },
    userRole: {
      async create(args: { data: UserRoleRow }) {
        state.userRoles.push({ ...args.data });
        return { ...args.data };
      },
      async deleteMany(args: { where: Record<string, unknown> }) {
        const before = state.userRoles.length;
        state.userRoles = state.userRoles.filter((ur) => !matchUserRoleWhere(ur, args.where));
        return { count: before - state.userRoles.length };
      },
      async count(args: { where: Record<string, unknown> }) {
        return state.userRoles.filter((ur) => matchUserRoleWhere(ur, args.where)).length;
      },
    },
    member: {
      async findFirst(args: { where: { email?: string }; select?: Record<string, unknown> }) {
        const m = state.members.find((x) => x.email === args.where.email);
        return m ? { ...m } : null;
      },
    },
    actionToken: {
      async create(args: { data: Omit<TokenRow, "id" | "usedAt" | "createdAt"> }) {
        const t: TokenRow = { id: nextId++, usedAt: null, createdAt: new Date(), ...args.data };
        state.actionTokens.push(t);
        return { ...t };
      },
      async findUnique(args: { where: { tokenHash: string } }) {
        const t = state.actionTokens.find((x) => x.tokenHash === args.where.tokenHash);
        return t ? { ...t } : null;
      },
      async deleteMany(args: { where: Record<string, unknown> }) {
        const before = state.actionTokens.length;
        state.actionTokens = state.actionTokens.filter((t) => !matchTokenWhere(t, args.where));
        return { count: before - state.actionTokens.length };
      },
      async updateMany(args: { where: Record<string, unknown>; data: Partial<TokenRow> }) {
        let count = 0;
        for (const t of state.actionTokens) {
          if (matchTokenWhere(t, args.where)) { Object.assign(t, args.data); count++; }
        }
        return { count };
      },
    },
    async $transaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
      const snapshot = structuredClone(state);
      try {
        return await fn(db);
      } catch (e) {
        state = snapshot; // rollback
        throw e;
      }
    },
  };
  return db;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → sin errores.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/fake-users-db.ts
git commit -m "test(users): in-memory db double with where-honoring filters and rollback"
```

---

### Task 4: Dominio de escritura — `service.ts` (alta, edición, invitaciones)

**Files:**
- Create: `src/lib/users/service.ts`
- Test: `tests/users-service.test.ts`

**Interfaces:**
- Produces: `type ManagedRole = "admin" | "superadmin"`, `USER_GUARD_MESSAGES`, `makeUserAdminService(db)` con `createManagedUser`, `updateManagedUser`, `resendInvitation`, `revokeInvitation` (esta task) y `grantRole`, `revokeRole`, `setUserActive` (Task 5). **Solo la factory se exporta** (el bind con `prisma` lo hace `actions.ts` en la Task 8): así los tests puros no arrastran `@/lib/prisma`.
- Consumes: `createKeyedMutex`, `makeTokens` (Task 1: propósito `admin_invitation`), `isUniqueViolation`.

- [ ] **Step 1: Escribir los tests de esta mitad (fallan: el módulo no existe)**

```ts
// tests/users-service.test.ts
import { describe, expect, it, vi } from "vitest";
// `makeTokens` importa `@/lib/prisma` para su versión ligada: se mockea para
// que el test puro no exija DATABASE_URL.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeFakeUsersDb } from "./helpers/fake-users-db";
import { makeUserAdminService, USER_GUARD_MESSAGES } from "@/lib/users/service";

const HASH = "$2b$12$XHfiAzolMFmdVT8v4PxyjuE0zE.lYU0I3W.1mn8IuVLg6LFDwN1QS";

function seeded() {
  const db = makeFakeUsersDb({
    users: [
      { id: 1, email: "root@x.com", passwordHash: HASH, passwordChangedAt: new Date(), name: "Root", active: true, lastLoginAt: null },
      { id: 2, email: "ana@x.com", passwordHash: HASH, passwordChangedAt: new Date(), name: "Ana", active: true, lastLoginAt: null },
      { id: 3, email: "socio@x.com", passwordHash: HASH, passwordChangedAt: new Date(), name: "Socio", active: true, lastLoginAt: null },
    ],
    // 1 = superadmin+admin, 2 = admin, 3 = socio
    userRoles: [
      { userId: 1, roleId: 1 }, { userId: 1, roleId: 2 },
      { userId: 2, roleId: 2 }, { userId: 3, roleId: 3 },
    ],
    members: [{ id: 50, email: "socio@x.com", userId: 3 }, { id: 51, email: "sin-cuenta@x.com", userId: null }],
  });
  return { db, service: makeUserAdminService(db) };
}

describe("createManagedUser", () => {
  it("crea la cuenta con rol admin y una invitación admin_invitation viva", async () => {
    const { db, service } = seeded();
    const res = await service.createManagedUser({ email: "Nueva@X.com", name: "Nueva", passwordHash: HASH });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const u = db.state.users.find((x) => x.id === res.userId)!;
    expect(u.email).toBe("nueva@x.com"); // normalizado como verify-credentials
    expect(u.passwordChangedAt).toBeNull();
    expect(db.state.userRoles.some((ur) => ur.userId === res.userId && ur.roleId === 2)).toBe(true);
    const t = db.state.actionTokens.find((x) => x.userId === res.userId)!;
    expect(t.purpose).toBe("admin_invitation");
    expect(res.rawToken.length).toBeGreaterThan(20);
  });

  it("rechaza un email que ya tiene cuenta", async () => {
    const { service } = seeded();
    const res = await service.createManagedUser({ email: "ana@x.com", name: "Otra", passwordHash: HASH });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.emailTaken });
  });

  it("rechaza el email de la ficha de un socio (con o sin cuenta)", async () => {
    const { service } = seeded();
    const res = await service.createManagedUser({ email: "sin-cuenta@x.com", name: "X", passwordHash: HASH });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.memberCardEmail });
  });
});

describe("updateManagedUser", () => {
  it("edita nombre y email de una cuenta sin socio, revocando los tokens vivos", async () => {
    const { db, service } = seeded();
    const created = await service.createManagedUser({ email: "temp@x.com", name: "Temp", passwordHash: HASH });
    if (!created.ok) throw new Error("seed");
    const res = await service.updateManagedUser({ targetId: created.userId, name: "Temp 2", email: "temp2@x.com" });
    expect(res.ok).toBe(true);
    const u = db.state.users.find((x) => x.id === created.userId)!;
    expect(u.email).toBe("temp2@x.com");
    // el cambio de email mata la invitación emitida hacia la casilla anterior
    expect(db.state.actionTokens.filter((t) => t.userId === created.userId && t.usedAt === null)).toHaveLength(0);
  });

  it("no toca el email de una cuenta con socio vinculado", async () => {
    const { service } = seeded();
    const res = await service.updateManagedUser({ targetId: 3, name: "Socio", email: "otro@x.com" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.memberEmail });
  });

  it("traduce la colisión de unique a su mensaje", async () => {
    const { service } = seeded();
    const created = await service.createManagedUser({ email: "temp@x.com", name: "Temp", passwordHash: HASH });
    if (!created.ok) throw new Error("seed");
    const res = await service.updateManagedUser({ targetId: created.userId, name: "Temp", email: "ana@x.com" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.emailTaken });
  });
});

describe("invitaciones", () => {
  it("resend revoca la anterior y emite una nueva", async () => {
    const { db, service } = seeded();
    const created = await service.createManagedUser({ email: "temp@x.com", name: "Temp", passwordHash: HASH });
    if (!created.ok) throw new Error("seed");
    const res = await service.resendInvitation({ targetId: created.userId });
    expect(res.ok).toBe(true);
    const live = db.state.actionTokens.filter((t) => t.userId === created.userId && t.usedAt === null);
    expect(live).toHaveLength(1);
  });

  it("resend rechaza una cuenta que ya creó su contraseña", async () => {
    const { service } = seeded();
    const res = await service.resendInvitation({ targetId: 2 });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.alreadyRedeemed });
  });

  it("revoke borra la invitación viva y rechaza si no hay ninguna", async () => {
    const { db, service } = seeded();
    const created = await service.createManagedUser({ email: "temp@x.com", name: "Temp", passwordHash: HASH });
    if (!created.ok) throw new Error("seed");
    expect((await service.revokeInvitation({ targetId: created.userId })).ok).toBe(true);
    expect(db.state.actionTokens.filter((t) => t.userId === created.userId && t.usedAt === null)).toHaveLength(0);
    const again = await service.revokeInvitation({ targetId: created.userId });
    expect(again).toEqual({ ok: false, error: USER_GUARD_MESSAGES.noInvitation });
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/users-service.test.ts` → FAIL ("Cannot find module @/lib/users/service").

- [ ] **Step 3: Escribir `src/lib/users/service.ts`** (con las firmas de Task 5 ya declaradas, implementadas allá)

```ts
// Escrituras del módulo de usuarios: alta de cuenta de gestión, roles
// admin/superadmin, estado de la cuenta e invitaciones.
//
// Tres reglas de la spec (2026-08-29 §4.2):
//  - TODA escritura pasa por un mutex en memoria de UNA clave ("user-roles"),
//    premisa de un solo proceso (docs/03). El mutex es cinturón;
//  - ...y las guardas se REVALIDAN dentro de la $transaction, que es el
//    tirante (lección del cerrojo optimista de la exención): "nunca cero
//    superadmins activos" se cuenta DESPUÉS de la escritura, adentro.
//  - El rol "socio" no es un valor posible acá: `ManagedRole` lo excluye por
//    construcción, no por validación.
//
// Solo se exporta la FACTORY: el bind con prisma vive en las actions. Un test
// puro que importe este módulo no arrastra `@/lib/prisma` por su propia
// cuenta (sí lo arrastra `@/lib/tokens`, que los tests mockean).
import type { PrismaClient } from "@/generated/prisma/client";
import { createKeyedMutex } from "@/lib/keyed-mutex";
import { makeTokens } from "@/lib/tokens";
import { isUniqueViolation } from "@/lib/treasury/unique-violation";

export type ManagedRole = "admin" | "superadmin";
export const MANAGED_ROLES: readonly ManagedRole[] = ["admin", "superadmin"];

// Los TEXTOS salen del dominio (patrón GRANT_GUARD_MESSAGES de la exención):
// el operador lee lo mismo se corte donde se corte, y la pantalla deshabilita
// con el mismo motivo que la action rechaza.
export const USER_GUARD_MESSAGES = {
  emailTaken: "Ya existe una cuenta con ese email.",
  memberCardEmail:
    "Ese email es el de la ficha de un socio. Si ya tiene cuenta, otorgale el rol a esa cuenta; " +
    "si no, envíale el acceso de socio desde su ficha y después otorgale el rol.",
  roleUnavailable: "Falta un rol base en el sistema. Comunicate con el desarrollador.",
  notFound: "Esa cuenta no existe.",
  alreadyHasRole: "La cuenta ya tiene ese rol.",
  missingRole: "La cuenta no tiene ese rol.",
  selfSuperadmin: "No podés quitarte tu propio rol de superadmin.",
  selfDisable: "No podés desactivar tu propia cuenta.",
  lastSuperadmin: "El sistema no puede quedar sin ningún superadmin activo.",
  notManaged: "Esa cuenta no es de gestión: su estado lo gobierna el ciclo del socio (baja y readmisión).",
  memberEmail: "El email de una cuenta con socio vinculado se cambia desde la ficha del socio.",
  noChange: "La cuenta ya estaba en ese estado.",
  noInvitation: "Esa cuenta no tiene una invitación viva.",
  alreadyRedeemed: "Esa cuenta ya creó su contraseña: no hay invitación que gestionar.",
  inactiveInvitation: "Una cuenta desactivada no puede recibir una invitación: reactivala primero.",
} as const;

/** Rechazo que hace ROLLBACK de la transacción (misma mecánica que
 *  `AccessAbort` en members/access.ts). */
class UserGuardAbort extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "UserGuardAbort";
  }
}

type UsersWriteDb = Pick<
  PrismaClient,
  "$transaction" | "user" | "userRole" | "role" | "actionToken" | "member"
>;
type Tx = Parameters<Parameters<UsersWriteDb["$transaction"]>[0]>[0];

export type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function makeUserAdminService(db: UsersWriteDb) {
  const mutex = createKeyedMutex();
  const LOCK = "user-roles";

  function run<T>(fn: (tx: Tx) => Promise<{ ok: true } & T>): Promise<ServiceResult<T>> {
    return mutex.run(LOCK, async () => {
      try {
        return await db.$transaction(fn);
      } catch (e) {
        if (e instanceof UserGuardAbort) return { ok: false as const, error: e.reason };
        throw e;
      }
    });
  }

  async function managedTarget(tx: Tx, targetId: number) {
    const target = await tx.user.findUnique({
      where: { id: targetId },
      include: { roles: { include: { role: true } } },
    });
    if (!target) throw new UserGuardAbort(USER_GUARD_MESSAGES.notFound);
    const names = target.roles.map((r) => r.role.name);
    return { target, names, managed: names.some((n) => (MANAGED_ROLES as readonly string[]).includes(n)) };
  }

  /** Cuántos superadmins ACTIVOS quedan. Se llama DESPUÉS de la escritura y
   *  dentro de la transacción: es la guarda real, no la de la pantalla. */
  function activeSuperadmins(tx: Tx): Promise<number> {
    return tx.userRole.count({ where: { role: { name: "superadmin" }, user: { active: true } } });
  }

  return {
    /** Alta de cuenta de gestión. `passwordHash` viene calculado de AFUERA
     *  (bcrypt ~300 ms, nunca con la transacción abierta) y es un hash de
     *  bytes aleatorios que nadie conoce: el login es imposible hasta el
     *  canje, con el mismo costo de tiempo de siempre (anti-enumeración). */
    async createManagedUser(input: {
      email: string; name: string; passwordHash: string; now?: Date;
    }): Promise<ServiceResult<{ userId: number; rawToken: string }>> {
      const email = input.email.toLowerCase().trim();
      const now = input.now ?? new Date();
      // Pre-validaciones baratas ANTES de abrir nada (patrón de la exención):
      // por acá se rechaza casi siempre, y con el mensaje útil.
      const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) return { ok: false, error: USER_GUARD_MESSAGES.emailTaken };
      // Cualquier ficha con ese email bloquea el alta: si el socio ya tiene
      // cuenta, el rol se otorga ahí; si no, crear una cuenta de gestión con
      // esa dirección le rompería el canje de su invitación de socio (guarda
      // anti-escalada de members/access.ts, que es deliberada y no se toca).
      const card = await db.member.findFirst({ where: { email }, select: { id: true } });
      if (card) return { ok: false, error: USER_GUARD_MESSAGES.memberCardEmail };

      return run(async (tx) => {
        const adminRole = await tx.role.findUnique({ where: { name: "admin" } });
        if (!adminRole) throw new UserGuardAbort(USER_GUARD_MESSAGES.roleUnavailable);
        try {
          // `passwordChangedAt` queda en null A PROPÓSITO: junto con la
          // invitación viva es lo que la pantalla lee como "invitación
          // pendiente" (accountState).
          const user = await tx.user.create({
            data: { email, name: input.name, passwordHash: input.passwordHash, active: true },
          });
          await tx.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
          const rawToken = await makeTokens(tx).issue({ purpose: "admin_invitation", userId: user.id, now });
          return { ok: true as const, userId: user.id, rawToken };
        } catch (e) {
          // La carrera contra otro alta con el mismo email: el unique decide.
          if (isUniqueViolation(e)) throw new UserGuardAbort(USER_GUARD_MESSAGES.emailTaken);
          throw e;
        }
      });
    },

    /** Nombre siempre; email SOLO sin socio vinculado (spec §2 decisión 10).
     *  El cambio de email revoca los tokens emitidos hacia la casilla vieja
     *  (mismo motivo que members/write.ts: quien tenga el buzón anterior no
     *  puede quedarse con la cuenta). */
    async updateManagedUser(input: {
      targetId: number; name: string; email?: string;
    }): Promise<ServiceResult<{ emailChanged: boolean }>> {
      return run(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: input.targetId },
          include: { member: { select: { id: true } } },
        });
        if (!target) throw new UserGuardAbort(USER_GUARD_MESSAGES.notFound);
        const email = input.email?.toLowerCase().trim();
        const emailChanged = email !== undefined && email !== "" && email !== target.email;
        if (emailChanged && target.member) throw new UserGuardAbort(USER_GUARD_MESSAGES.memberEmail);
        try {
          await tx.user.update({
            where: { id: target.id },
            data: { name: input.name, ...(emailChanged ? { email } : {}) },
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw new UserGuardAbort(USER_GUARD_MESSAGES.emailTaken);
          throw e;
        }
        if (emailChanged) {
          await makeTokens(tx).revokeForUser(target.id, ["admin_invitation", "password_reset"]);
        }
        return { ok: true as const, emailChanged };
      });
    },

    /** Reemite la invitación: revoca la viva y emite una nueva (quien emite
     *  está autenticado como superadmin: revocar al emitir es la regla del
     *  encabezado de tokens.ts). El ENVÍO va después del commit, en la action. */
    async resendInvitation(input: {
      targetId: number; now?: Date;
    }): Promise<ServiceResult<{ rawToken: string; email: string }>> {
      return run(async (tx) => {
        const { target, managed } = await managedTarget(tx, input.targetId);
        if (!managed) throw new UserGuardAbort(USER_GUARD_MESSAGES.notManaged);
        if (target.passwordChangedAt !== null) throw new UserGuardAbort(USER_GUARD_MESSAGES.alreadyRedeemed);
        if (!target.active) throw new UserGuardAbort(USER_GUARD_MESSAGES.inactiveInvitation);
        const tokens = makeTokens(tx);
        await tokens.revokeForUser(target.id, ["admin_invitation"]);
        const rawToken = await tokens.issue({
          purpose: "admin_invitation", userId: target.id, now: input.now ?? new Date(),
        });
        return { ok: true as const, rawToken, email: target.email };
      });
    },

    async revokeInvitation(input: { targetId: number }): Promise<ServiceResult> {
      return run(async (tx) => {
        const count = await makeTokens(tx).revokeForUser(input.targetId, ["admin_invitation"]);
        if (count === 0) throw new UserGuardAbort(USER_GUARD_MESSAGES.noInvitation);
        return { ok: true as const };
      });
    },

    // ── Task 5 implementa estos tres ─────────────────────────────────────────
    async grantRole(input: {
      actorId: number; targetId: number; role: ManagedRole;
    }): Promise<ServiceResult> {
      return run(async (tx) => {
        const { target, names } = await managedTarget(tx, input.targetId);
        if (names.includes(input.role)) throw new UserGuardAbort(USER_GUARD_MESSAGES.alreadyHasRole);
        const role = await tx.role.findUnique({ where: { name: input.role } });
        if (!role) throw new UserGuardAbort(USER_GUARD_MESSAGES.roleUnavailable);
        await tx.userRole.create({ data: { userId: target.id, roleId: role.id } });
        return { ok: true as const };
      });
    },

    async revokeRole(input: {
      actorId: number; targetId: number; role: ManagedRole;
    }): Promise<ServiceResult> {
      // Guarda 1 (barata, fuera de la tx porque no depende de la base): el
      // superadmin no se degrada a sí mismo.
      if (input.role === "superadmin" && input.targetId === input.actorId) {
        return { ok: false, error: USER_GUARD_MESSAGES.selfSuperadmin };
      }
      return run(async (tx) => {
        const deleted = await tx.userRole.deleteMany({
          where: { userId: input.targetId, role: { name: input.role } },
        });
        if (deleted.count === 0) throw new UserGuardAbort(USER_GUARD_MESSAGES.missingRole);
        // Guarda 2, DESPUÉS de la escritura y adentro: si esta revocación dejó
        // cero superadmins activos, la transacción entera vuelve atrás.
        if (input.role === "superadmin" && (await activeSuperadmins(tx)) === 0) {
          throw new UserGuardAbort(USER_GUARD_MESSAGES.lastSuperadmin);
        }
        return { ok: true as const };
      });
    },

    async setUserActive(input: {
      actorId: number; targetId: number; active: boolean;
    }): Promise<ServiceResult> {
      if (!input.active && input.targetId === input.actorId) {
        return { ok: false, error: USER_GUARD_MESSAGES.selfDisable };
      }
      return run(async (tx) => {
        const { target, names, managed } = await managedTarget(tx, input.targetId);
        // Solo cuentas de gestión: el `active` de un socio puro lo gobierna la
        // baja/readmisión (spec §2 decisión 11).
        if (!managed) throw new UserGuardAbort(USER_GUARD_MESSAGES.notManaged);
        if (target.active === input.active) throw new UserGuardAbort(USER_GUARD_MESSAGES.noChange);
        await tx.user.update({ where: { id: target.id }, data: { active: input.active } });
        // Desactivar a un superadmin también puede dejar cero: misma guarda,
        // mismo lugar (después de la escritura, adentro de la tx).
        if (!input.active && names.includes("superadmin") && (await activeSuperadmins(tx)) === 0) {
          throw new UserGuardAbort(USER_GUARD_MESSAGES.lastSuperadmin);
        }
        return { ok: true as const };
      });
    },
  };
}

export type UserAdminService = ReturnType<typeof makeUserAdminService>;
```

- [ ] **Step 4: Correr los tests de esta mitad**

Run: `npx vitest run tests/users-service.test.ts` → PASS (los `describe` de esta task). Run: `npx tsc --noEmit` → sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/users/service.ts tests/users-service.test.ts
git commit -m "feat(users): write-side service (managed account creation, profile edit, invitations)"
```

---

### Task 5: Guardas de roles y estado — tests (incluida la verificación por mutación)

La implementación de `grantRole`/`revokeRole`/`setUserActive` ya quedó escrita en la Task 4 (un solo archivo coherente); esta task la CUBRE con tests, que es lo que la valida.

**Files:**
- Modify: `tests/users-service.test.ts` (agregar los `describe` de abajo)

**Interfaces:**
- Consumes: `makeUserAdminService`, `USER_GUARD_MESSAGES`, `makeFakeUsersDb` (mismo seed de Task 4: user 1 = superadmin+admin, 2 = admin, 3 = socio).

- [ ] **Step 1: Agregar los tests**

```ts
describe("grantRole", () => {
  it("otorga admin a una cuenta de socio (roles acumulables)", async () => {
    const { db, service } = seeded();
    const res = await service.grantRole({ actorId: 1, targetId: 3, role: "admin" });
    expect(res.ok).toBe(true);
    expect(db.state.userRoles.some((ur) => ur.userId === 3 && ur.roleId === 2)).toBe(true);
    // el rol socio sigue ahí: otorgar no pisa nada
    expect(db.state.userRoles.some((ur) => ur.userId === 3 && ur.roleId === 3)).toBe(true);
  });

  it("rechaza otorgar un rol que ya tiene", async () => {
    const { service } = seeded();
    const res = await service.grantRole({ actorId: 1, targetId: 2, role: "admin" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.alreadyHasRole });
  });
});

describe("revokeRole", () => {
  it("quita admin y deja el resto de los roles intactos", async () => {
    const { db, service } = seeded();
    await service.grantRole({ actorId: 1, targetId: 3, role: "admin" });
    const res = await service.revokeRole({ actorId: 1, targetId: 3, role: "admin" });
    expect(res.ok).toBe(true);
    expect(db.state.userRoles.some((ur) => ur.userId === 3 && ur.roleId === 2)).toBe(false);
    expect(db.state.userRoles.some((ur) => ur.userId === 3 && ur.roleId === 3)).toBe(true);
  });

  it("el superadmin no puede quitarse su propio superadmin", async () => {
    const { service } = seeded();
    const res = await service.revokeRole({ actorId: 1, targetId: 1, role: "superadmin" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.selfSuperadmin });
  });

  it("quitar el ÚLTIMO superadmin activo hace rollback y no escribe nada", async () => {
    const { db, service } = seeded();
    // el actor 2 (admin) le quita superadmin al 1, que es el único: la
    // autorización de rol del ACTOR es de la action (requireSuperadminUsers);
    // acá se prueba la guarda del dominio con actorId ≠ targetId.
    const res = await service.revokeRole({ actorId: 2, targetId: 1, role: "superadmin" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.lastSuperadmin });
    // ROLLBACK: la fila del rol sigue en la base
    expect(db.state.userRoles.some((ur) => ur.userId === 1 && ur.roleId === 1)).toBe(true);
  });

  it("con DOS superadmins activos, quitarle el rol a uno sí pasa", async () => {
    const { db, service } = seeded();
    await service.grantRole({ actorId: 1, targetId: 2, role: "superadmin" });
    const res = await service.revokeRole({ actorId: 2, targetId: 1, role: "superadmin" });
    expect(res.ok).toBe(true);
    expect(db.state.userRoles.some((ur) => ur.userId === 1 && ur.roleId === 1)).toBe(false);
  });

  it("un superadmin DESACTIVADO no cuenta para la guarda", async () => {
    const { service } = seeded();
    await service.grantRole({ actorId: 1, targetId: 2, role: "superadmin" });
    await service.setUserActive({ actorId: 1, targetId: 2, active: false });
    // el 2 quedó superadmin pero inactivo: el 1 vuelve a ser el último ACTIVO
    const res = await service.revokeRole({ actorId: 2, targetId: 1, role: "superadmin" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.lastSuperadmin });
  });
});

describe("setUserActive", () => {
  it("no permite desactivarse a sí mismo", async () => {
    const { service } = seeded();
    const res = await service.setUserActive({ actorId: 1, targetId: 1, active: false });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.selfDisable });
  });

  it("no toca cuentas de socios puros", async () => {
    const { service } = seeded();
    const res = await service.setUserActive({ actorId: 1, targetId: 3, active: false });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.notManaged });
  });

  it("desactivar al último superadmin activo hace rollback", async () => {
    const { db, service } = seeded();
    const res = await service.setUserActive({ actorId: 2, targetId: 1, active: false });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.lastSuperadmin });
    expect(db.state.users.find((u) => u.id === 1)!.active).toBe(true); // rollback
  });

  it("desactiva y reactiva una cuenta admin común", async () => {
    const { db, service } = seeded();
    expect((await service.setUserActive({ actorId: 1, targetId: 2, active: false })).ok).toBe(true);
    expect(db.state.users.find((u) => u.id === 2)!.active).toBe(false);
    expect((await service.setUserActive({ actorId: 1, targetId: 2, active: true })).ok).toBe(true);
    const noChange = await service.setUserActive({ actorId: 1, targetId: 2, active: true });
    expect(noChange).toEqual({ ok: false, error: USER_GUARD_MESSAGES.noChange });
  });
});
```

- [ ] **Step 2: Correr y ver pasar**

Run: `npx vitest run tests/users-service.test.ts` → PASS completo.

- [ ] **Step 3: Verificación POR MUTACIÓN de las tres guardas** (regla del M6: la única prueba de que una guarda se está probando es borrarla y ver el test en rojo)

En `src/lib/users/service.ts`, una por vez:
1. Comentar el `if` de `selfSuperadmin` en `revokeRole` → correr la suite → el test "no puede quitarse su propio superadmin" debe fallar → restaurar.
2. Comentar el bloque `lastSuperadmin` de `revokeRole` → correr → "quitar el ÚLTIMO superadmin" y "un superadmin DESACTIVADO no cuenta" deben fallar → restaurar.
3. Comentar el bloque `lastSuperadmin` de `setUserActive` → correr → "desactivar al último superadmin" debe fallar → restaurar.

Run tras restaurar: `npx vitest run tests/users-service.test.ts` → PASS. Verificar con `git diff src/lib/users/service.ts` que el archivo quedó EXACTAMENTE como antes de la mutación.

- [ ] **Step 4: Commit**

```bash
git add tests/users-service.test.ts
git commit -m "test(users): role/state guards incl. last-superadmin rollback, mutation-verified"
```

---

### Task 6: Canje de la invitación — `admin-access.ts`

**Files:**
- Create: `src/lib/users/admin-access.ts`
- Test: `tests/users-admin-access.test.ts`

**Interfaces:**
- Produces: `ADMIN_REDEEM_ERRORS`, `ADMIN_REDEEM_PAGE_COPY`, `makeAdminAccess(db)` con `redeemInvitation(rawToken, passwordHash, now?)` → `{ ok: true; userId: number } | { ok: false; error: string }`. Solo factory (el bind vive en la action pública, Task 8… no: Task 7).
- Consumes: `makeTokens` (propósito `admin_invitation`).

- [ ] **Step 1: Test primero**

```ts
// tests/users-admin-access.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeFakeUsersDb } from "./helpers/fake-users-db";
import { hashToken } from "@/lib/tokens";
import { ADMIN_REDEEM_ERRORS, makeAdminAccess } from "@/lib/users/admin-access";

const OLD_HASH = "$2b$12$XHfiAzolMFmdVT8v4PxyjuE0zE.lYU0I3W.1mn8IuVLg6LFDwN1QS";
const NOW = new Date("2026-08-29T12:00:00Z");
const IN_7_DAYS = new Date("2026-09-05T12:00:00Z");

function seeded(opts?: { active?: boolean }) {
  const db = makeFakeUsersDb({
    users: [{
      id: 9, email: "invitada@x.com", passwordHash: OLD_HASH, passwordChangedAt: null,
      name: "Invitada", active: opts?.active ?? true, lastLoginAt: null,
    }],
    userRoles: [{ userId: 9, roleId: 2 }],
    actionTokens: [
      { id: 1, purpose: "admin_invitation", tokenHash: hashToken("raw-1"), memberId: null,
        applicationId: null, userId: 9, expiresAt: IN_7_DAYS, usedAt: null, createdAt: NOW },
      // una segunda invitación paralela viva, para verificar que el canje revoca
      { id: 2, purpose: "admin_invitation", tokenHash: hashToken("raw-2"), memberId: null,
        applicationId: null, userId: 9, expiresAt: IN_7_DAYS, usedAt: null, createdAt: NOW },
    ],
  });
  return { db, access: makeAdminAccess(db) };
}

describe("redeemInvitation", () => {
  it("escribe hash + passwordChangedAt y revoca las invitaciones paralelas", async () => {
    const { db, access } = seeded();
    const res = await access.redeemInvitation("raw-1", "$2b$12$nuevo", NOW);
    expect(res).toEqual({ ok: true, userId: 9 });
    const u = db.state.users[0];
    expect(u.passwordHash).toBe("$2b$12$nuevo");
    expect(u.passwordChangedAt).toEqual(NOW);
    // el consumido queda como rastro (usedAt), el paralelo se borra
    expect(db.state.actionTokens.find((t) => t.id === 1)?.usedAt).toEqual(NOW);
    expect(db.state.actionTokens.find((t) => t.id === 2)).toBeUndefined();
  });

  it("el segundo POST con el mismo token pierde", async () => {
    const { access } = seeded();
    await access.redeemInvitation("raw-1", "$2b$12$nuevo", NOW);
    const again = await access.redeemInvitation("raw-1", "$2b$12$otro", NOW);
    expect(again).toEqual({ ok: false, error: ADMIN_REDEEM_ERRORS.dead });
  });

  it("token vencido o inventado → dead", async () => {
    const { access } = seeded();
    expect(await access.redeemInvitation("inventado", "$2b$12$x", NOW))
      .toEqual({ ok: false, error: ADMIN_REDEEM_ERRORS.dead });
    expect(await access.redeemInvitation("raw-1", "$2b$12$x", new Date("2026-10-01T00:00:00Z")))
      .toEqual({ ok: false, error: ADMIN_REDEEM_ERRORS.dead });
  });

  it("cuenta desactivada: rechaza SIN quemar el enlace (rollback)", async () => {
    const { db, access } = seeded({ active: false });
    const res = await access.redeemInvitation("raw-1", "$2b$12$x", NOW);
    expect(res).toEqual({ ok: false, error: ADMIN_REDEEM_ERRORS.disabled });
    // el rollback conserva el token vivo: si el superadmin reactiva la cuenta,
    // el enlace del buzón sigue sirviendo.
    expect(db.state.actionTokens.find((t) => t.id === 1)?.usedAt).toBeNull();
    expect(db.state.users[0].passwordHash).toBe(OLD_HASH);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/users-admin-access.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Escribir `src/lib/users/admin-access.ts`**

```ts
// Canje de la invitación de una cuenta de GESTIÓN (/acceso/[token], rama
// admin). Calca la mecánica de members/access.ts sin tocarla: consume dentro
// de la transacción (gana exactamente un POST), bcrypt AFUERA (~300 ms, nunca
// con la transacción abierta), y el rechazo por cuenta desactivada hace
// ROLLBACK para conservar el enlace — si el superadmin la reactiva, el correo
// del buzón sigue sirviendo. No toca roles ni Member: los roles se otorgaron
// al crear la cuenta o se otorgan desde /admin/usuarios.
import type { PrismaClient } from "@/generated/prisma/client";
import { makeTokens } from "@/lib/tokens";

export const ADMIN_REDEEM_ERRORS = {
  dead: "Este enlace ya no sirve. Pedile a la vecinal que te reenvíe la invitación.",
  disabled: "Tu cuenta de acceso está deshabilitada. Comunicate con la vecinal.",
} as const;

// Los textos de la variante admin de la página de canje. Constantes y sin
// nombre propio, mismo criterio que REDEEM_PAGE_COPY: la dirección la tipeó
// el superadmin y el correo pudo ir a la casilla equivocada.
export const ADMIN_REDEEM_PAGE_COPY = {
  createLead: "Elegí una contraseña para entrar al panel de administración con esta dirección:",
  createWhy:
    "Es la cuenta de gestión que la Asociación Vecinal del Barrio Ciudadela creó para esta casilla.",
  createNotYou:
    "Si no esperabas este correo, cerrá esta página y avisale a la vecinal: puede ser un error de carga.",
} as const;

class AdminAccessAbort extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "AdminAccessAbort";
  }
}

type AdminAccessDb = Pick<PrismaClient, "$transaction" | "actionToken" | "user">;

export function makeAdminAccess(db: AdminAccessDb) {
  return {
    async redeemInvitation(
      rawToken: string,
      passwordHash: string,
      now = new Date(),
    ): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
      try {
        return await db.$transaction(async (tx) => {
          const tokens = makeTokens(tx);
          const t = await tokens.consume(rawToken, "admin_invitation", now);
          if (!t?.userId) return { ok: false as const, error: ADMIN_REDEEM_ERRORS.dead };
          const user = await tx.user.findUnique({ where: { id: t.userId } });
          if (!user) return { ok: false as const, error: ADMIN_REDEEM_ERRORS.dead };
          if (!user.active) throw new AdminAccessAbort(ADMIN_REDEEM_ERRORS.disabled);
          await tx.user.update({
            where: { id: user.id },
            data: { passwordHash, passwordChangedAt: now },
          });
          // Un enlace vivo por cuenta: los reenvíos paralelos mueren acá, el
          // consumido queda como rastro (usedAt).
          await tokens.revokeForUser(user.id, ["admin_invitation"]);
          return { ok: true as const, userId: user.id };
        });
      } catch (e) {
        if (e instanceof AdminAccessAbort) return { ok: false as const, error: e.reason };
        throw e;
      }
    },
  };
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run tests/users-admin-access.test.ts` → PASS. `npx tsc --noEmit` → sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/users/admin-access.ts tests/users-admin-access.test.ts
git commit -m "feat(users): admin invitation redemption (tx consume, rollback keeps link on disabled account)"
```

---

### Task 7: Email de invitación + rama pública en `/acceso/[token]`

**Files:**
- Modify: `src/lib/email/templates.ts` (agregar `adminInvitationEmail` al final)
- Create: `src/lib/users/invitation.ts`
- Modify: `src/app/(public)/acceso/[token]/actions.ts`
- Modify: `src/app/(public)/acceso/[token]/page.tsx`
- Test: `tests/users-invitation-email.test.ts`

**Interfaces:**
- Produces: `adminInvitationEmail({ url })` → `Rendered`; `makeSendAdminInvitation(deps)` y bound `sendAdminInvitation({ to, token })` → `Promise<{ sent: boolean; blocked: boolean }>`; la action pública `createPasswordAction` ahora canjea también `admin_invitation`.
- Consumes: `mailer.sendToMember` (tipo `"generic"`, `memberId: null`), `ALLOWLIST_BLOCK_CODE` de `@/lib/email/transport`, `adminAccess` (Task 6), `audit` con action `admin_password_set`.

- [ ] **Step 1: Test de la plantilla y del sender**

```ts
// tests/users-invitation-email.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { adminInvitationEmail } from "@/lib/email/templates";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { makeSendAdminInvitation } from "@/lib/users/invitation";

describe("adminInvitationEmail", () => {
  it("lleva el enlace en texto y html, y NO saluda por nombre", () => {
    const r = adminInvitationEmail({ url: "https://x/acceso/tok" });
    expect(r.text).toContain("https://x/acceso/tok");
    expect(r.html).toContain("https://x/acceso/tok");
    expect(r.text).not.toMatch(/^Hola /);
    expect(r.subject).toContain("Vecinal Ciudadela");
  });
});

describe("sendAdminInvitation", () => {
  it("arma la URL /acceso/{token} y reporta sent", async () => {
    const send = vi.fn(async () => ({ messageId: "m1" }));
    const sender = makeSendAdminInvitation({ send, baseUrl: () => "https://x" });
    const res = await sender({ to: "a@b.com", token: "tok" });
    expect(res).toEqual({ sent: true, blocked: false });
    const arg = send.mock.calls[0][0];
    expect(arg.to).toBe("a@b.com");
    expect(arg.memberId).toBeNull();
    expect(arg.type).toBe("generic");
    expect(arg.message.text).toContain("https://x/acceso/tok");
  });

  it("distingue el bloqueo de allowlist de un fallo real", async () => {
    const blockedErr = Object.assign(new Error("blocked"), { code: ALLOWLIST_BLOCK_CODE });
    const sender = makeSendAdminInvitation({
      send: vi.fn(async () => { throw blockedErr; }), baseUrl: () => "https://x",
    });
    expect(await sender({ to: "a@b.com", token: "t" })).toEqual({ sent: false, blocked: true });
    const failing = makeSendAdminInvitation({
      send: vi.fn(async () => { throw new Error("smtp down"); }), baseUrl: () => "https://x",
    });
    expect(await failing({ to: "a@b.com", token: "t" })).toEqual({ sent: false, blocked: false });
  });
});
```

- [ ] **Step 2: Ver fallar** — `npx vitest run tests/users-invitation-email.test.ts` → FAIL.

- [ ] **Step 3: Agregar la plantilla al final de `src/lib/email/templates.ts`**

```ts
/** Invitación de una cuenta de GESTIÓN (módulo de usuarios, /admin/usuarios).
 *
 *  No saluda por nombre y la plantilla ni siquiera lo recibe: la dirección la
 *  tipea el superadmin al crear la cuenta — el mismo canal de dedazo que
 *  `verificationEmail`, y acá el premio sería una cuenta de administración.
 *  El enlace se canjea en /acceso (rama admin del mismo circuito). */
export function adminInvitationEmail(opts: { url: string }): Rendered {
  return {
    subject: "Tu acceso al panel de administración — Vecinal Ciudadela",
    text: `La ${ORG} creó una cuenta de administración de su sistema de gestión para esta dirección de correo.

Para activarla, creá tu contraseña desde este enlace:

${opts.url}

El enlace vence en 7 días y se puede usar una sola vez.

Si no esperabas este correo, ignoralo y avisale a la vecinal: nadie puede usar la cuenta sin crear la contraseña.${SIGNATURE}`,
    html: layout("Tu acceso al panel de administración", `<p>La ${esc(ORG)} creó una <strong>cuenta de administración</strong> de su sistema de gestión para esta dirección de correo.</p>
<p>Para activarla, creá tu contraseña:</p>
${button(opts.url, "Crear mi contraseña")}
<p>El enlace vence en 7 días y se puede usar una sola vez.</p>
<p>Si no esperabas este correo, ignoralo y avisale a la vecinal: nadie puede usar la cuenta sin crear la contraseña.</p>`),
  };
}
```

- [ ] **Step 4: Crear `src/lib/users/invitation.ts`**

```ts
// Envío del correo de invitación de una cuenta de gestión. SIEMPRE post-commit
// y best-effort: si el correo no sale, la cuenta ya quedó creada y el botón
// "Reenviar invitación" del detalle es la recuperación (mismo criterio que el
// PDF del recibo). `EMAIL_ALLOWLIST` envuelve el transporte, así que este
// camino nuevo queda cubierto sin hacer nada — y su bloqueo NO es un fallo:
// se distingue para no auditar `admin_invitation_send_failed` por la guarda
// del entorno de prueba funcionando.
import { mailer } from "@/lib/email";
import { adminInvitationEmail } from "@/lib/email/templates";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";

export type SendAdminInvitationDeps = {
  send: (typeof mailer)["sendToMember"];
  baseUrl: () => string;
};

export function makeSendAdminInvitation(deps: SendAdminInvitationDeps) {
  return async function sendAdminInvitation(input: {
    to: string;
    token: string;
  }): Promise<{ sent: boolean; blocked: boolean }> {
    try {
      await deps.send({
        memberId: null,
        to: input.to,
        type: "generic",
        message: adminInvitationEmail({ url: `${deps.baseUrl()}/acceso/${input.token}` }),
        summary: "invitación de acceso de administración",
      });
      return { sent: true, blocked: false };
    } catch (e) {
      const blocked = (e as { code?: unknown } | null)?.code === ALLOWLIST_BLOCK_CODE;
      return { sent: false, blocked };
    }
  };
}

// AUTH_URL se hornea en el build, mismo criterio que member-debit.ts.
export const sendAdminInvitation = makeSendAdminInvitation({
  send: (i) => mailer.sendToMember(i),
  baseUrl: () => process.env.AUTH_URL ?? "http://localhost:3000",
});
```

- [ ] **Step 5: Ver pasar** — `npx vitest run tests/users-invitation-email.test.ts` → PASS.

- [ ] **Step 6: Rama admin en `src/app/(public)/acceso/[token]/actions.ts`** — reemplazar el cuerpo desde el limiter hasta el final por:

```ts
  const ip = await clientIp();
  if (!publicTokenLimiter.check(ip)) return { error: TOO_MANY };

  // ¿De qué circuito es el enlace? El `peek` barato decide la RAMA antes del
  // bcrypt (~300 ms de CPU); cada rama consume su token adentro de su propia
  // transacción, que es lo que decide quién gana entre dos POST simultáneos.
  const isMemberInvite = (await tokens.peek(raw, "password_invitation")) !== null;
  const isAdminInvite = !isMemberInvite && (await tokens.peek(raw, "admin_invitation")) !== null;
  if (!isMemberInvite && !isAdminInvite) return { error: ACCESS_ERRORS.dead };

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  if (isAdminInvite) {
    const res = await adminAccess.redeemInvitation(raw, passwordHash);
    if (!res.ok) return { error: res.error };
    await audit({
      userId: res.userId,
      action: "admin_password_set",
      entity: "user",
      entityId: res.userId,
      ip,
    });
    redirect("/ingresar?cuenta=lista");
  }

  const res = await memberAccess.createPassword(raw, passwordHash);
  if (!res.ok) return { error: res.error };

  await audit({
    userId: res.userId,
    action: res.created ? "member_user_created" : "member_password_set",
    entity: "member",
    entityId: res.memberId,
    ip,
  });

  // Fuera de cualquier try: `redirect` señaliza con una excepción.
  redirect("/ingresar?cuenta=lista");
```

Y en los imports, agregar (la rama admin se liga acá, donde ya vive `prisma` vía los módulos ligados):

```ts
import { makeAdminAccess } from "@/lib/users/admin-access";
import { prisma } from "@/lib/prisma";

const adminAccess = makeAdminAccess(prisma);
```

(El resto del archivo — validaciones locales, `TOO_MANY`, `MISMATCH`, `clientIp` — queda byte-idéntico.)

- [ ] **Step 7: Rama admin en `src/app/(public)/acceso/[token]/page.tsx`** — reemplazo completo del archivo:

```tsx
import { PasswordForm } from "./password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ACCESS_ERRORS, canRedeem, REDEEM_CARD_SELECT, REDEEM_PAGE_COPY,
} from "@/lib/members/access";
import { ADMIN_REDEEM_PAGE_COPY } from "@/lib/users/admin-access";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Creá tu contraseña — Vecinal Ciudadela",
  robots: { index: false, follow: false },
};

export default async function AccesoPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  // `peek`, nunca `consume`: ver el comentario de /verificar. Acá el enlace
  // además puede haber llegado por redirect desde la verificación, así que un
  // GET que consumiera rompería el circuito completo de una.
  //
  // El MISMO formulario sirve para los dos circuitos (socio y cuenta de
  // gestión): la action decide la rama con el mismo par de peeks.
  const t = await tokens.peek(token, "password_invitation");
  const adminT = t ? null : await tokens.peek(token, "admin_invitation");

  // Sin el nombre del titular en ninguna de las dos ramas, por el mismo motivo
  // que /verificar: a esta URL se llega con un token que viajó por correo, y el
  // correo pudo haber ido a la casilla equivocada — ver `REDEEM_CARD_SELECT`.
  const member = t?.memberId
    ? await prisma.member.findUnique({ where: { id: t.memberId }, select: REDEEM_CARD_SELECT })
    : null;
  const adminUser = adminT?.userId
    ? await prisma.user.findUnique({ where: { id: adminT.userId }, select: { email: true, active: true } })
    : null;

  const blocked = member ? canRedeem(member) : { ok: false as const, error: ACCESS_ERRORS.dead };
  const memberUsable = member && blocked.ok && member.email;
  const adminUsable = adminUser?.active ? adminUser : null;

  const copy = adminUsable ? ADMIN_REDEEM_PAGE_COPY : REDEEM_PAGE_COPY;
  // `memberUsable` ya probó `member.email`; el `?? null` es para el narrowing.
  const email = adminUsable?.email ?? (memberUsable ? (member?.email ?? null) : null);
  const usable = Boolean(memberUsable || adminUsable);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>Creá tu contraseña</CardTitle>
          <CardDescription>
            {usable
              ? adminUsable
                ? "Último paso para entrar al panel de administración."
                : "Último paso para entrar al portal."
              : "No pudimos usar este enlace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usable ? (
            <>
              <p className="text-sm">{copy.createLead}</p>
              <p className="rounded bg-secondary px-3 py-2 text-sm font-medium break-all">
                {email}
              </p>
              <p className="text-sm text-muted-foreground">{copy.createWhy}</p>
              <PasswordForm token={token} />
              <p className="text-sm text-muted-foreground">{copy.createNotYou}</p>
            </>
          ) : (
            <p className="text-sm text-red-600" role="alert">
              {member && blocked.ok ? ACCESS_ERRORS.noEmail : !member && adminUser && !adminUser.active
                ? ACCESS_ERRORS.dead
                : member
                  ? blocked.error
                  : ACCESS_ERRORS.dead}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 8: Verificar que la rama socio no cambió**

Run: `npx vitest run` → la suite ENTERA en verde, en particular los tests de `member-access` y de la action de acceso **sin tocar una aserción** (rediseñar una ruta no autoriza a reescribir su lógica). `npx tsc --noEmit` → sin errores.

- [ ] **Step 9: Commit**

```bash
git add src/lib/email/templates.ts src/lib/users/invitation.ts tests/users-invitation-email.test.ts "src/app/(public)/acceso/[token]/actions.ts" "src/app/(public)/acceso/[token]/page.tsx"
git commit -m "feat(users): admin invitation email and admin branch in /acceso/[token]"
```

---

### Task 8: Guarda con mensaje propio + server actions de `/admin/usuarios`

**Files:**
- Modify: `src/lib/auth/require-admin.ts` (agregado aditivo al final)
- Create: `src/app/admin/usuarios/actions.ts`
- Test: `tests/usuarios-actions-auth.test.ts`

**Interfaces:**
- Produces:
  - `require-admin.ts`: `USERS_SUPERADMIN_MESSAGE`, `makeRequireSuperadminUsers(getSession, findAccount)`, `requireSuperadminUsers()`.
  - `actions.ts` (`"use server"`): `createUserAction`, `updateUserAction`, `grantRoleAction`, `revokeRoleAction`, `setActiveAction`, `resendInvitationAction`, `revokeInvitationAction` — todas `(prev: ActionState, formData: FormData) => Promise<ActionState>` con `ActionState = { error?: string }`.
- Consumes: `makeUserAdminService` (Tasks 4-5), `sendAdminInvitation` (Task 7), `parseForm`, `audit`.

- [ ] **Step 1: Agregado al final de `src/lib/auth/require-admin.ts`**

```ts
/** El mensaje de la pantalla de Usuarios: la de Configuración habla de
 *  "configuración" y acá mentiría. Misma factory, mismo orden de guardas. */
export const USERS_SUPERADMIN_MESSAGE = "Solo el superadmin puede gestionar las cuentas y los roles.";

export function makeRequireSuperadminUsers(getSession: GetSession, findAccount: AdminAccountLookup) {
  return makeRequireRole(getSession, findAccount, isSuperadmin, USERS_SUPERADMIN_MESSAGE);
}

export async function requireSuperadminUsers(): Promise<AdminActor> {
  const [{ auth }, lookup] = await Promise.all([import("@/auth"), liveAccount()]);
  return makeRequireSuperadminUsers(auth, lookup)();
}
```

(`GetSession` es un type local del archivo: la función nueva vive en el mismo archivo y lo usa igual que las otras dos. Nada existente se modifica.)

- [ ] **Step 2: Test de autorización (molde `config-actions-auth`) — primero, y ver fallar**

```ts
// tests/usuarios-actions-auth.test.ts
import { describe, expect, it, vi } from "vitest";

// Cada action de /admin/usuarios es un endpoint público (Next-Action): este
// archivo fija que el rechazo de superadmin no escribe, no audita, no manda
// correos y no redirige.
const serviceMock = vi.hoisted(() => ({
  createManagedUser: vi.fn(), updateManagedUser: vi.fn(),
  grantRole: vi.fn(), revokeRole: vi.fn(), setUserActive: vi.fn(),
  resendInvitation: vi.fn(), revokeInvitation: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/users/service", () => ({
  makeUserAdminService: () => serviceMock,
  USER_GUARD_MESSAGES: {},
}));
vi.mock("@/lib/users/invitation", () => ({ sendAdminInvitation: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireSuperadminUsers: vi.fn(async () => ({
    ok: false,
    reason: "not_admin",
    error: "Solo el superadmin puede gestionar las cuentas y los roles.",
  })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { sendAdminInvitation } from "@/lib/users/invitation";
import {
  createUserAction, grantRoleAction, revokeRoleAction, setActiveAction,
  updateUserAction, resendInvitationAction, revokeInvitationAction,
} from "@/app/admin/usuarios/actions";

const ACTIONS: Array<[string, (p: object, f: FormData) => Promise<{ error?: string }>, FormData]> = [
  ["createUserAction", createUserAction, (() => { const f = new FormData(); f.set("name", "X"); f.set("email", "x@x.com"); return f; })()],
  ["updateUserAction", updateUserAction, (() => { const f = new FormData(); f.set("id", "2"); f.set("name", "X"); return f; })()],
  ["grantRoleAction", grantRoleAction, (() => { const f = new FormData(); f.set("id", "2"); f.set("role", "admin"); return f; })()],
  ["revokeRoleAction", revokeRoleAction, (() => { const f = new FormData(); f.set("id", "2"); f.set("role", "admin"); return f; })()],
  ["setActiveAction", setActiveAction, (() => { const f = new FormData(); f.set("id", "2"); f.set("active", "0"); return f; })()],
  ["resendInvitationAction", resendInvitationAction, (() => { const f = new FormData(); f.set("id", "2"); return f; })()],
  ["revokeInvitationAction", revokeInvitationAction, (() => { const f = new FormData(); f.set("id", "2"); return f; })()],
];

describe("actions de /admin/usuarios sin superadmin", () => {
  it.each(ACTIONS)("%s: rechaza sin escribir, auditar, mandar correo ni redirigir", async (_n, action, form) => {
    const result = await action({}, form);
    expect(result.error).toBe("Solo el superadmin puede gestionar las cuentas y los roles.");
    for (const fn of Object.values(serviceMock)) expect(fn).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(sendAdminInvitation).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run tests/usuarios-actions-auth.test.ts` → FAIL (actions inexistentes).

- [ ] **Step 3: Escribir `src/app/admin/usuarios/actions.ts`**

```ts
"use server";
// Actions de /admin/usuarios. Vale el recordatorio de require-admin.ts: cada
// action es un endpoint público y se autoriza a sí misma con
// `requireSuperadminUsers()` — la pantalla de bloqueo de page.tsx solo esconde
// el formulario. Las guardas de dominio (último superadmin, auto-degradación,
// email con socio) viven en el service y se revalidan dentro de su
// transacción; acá va la autorización, el parseo, la auditoría y el redirect.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { BCRYPT_COST } from "@/lib/auth/password";
import { requireSuperadminUsers } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { sendAdminInvitation } from "@/lib/users/invitation";
import { makeUserAdminService } from "@/lib/users/service";

const service = makeUserAdminService(prisma);

type ActionState = { error?: string };

const BASE = "/admin/usuarios";

async function clientIp(): Promise<string> {
  // Solo X-Real-IP, como en el resto del panel.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Mensajes en castellano SIEMPRE: una server action es un endpoint público y
// el texto de zod por defecto (en inglés) terminaría en pantalla.
const idField = z.coerce
  .number("La cuenta seleccionada no es válida.")
  .int("La cuenta seleccionada no es válida.")
  .positive("La cuenta seleccionada no es válida.");

const createSchema = z.object({
  name: z
    .string("Ingresá el nombre.")
    .trim()
    .min(2, "El nombre tiene que tener al menos 2 caracteres.")
    .max(120, "El nombre no puede superar los 120 caracteres."),
  email: z
    .email("El email no es válido.")
    .max(191, "El email no puede superar los 191 caracteres."),
});

const updateSchema = z.object({
  id: idField,
  name: z
    .string("Ingresá el nombre.")
    .trim()
    .min(2, "El nombre tiene que tener al menos 2 caracteres.")
    .max(120, "El nombre no puede superar los 120 caracteres."),
  email: z
    .email("El email no es válido.")
    .max(191, "El email no puede superar los 191 caracteres.")
    .optional(),
});

const roleSchema = z.object({
  id: idField,
  role: z.enum(["admin", "superadmin"], { error: "El rol seleccionado no es válido." }),
});

const activeSchema = z.object({
  id: idField,
  active: z.enum(["1", "0"], { error: "El estado seleccionado no es válido." }),
});

const idSchema = z.object({ id: idField });

/** Emite y manda la invitación de una cuenta recién creada o reenviada, y deja
 *  el rastro correcto: `_send_failed` SOLO ante un fallo real — el bloqueo de
 *  `EMAIL_ALLOWLIST` es la guarda del entorno de prueba funcionando. */
async function deliverInvitation(input: {
  actorId: number; userId: number; to: string; token: string; ip: string; resent: boolean;
}): Promise<boolean> {
  const delivery = await sendAdminInvitation({ to: input.to, token: input.token });
  const base = { userId: input.actorId, entity: "user", entityId: input.userId, ip: input.ip };
  if (delivery.sent) {
    await audit({ ...base, action: input.resent ? "admin_invitation_resent" : "admin_invitation_sent" });
  } else if (!delivery.blocked) {
    await audit({ ...base, action: "admin_invitation_send_failed" });
  }
  return delivery.sent;
}

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(createSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  // Hash de bytes aleatorios que nadie conoce: la cuenta no puede loguearse
  // hasta el canje. Se calcula acá (~300 ms), nunca dentro de la transacción.
  const unusableHash = await bcrypt.hash(randomBytes(32).toString("base64url"), BCRYPT_COST);
  const res = await service.createManagedUser({
    email: parsed.data.email, name: parsed.data.name, passwordHash: unusableHash,
  });
  if (!res.ok) return { error: res.error };

  const ip = await clientIp();
  await audit({ userId: actor.actorId, action: "user_create", entity: "user", entityId: res.userId, ip });
  const sent = await deliverInvitation({
    actorId: actor.actorId, userId: res.userId, to: parsed.data.email,
    token: res.rawToken, ip, resent: false,
  });
  redirect(`${BASE}/${res.userId}?invitado=${sent ? 1 : 2}`);
}

export async function updateUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(updateSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const res = await service.updateManagedUser({
    targetId: parsed.data.id, name: parsed.data.name, email: parsed.data.email,
  });
  if (!res.ok) return { error: res.error };

  await audit({
    userId: actor.actorId, action: "user_update", entity: "user", entityId: parsed.data.id,
    // Qué campos se tocaron, nunca los valores: el email es dato personal.
    detail: { fields: res.emailChanged ? ["name", "email"] : ["name"] },
    ip: await clientIp(),
  });
  redirect(`${BASE}/${parsed.data.id}?guardado=1`);
}

export async function grantRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(roleSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const res = await service.grantRole({
    actorId: actor.actorId, targetId: parsed.data.id, role: parsed.data.role,
  });
  if (!res.ok) return { error: res.error };

  await audit({
    userId: actor.actorId, action: "role_grant", entity: "user", entityId: parsed.data.id,
    detail: { role: parsed.data.role }, ip: await clientIp(),
  });
  redirect(`${BASE}/${parsed.data.id}?rol=1`);
}

export async function revokeRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(roleSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const res = await service.revokeRole({
    actorId: actor.actorId, targetId: parsed.data.id, role: parsed.data.role,
  });
  if (!res.ok) return { error: res.error };

  await audit({
    userId: actor.actorId, action: "role_revoke", entity: "user", entityId: parsed.data.id,
    detail: { role: parsed.data.role }, ip: await clientIp(),
  });
  redirect(`${BASE}/${parsed.data.id}?rol=2`);
}

export async function setActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(activeSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const active = parsed.data.active === "1";

  const res = await service.setUserActive({
    actorId: actor.actorId, targetId: parsed.data.id, active,
  });
  if (!res.ok) return { error: res.error };

  await audit({
    userId: actor.actorId, action: active ? "user_enable" : "user_disable",
    entity: "user", entityId: parsed.data.id, ip: await clientIp(),
  });
  redirect(`${BASE}/${parsed.data.id}?cuenta=${active ? 1 : 2}`);
}

export async function resendInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const res = await service.resendInvitation({ targetId: parsed.data.id });
  if (!res.ok) return { error: res.error };

  const sent = await deliverInvitation({
    actorId: actor.actorId, userId: parsed.data.id, to: res.email,
    token: res.rawToken, ip: await clientIp(), resent: true,
  });
  redirect(`${BASE}/${parsed.data.id}?invitacion=${sent ? 1 : 2}`);
}

export async function revokeInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const res = await service.revokeInvitation({ targetId: parsed.data.id });
  if (!res.ok) return { error: res.error };

  await audit({
    userId: actor.actorId, action: "admin_invitation_revoked",
    entity: "user", entityId: parsed.data.id, ip: await clientIp(),
  });
  redirect(`${BASE}/${parsed.data.id}?invitacion=3`);
}
```

- [ ] **Step 4: Ver pasar** — `npx vitest run tests/usuarios-actions-auth.test.ts` → PASS. `npx tsc --noEmit` → sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/require-admin.ts src/app/admin/usuarios/actions.ts tests/usuarios-actions-auth.test.ts
git commit -m "feat(users): /admin/usuarios server actions with module-specific superadmin guard"
```

---

### Task 9: Pantalla de lista `/admin/usuarios` + nav, tablero y badges

**Files:**
- Create: `src/app/admin/usuarios/page.tsx`
- Modify: `src/lib/admin/nav.ts` (`AdminNavIcon` + ítem en Sistema)
- Modify: `src/components/admin/nav-icons.ts` (`UserCog`)
- Modify: `src/lib/admin/dashboard-cards.ts` (tarjeta en Sistema)
- Modify: `src/lib/admin/status-badges.ts` (dos funciones al final)
- Modify: `tests/admin-nav.test.ts` (array literal + `it` nuevo)

**Interfaces:**
- Consumes: `parseUserFilters`, `fetchUserCounts`, `fetchUsersPage` (Task 2); `requireSuperadminUsers` (Task 8); `PageHeader`, `EmptyState`, `PaginationNav`, `FormMessage`, `Badge`, `Table*`, `INLINE_LINK`, `pageHref`.
- Produces: `userRoleBadgeVariant(role)`, `userAccountBadgeVariant(state)` en status-badges.

- [ ] **Step 1: Invocar la skill `frontend-design`** antes de escribir JSX (obligatorio; vale también para Tasks 10-11 si el subagente es otro).

- [ ] **Step 2: Nav — `src/lib/admin/nav.ts`**

Unión de íconos (línea 6-8):

```ts
export type AdminNavIcon =
  | "home" | "inbox" | "users" | "wallet" | "scroll-text" | "newspaper" | "calendar-days" | "settings"
  | "activity" | "vote" | "clipboard-check" | "user-cog";
```

Grupo Sistema (entre Padrón electoral y Configuración):

```ts
      { href: "/admin/padron-electoral", label: "Padrón electoral", icon: "vote", superadminOnly: true },
      // Usuarios se usa poco (el recambio de la Comisión Directiva): más que el
      // padrón bianual no, pero sí antes que Configuración, que es la
      // pantalla-cajón. `superadminOnly` es display: la guarda real es
      // `requireSuperadminUsers` en la ruta y en cada action.
      { href: "/admin/usuarios", label: "Usuarios", icon: "user-cog", superadminOnly: true },
      { href: "/admin/configuracion", label: "Configuración", icon: "settings", superadminOnly: true },
```

- [ ] **Step 3: `src/components/admin/nav-icons.ts`** — agregar `UserCog` al import de lucide-react y al mapa:

```ts
  "user-cog": UserCog,
```

- [ ] **Step 4: `src/lib/admin/dashboard-cards.ts`** — tarjeta en Sistema, entre Padrón electoral y Configuración:

```ts
      {
        // `title` idéntico al `label` de la nav: lo verifica dashboard-cards.test.ts.
        title: "Usuarios",
        description: "Cuentas de acceso al panel: roles de gestión, altas e invitaciones.",
        href: "/admin/usuarios",
        cta: "Gestionar",
        superadminOnly: true,
      },
```

- [ ] **Step 5: Badges — al final de `src/lib/admin/status-badges.ts`**

```ts
// Los roles de una cuenta (módulo de usuarios). Por PESO: superadmin con
// relleno celeste (acá hay poder), admin gris con relleno, socio borde fino.
export function userRoleBadgeVariant(role: string): BadgeVariant {
  if (role === "superadmin") return "default";
  if (role === "admin") return "secondary";
  return "outline";
}

// El estado derivado de la cuenta (accountState, @/lib/users/labels). La
// invitación vencida es lo único accionable de la columna —reenviar o
// revocar— y por eso es la que lleva el celeste de "acá hay trabajo".
import type { UserAccountState } from "@/lib/users/labels";
export function userAccountBadgeVariant(state: UserAccountState): BadgeVariant {
  if (state === "active") return "success";
  if (state === "disabled") return "secondary";
  if (state === "invitation_expired") return "default";
  return "outline"; // invited: todavía no ocurrió
}
```

(Mover el `import type` junto a los demás imports del tope del archivo, no en el medio.)

- [ ] **Step 6: `src/app/admin/usuarios/page.tsx`**

```tsx
// Listado de cuentas de acceso (módulo de usuarios). Mismo molde que
// /admin/socios: chips segmentados que filtran EXACTAMENTE lo que cuentan,
// búsqueda GET plana, tabla en desktop (`hidden md:block`) y una tarjeta por
// cuenta en móvil (`md:hidden`).
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { pageHref } from "@/lib/admin/pagination";
import { userAccountBadgeVariant, userRoleBadgeVariant } from "@/lib/admin/status-badges";
import { requireSuperadminUsers } from "@/lib/auth/require-admin";
import { formatDateAR } from "@/lib/format";
import { ACCOUNT_STATE_LABELS, ROLE_LABELS } from "@/lib/users/labels";
import {
  fetchUserCounts, fetchUsersPage, parseUserFilters,
  type UserChip, type UserListFilters, type UserRow,
} from "@/lib/users/query";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = { title: "Usuarios — SIGeV" };

const BASE = "/admin/usuarios";

const CHIP_BASE =
  "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_ACTIVE = "bg-background text-foreground shadow-sm";
const CHIP_INACTIVE = "text-muted-foreground hover:text-foreground";

const CHIPS: { key: UserChip; label: string; href: string }[] = [
  { key: "gestion", label: "Gestión", href: `${BASE}?vista=gestion` },
  { key: "socios", label: "Socios", href: `${BASE}?vista=socios` },
  { key: "inactivas", label: "Inactivas", href: `${BASE}?vista=inactivas` },
  { key: "todas", label: "Todas", href: BASE },
];

function activeChip(f: UserListFilters): UserChip {
  return f.vista ?? "todas";
}

export default async function UsuariosPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) {
    // Pantalla de bloqueo, no redirect: el rebote /ingresar → /redirigir →
    // /admin marearía a un admin común con sesión válida (molde Configuración).
    return (
      <div className="space-y-4">
        <PageHeader title="Usuarios" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const filters = parseUserFilters(sp);
  const [{ rows, total, page, pageCount, pageSize }, counts] = await Promise.all([
    fetchUsersPage(prisma, filters, sp),
    fetchUserCounts(prisma),
  ]);
  const hasFilters = Object.keys(filters).length > 0;
  const chip = activeChip(filters);
  const firstShown = (page - 1) * pageSize + 1;
  const lastShown = (page - 1) * pageSize + rows.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Usuarios"
        actions={
          <Button asChild className="min-h-11">
            <Link href={`${BASE}/nuevo`}>Nuevo usuario de gestión</Link>
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          Cuentas de acceso al panel y al portal de socios: roles de gestión, invitaciones y estado.
        </p>
      </PageHeader>

      <nav
        aria-label="Vistas de las cuentas"
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1"
      >
        {CHIPS.map(({ key, label, href }) => (
          <Link
            key={key}
            href={href}
            aria-current={chip === key ? "page" : undefined}
            className={cn(CHIP_BASE, chip === key ? CHIP_ACTIVE : CHIP_INACTIVE)}
          >
            {label}
            <span className="font-mono tabular-nums">{counts[key]}</span>
          </Link>
        ))}
      </nav>

      <form className="flex flex-wrap items-end gap-2" method="get">
        {/* La vista activa sobrevive a la búsqueda. */}
        {filters.vista && <input type="hidden" name="vista" value={filters.vista} />}
        <Input
          name="q"
          placeholder="Nombre o email"
          defaultValue={filters.q ?? ""}
          aria-label="Nombre o email"
          className="w-full sm:w-56"
        />
        <Button type="submit" variant="secondary" className="min-h-11">Buscar</Button>
      </form>

      {total === 0 ? (
        <EmptyState
          size="list"
          description={
            hasFilters
              ? "Ninguna cuenta coincide con esta vista o búsqueda."
              : "Todavía no hay cuentas de acceso."
          }
          action={
            hasFilters
              ? <Button asChild variant="outline"><Link href={BASE}>Limpiar filtros</Link></Button>
              : undefined
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {`${firstShown}–${lastShown} de ${total} cuentas`}
            {pageCount > 1 && ` · página ${page} de ${pageCount}`}
          </p>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Último ingreso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link className={INLINE_LINK} href={`${BASE}/${row.id}`}>
                        {row.name ?? row.email}
                      </Link>
                    </TableCell>
                    <TableCell className="break-all">{row.email}</TableCell>
                    <TableCell><RoleBadges roles={row.roles} /></TableCell>
                    <TableCell>
                      <Badge variant={userAccountBadgeVariant(row.state)}>
                        {ACCOUNT_STATE_LABELS[row.state]}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {row.lastLoginAt ? formatDateAR(row.lastLoginAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {rows.map((row) => <UserCard key={row.id} row={row} />)}
          </div>
        </>
      )}

      <PaginationNav
        page={page}
        pageCount={pageCount}
        href={(n) => pageHref(BASE, filters as Record<string, string | undefined>, n)}
        label="Páginas de cuentas"
      />
    </div>
  );
}

function RoleBadges({ roles }: { roles: string[] }) {
  if (roles.length === 0) return <span className="text-sm text-muted-foreground">Sin roles</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {roles.map((r) => (
        <Badge key={r} variant={userRoleBadgeVariant(r)}>{ROLE_LABELS[r] ?? r}</Badge>
      ))}
    </span>
  );
}

function UserCard({ row }: { row: UserRow }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <Link className={INLINE_LINK} href={`${BASE}/${row.id}`}>{row.name ?? row.email}</Link>
          <Badge variant={userAccountBadgeVariant(row.state)}>
            {ACCOUNT_STATE_LABELS[row.state]}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-sm break-all text-muted-foreground">{row.email}</p>
        <RoleBadges roles={row.roles} />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Actualizar `tests/admin-nav.test.ts`**

En el `it` "keeps every live section for superadmin, in stable order" (líneas 37-45), el array pasa a:

```ts
    expect(hrefs).toEqual([
      "/admin", "/admin/solicitudes", "/admin/reempadronamiento", "/admin/socios",
      "/admin/tesoreria", "/admin/actas",
      "/admin/noticias", "/admin/actividades", "/admin/salud", "/admin/padron-electoral",
      "/admin/usuarios", "/admin/configuracion",
    ]);
```

En el `it` de Salud (líneas 54-56), el orden del grupo pasa a:

```ts
    expect(sistema.items.map((i) => i.href)).toEqual([
      "/admin/salud", "/admin/padron-electoral", "/admin/usuarios", "/admin/configuracion",
    ]);
```

Y agregar el `it` nuevo (molde del de padrón electoral):

```ts
  it("Usuarios vive en Sistema, entre Padrón electoral y Configuración, y es sólo del superadmin", () => {
    // Otorgar y quitar roles de gestión es el acto más sensible del panel: la
    // pantalla no puede siquiera listarse para un admin común (y la guarda
    // real, requireSuperadminUsers, corta en la ruta y en cada action).
    const sistema = ADMIN_NAV.find((g) => g.label === "Sistema")!;
    const usuarios = sistema.items.find((i) => i.href === "/admin/usuarios")!;
    expect(usuarios).toMatchObject({ label: "Usuarios", icon: "user-cog", superadminOnly: true });
    expect(
      navForRoles(["admin"]).some((g) => g.items.some((i) => i.href === "/admin/usuarios")),
    ).toBe(false);
  });
```

- [ ] **Step 8: Correr los tests de sincronía**

Run: `npx vitest run tests/admin-nav.test.ts tests/dashboard-cards.test.ts` → PASS (dashboard-cards es genérico: encuentra la tarjeta nueva solo). `npx tsc --noEmit` → sin errores.

- [ ] **Step 9: Commit**

```bash
git add src/app/admin/usuarios/page.tsx src/lib/admin/nav.ts src/components/admin/nav-icons.ts src/lib/admin/dashboard-cards.ts src/lib/admin/status-badges.ts tests/admin-nav.test.ts
git commit -m "feat(users): /admin/usuarios list screen, nav + dashboard entries, user badges"
```

---

### Task 10: Pantalla de alta `/admin/usuarios/nuevo`

**Files:**
- Create: `src/app/admin/usuarios/nuevo/page.tsx`
- Create: `src/app/admin/usuarios/nuevo/new-user-form.tsx`

**Interfaces:**
- Consumes: `createUserAction` (Task 8), `useSyncedForm`/`TextField`, `FormMessage`, `PageHeader`.

- [ ] **Step 1: `new-user-form.tsx`**

```tsx
"use client";
// El alta crea la cuenta con rol admin y manda la invitación. Superadmin se
// otorga DESPUÉS, desde el detalle (decisión 9 de la spec): el alta no puede
// crear un superadmin por descuido.
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { createUserAction } from "../actions";

export function NewUserForm() {
  const [state, formAction, pending] = useActionState(createUserAction, {});
  const { formRef, field } = useSyncedForm({ name: "", email: "" });
  return (
    <form ref={formRef} action={formAction} className="max-w-md space-y-3">
      <TextField label="Nombre y apellido" field={field("name")} maxLength={120} autoFocus />
      <TextField
        label="Email"
        field={field("email")}
        type="email"
        maxLength={191}
        hint="A esta casilla llega el enlace para crear la contraseña. Vence en 7 días."
      />
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" size="lg" className="min-h-11 px-4" disabled={pending}>
        {pending ? "Creando…" : "Crear cuenta y enviar invitación"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: `page.tsx`**

```tsx
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { requireSuperadminUsers } from "@/lib/auth/require-admin";
import { NewUserForm } from "./new-user-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Nuevo usuario — SIGeV" };

export default async function NuevoUsuarioPage() {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Nuevo usuario de gestión" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <PageHeader
        // La entidad va en el <h1>; la última miga es un sustantivo corto.
        title="Nuevo usuario de gestión"
        breadcrumb={[{ label: "Usuarios", href: "/admin/usuarios" }, { label: "Nueva" }]}
      >
        <p className="text-sm text-muted-foreground">
          La cuenta nace con rol Admin y una invitación por correo para crear su contraseña.
          Si además debe ser superadmin, se otorga después desde su detalle.
          Para un socio que ya tiene cuenta, el rol se otorga sobre esa cuenta — no se crea otra.
        </p>
      </PageHeader>
      <NewUserForm />
    </div>
  );
}
```

(Verificar la forma exacta de `breadcrumb` contra `src/components/admin/page-header.tsx` antes de commitear; ajustar los props si el tipo `Crumb` difiere.)

- [ ] **Step 3: Verificar** — `npx tsc --noEmit` → sin errores. `npm run build` → compila.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/usuarios/nuevo
git commit -m "feat(users): new managed user screen"
```

---

### Task 11: Pantalla de detalle `/admin/usuarios/[id]`

**Files:**
- Create: `src/app/admin/usuarios/[id]/page.tsx`
- Create: `src/app/admin/usuarios/[id]/edit-form.tsx`
- Create: `src/app/admin/usuarios/[id]/role-forms.tsx`
- Create: `src/app/admin/usuarios/[id]/account-forms.tsx`

**Interfaces:**
- Consumes: `getUserDetail` (Task 2), todas las actions (Task 8), `Dialog*` del design system, badges (Task 9), `auditActionLabel`.

- [ ] **Step 1: `role-forms.tsx`** — otorgar/quitar con Dialog (molde `DeleteHolidayButton`: el form va fuera del portal, el botón lo referencia con `form=`)

```tsx
"use client";
// Otorgar y quitar roles de gestión, cada uno con su Dialog: el efecto se
// redacta ANTES de confirmar, y lo que la guarda del dominio va a rechazar se
// muestra deshabilitado con el mismo motivo (patrón debit-adhesion). El aviso
// del token de 8 h vive en el banner del redirect (?rol=1), no acá.
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { grantRoleAction, revokeRoleAction } from "../actions";

export function RoleActionButton(props: {
  userId: number;
  userLabel: string;
  role: "admin" | "superadmin";
  mode: "grant" | "revoke";
  /** Si viene, el botón se deshabilita y este texto se muestra al lado: es el
   *  MISMO motivo por el que la action rechazaría. */
  disabledReason?: string;
}) {
  const action = props.mode === "grant" ? grantRoleAction : revokeRoleAction;
  const [state, formAction, pending] = useActionState(action, {});
  const formId = `role-${props.mode}-${props.role}-${props.userId}`;
  const roleLabel = props.role === "superadmin" ? "Superadmin" : "Admin";
  const verb = props.mode === "grant" ? "Otorgar" : "Quitar";

  if (props.disabledReason) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="min-h-11" disabled>{`${verb} ${roleLabel}`}</Button>
        <span className="text-xs text-muted-foreground">{props.disabledReason}</span>
      </span>
    );
  }

  const description =
    props.mode === "grant"
      ? props.role === "superadmin"
        ? `${props.userLabel} va a poder gestionar usuarios y roles, la configuración, la salud del sistema, el padrón electoral y todas las acciones sensibles de tesorería. El cambio rige cuando cierre sesión y vuelva a entrar.`
        : `${props.userLabel} va a poder operar el panel de administración (solicitudes, socios, tesorería, actas y contenido). El cambio rige cuando cierre sesión y vuelva a entrar.`
      : props.role === "superadmin"
        ? `${props.userLabel} deja de poder gestionar usuarios, configuración y las acciones de superadmin. El corte es inmediato en cada acción del panel.`
        : `${props.userLabel} deja de poder operar el panel de administración. El corte es inmediato en cada acción del panel.`;

  return (
    <>
      <Dialog>
        <form id={formId} action={formAction} className="hidden">
          <input type="hidden" name="id" value={props.userId} />
          <input type="hidden" name="role" value={props.role} />
        </form>
        <DialogTrigger asChild>
          <Button
            variant={props.mode === "revoke" ? "outline" : "default"}
            className="min-h-11"
            aria-label={`${verb} el rol ${roleLabel} a ${props.userLabel}`}
          >
            {`${verb} ${roleLabel}`}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`¿${verb} el rol ${roleLabel}?`}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button
              type="submit"
              form={formId}
              variant={props.mode === "revoke" ? "destructive" : "default"}
              disabled={pending}
            >
              {pending
                ? props.mode === "grant" ? "Otorgando…" : "Quitando…"
                : `${verb} ${roleLabel}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {state.error && (
        <FormMessage kind="error" as="span" className="w-full">{state.error}</FormMessage>
      )}
    </>
  );
}
```

- [ ] **Step 2: `account-forms.tsx`** — activar/desactivar (Dialog destructivo) + invitación (reenviar/revocar, botones simples)

```tsx
"use client";
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { resendInvitationAction, revokeInvitationAction, setActiveAction } from "../actions";

export function SetActiveButton(props: {
  userId: number;
  userLabel: string;
  active: boolean; // estado ACTUAL de la cuenta
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState(setActiveAction, {});
  const formId = `set-active-${props.userId}`;
  const disabling = props.active;
  const verb = disabling ? "Desactivar cuenta" : "Reactivar cuenta";

  if (props.disabledReason) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="min-h-11" disabled>{verb}</Button>
        <span className="text-xs text-muted-foreground">{props.disabledReason}</span>
      </span>
    );
  }

  return (
    <>
      <Dialog>
        <form id={formId} action={formAction} className="hidden">
          <input type="hidden" name="id" value={props.userId} />
          <input type="hidden" name="active" value={disabling ? "0" : "1"} />
        </form>
        <DialogTrigger asChild>
          <Button variant={disabling ? "outline" : "default"} className="min-h-11">{verb}</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`¿${verb}?`}</DialogTitle>
            <DialogDescription>
              {disabling
                ? `${props.userLabel} no va a poder ingresar más, con ningún rol, desde el próximo intento. Se puede reactivar cuando haga falta.`
                : `${props.userLabel} vuelve a poder ingresar con los roles que tiene.`}
            </DialogDescription>
          </DialogHeader>
          {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button
              type="submit"
              form={formId}
              variant={disabling ? "destructive" : "default"}
              disabled={pending}
            >
              {pending ? (disabling ? "Desactivando…" : "Reactivando…") : verb}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {state.error && (
        <FormMessage kind="error" as="span" className="w-full">{state.error}</FormMessage>
      )}
    </>
  );
}

export function InvitationButtons({ userId }: { userId: number }) {
  const [resendState, resendAction, resendPending] = useActionState(resendInvitationAction, {});
  const [revokeState, revokeAction, revokePending] = useActionState(revokeInvitationAction, {});
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={resendAction}>
          <input type="hidden" name="id" value={userId} />
          <Button type="submit" variant="secondary" className="min-h-11" disabled={resendPending}>
            {resendPending ? "Reenviando…" : "Reenviar invitación"}
          </Button>
        </form>
        <form action={revokeAction}>
          <input type="hidden" name="id" value={userId} />
          <Button type="submit" variant="outline" className="min-h-11" disabled={revokePending}>
            {revokePending ? "Revocando…" : "Revocar invitación"}
          </Button>
        </form>
      </div>
      {resendState.error && <FormMessage kind="error" box>{resendState.error}</FormMessage>}
      {revokeState.error && <FormMessage kind="error" box>{revokeState.error}</FormMessage>}
    </div>
  );
}
```

- [ ] **Step 3: `edit-form.tsx`**

```tsx
"use client";
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { updateUserAction } from "../actions";

export function EditUserForm(props: {
  userId: number;
  name: string;
  email: string;
  /** id de la ficha vinculada, si la hay: con socio, el email se edita desde
   *  la ficha (invariante Member.email ↔ User.email de members/write.ts). */
  memberId: number | null;
}) {
  const [state, formAction, pending] = useActionState(updateUserAction, {});
  const { formRef, field } = useSyncedForm({ name: props.name, email: props.email });
  return (
    <form ref={formRef} action={formAction} className="max-w-md space-y-3">
      <input type="hidden" name="id" value={props.userId} />
      <TextField label="Nombre y apellido" field={field("name")} maxLength={120} />
      {props.memberId === null ? (
        <TextField
          label="Email"
          field={field("email")}
          type="email"
          maxLength={191}
          hint="Cambiarlo revoca la invitación pendiente: reenviala después a la casilla nueva."
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          El email se cambia desde{" "}
          <a className={INLINE_LINK} href={`/admin/socios/${props.memberId}`}>la ficha del socio</a>
          : es la misma dirección con la que ingresa.
        </p>
      )}
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" className="min-h-11 px-4" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: `page.tsx`** — el detalle completo

```tsx
// Detalle de una cuenta (módulo de usuarios). Secciones: Datos, Roles, Cuenta,
// Invitación y Actividad. La pantalla deshabilita EXACTAMENTE lo que las
// guardas del dominio rechazan (auto-degradación, último superadmin, cuentas
// de socios) y lo dice con el mismo texto.
import Link from "next/link";
import { notFound } from "next/navigation";

import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { userAccountBadgeVariant, userRoleBadgeVariant } from "@/lib/admin/status-badges";
import { requireSuperadminUsers } from "@/lib/auth/require-admin";
import { formatDateAR, formatDateTimeAR } from "@/lib/format";
import {
  ACCOUNT_STATE_LABELS, auditActionLabel, ROLE_LABELS,
} from "@/lib/users/labels";
import { getUserDetail } from "@/lib/users/query";
import { USER_GUARD_MESSAGES } from "@/lib/users/service";
import { prisma } from "@/lib/prisma";
import { EditUserForm } from "./edit-form";
import { InvitationButtons, SetActiveButton } from "./account-forms";
import { RoleActionButton } from "./role-forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Usuario — SIGeV" };

// Banners de éxito por searchParam (patrón Configuración). El de rol otorgado
// lleva el aviso del token: el JWT de 8 h no refleja un rol nuevo hasta que la
// persona re-ingresa (spec §2 decisión 4).
const BANNERS: Record<string, { kind: "success" | "warning"; text: (name: string) => string }> = {
  "invitado=1": { kind: "success", text: () => "La cuenta se creó y la invitación salió por correo." },
  "invitado=2": { kind: "warning", text: () => "La cuenta se creó, pero el correo de invitación no salió. Reenvialo desde la sección Invitación." },
  "guardado=1": { kind: "success", text: () => "Datos guardados." },
  "rol=1": { kind: "success", text: (n) => `Rol otorgado. El cambio rige cuando ${n} cierre sesión y vuelva a entrar.` },
  "rol=2": { kind: "success", text: () => "Rol quitado. Deja de tener efecto de inmediato en cada acción del panel." },
  "cuenta=1": { kind: "success", text: () => "Cuenta reactivada." },
  "cuenta=2": { kind: "success", text: () => "Cuenta desactivada: no puede ingresar desde ahora." },
  "invitacion=1": { kind: "success", text: () => "Invitación reenviada." },
  "invitacion=2": { kind: "warning", text: () => "La invitación se reemitió, pero el correo no salió. Probá reenviarla de nuevo." },
  "invitacion=3": { kind: "success", text: () => "Invitación revocada: el enlace del buzón ya no sirve." },
};

function activeBanner(sp: Record<string, string | string[] | undefined>) {
  for (const key of Object.keys(BANNERS)) {
    const [k, v] = key.split("=");
    if ((Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) === v) return BANNERS[key];
  }
  return null;
}

export default async function UsuarioDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Usuario" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const [{ id: rawId }, sp] = await Promise.all([props.params, props.searchParams]);
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const user = await getUserDetail(prisma, id);
  if (!user) notFound();

  const label = user.name ?? user.email;
  const isSelf = user.id === actor.actorId;
  const managed = user.roles.includes("admin") || user.roles.includes("superadmin");
  const lastSuperadmin =
    user.roles.includes("superadmin") && user.active && user.activeSuperadmins <= 1;
  const banner = activeBanner(sp);

  return (
    <div className="space-y-6">
      <PageHeader
        title={label}
        breadcrumb={[{ label: "Usuarios", href: "/admin/usuarios" }, { label: "Detalle" }]}
      >
        <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <span className="break-all">{user.email}</span>
          <Badge variant={userAccountBadgeVariant(user.state)}>
            {ACCOUNT_STATE_LABELS[user.state]}
          </Badge>
        </p>
      </PageHeader>

      {banner && <FormMessage kind={banner.kind} box>{banner.text(label)}</FormMessage>}

      <section aria-labelledby="datos-title" className="space-y-3">
        <h2 id="datos-title" className="text-lg font-semibold">Datos</h2>
        <EditUserForm
          userId={user.id}
          name={user.name ?? ""}
          email={user.email}
          memberId={user.member?.id ?? null}
        />
        <p className="text-sm text-muted-foreground">
          Último ingreso:{" "}
          <span className="font-mono tabular-nums">
            {user.lastLoginAt ? formatDateTimeAR(user.lastLoginAt) : "nunca"}
          </span>
        </p>
      </section>

      <section aria-labelledby="roles-title" className="space-y-3">
        <h2 id="roles-title" className="text-lg font-semibold">Roles</h2>
        <p className="flex flex-wrap gap-1">
          {user.roles.length === 0 && <span className="text-sm text-muted-foreground">Sin roles.</span>}
          {user.roles.map((r) => (
            <Badge key={r} variant={userRoleBadgeVariant(r)}>{ROLE_LABELS[r] ?? r}</Badge>
          ))}
        </p>
        {user.member && (
          <p className="text-sm text-muted-foreground">
            El rol Socio lo gobierna el ciclo del socio (alta de acceso, baja y readmisión):{" "}
            <Link className={INLINE_LINK} href={`/admin/socios/${user.member.id}`}>ver la ficha</Link>.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <RoleActionButton
            userId={user.id}
            userLabel={label}
            role="admin"
            mode={user.roles.includes("admin") ? "revoke" : "grant"}
          />
          <RoleActionButton
            userId={user.id}
            userLabel={label}
            role="superadmin"
            mode={user.roles.includes("superadmin") ? "revoke" : "grant"}
            disabledReason={
              user.roles.includes("superadmin")
                ? isSelf
                  ? USER_GUARD_MESSAGES.selfSuperadmin
                  : lastSuperadmin
                    ? USER_GUARD_MESSAGES.lastSuperadmin
                    : undefined
                : undefined
            }
          />
        </div>
      </section>

      <section aria-labelledby="cuenta-title" className="space-y-3">
        <h2 id="cuenta-title" className="text-lg font-semibold">Cuenta</h2>
        {managed ? (
          <SetActiveButton
            userId={user.id}
            userLabel={label}
            active={user.active}
            disabledReason={
              user.active && isSelf
                ? USER_GUARD_MESSAGES.selfDisable
                : user.active && lastSuperadmin
                  ? USER_GUARD_MESSAGES.lastSuperadmin
                  : undefined
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {USER_GUARD_MESSAGES.notManaged}
            {user.member && (
              <>
                {" "}
                <Link className={INLINE_LINK} href={`/admin/socios/${user.member.id}`}>Ver la ficha</Link>.
              </>
            )}
          </p>
        )}
      </section>

      {managed && user.passwordChangedAt === null && (
        <section aria-labelledby="invitacion-title" className="space-y-3">
          <h2 id="invitacion-title" className="text-lg font-semibold">Invitación</h2>
          <p className="text-sm text-muted-foreground">
            {user.invitation
              ? `Invitación pendiente: vence el ${formatDateAR(user.invitation.expiresAt)}.`
              : "No hay una invitación viva: la cuenta no puede crear su contraseña hasta que le reenvíes una."}
          </p>
          <InvitationButtons userId={user.id} />
        </section>
      )}

      <section aria-labelledby="actividad-title" className="space-y-3">
        <h2 id="actividad-title" className="text-lg font-semibold">Actividad</h2>
        {user.activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividad registrada.</p>
        ) : (
          <ul className="list-none divide-y rounded-xl border p-0 text-sm">
            {user.activity.map((a) => {
              const role = (a.detail as { role?: string } | null)?.role;
              return (
                <li key={String(a.id)} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {auditActionLabel(a.action)}
                    {role ? ` (${ROLE_LABELS[role] ?? role})` : ""}
                    {a.actor ? <span className="text-muted-foreground">{` — por ${a.actor}`}</span> : ""}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDateTimeAR(a.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Verificar** — `npx tsc --noEmit` y `npm run build` → sin errores. Levantar el dev server (preview) y recorrer: lista → detalle → otorgar/quitar rol (Dialog) → alta → invitación. Con `EMAIL_ALLOWLIST` local, el alta debe caer en `?invitado=2` salvo que el email esté en la lista.

- [ ] **Step 6: Commit**

```bash
git add "src/app/admin/usuarios/[id]"
git commit -m "feat(users): user detail screen with role/account dialogs, invitation and activity"
```

---

### Task 12: Verificación final y cierre

**Files:** ninguno nuevo (correcciones menores si aparecen).

- [ ] **Step 1: Suite completa** — Run: `npx vitest run` → TODO verde. En particular: `member-access`, `require-admin`, `require-superadmin` y las suites de tesorería/MP **sin una aserción tocada**.

- [ ] **Step 2: Typecheck y build** — `npx tsc --noEmit` y `npm run build` → sin errores.

- [ ] **Step 3: La verificación de la spec §8** — Run:

```bash
git diff main --stat -- src/lib/treasury src/lib/mp src/lib/members
```

Expected: **salida vacía** (cero archivos tocados en las tres carpetas). Si aparece algo, es un desvío del plan: investigar antes de seguir.

- [ ] **Step 4: Revisión de auditoría** — grep de las actions nuevas confirmando que ningún `detail` lleva email/nombre: `rg "detail:" src/app/admin/usuarios src/lib/users` y leer cada hit.

- [ ] **Step 5: Commit final si hubo correcciones, y anunciar**

El plan termina acá. El merge a `main`, el push (lo corre Mariano) y el deploy con su `prisma migrate deploy` en el VPS (comandos COPIADOS de docs/10, nunca de memoria) quedan para después de la verificación en vivo con el operador, como en todos los módulos.
