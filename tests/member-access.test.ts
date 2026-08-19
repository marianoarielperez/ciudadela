import { describe, expect, it, vi } from "vitest";

// El singleton importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { ACCESS_ERRORS, makeMemberAccess } from "@/lib/members/access";
import { hashToken, TOKEN_TTL } from "@/lib/tokens";

const NOW = new Date("2026-08-19T12:00:00Z");

type FakeToken = {
  id: number; purpose: string; tokenHash: string; memberId: number | null;
  userId: number | null; expiresAt: Date; usedAt: Date | null;
};
type FakeUser = { id: number; email: string; passwordHash: string; name: string | null; active: boolean };
type FakeMember = Record<string, unknown> & { id: number };

const FUTURE = new Date(NOW.getTime() + TOKEN_TTL.email_verification);

function token(raw: string, purpose: string, over: Partial<FakeToken> = {}): FakeToken {
  return {
    id: 0, purpose, tokenHash: hashToken(raw), memberId: 1, userId: null,
    expiresAt: FUTURE, usedAt: null, ...over,
  };
}

type Seed = {
  member?: Record<string, unknown>;
  tokens?: FakeToken[];
  users?: FakeUser[];
  members?: FakeMember[];
  roles?: { id: number; name: string }[];
};

function makeFakeDb(seed: Seed = {}) {
  const base: FakeMember = {
    id: 1, fullName: "Perez Ana", status: "active", email: "vecino@example.com",
    emailStatus: "declared", emailVerifiedAt: null, userId: null, ...seed.member,
  };
  const state = {
    members: (seed.members ?? [base]).map((m) => ({ ...m })),
    tokens: (seed.tokens ?? []).map((t, i) => ({ ...t, id: t.id || i + 1 })),
    users: (seed.users ?? []).map((u) => ({ ...u })),
    userRoles: [] as { userId: number; roleId: number }[],
    roles: seed.roles ?? [{ id: 9, name: "socio" }],
    nextUserId: 100,
    nextTokenId: 900,
  };

  function snapshot() {
    return {
      members: state.members.map((m) => ({ ...m })),
      tokens: state.tokens.map((t) => ({ ...t })),
      users: state.users.map((u) => ({ ...u })),
      userRoles: [...state.userRoles],
    };
  }

  const db = {
    // Como en tests/member-write.test.ts: el fake fotografía el estado y lo
    // restaura si el callback lanza. Un passthrough no distingue atomicidad de
    // secuencialidad, y acá lo que se asserta es justamente qué queda escrito
    // cuando el canje se rechaza.
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const snap = snapshot();
      try {
        return await cb(db);
      } catch (err) {
        Object.assign(state, snap);
        throw err;
      }
    }),
    actionToken: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        // Cede el turno: sin esto dos canjes concurrentes se serializan solos y
        // el test de carrera no probaría nada.
        await Promise.resolve();
        return state.tokens.find((t) => t.tokenHash === where.tokenHash) ?? null;
      },
      create: async ({ data }: { data: Omit<FakeToken, "id" | "usedAt"> }) => {
        const row = { id: state.nextTokenId++, usedAt: null, ...data };
        state.tokens.push(row);
        return row;
      },
      // UPDATE ... WHERE condicional: el filtro lo evalúa el "motor" y el cuerpo
      // corre sin ceder el turno, como una sentencia atómica.
      updateMany: async ({ where, data }: { where: { id: number; usedAt: null }; data: Partial<FakeToken> }) => {
        const row = state.tokens.find((t) => t.id === where.id && t.usedAt === where.usedAt);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      deleteMany: async ({
        where,
      }: { where: { memberId?: number; purpose?: { in: string[] }; usedAt?: null } }) => {
        const doomed = state.tokens.filter(
          (t) =>
            (where.memberId === undefined || t.memberId === where.memberId) &&
            (where.purpose === undefined || where.purpose.in.includes(t.purpose)) &&
            (where.usedAt === undefined || t.usedAt === where.usedAt),
        );
        state.tokens = state.tokens.filter((t) => !doomed.includes(t));
        return { count: doomed.length };
      },
    },
    member: {
      findUnique: async ({ where }: { where: { id?: number; userId?: number } }) => {
        const row = state.members.find(
          (m) =>
            (where.id === undefined || m.id === where.id) &&
            (where.userId === undefined || m.userId === where.userId),
        );
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = state.members.find((m) => m.id === where.id);
        if (!row) throw new Error("member not found");
        Object.assign(row, data);
        return { ...row };
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id?: number; email?: string } }) => {
        const row = state.users.find(
          (u) =>
            (where.id === undefined || u.id === where.id) &&
            (where.email === undefined || u.email === where.email),
        );
        if (!row) return null;
        const roles = state.userRoles
          .filter((ur) => ur.userId === row.id)
          .map((ur) => ({ role: state.roles.find((r) => r.id === ur.roleId)! }));
        return { ...row, roles };
      },
      create: async ({ data }: { data: Omit<FakeUser, "id"> }) => {
        const row = { id: state.nextUserId++, ...data };
        state.users.push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: number }; data: Partial<FakeUser> }) => {
        const row = state.users.find((u) => u.id === where.id);
        if (!row) throw new Error("user not found");
        Object.assign(row, data);
        return { ...row };
      },
    },
    role: {
      findUnique: async ({ where }: { where: { name: string } }) =>
        state.roles.find((r) => r.name === where.name) ?? null,
    },
    userRole: {
      upsert: async ({ create }: { create: { userId: number; roleId: number } }) => {
        const found = state.userRoles.find(
          (ur) => ur.userId === create.userId && ur.roleId === create.roleId,
        );
        if (!found) state.userRoles.push(create);
        return create;
      },
    },
  };
  return { db, state };
}

function seedRole(state: ReturnType<typeof makeFakeDb>["state"], userId: number, name: string) {
  const role = state.roles.find((r) => r.name === name);
  if (!role) {
    const created = { id: state.roles.length + 20, name };
    state.roles.push(created);
    state.userRoles.push({ userId, roleId: created.id });
    return;
  }
  state.userRoles.push({ userId, roleId: role.id });
}

describe("memberAccess.verifyEmail", () => {
  it("marks the email as verified, burns the token and hands back an invitation", async () => {
    const { db, state } = makeFakeDb({ tokens: [token("raw", "email_verification")] });
    const res = await makeMemberAccess(db as never).verifyEmail("raw", NOW);

    expect(res).toMatchObject({ ok: true, memberId: 1 });
    expect(res.ok && res.invite).toBeTruthy();
    expect(state.members[0]).toMatchObject({ emailStatus: "verified", emailVerifiedAt: NOW });
    expect(state.tokens.find((t) => t.tokenHash === hashToken("raw"))?.usedAt).toEqual(NOW);
    // La invitación emitida es un password_invitation vivo de ESE socio.
    const invite = state.tokens.find((t) => t.purpose === "password_invitation");
    expect(invite).toMatchObject({ memberId: 1, usedAt: null });
    expect(res.ok && invite?.tokenHash).toBe(hashToken(res.ok ? (res.invite as string) : ""));
  });

  it("does not invite a member that already has an account", async () => {
    const { db, state } = makeFakeDb({
      member: { userId: 42 },
      tokens: [token("raw", "email_verification")],
      users: [{ id: 42, email: "vecino@example.com", passwordHash: "x", name: null, active: true }],
    });
    const res = await makeMemberAccess(db as never).verifyEmail("raw", NOW);
    expect(res).toEqual({ ok: true, memberId: 1, invite: null });
    expect(state.tokens.some((t) => t.purpose === "password_invitation")).toBe(false);
  });

  // Un solo enlace vivo por socio: si la verificación emite una invitación sin
  // revocar, quedan dos caminos paralelos para crear la contraseña de la cuenta.
  it("revokes the member's other live links before issuing the invitation", async () => {
    const { db, state } = makeFakeDb({
      tokens: [
        token("raw", "email_verification"),
        token("otro", "email_verification", { id: 2 }),
        token("vieja", "password_invitation", { id: 3 }),
        token("ajena", "password_invitation", { id: 4, memberId: 2 }),
        token("usada", "email_verification", { id: 5, usedAt: new Date("2026-08-01T00:00:00Z") }),
      ],
    });
    await makeMemberAccess(db as never).verifyEmail("raw", NOW);
    const live = state.tokens.filter((t) => t.usedAt === null).map((t) => t.id);
    // Sobrevive la invitación nueva (id >= 900) y el token del socio 2.
    expect(live.filter((id) => id < 900)).toEqual([4]);
    // El consumido y el ya usado quedan como rastro.
    expect(state.tokens.filter((t) => t.usedAt !== null).map((t) => t.id).sort()).toEqual([1, 5]);
  });

  it("rejects a token of another purpose, an expired one and an unknown one", async () => {
    const svc = (tokens: FakeToken[]) => makeMemberAccess(makeFakeDb({ tokens }).db as never);
    expect(await svc([token("raw", "password_invitation")]).verifyEmail("raw", NOW)).toEqual({
      ok: false, error: ACCESS_ERRORS.dead,
    });
    expect(
      await svc([token("raw", "email_verification", { expiresAt: new Date(NOW.getTime() - 1) })])
        .verifyEmail("raw", NOW),
    ).toEqual({ ok: false, error: ACCESS_ERRORS.dead });
    expect(await svc([]).verifyEmail("raw", NOW)).toEqual({ ok: false, error: ACCESS_ERRORS.dead });
  });

  // La carrera que dejó abierta la Task 13: el envío lee al socio fuera de
  // transacción, así que una baja que commitea en el medio deja un enlace vivo.
  // Se revalida AL CANJEAR, y el token se quema igual: un enlace que llegó a un
  // buzón que ya no representa a nadie no puede quedar vivo esperando otro click.
  it("rejects the redemption when the member was withdrawn after the link was sent", async () => {
    const { db, state } = makeFakeDb({
      member: { status: "withdrawn" },
      tokens: [token("raw", "email_verification")],
    });
    const res = await makeMemberAccess(db as never).verifyEmail("raw", NOW);
    expect(res).toEqual({ ok: false, error: ACCESS_ERRORS.withdrawn });
    expect(state.members[0]).toMatchObject({ emailStatus: "declared", emailVerifiedAt: null });
    expect(state.tokens[0].usedAt).toEqual(NOW); // quemado
  });

  // La suspensión es temporal y no le saca al socio el domicilio electrónico:
  // verificarlo sigue correspondiendo (el panel se lo bloquea `requireMember`).
  it("lets a suspended member verify the address", async () => {
    const { db } = makeFakeDb({ member: { status: "suspended" }, tokens: [token("raw", "email_verification")] });
    expect(await makeMemberAccess(db as never).verifyEmail("raw", NOW)).toMatchObject({ ok: true });
  });

  it("lets only one of two simultaneous redemptions through", async () => {
    const { db, state } = makeFakeDb({ tokens: [token("raw", "email_verification")] });
    const svc = makeMemberAccess(db as never);
    const [a, b] = await Promise.all([svc.verifyEmail("raw", NOW), svc.verifyEmail("raw", NOW)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(state.tokens.filter((t) => t.purpose === "password_invitation")).toHaveLength(1);
  });
});

describe("memberAccess.createPassword", () => {
  const invite = () => [token("raw", "password_invitation")];

  it("creates the account, gives it the socio role and links it to the card", async () => {
    const { db, state } = makeFakeDb({ member: { email: "Vecino@Example.com" }, tokens: invite() });
    const res = await makeMemberAccess(db as never).createPassword("raw", "hash", NOW);

    expect(res).toMatchObject({ ok: true, memberId: 1 });
    const user = state.users[0];
    expect(user).toMatchObject({
      email: "vecino@example.com", // normalizado: el login busca en minúsculas
      passwordHash: "hash",
      name: "Perez Ana",
      active: true,
    });
    expect(state.userRoles).toEqual([{ userId: user.id, roleId: 9 }]);
    expect(state.members[0].userId).toBe(user.id);
    expect(state.tokens[0].usedAt).toEqual(NOW);
  });

  it("resets the password of the account already linked to the card", async () => {
    const { db, state } = makeFakeDb({
      member: { userId: 42 },
      tokens: invite(),
      users: [{ id: 42, email: "vecino@example.com", passwordHash: "viejo", name: "Perez Ana", active: false }],
    });
    const res = await makeMemberAccess(db as never).createPassword("raw", "hash", NOW);
    expect(res).toMatchObject({ ok: true, userId: 42 });
    expect(state.users).toHaveLength(1);
    expect(state.users[0]).toMatchObject({ passwordHash: "hash", active: true });
  });

  it("rejects a dead link and a token of another purpose", async () => {
    const dead = makeMemberAccess(makeFakeDb({ tokens: [] }).db as never);
    expect(await dead.createPassword("raw", "hash", NOW)).toEqual({ ok: false, error: ACCESS_ERRORS.dead });
    const wrong = makeMemberAccess(makeFakeDb({ tokens: [token("raw", "email_verification")] }).db as never);
    expect(await wrong.createPassword("raw", "hash", NOW)).toEqual({ ok: false, error: ACCESS_ERRORS.dead });
  });

  it("rejects and burns the link when the member was withdrawn in the meantime", async () => {
    const { db, state } = makeFakeDb({ member: { status: "withdrawn" }, tokens: invite() });
    expect(await makeMemberAccess(db as never).createPassword("raw", "hash", NOW)).toEqual({
      ok: false, error: ACCESS_ERRORS.withdrawn,
    });
    expect(state.users).toHaveLength(0);
    expect(state.tokens[0].usedAt).toEqual(NOW);
  });

  it("lets a suspended member create the password (the panel is what stays closed)", async () => {
    const { db } = makeFakeDb({ member: { status: "suspended" }, tokens: invite() });
    expect(await makeMemberAccess(db as never).createPassword("raw", "hash", NOW)).toMatchObject({ ok: true });
  });

  // Una invitación de socio NO puede escribirle la contraseña a una cuenta de
  // administración que casualmente tenga el mismo email en la ficha.
  it("refuses to take over an administrator account with the same address", async () => {
    const { db, state } = makeFakeDb({
      tokens: invite(),
      users: [{ id: 5, email: "vecino@example.com", passwordHash: "del-admin", name: "Admin", active: true }],
    });
    seedRole(state, 5, "admin");
    expect(await makeMemberAccess(db as never).createPassword("raw", "hash", NOW)).toEqual({
      ok: false, error: ACCESS_ERRORS.conflict,
    });
    expect(state.users[0].passwordHash).toBe("del-admin");
    // El enlace NO se quema: el problema es un dato mal cargado, no un ataque, y
    // quemarlo dejaría al socio sin camino (el reenvío exige email sin verificar).
    expect(state.tokens[0].usedAt).toBeNull();
  });

  it("refuses an account already linked to another member's card", async () => {
    const { db, state } = makeFakeDb({
      tokens: invite(),
      members: [
        { id: 1, fullName: "Perez Ana", status: "active", email: "vecino@example.com", emailStatus: "verified", userId: null },
        { id: 2, fullName: "Perez Juan", status: "active", email: "vecino@example.com", emailStatus: "verified", userId: 5 },
      ],
      users: [{ id: 5, email: "vecino@example.com", passwordHash: "del-otro", name: "Perez Juan", active: true }],
    });
    seedRole(state, 5, "socio");
    expect(await makeMemberAccess(db as never).createPassword("raw", "hash", NOW)).toEqual({
      ok: false, error: ACCESS_ERRORS.conflict,
    });
    expect(state.users[0].passwordHash).toBe("del-otro");
    expect(state.tokens[0].usedAt).toBeNull();
  });

  it("refuses when the card has no address to use as the account email", async () => {
    const { db, state } = makeFakeDb({ member: { email: null }, tokens: invite() });
    expect(await makeMemberAccess(db as never).createPassword("raw", "hash", NOW)).toEqual({
      ok: false, error: ACCESS_ERRORS.noEmail,
    });
    expect(state.tokens[0].usedAt).toBeNull();
  });

  it("refuses when the socio role is missing from the database", async () => {
    const { db, state } = makeFakeDb({ tokens: invite(), roles: [{ id: 1, name: "admin" }] });
    expect(await makeMemberAccess(db as never).createPassword("raw", "hash", NOW)).toEqual({
      ok: false, error: ACCESS_ERRORS.conflict,
    });
    expect(state.users).toHaveLength(0);
    expect(state.tokens[0].usedAt).toBeNull();
  });

  it("lets only one of two simultaneous submissions create the account", async () => {
    const { db, state } = makeFakeDb({ tokens: invite() });
    const svc = makeMemberAccess(db as never);
    const [a, b] = await Promise.all([
      svc.createPassword("raw", "hash-a", NOW),
      svc.createPassword("raw", "hash-b", NOW),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(state.users).toHaveLength(1);
  });
});
