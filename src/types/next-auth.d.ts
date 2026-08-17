import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: { id: string; roles: string[] } & DefaultSession["user"]
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
  }
}
