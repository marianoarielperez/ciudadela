import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"

import { authConfig } from "@/auth.config"
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
      // La auditoría del login la hace la server action, que sí conoce la IP.
      // Acá solo el sello de última entrada, y en try/catch: un hipo de la base
      // no puede tumbar un login válido con "Email o contraseña incorrectos.".
      try {
        const userId = Number(user.id)
        await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
      } catch (err) {
        console.error("[auth] no se pudo actualizar lastLoginAt", err)
      }
    },
  },
})
