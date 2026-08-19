import { describe, expect, it, vi } from "vitest";

// El singleton importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeMemberWriter, memberTokensLostAuthorization } from "@/lib/members/write";

type FakeToken = { id: number; memberId: number; purpose: string; usedAt: Date | null };

const TOKENS: FakeToken[] = [
  { id: 1, memberId: 1, purpose: "email_verification", usedAt: null },
  { id: 2, memberId: 1, purpose: "password_invitation", usedAt: null },
  { id: 3, memberId: 1, purpose: "password_reset", usedAt: null }, // atado a la cuenta, no a la ficha
  { id: 4, memberId: 1, purpose: "email_verification", usedAt: new Date("2026-01-02T00:00:00Z") }, // rastro
  { id: 5, memberId: 2, purpose: "email_verification", usedAt: null }, // de otro socio
];

function makeFakeDb(member: Record<string, unknown>, opts: { failRevoke?: boolean } = {}) {
  const state = {
    member: { id: 1, status: "active", email: "vecino@example.com", fullName: "Perez Ana", ...member },
    tokens: TOKENS.map((t) => ({ ...t })),
  };
  const db = {
    // Un passthrough no distingue atomicidad de secuencialidad: este fake
    // fotografía el estado y lo restaura si algo lanza, que es lo que hace un
    // ROLLBACK. Sin eso, el test de "si falla la revocación el email no cambia"
    // pasaría igual con las dos sentencias sueltas.
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const snapshot = { member: { ...state.member }, tokens: state.tokens.map((t) => ({ ...t })) };
      try {
        return await cb(db);
      } catch (err) {
        state.member = snapshot.member;
        state.tokens = snapshot.tokens;
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
      }: { where: { memberId?: number; purpose?: { in: string[] }; usedAt?: null } }) => {
        if (opts.failRevoke) throw new Error("revoke failed");
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
