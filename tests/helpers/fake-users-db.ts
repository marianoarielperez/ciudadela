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

  // Los `where` se COMPILAN una vez por consulta, no se interpretan por fila:
  // así una forma no soportada tira aunque la tabla esté vacía. Validando por
  // fila, un `count` con un filtro que el doble no entiende devolvería 0 en
  // silencio sobre una tabla sin filas —y un test de guarda pasaría por el
  // motivo equivocado—, que es exactamente lo que este doble existe para evitar.

  function compileNameFilter(filter: unknown): (name: string | undefined) => boolean {
    if (filter === undefined) return () => true;
    if (typeof filter === "string") return (name) => name === filter;
    const f = filter as { in?: string[] };
    if (Array.isArray(f.in)) return (name) => f.in!.includes(name ?? "");
    throw new Error(`fake: filtro de role.name no soportado: ${JSON.stringify(filter)}`);
  }

  function compileUserRoleWhere(where: Record<string, unknown>): (ur: UserRoleRow) => boolean {
    const checks: ((ur: UserRoleRow) => boolean)[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (k === "userId") { checks.push((ur) => ur.userId === v); }
      else if (k === "role") {
        const matchesName = compileNameFilter((v as { name?: unknown }).name);
        checks.push((ur) => matchesName(roleName(ur.roleId)));
      } else if (k === "user") {
        const f = v as { active?: boolean };
        for (const uk of Object.keys(f)) {
          if (uk !== "active") throw new Error(`fake: userRole where user.${uk} no soportado`);
        }
        if (f.active !== undefined) {
          checks.push((ur) => state.users.find((x) => x.id === ur.userId)?.active === f.active);
        }
      } else throw new Error(`fake: userRole where no soportado: ${k}`);
    }
    return (ur) => checks.every((c) => c(ur));
  }

  function compileTokenWhere(where: Record<string, unknown>): (t: TokenRow) => boolean {
    const checks: ((t: TokenRow) => boolean)[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (k === "tokenHash" || k === "id" || k === "userId" || k === "memberId" || k === "usedAt") {
        const field = k;
        checks.push((t) => t[field] === v);
      } else if (k === "purpose") {
        const f = v as { in?: string[] } | string;
        if (typeof f === "string") { checks.push((t) => t.purpose === f); }
        else if (Array.isArray(f.in)) { checks.push((t) => f.in!.includes(t.purpose)); }
        else throw new Error(`fake: purpose where no soportado: ${JSON.stringify(v)}`);
      } else throw new Error(`fake: actionToken where no soportado: ${k}`);
    }
    return (t) => checks.every((c) => c(t));
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

  // Los delegates van en su propio objeto para que el tipo del `tx` que recibe
  // `$transaction` no se refiera a sí mismo (`typeof db` adentro de `db` no
  // compila: TS7022). Se le agrega `$transaction` por mutación, así que en
  // tiempo de ejecución `tables` y `db` son EL MISMO objeto y el getter `state`
  // sigue leyendo la variable viva (clave para que el rollback se vea).
  const tables = {
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
        const match = compileUserRoleWhere(args.where);
        const before = state.userRoles.length;
        state.userRoles = state.userRoles.filter((ur) => !match(ur));
        return { count: before - state.userRoles.length };
      },
      async count(args: { where: Record<string, unknown> }) {
        const match = compileUserRoleWhere(args.where);
        return state.userRoles.filter(match).length;
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
        const match = compileTokenWhere(args.where);
        const before = state.actionTokens.length;
        state.actionTokens = state.actionTokens.filter((t) => !match(t));
        return { count: before - state.actionTokens.length };
      },
      async updateMany(args: { where: Record<string, unknown>; data: Partial<TokenRow> }) {
        const match = compileTokenWhere(args.where);
        let count = 0;
        for (const t of state.actionTokens) {
          if (match(t)) { Object.assign(t, args.data); count++; }
        }
        return { count };
      },
    },
  };

  /** Lo que recibe el callback de `$transaction`: los mismos delegates. */
  type FakeTx = typeof tables;

  const db = Object.assign(tables, {
    async $transaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
      const snapshot = structuredClone(state);
      try {
        return await fn(tables);
      } catch (e) {
        state = snapshot; // rollback
        throw e;
      }
    },
  });
  return db;
}
