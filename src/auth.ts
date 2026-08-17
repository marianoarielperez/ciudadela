import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"

import { authConfig } from "@/auth.config"
import { audit } from "@/lib/audit"
import { makeVerifyCredentials } from "@/lib/auth/verify-credentials"
import { prisma } from "@/lib/prisma"

const verifyCredentials = makeVerifyCredentials(prisma)

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        return verifyCredentials(credentials?.email, credentials?.password)
      },
    }),
  ],
  events: {
    async signIn({ user }) {
      const userId = Number(user.id)
      await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
      await audit({ userId, action: "login", entity: "user", entityId: userId })
    },
  },
})
