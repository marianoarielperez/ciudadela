import { describe, expect, it, vi } from "vitest";

// El singleton importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  makeMemberWriter,
  MEMBER_WRITE_ERRORS,
  MemberEmailConflictError,
  memberTokensLostAuthorization,
} from "@/lib/members/write";

type FakeToken = {
  id: number;
  memberId: number | null;
  userId: number | null;
  purpose: string;
  usedAt: Date | null;
};
type FakeUser = { id: number; email: string };

const TOKENS: FakeToken[] = [
  { id: 1, memberId: 1, userId: null, purpose: "email_verification", usedAt: null },
  { id: 2, memberId: 1, userId: null, purpose: "password_invitation", usedAt: null },
  // El recupero cuelga de la CUENTA (`userId`), no de la ficha: por eso la
  // revocación por ficha no lo alcanza y hay una regla propia para él.
  { id: 3, memberId: null, userId: 50, purpose: "password_reset", usedAt: null },
  { id: 4, memberId: 1, userId: null, purpose: "email_verification", usedAt: new Date("2026-01-02T00:00:00Z") }, // rastro
  { id: 5, memberId: 2, userId: null, purpose: "email_verification", usedAt: null }, // de otro socio
];

// La ficha por defecto NO tiene cuenta de acceso (`userId: null`), que es el
// caso del padrón importado: los tests de la cuenta la piden explícitamente.
const USERS: FakeUser[] = [
  { id: 50, email: "vecino@example.com" },
  { id: 51, email: "otro.socio@example.com" },
];

function makeFakeDb(
  member: Record<string, unknown>,
  // `hiddenEmail`: la lectura de la guarda NO ve esa cuenta, pero el índice
  // único sí la ve al escribir. Modela la carrera contra un alta concurrente.
  opts: { failRevoke?: boolean; hiddenEmail?: string } = {},
) {
  const state = {
    member: {
      id: 1, status: "active", email: "vecino@example.com", fullName: "Perez Ana", userId: null,
      ...member,
    },
    tokens: TOKENS.map((t) => ({ ...t })),
    users: USERS.map((u) => ({ ...u })),
  };
  const db = {
    // Un passthrough no distingue atomicidad de secuencialidad: este fake
    // fotografía el estado y lo restaura si algo lanza, que es lo que hace un
    // ROLLBACK. Sin eso, el test de "si falla la revocación el email no cambia"
    // pasaría igual con las dos sentencias sueltas.
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        member: { ...state.member },
        tokens: state.tokens.map((t) => ({ ...t })),
        users: state.users.map((u) => ({ ...u })),
      };
      try {
        return await cb(db);
      } catch (err) {
        state.member = snapshot.member;
        state.tokens = snapshot.tokens;
        state.users = snapshot.users;
        throw err;
      }
    }),
    member: {
      findUniqueOrThrow: async () => ({ ...state.member }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.member, data);
        return { ...state.member };
      },
    },
    actionToken: {
      deleteMany: async ({
        where,
      }: { where: { memberId?: number; userId?: number; purpose?: { in: string[] }; usedAt?: null } }) => {
        if (opts.failRevoke) throw new Error("revoke failed");
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
        if (where.email !== undefined && where.email === opts.hiddenEmail) return null;
        const row = state.users.find(
          (u) =>
            (where.id === undefined || u.id === where.id) &&
            (where.email === undefined || u.email === where.email),
        );
        return row ? { ...row } : null;
      },
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: { email?: string } }) => {
        const row = state.users.find((u) => u.id === where.id);
        if (!row) throw new Error("user not found");
        // El índice único de `users.email` es parte de lo que se está probando:
        // el fake lo modela para que la carrera contra un alta concurrente
        // (P2002) tenga un camino real en los tests.
        if (data.email !== undefined && state.users.some((u) => u.id !== row.id && u.email === data.email)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        Object.assign(row, data);
        return { ...row };
      }),
    },
  };
  return { db, state };
}

const active = (email: string | null) => ({ email, status: "active" as const });
const withdrawn = (email: string | null) => ({ email, status: "withdrawn" as const });

describe("memberTokensLostAuthorization", () => {
  it("says yes when the address changes, is deleted or is added", () => {
    expect(memberTokensLostAuthorization(active("a@x.com"), active("b@x.com"))).toBe(true);
    expect(memberTokensLostAuthorization(active("a@x.com"), active(null))).toBe(true);
    expect(memberTokensLostAuthorization(active(null), active("a@x.com"))).toBe(true);
  });

  // El modo carga guarda en minúsculas y el padrón importado trae mayúsculas:
  // normalizar no es cambiar de dirección, el enlace sigue yendo al mismo buzón.
  it("does not treat case normalization as a change of address", () => {
    expect(memberTokensLostAuthorization(active("Vecino@Example.com"), active("vecino@example.com"))).toBe(false);
  });

  it("says no when nothing relevant changed", () => {
    expect(memberTokensLostAuthorization(active("a@x.com"), active("a@x.com"))).toBe(false);
    expect(memberTokensLostAuthorization(active(null), active(null))).toBe(false);
  });

  // La invariante es "una baja no tiene enlaces vivos", no una lista de
  // transiciones: da lo mismo con qué estado venía la fila.
  it("says yes for a withdrawn member even with the same address", () => {
    expect(memberTokensLostAuthorization(active("a@x.com"), withdrawn("a@x.com"))).toBe(true);
    expect(memberTokensLostAuthorization(withdrawn("a@x.com"), withdrawn("a@x.com"))).toBe(true);
  });

  // La suspensión es temporal y no le saca el domicilio electrónico: el envío a
  // un suspendido está habilitado en `verificationTarget`.
  it("says no for a suspended member", () => {
    expect(memberTokensLostAuthorization(active("a@x.com"), { email: "a@x.com", status: "suspended" })).toBe(false);
  });
});

describe("memberWriter.updateMember", () => {
  it("revokes only the member's live email tokens when the address changes", async () => {
    const { db, state } = makeFakeDb({});
    const writer = makeMemberWriter(db as never);
    const { member, revokedTokens } = await writer.updateMember(1, { email: "otro@example.com" });
    expect(member.email).toBe("otro@example.com");
    expect(revokedTokens).toBe(2);
    // Sobreviven: el recupero de contraseña, el ya usado y el del otro socio.
    expect(state.tokens.map((t) => t.id).sort()).toEqual([3, 4, 5]);
  });

  it("revokes when the address is deleted", async () => {
    const { db, state } = makeFakeDb({});
    const writer = makeMemberWriter(db as never);
    const { revokedTokens } = await writer.updateMember(1, { email: null });
    expect(revokedTokens).toBe(2);
    expect(state.tokens.map((t) => t.id).sort()).toEqual([3, 4, 5]);
  });

  it("does not revoke when only unrelated fields change", async () => {
    const { db, state } = makeFakeDb({});
    const writer = makeMemberWriter(db as never);
    const { revokedTokens } = await writer.updateMember(1, { fullName: "Perez Ana Maria" });
    expect(revokedTokens).toBe(0);
    expect(state.tokens).toHaveLength(5);
  });

  it("does not revoke when the address is only normalized to lowercase", async () => {
    const { db, state } = makeFakeDb({ email: "Vecino@Example.com" });
    const writer = makeMemberWriter(db as never);
    const { revokedTokens } = await writer.updateMember(1, { email: "vecino@example.com" });
    expect(revokedTokens).toBe(0);
    expect(state.tokens).toHaveLength(5);
  });

  // El camino que quedaba abierto: `scripts/import-padron.ts --update-existing`
  // pisa email/emailStatus (y el estado) de socios ya cargados.
  it("revokes when the write leaves the member withdrawn", async () => {
    const { db, state } = makeFakeDb({});
    const writer = makeMemberWriter(db as never);
    const { revokedTokens } = await writer.updateMember(1, { status: "withdrawn" });
    expect(revokedTokens).toBe(2);
    expect(state.tokens.map((t) => t.id).sort()).toEqual([3, 4, 5]);
  });

  // Si las dos sentencias van sueltas, la falla cara (email cambiado con los
  // enlaces viejos vivos) es justo la que queda sin proteger.
  it("does not change the address when the revocation fails", async () => {
    const { db, state } = makeFakeDb({}, { failRevoke: true });
    const writer = makeMemberWriter(db as never);
    await expect(writer.updateMember(1, { email: "otro@example.com" })).rejects.toThrow(/revoke failed/);
    expect(state.member.email).toBe("vecino@example.com");
    expect(state.tokens).toHaveLength(5);
  });

  it("writes inside a single transaction", async () => {
    const { db } = makeFakeDb({});
    const writer = makeMemberWriter(db as never);
    await writer.updateMember(1, { email: "otro@example.com" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

// `User.email` es, en los hechos, la dirección que puede TOMAR la cuenta: si el
// panel le cambia el email a la ficha y la cuenta se queda con el anterior,
// quien tenga el buzón viejo le restablece la contraseña al socio para siempre.
describe("memberWriter.updateMember — dirección de la cuenta de acceso", () => {
  // La ficha del socio que ya creó su contraseña: apunta a la cuenta 50.
  const withAccount = { userId: 50 };

  it("moves the new address to the linked account, normalized", async () => {
    const { db, state } = makeFakeDb(withAccount);
    const writer = makeMemberWriter(db as never);
    const { accountEmailUpdated } = await writer.updateMember(1, { email: "Nuevo@Example.com" });

    expect(accountEmailUpdated).toBe(true);
    // Minúsculas: el login busca la cuenta normalizada (`verify-credentials`).
    expect(state.users.find((u) => u.id === 50)?.email).toBe("nuevo@example.com");
  });

  it("revokes the live reset links of the account when the address changes", async () => {
    const { db, state } = makeFakeDb(withAccount);
    const writer = makeMemberWriter(db as never);
    await writer.updateMember(1, { email: "nuevo@example.com" });

    // El enlace de recupero emitido hacia la casilla anterior deja de estar
    // autorizado por el mismo motivo por el que se revocan los de la ficha.
    expect(state.tokens.some((t) => t.id === 3)).toBe(false);
  });

  it("does not touch any account when the member has none", async () => {
    const { db, state } = makeFakeDb({}); // userId: null
    const writer = makeMemberWriter(db as never);
    const { accountEmailUpdated } = await writer.updateMember(1, { email: "nuevo@example.com" });

    expect(accountEmailUpdated).toBe(false);
    expect(state.users.map((u) => u.email)).toEqual(["vecino@example.com", "otro.socio@example.com"]);
    expect(state.tokens.some((t) => t.id === 3)).toBe(true);
  });

  it("does not touch the account when the address is only normalized to lowercase", async () => {
    const { db, state } = makeFakeDb({ ...withAccount, email: "Vecino@Example.com" });
    const writer = makeMemberWriter(db as never);
    const { accountEmailUpdated } = await writer.updateMember(1, { email: "vecino@example.com" });

    expect(accountEmailUpdated).toBe(false);
    // Y tampoco se le revoca el recupero vivo: el buzón es el mismo.
    expect(state.tokens.some((t) => t.id === 3)).toBe(true);
  });

  // `User.email` es la identidad con la que se ingresa, única y no nula: no hay
  // con qué reemplazarla. Borrar el email de la ficha NO es la forma de sacarle
  // el acceso a nadie (eso es una baja), pero sí le saca los enlaces vivos.
  it("keeps the account address when the card is left without one", async () => {
    const { db, state } = makeFakeDb(withAccount);
    const writer = makeMemberWriter(db as never);
    const { accountEmailUpdated } = await writer.updateMember(1, { email: null });

    expect(accountEmailUpdated).toBe(false);
    expect(state.users.find((u) => u.id === 50)?.email).toBe("vecino@example.com");
    expect(state.tokens.some((t) => t.id === 3)).toBe(false);
  });

  // La guarda de colisión: sin ella, propagar abriría un agujero peor que el que
  // cierra. Se aborta la edición ENTERA, no se pisa nada.
  it("aborts the whole edit when the new address already belongs to another account", async () => {
    const { db, state } = makeFakeDb(withAccount);
    const writer = makeMemberWriter(db as never);

    await expect(writer.updateMember(1, { email: "otro.socio@example.com" })).rejects.toBeInstanceOf(
      MemberEmailConflictError,
    );
    // Nada quedó escrito: ni la ficha, ni la cuenta ajena, ni la propia.
    expect(state.member.email).toBe("vecino@example.com");
    expect(state.users.find((u) => u.id === 51)?.email).toBe("otro.socio@example.com");
    expect(state.users.find((u) => u.id === 50)?.email).toBe("vecino@example.com");
    // Y los enlaces siguen todos vivos (la transacción volvió atrás).
    expect(state.tokens).toHaveLength(5);
    // La escritura ni se intenta: el motivo lo decide nuestra regla y no el
    // mapeo del error de Prisma, que es el que queda como red de la carrera.
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("gives the operator a message that does not name the other account holder", async () => {
    const { db } = makeFakeDb(withAccount);
    const writer = makeMemberWriter(db as never);
    const err = await writer
      .updateMember(1, { email: "otro.socio@example.com" })
      .then(() => null, (e: unknown) => e as Error);

    expect(err?.message).toBe(MEMBER_WRITE_ERRORS.emailConflict);
    // El mensaje se lee en el mostrador: no puede traer datos del titular de la
    // otra cuenta, ni siquiera su dirección.
    expect(err?.message).not.toContain("otro.socio@example.com");
    expect(err?.message).not.toContain("@");
  });

  // La lectura de la guarda y la escritura no son atómicas entre sí: si un alta
  // de cuenta gana la carrera, el operador tiene que leer el mismo motivo y no
  // un error crudo de Prisma.
  it("reports the same conflict when the unique index is the one that catches it", async () => {
    const { db, state } = makeFakeDb(withAccount, { hiddenEmail: "otro.socio@example.com" });
    const writer = makeMemberWriter(db as never);

    await expect(writer.updateMember(1, { email: "otro.socio@example.com" })).rejects.toBeInstanceOf(
      MemberEmailConflictError,
    );
    expect(state.member.email).toBe("vecino@example.com");
  });

  it("does not go near the account when the address did not change", async () => {
    const { db, state } = makeFakeDb(withAccount);
    const writer = makeMemberWriter(db as never);
    const { accountEmailUpdated } = await writer.updateMember(1, { fullName: "Perez Ana Maria" });

    expect(accountEmailUpdated).toBe(false);
    expect(state.tokens).toHaveLength(5);
  });
});
