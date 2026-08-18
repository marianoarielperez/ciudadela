// Single-use action tokens (email verification, password invitation/reset).
// Only the sha256 hash is stored; the raw token travels once, inside the email link.
import { createHash, randomBytes } from "node:crypto";
import type { ActionToken, PrismaClient, TokenPurpose } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const TOKEN_TTL: Record<TokenPurpose, number> = {
  email_verification: 7 * 24 * 60 * 60 * 1000,
  password_invitation: 7 * 24 * 60 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
};

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

type TokenDb = Pick<PrismaClient, "actionToken">;

export function makeTokens(db: TokenDb) {
  async function find(raw: string, purpose: TokenPurpose, now: Date): Promise<ActionToken | null> {
    const t = await db.actionToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!t || t.purpose !== purpose || t.usedAt !== null || t.expiresAt < now) return null;
    return t;
  }
  return {
    async issue(input: { purpose: TokenPurpose; memberId?: number; userId?: number; now?: Date }): Promise<string> {
      const raw = randomBytes(32).toString("base64url");
      const now = input.now ?? new Date();
      await db.actionToken.create({
        data: {
          purpose: input.purpose,
          tokenHash: hashToken(raw),
          memberId: input.memberId ?? null,
          userId: input.userId ?? null,
          expiresAt: new Date(now.getTime() + TOKEN_TTL[input.purpose]),
        },
      });
      return raw;
    },
    // `peek` valida sin consumir: las páginas que renderizan un formulario con GET
    // tienen que usarla, porque los escáneres de links de los clientes de correo
    // abren la URL y consumirían el token antes de que la persona haga clic.
    peek(raw: string, purpose: TokenPurpose, now = new Date()): Promise<ActionToken | null> {
      return find(raw, purpose, now);
    },
    async consume(raw: string, purpose: TokenPurpose, now = new Date()): Promise<ActionToken | null> {
      const t = await find(raw, purpose, now);
      if (!t) return null;
      await db.actionToken.update({ where: { id: t.id }, data: { usedAt: now } });
      return t;
    },
  };
}

export const tokens = makeTokens(prisma);
