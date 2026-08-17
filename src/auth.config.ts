import type { NextAuthConfig } from "next-auth"

// Config compartida entre el server (auth.ts) y el proxy (proxy.ts).
// NO puede importar Prisma ni bcrypt: el proxy corre en cada request y se
// mantiene liviano (y edge-safe, si alguna vez se mueve a ese runtime).
export const authConfig = {
  pages: { signIn: "/ingresar" },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  trustHost: true, // detrás de Nginx/Cloudflare; X-Forwarded-* los fija el proxy
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.roles = user.roles ?? []
      }
      return token
    },
    session({ session, token }) {
      // Solo si vino en el token: un "" silencioso se propaga como id válido.
      if (token.id) session.user.id = token.id
      session.user.roles = token.roles ?? []
      return session
    },
    authorized({ auth, request }) {
      const roles = auth?.user?.roles ?? []
      const path = request.nextUrl.pathname
      if (path.startsWith("/admin")) return roles.includes("admin") || roles.includes("superadmin")
      if (path.startsWith("/mi")) return roles.includes("socio")
      return true
    },
  },
  providers: [], // se completan en auth.ts (server only)
} satisfies NextAuthConfig
