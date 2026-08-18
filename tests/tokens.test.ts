import { beforeEach, describe, expect, it, vi } from "vitest";

// El singleton importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { hashToken, makeTokens, TOKEN_TTL } from "@/lib/tokens";

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
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        rows.find((r) => r.tokenHash === where.tokenHash) ?? null,
      update: async ({ where, data }: { where: { id: number }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
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
});
