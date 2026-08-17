import NextAuth from "next-auth"

import { authConfig } from "@/auth.config"

// Next 16 renombró la convención `middleware.ts` a `proxy.ts` (la vieja avisa
// deprecación en el build). El comportamiento es el mismo: el callback
// `authorized` de authConfig decide el acceso a /admin y /mi.
export default NextAuth(authConfig).auth

export const config = { matcher: ["/admin/:path*", "/mi/:path*"] }
