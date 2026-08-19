import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    // `authAt`: segundos epoch del momento en que se abrió la sesión (lo fija el
    // callback `jwt` al entrar). `null` en las sesiones emitidas antes de que el
    // claim existiera. Ver `@/lib/auth/session-freshness`.
    user: { id: string; roles: string[]; authAt: number | null } & DefaultSession["user"]
  }
  interface User {
    roles?: string[]
  }
}

// El JWT hay que aumentarlo en "@auth/core/jwt": "next-auth/jwt" sólo hace
// `export *` y una augmentation sobre ese path no se fusiona con la interfaz real.
declare module "@auth/core/jwt" {
  interface JWT {
    id?: string
    roles?: string[]
    authAt?: number
  }
}
