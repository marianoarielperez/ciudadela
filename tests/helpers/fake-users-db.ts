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

/** Campos escalares que `user.create` sabe escribir. Todo lo demás —incluido
 *  cualquier write anidado— tira. */
const USER_WRITABLE = [
  "email", "passwordHash", "passwordChangedAt", "name", "active", "lastLoginAt",
];

/** Ídem para `actionToken.create`: los escalares de la fila (el `id` lo pone el
 *  doble). Un write anidado —`user: { connect: … }`— tira. */
const TOKEN_WRITABLE = [
  "purpose", "tokenHash", "memberId", "applicationId", "userId",
  "expiresAt", "usedAt", "createdAt",
];

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

  /** P2002 con la forma que produce `@prisma/adapter-mariadb` (la única que el
   *  proyecto lee: `src/lib/treasury/unique-violation.ts`). */
  const p2002 = (index: string) => ({
    code: "P2002",
    meta: { driverAdapterError: { cause: { constraint: { index } } } },
  });

  /** Compila la comparación de un campo ESCALAR. Un filtro-objeto
   *  (`{ not: … }`, `{ in: […] }`, `{ equals: … }`, un `Date`) no está
   *  implementado: comparado con `===` daría un predicado que nunca es
   *  verdadero, así que un `count` devolvería 0 y una guarda rota —"nunca cero
   *  superadmins activos" es la del caso— pasaría el test por el motivo
   *  equivocado. Se valida al COMPILAR: tira aunque la tabla esté vacía.
   *
   *  `undefined` es el otro lado de la misma trampa y NO tira: en Prisma
   *  significa "cláusula ignorada", y los tipos admiten `number | undefined` en
   *  esas posiciones sin ningún cast. Comparado con `===` daría el mismo
   *  predicado que nunca matchea —un `userRole.count({ where: { userId:
   *  excludeId, … } })` con `excludeId` sin definir devolvería 0, que es lo que
   *  la guarda lee como "rechazar"—. La única respuesta inadmisible es cero:
   *  acá se ignora, igual que hace `compileNameFilter` más abajo. */
  function scalarEquals(key: string, value: unknown): (actual: unknown) => boolean {
    if (value === undefined) return () => true;
    if (value !== null && typeof value === "object") {
      throw new Error(
        `fake: filtro no escalar sobre ${key} no soportado: ${JSON.stringify(value)}`,
      );
    }
    return (actual) => actual === value;
  }

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
      if (k === "userId") { const eq = scalarEquals(k, v); checks.push((ur) => eq(ur.userId)); }
      else if (k === "role") {
        const matchesName = compileNameFilter((v as { name?: unknown }).name);
        checks.push((ur) => matchesName(roleName(ur.roleId)));
      } else if (k === "user") {
        const f = v as { active?: unknown };
        for (const uk of Object.keys(f)) {
          if (uk !== "active") throw new Error(`fake: userRole where user.${uk} no soportado`);
        }
        if (f.active !== undefined) {
          const eq = scalarEquals("user.active", f.active);
          checks.push((ur) => eq(state.users.find((x) => x.id === ur.userId)?.active));
        }
      } else throw new Error(`fake: userRole where no soportado: ${k}`);
    }
    return (ur) => checks.every((c) => c(ur));
  }

  function compileUserWhere(where: Record<string, unknown>): (u: UserRow) => boolean {
    const checks: ((u: UserRow) => boolean)[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (k === "id" || k === "email" || k === "active") {
        const field = k;
        const eq = scalarEquals(k, v);
        checks.push((u) => eq(u[field]));
      } else throw new Error(`fake: user where no soportado: ${k}`);
    }
    return (u) => checks.every((c) => c(u));
  }

  function compileMemberWhere(where: Record<string, unknown>): (m: MemberRow) => boolean {
    const checks: ((m: MemberRow) => boolean)[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (k === "email" || k === "userId" || k === "id") {
        const field = k;
        const eq = scalarEquals(k, v);
        checks.push((m) => eq(m[field]));
      } else throw new Error(`fake: member where no soportado: ${k}`);
    }
    return (m) => checks.every((c) => c(m));
  }

  function compileTokenWhere(where: Record<string, unknown>): (t: TokenRow) => boolean {
    const checks: ((t: TokenRow) => boolean)[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (k === "tokenHash" || k === "id" || k === "userId" || k === "memberId" || k === "usedAt") {
        const field = k;
        const eq = scalarEquals(k, v);
        checks.push((t) => eq(t[field]));
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
        // `findUnique` sólo entiende las dos claves únicas de `users`. Un where
        // vacío, uno por otro campo o un `email: { equals: … }` tiene que TIRAR:
        // devolver `null` es indistinguible de "no existe".
        const where = args.where as Record<string, unknown>;
        const keys = Object.keys(where);
        for (const k of keys) {
          if (k !== "id" && k !== "email") {
            throw new Error(`fake: user.findUnique where no soportado: ${k}`);
          }
        }
        // Se cuentan las claves DEFINIDAS: desde que `scalarEquals` ignora un
        // `undefined` (semántica de Prisma), un `{ id: undefined }` compilaría a
        // "todo matchea" y `findUnique` devolvería una fila cualquiera. Prisma
        // también rechaza ese where.
        if (keys.every((k) => where[k] === undefined)) {
          throw new Error("fake: user.findUnique sin id ni email");
        }
        const match = compileUserWhere(where);
        const u = state.users.find(match);
        return u ? userView(u, args) : null;
      },
      async create(args: { data: Record<string, unknown> }) {
        // Lista blanca: un write anidado (`roles: { create: […] }`) compila
        // contra el tipo real de Prisma y acá se perdería sin ruido, dejando
        // `state.userRoles` intacto y el conteo que sostiene una guarda midiendo
        // un estado que el servicio creía haber escrito.
        for (const [k, v] of Object.entries(args.data)) {
          if (!USER_WRITABLE.includes(k)) {
            throw new Error(`fake: user.create data.${k} no soportado`);
          }
          if (v !== null && typeof v === "object" && !(v instanceof Date)) {
            throw new Error(`fake: user.create data.${k} anidado no soportado: ${JSON.stringify(v)}`);
          }
        }
        const email = args.data.email as string;
        if (state.users.some((u) => u.email === email)) throw p2002("users_email_key");
        const u: UserRow = {
          id: nextId++, email,
          passwordHash: (args.data.passwordHash as string) ?? "x",
          passwordChangedAt: (args.data.passwordChangedAt as Date) ?? null,
          name: (args.data.name as string) ?? null,
          active: (args.data.active as boolean) ?? true,
          lastLoginAt: (args.data.lastLoginAt as Date) ?? null,
        };
        state.users.push(u);
        return { ...u };
      },
      async update(args: { where: { id?: number; email?: string }; data: Record<string, unknown> }) {
        // El doble sólo sabe ubicar por id. Un `update({ where: { email } })`
        // compila contra el tipo real, y sin este corte caía en el mensaje de
        // "id inexistente": tiraba (bien) pero mentía el motivo.
        if (args.where.id === undefined) {
          throw new Error(`fake: user.update where sin id: ${JSON.stringify(args.where)}`);
        }
        const u = state.users.find((x) => x.id === args.where.id);
        if (!u) throw new Error("fake: user.update sobre id inexistente");
        // Mismo motivo que en `create`, y con la misma lista blanca: un
        // `roles: { deleteMany: {} }` —o un campo que no existe— escribiría una
        // propiedad basura sobre la fila y no tocaría los roles.
        for (const [k, v] of Object.entries(args.data)) {
          if (!USER_WRITABLE.includes(k)) {
            throw new Error(`fake: user.update data.${k} no soportado`);
          }
          if (v !== null && typeof v === "object" && !(v instanceof Date)) {
            throw new Error(`fake: user.update data.${k} anidado no soportado: ${JSON.stringify(v)}`);
          }
        }
        if (args.data.email !== undefined && args.data.email !== u.email
          && state.users.some((x) => x.email === args.data.email)) {
          throw p2002("users_email_key");
        }
        Object.assign(u, args.data);
        return { ...u };
      },
      async count(args?: { where?: Record<string, unknown> }) {
        if (!args?.where) return state.users.length;
        return state.users.filter(compileUserWhere(args.where)).length;
      },
    },
    role: {
      async findUnique(args: { where: { name?: string; id?: number } }) {
        // Las dos claves únicas de `roles`. Sin esto un `where: { id }` miraba
        // `where.name` (undefined), no matcheaba nada y devolvía `null`:
        // indistinguible de "ese rol no existe".
        const where = args.where as Record<string, unknown>;
        const keys = Object.keys(where);
        for (const k of keys) {
          if (k !== "name" && k !== "id") {
            throw new Error(`fake: role.findUnique where no soportado: ${k}`);
          }
        }
        if (keys.every((k) => where[k] === undefined)) {
          throw new Error("fake: role.findUnique sin name ni id");
        }
        const checks = keys.map((k) => {
          const field = k as "name" | "id";
          const eq = scalarEquals(k, where[k]);
          return (r: RoleRow) => eq(r[field]);
        });
        const r = state.roles.find((x) => checks.every((c) => c(x)));
        return r ? { ...r } : null;
      },
    },
    userRole: {
      async create(args: { data: UserRoleRow }) {
        // La base real tiene `@@id([userId, roleId])`: asignar dos veces el mismo
        // rol tira P2002. Sin este chequeo quedarían dos filas y un `count`
        // posterior —el que sostiene "queda al menos un superadmin"— daría 2.
        // MariaDB llama PRIMARY al índice de la clave primaria, siempre.
        if (state.userRoles.some((ur) =>
          ur.userId === args.data.userId && ur.roleId === args.data.roleId)) {
          throw p2002("PRIMARY");
        }
        state.userRoles.push({ ...args.data });
        return { ...args.data };
      },
      async deleteMany(args?: { where?: Record<string, unknown> }) {
        // Sin `where` el `Object.entries(undefined)` reventaba con un TypeError
        // ilegible; y borrar la tabla entera no es lo que quiso escribir nadie.
        if (!args?.where) throw new Error("fake: userRole.deleteMany where requerido");
        const match = compileUserRoleWhere(args.where);
        const before = state.userRoles.length;
        state.userRoles = state.userRoles.filter((ur) => !match(ur));
        return { count: before - state.userRoles.length };
      },
      async count(args?: { where?: Record<string, unknown> }) {
        if (!args?.where) throw new Error("fake: userRole.count where requerido");
        const match = compileUserRoleWhere(args.where);
        return state.userRoles.filter(match).length;
      },
    },
    member: {
      async findFirst(args: { where: Record<string, unknown>; select?: Record<string, unknown> }) {
        // `{ email, userId: null }` —socio con esa casilla y todavía SIN usuario—
        // es la consulta del dominio: descartar el `userId` devolvía uno ya
        // vinculado.
        const m = state.members.find(compileMemberWhere(args.where));
        return m ? { ...m } : null;
      },
    },
    actionToken: {
      async create(args: { data: Omit<TokenRow, "id" | "usedAt" | "createdAt"> }) {
        // Misma lista blanca que `user.create`: un `user: { connect: { id } }`
        // en vez de `userId` compila contra el tipo real, se spreadearía tal
        // cual y dejaría la fila con `userId: undefined` —y después un
        // `deleteMany({ where: { userId } })` no borraría nada—.
        for (const [k, v] of Object.entries(args.data as Record<string, unknown>)) {
          if (!TOKEN_WRITABLE.includes(k)) {
            throw new Error(`fake: actionToken.create data.${k} no soportado`);
          }
          if (v !== null && typeof v === "object" && !(v instanceof Date)) {
            throw new Error(`fake: actionToken.create data.${k} anidado no soportado: ${JSON.stringify(v)}`);
          }
        }
        const t: TokenRow = { id: nextId++, usedAt: null, createdAt: new Date(), ...args.data };
        state.actionTokens.push(t);
        return { ...t };
      },
      async findUnique(args: { where: Record<string, unknown> }) {
        // El canje consulta `{ tokenHash, usedAt: null }`: comparando el
        // `tokenHash` a pelo el `usedAt` se perdía y devolvía un token ya usado.
        const t = state.actionTokens.find(compileTokenWhere(args.where));
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
