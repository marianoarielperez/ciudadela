import bcrypt from "bcryptjs"
import { z } from "zod"

import type { PrismaClient } from "@/generated/prisma/client"

export type AuthUser = { id: string; email: string; name: string | null; roles: string[] }

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

type Db = Pick<PrismaClient, "user">

// Hash bcrypt cost 12 de una frase fija, precalculado y pegado como literal:
// generarlo en tiempo de import costaría ~300 ms de arranque. Solo se usa para
// gastar el mismo tiempo cuando NO hay contra qué comparar, de modo que la
// latencia no revele si un email existe o si la cuenta está desactivada.
const DUMMY_HASH = "$2b$12$XHfiAzolMFmdVT8v4PxyjuE0zE.lYU0I3W.1mn8IuVLg6LFDwN1QS"

export function makeVerifyCredentials(db: Db) {
  return async function verifyCredentials(email: unknown, password: unknown): Promise<AuthUser | null> {
    const parsed = credentialsSchema.safeParse({ email, password })
    if (!parsed.success) return null

    const user = await db.user.findUnique({
      where: { email: parsed.data.email.toLowerCase().trim() },
      include: { roles: { include: { role: true } } },
    })
    if (!user || !user.active) {
      await bcrypt.compare(parsed.data.password, DUMMY_HASH)
      return null
    }

    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash)
    if (!ok) return null

    return {
      id: String(user.id),
      email: user.email,
      name: user.name,
      roles: user.roles.map((r) => r.role.name),
    }
  }
}
