import { beforeEach, describe, expect, it, vi } from "vitest";

// El singleton importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { hashToken, makeTokens, MEMBER_EMAIL_TOKEN_PURPOSES, TOKEN_TTL } from "@/lib/tokens";

type Row = {
  id: number; purpose: string; tokenHash: string; memberId: number | null;
  userId: number | null; expiresAt: Date; usedAt: Date | null;
};

function makeFakeDb() {
  const rows: Row[] = [];
  let nextId = 1;
  return {
    rows,
    actionToken: {
      create: async ({ data }: { data: Omit<Row, "id" | "usedAt"> }) => {
        // `data` ya trae memberId/userId (el tipo los exige): repetirlos como
        // default acá sería código muerto que además rompe tsc (TS2783).
        const row: Row = { id: nextId++, usedAt: null, ...data };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        // Cede el turno antes de responder: sin esto dos `consume` concurrentes se
        // serializarían solos y el test de carrera no probaría nada.
        await Promise.resolve();
        return rows.find((r) => r.tokenHash === where.tokenHash) ?? null;
      },
      deleteMany: async ({
        where,
      }: { where: { memberId?: number; purpose?: { in: string[] }; tokenHash?: string; usedAt?: null } }) => {
        const doomed = rows.filter(
          (r) =>
            (where.memberId === undefined || r.memberId === where.memberId) &&
            (where.purpose === undefined || where.purpose.in.includes(r.purpose)) &&
            (where.tokenHash === undefined || r.tokenHash === where.tokenHash) &&
            (where.usedAt === undefined || r.usedAt === where.usedAt),
        );
        for (const row of doomed) rows.splice(rows.indexOf(row), 1);
        return { count: doomed.length };
      },
      // Imita el UPDATE ... WHERE condicional: el filtro lo evalúa el "motor", no el
      // llamador, y el cuerpo corre sin ceder el turno (como una sentencia atómica).
      updateMany: async ({
        where, data,
      }: { where: { id: number; usedAt: null }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id && r.usedAt === where.usedAt);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
}

describe("tokens", () => {
  let db: ReturnType<typeof makeFakeDb>;
  let svc: ReturnType<typeof makeTokens>;
  const now = new Date("2026-08-18T12:00:00Z");

  beforeEach(() => {
    db = makeFakeDb();
    svc = makeTokens(db as never);
  });

  // Los demás tests usan TOKEN_TTL a los dos lados de la comparación, así que pasarían
  // igual si alguien cambiara los 30 minutos del recupero por 30 días. Los literales se
  // fijan acá: es la garantía de seguridad más fácil de romper con un dedazo.
  it("pins the TTL literals", () => {
    expect(TOKEN_TTL.email_verification).toBe(604_800_000); // 7 días
    expect(TOKEN_TTL.password_invitation).toBe(604_800_000); // 7 días
    expect(TOKEN_TTL.password_reset).toBe(1_800_000); // 30 minutos
  });

  // La lista fija qué se revoca cuando el email del socio deja de ser el suyo.
  // `password_reset` no entra: va atado al userId y al email de la cuenta, no a
  // la ficha, y borrarlo desde la pantalla de carga cortaría un recupero en curso.
  it("pins the purposes tied to the member's mailbox", () => {
    expect([...MEMBER_EMAIL_TOKEN_PURPOSES].sort()).toEqual(["email_verification", "password_invitation"]);
  });

  it("issues a raw token and stores only its hash", async () => {
    const raw = await svc.issue({ purpose: "email_verification", memberId: 7, now });
    expect(raw.length).toBeGreaterThan(30);
    expect(db.rows[0].tokenHash).toBe(hashToken(raw));
    expect(db.rows[0].tokenHash).not.toContain(raw);
    expect(db.rows[0].expiresAt.getTime()).toBe(now.getTime() + TOKEN_TTL.email_verification);
  });

  it("consume succeeds once and only once", async () => {
    const raw = await svc.issue({ purpose: "password_reset", userId: 3, now });
    const first = await svc.consume(raw, "password_reset", now);
    expect(first?.userId).toBe(3);
    const second = await svc.consume(raw, "password_reset", now);
    expect(second).toBeNull();
  });

  it("issues a different token every time", async () => {
    const a = await svc.issue({ purpose: "email_verification", memberId: 1, now });
    const b = await svc.issue({ purpose: "email_verification", memberId: 1, now });
    expect(a).not.toBe(b);
    expect(db.rows[0].tokenHash).not.toBe(db.rows[1].tokenHash);
  });

  // Dos POST simultáneos (doble clic, reintento del cliente de correo) pueden pasar
  // los dos la validación si consume lee y después escribe. Acá los dos `find`
  // resuelven antes de que cualquiera marque el token: solo uno tiene que ganar.
  it("consume is atomic: only one of two concurrent calls wins", async () => {
    const raw = await svc.issue({ purpose: "password_reset", userId: 9, now });
    const results = await Promise.all([
      svc.consume(raw, "password_reset", now),
      svc.consume(raw, "password_reset", now),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(db.rows[0].usedAt).toEqual(now);
  });

  it("returns null for a token that was never issued", async () => {
    expect(await svc.consume("no-existe", "password_reset", now)).toBeNull();
    expect(await svc.peek("no-existe", "password_reset", now)).toBeNull();
  });

  it("rejects wrong purpose and expired tokens", async () => {
    const raw = await svc.issue({ purpose: "password_reset", userId: 3, now });
    expect(await svc.consume(raw, "email_verification", now)).toBeNull();
    const later = new Date(now.getTime() + TOKEN_TTL.password_reset + 1);
    expect(await svc.consume(raw, "password_reset", later)).toBeNull();
  });

  it("peek validates without consuming", async () => {
    const raw = await svc.issue({ purpose: "password_invitation", memberId: 1, now });
    expect(await svc.peek(raw, "password_invitation", now)).not.toBeNull();
    expect(await svc.consume(raw, "password_invitation", now)).not.toBeNull();
    expect(await svc.peek(raw, "password_invitation", now)).toBeNull();
  });
  // Un token va atado al memberId y no a la dirección a la que se mandó: si el
  // email del socio cambia, el enlace que quedó en el buzón viejo seguiría
  // verificando —y creando la contraseña de— esa cuenta. Revocar es lo que
  // cierra ese agujero, así que hay que probar exactamente qué borra.
  describe("revokeForMember", () => {
    it("borra los tokens vivos del socio y devuelve cuántos", async () => {
      const a = await svc.issue({ purpose: "email_verification", memberId: 7, now });
      const b = await svc.issue({ purpose: "password_invitation", memberId: 7, now });
      expect(await svc.revokeForMember(7, ["email_verification", "password_invitation"])).toBe(2);
      expect(await svc.peek(a, "email_verification", now)).toBeNull();
      expect(await svc.peek(b, "password_invitation", now)).toBeNull();
      expect(db.rows).toHaveLength(0);
    });

    it("no toca los tokens de otro socio", async () => {
      const mio = await svc.issue({ purpose: "email_verification", memberId: 7, now });
      const ajeno = await svc.issue({ purpose: "email_verification", memberId: 8, now });
      expect(await svc.revokeForMember(7, ["email_verification"])).toBe(1);
      expect(await svc.peek(mio, "email_verification", now)).toBeNull();
      expect(await svc.peek(ajeno, "email_verification", now)).not.toBeNull();
    });

    it("no toca propósitos que no se le pidieron", async () => {
      const inv = await svc.issue({ purpose: "password_invitation", memberId: 7, now });
      expect(await svc.revokeForMember(7, ["email_verification"])).toBe(0);
      expect(await svc.peek(inv, "password_invitation", now)).not.toBeNull();
      expect(await svc.revokeForMember(7, [])).toBe(0);
      expect(await svc.peek(inv, "password_invitation", now)).not.toBeNull();
    });

    // Los consumidos son rastro de algo que pasó: borrarlos perdería la prueba
    // de que el socio verificó.
    it("conserva los tokens ya usados", async () => {
      const raw = await svc.issue({ purpose: "email_verification", memberId: 7, now });
      await svc.consume(raw, "email_verification", now);
      expect(await svc.revokeForMember(7, ["email_verification"])).toBe(0);
      expect(db.rows).toHaveLength(1);
      expect(db.rows[0].usedAt).toEqual(now);
    });

    it("el enlace revocado ya no se puede consumir", async () => {
      const viejo = await svc.issue({ purpose: "email_verification", memberId: 7, now });
      await svc.revokeForMember(7, ["email_verification"]);
      const nuevo = await svc.issue({ purpose: "email_verification", memberId: 7, now });
      expect(await svc.consume(viejo, "email_verification", now)).toBeNull();
      expect(await svc.consume(nuevo, "email_verification", now)).not.toBeNull();
    });
  });
});
