import bcrypt from "bcryptjs"
import { z } from "zod"

import type { PrismaClient } from "@/generated/prisma/client"

export type AuthUser = { id: string; email: string; name: string | null; roles: string[] }

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

type Db = Pick<PrismaClient, "user">

export function makeVerifyCredentials(db: Db) {
  return async function verifyCredentials(email: unknown, password: unknown): Promise<AuthUser | null> {
    const parsed = credentialsSchema.safeParse({ email, password })
    if (!parsed.success) return null

    const user = await db.user.findUnique({
      where: { email: parsed.data.email.toLowerCase().trim() },
      include: { roles: { include: { role: true } } },
    })
    if (!user || !user.active) return null

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
