import { describe, expect, it, vi } from "vitest";

// El singleton importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makePasswordReset, RESET_ERRORS } from "@/lib/auth/password-reset";
import { hashToken, TOKEN_TTL } from "@/lib/tokens";

const NOW = new Date("2026-08-19T12:00:00Z");
const FUTURE = new Date(NOW.getTime() + TOKEN_TTL.password_reset);

type FakeToken = {
  id: number;
  purpose: string;
  tokenHash: string;
  memberId: number | null;
  userId: number | null;
  expiresAt: Date;
  usedAt: Date | null;
};
type FakeUser = { id: number; email: string; passwordHash: string; active: boolean };

function token(raw: string, over: Partial<FakeToken> = {}): FakeToken {
  return {
    id: 0,
    purpose: "password_reset",
    tokenHash: hashToken(raw),
    memberId: null,
    userId: 7,
    expiresAt: FUTURE,
    usedAt: null,
    ...over,
  };
}

type Seed = { users?: FakeUser[]; tokens?: FakeToken[] };

function makeFakeDb(seed: Seed = {}) {
  const state = {
    users: (seed.users ?? [{ id: 7, email: "vecino@example.com", passwordHash: "viejo", active: true }]).map(
      (u) => ({ ...u }),
    ),
    tokens: (seed.tokens ?? []).map((t, i) => ({ ...t, id: t.id || i + 1 })),
    nextTokenId: 900,
  };

  function snapshot() {
    return { users: state.users.map((u) => ({ ...u })), tokens: state.tokens.map((t) => ({ ...t })) };
  }

  const db = {
    // Igual que tests/member-access.test.ts: el fake fotografía el estado y lo
    // restaura si el callback lanza, para poder afirmar qué queda escrito
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
        // Cede el turno: sin esto dos canjes concurrentes se serializan solos.
        await Promise.resolve();
        return state.tokens.find((t) => t.tokenHash === where.tokenHash) ?? null;
      },
      create: async ({ data }: { data: Omit<FakeToken, "id" | "usedAt"> }) => {
        const row = { id: state.nextTokenId++, usedAt: null, ...data };
        state.tokens.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: number; usedAt: null };
        data: Partial<FakeToken>;
      }) => {
        const row = state.tokens.find((t) => t.id === where.id && t.usedAt === where.usedAt);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      deleteMany: async ({
        where,
      }: {
        where: { memberId?: number; userId?: number; purpose?: { in: string[] }; usedAt?: null };
      }) => {
        const doomed = state.tokens.filter(
          (t) =>
            (where.memberId === undefined || t.memberId === where.memberId) &&
            (where.userId === undefined || t.userId === where.userId) &&
            (where.purpose === undefined || where.purpose.in.includes(t.purpose)) &&
            (where.usedAt === undefined || t.usedAt === where.usedAt),
        );
        state.tokens = state.tokens.filter((t) => !doomed.includes(t));
        return { count: doomed.length };
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id?: number; email?: string } }) => {
        const row = state.users.find(
          (u) =>
            (where.id === undefined || u.id === where.id) &&
            (where.email === undefined || u.email === where.email),
        );
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: { where: { id: number }; data: Partial<FakeUser> }) => {
        const row = state.users.find((u) => u.id === where.id);
        if (!row) throw new Error("user not found");
        Object.assign(row, data);
        return { ...row };
      },
    },
  };
  return { db, state };
}

describe("passwordReset.request", () => {
  it("issues a live 30-minute token for an account that exists and is enabled", async () => {
    const { db, state } = makeFakeDb();
    const res = await makePasswordReset(db as never).request("vecino@example.com", NOW);

    expect(res).toMatchObject({ userId: 7 });
    const issued = state.tokens.find((t) => t.tokenHash === hashToken(res!.token));
    expect(issued).toMatchObject({ purpose: "password_reset", userId: 7, memberId: null, usedAt: null });
    // El TTL sale de TOKEN_TTL: media hora, no los 7 días de los enlaces del panel.
    expect(issued?.expiresAt).toEqual(FUTURE);
  });

  it("normalizes the address like the login does before looking the account up", async () => {
    const { db } = makeFakeDb();
    const res = await makePasswordReset(db as never).request("  Vecino@Example.com  ", NOW);
    expect(res).toMatchObject({ userId: 7 });
  });

  // Emitir NO revoca el enlace anterior. Si lo revocara, cualquiera que
  // conociera la dirección de un socio le mataría el enlace que el socio ya
  // tiene en el buzón, indefinidamente y sin captcha. Reenviar el mismo token en
  // vez de emitir otro no es posible: de un token guardamos sólo el sha256.
  it("leaves the link already in the mailbox alive when a new one is issued", async () => {
    const { db, state } = makeFakeDb({ tokens: [token("anterior")] });
    const res = await makePasswordReset(db as never).request("vecino@example.com", NOW);

    expect(state.tokens.some((t) => t.tokenHash === hashToken("anterior"))).toBe(true);
    expect(res).not.toBeNull();
    // Los dos sirven, y los dos están en la MISMA casilla: la de la cuenta.
    expect(state.tokens.filter((t) => t.purpose === "password_reset" && t.usedAt === null)).toHaveLength(2);
  });

  it("does not extend the life of the link it did not issue", async () => {
    const older = token("anterior", { expiresAt: new Date(NOW.getTime() + 60_000) });
    const { db, state } = makeFakeDb({ tokens: [older] });
    await makePasswordReset(db as never).request("vecino@example.com", NOW);
    // Cada enlace se muere con su propia ventana: un pedido nuevo no le regala
    // media hora más al que ya estaba dando vueltas.
    expect(state.tokens.find((t) => t.tokenHash === hashToken("anterior"))?.expiresAt).toEqual(
      new Date(NOW.getTime() + 60_000),
    );
  });

  it("returns null and issues nothing when no account has that address", async () => {
    const { db, state } = makeFakeDb();
    const res = await makePasswordReset(db as never).request("nadie@example.com", NOW);
    expect(res).toBeNull();
    expect(state.tokens).toHaveLength(0);
  });

  it("returns null and issues nothing for a disabled account", async () => {
    const { db, state } = makeFakeDb({
      users: [{ id: 7, email: "vecino@example.com", passwordHash: "viejo", active: false }],
    });
    const res = await makePasswordReset(db as never).request("vecino@example.com", NOW);
    // Misma respuesta que la cuenta inexistente: quien llama no puede distinguir
    // los casos ni siquiera para decidir qué contestar.
    expect(res).toBeNull();
    expect(state.tokens).toHaveLength(0);
  });

});

describe("passwordReset.reset", () => {
  it("burns the token and writes the new hash", async () => {
    const { db, state } = makeFakeDb({ tokens: [token("raw")] });
    const res = await makePasswordReset(db as never).reset("raw", "hash-nuevo", NOW);

    expect(res).toMatchObject({ ok: true, userId: 7 });
    expect(state.users[0]?.passwordHash).toBe("hash-nuevo");
    expect(state.tokens.find((t) => t.tokenHash === hashToken("raw"))?.usedAt).toEqual(NOW);
  });

  it("never re-enables a disabled account through the reset", async () => {
    const { db, state } = makeFakeDb({
      users: [{ id: 7, email: "vecino@example.com", passwordHash: "viejo", active: false }],
      tokens: [token("raw")],
    });
    const res = await makePasswordReset(db as never).reset("raw", "hash-nuevo", NOW);

    expect(res).toMatchObject({ ok: false, error: RESET_ERRORS.disabled, reason: "disabled" });
    expect(state.users[0]?.passwordHash).toBe("viejo");
    expect(state.users[0]?.active).toBe(false);
    // Rechazo por ESTADO: commitea, el enlace queda quemado (no vuelve a servir).
    expect(state.tokens.find((t) => t.tokenHash === hashToken("raw"))?.usedAt).toEqual(NOW);
  });

  // Acá se recupera la invariante que la emisión ya no sostiene: el socio que
  // apretó "no me llegó" varias veces tiene varios enlaces vivos, y el primero
  // que usa cierra la puerta de los demás.
  it("kills the other live links of the account when the password changes", async () => {
    const { db, state } = makeFakeDb({ tokens: [token("raw"), token("paralelo")] });
    const res = await makePasswordReset(db as never).reset("raw", "hash-nuevo", NOW);

    expect(res).toMatchObject({ ok: true });
    expect(state.tokens.some((t) => t.tokenHash === hashToken("paralelo"))).toBe(false);
  });

  it("keeps the consumed tokens as a trail when it revokes", async () => {
    const { db, state } = makeFakeDb({ tokens: [token("raw"), token("usado", { usedAt: NOW })] });
    await makePasswordReset(db as never).reset("raw", "hash-nuevo", NOW);
    expect(state.tokens.some((t) => t.tokenHash === hashToken("usado"))).toBe(true);
  });

  it("does not touch a live link of ANOTHER account", async () => {
    const { db, state } = makeFakeDb({
      users: [
        { id: 7, email: "vecino@example.com", passwordHash: "viejo", active: true },
        { id: 8, email: "otro@example.com", passwordHash: "otro", active: true },
      ],
      tokens: [token("raw"), token("ajeno", { userId: 8 })],
    });
    await makePasswordReset(db as never).reset("raw", "hash-nuevo", NOW);
    expect(state.tokens.some((t) => t.tokenHash === hashToken("ajeno"))).toBe(true);
  });

  it("gives the SAME message to a token that does not exist, one expired and one already used", async () => {
    const cases = [
      { name: "inexistente", tokens: [] as FakeToken[] },
      { name: "vencido", tokens: [token("raw", { expiresAt: new Date(NOW.getTime() - 1) })] },
      { name: "usado", tokens: [token("raw", { usedAt: new Date(NOW.getTime() - 60_000) })] },
      { name: "de otro propósito", tokens: [token("raw", { purpose: "password_invitation", userId: null, memberId: 1 })] },
    ];
    for (const c of cases) {
      const { db, state } = makeFakeDb({ tokens: c.tokens });
      const res = await makePasswordReset(db as never).reset("raw", "hash-nuevo", NOW);
      expect(res, c.name).toMatchObject({ ok: false, error: RESET_ERRORS.dead, reason: "dead" });
      expect(state.users[0]?.passwordHash, c.name).toBe("viejo");
    }
  });

  it("lets exactly one of two simultaneous submissions through", async () => {
    const { db, state } = makeFakeDb({ tokens: [token("raw")] });
    const reset = makePasswordReset(db as never);
    const [a, b] = await Promise.all([
      reset.reset("raw", "hash-a", NOW),
      reset.reset("raw", "hash-b", NOW),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(["hash-a", "hash-b"]).toContain(state.users[0]?.passwordHash);
  });
});
