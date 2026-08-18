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
    // Un token de un solo uso tiene que consumirse una sola vez incluso con dos POST
    // simultáneos (doble clic, reintento del cliente de correo). Leer y después
    // escribir deja una ventana en la que los dos pasan la validación y los dos
    // proceden. La marca de uso va con un UPDATE condicional: la condición
    // `usedAt: null` la evalúa la base, así que gana exactamente uno y el otro ve
    // cero filas afectadas. La firma no cambia: el segundo recibe null, igual que
    // si el token ya estuviera usado.
    async consume(raw: string, purpose: TokenPurpose, now = new Date()): Promise<ActionToken | null> {
      const t = await find(raw, purpose, now);
      if (!t) return null;
      const { count } = await db.actionToken.updateMany({
        where: { id: t.id, usedAt: null },
        data: { usedAt: now },
      });
      if (count !== 1) return null;
      return { ...t, usedAt: now };
    },
  };
}

export const tokens = makeTokens(prisma);
