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
        // Sello del momento en que se ABRIÓ esta sesión, en MILISEGUNDOS epoch.
        // Es lo que `require-admin` y `require-member` comparan contra
        // `User.passwordChangedAt` para cerrar las sesiones que sobrevivieron a
        // un cambio de contraseña (o a una revocación de rol).
        //
        // Por qué un claim propio y NO el `iat` estándar del JWT: `iat` no es el
        // inicio de la sesión sino la última vez que la cookie se re-firmó. El
        // proxy corre sobre /admin y /mi, y ahí Auth.js vuelve a encriptar el
        // token en CADA request (`@auth/core/lib/actions/session.js` llama
        // siempre a `jwt.encode`, y `jose` reescribe `iat` con la hora actual en
        // cada `encode`) y devuelve la cookie nueva en la respuesta. O sea que
        // `iat` avanza solo y a la segunda visita ya sería posterior a cualquier
        // cambio de contraseña: la comparación quedaría desactivada en silencio.
        // Este claim, en cambio, se escribe únicamente acá —cuando hay `user`,
        // que es el login— y viaja intacto por todas las re-firmas posteriores.
        //
        // Por qué milisegundos y no la convención de segundos de JWT: los dos
        // sellos que se comparan son fijos, así que truncar al segundo no
        // regalaba "una ventana de un segundo" sino una sesión válida PARA
        // SIEMPRE —la que se abriera dentro del mismo segundo del cambio de
        // contraseña daba `false` en todas las comparaciones posteriores—. En
        // milisegundos la ventana desaparece del todo, y el auto-echado que
        // motivó el truncado no puede ocurrir: `User.passwordChangedAt` se
        // escribe con un `new Date()` del MISMO proceso Node que después sella
        // el login, y el login es estrictamente posterior. La convención de
        // segundos no rige acá porque es un claim propio del proyecto, no uno
        // estándar (`iat`, `exp` y `jti` los sigue administrando la librería).
        //
        // Es aritmética pura: no toca la base ni rompe el edge runtime, que es
        // la condición para que este archivo lo pueda seguir compartiendo el
        // proxy (`proxy.ts`).
        token.authAt = Date.now()
      }
      return token
    },
    session({ session, token }) {
      // Solo si vino en el token: un "" silencioso se propaga como id válido.
      if (token.id) session.user.id = token.id
      session.user.roles = token.roles ?? []
      // `null` —y no un 0 ni un `Date.now()`— cuando el token no lo trae: es una
      // sesión emitida antes de que existiera el claim, y quien decide qué hacer
      // con esa ignorancia son las guardas, que fallan cerradas si además la
      // cuenta tiene un cambio de contraseña asentado. Ver `session-freshness.ts`.
      session.user.authAt = typeof token.authAt === "number" ? token.authAt : null
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
