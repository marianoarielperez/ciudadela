"use server"

import { AuthError } from "next-auth"
import { headers } from "next/headers"

import { signIn } from "@/auth"
import { audit } from "@/lib/audit"
import { ipLimiter, loginLimiter } from "@/lib/auth/rate-limiter"
import { prisma } from "@/lib/prisma"
import { verifyTurnstile } from "@/lib/turnstile"

export type LoginState = { error?: string }

const TOO_MANY = "Demasiados intentos. Probá de nuevo más tarde."
const NO_CAPTCHA = "No pudimos verificar que sos una persona. Recargá la página y probá de nuevo."

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  )
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // Normalizamos una sola vez: la misma clave para el limiter, el signIn y la auditoría.
  const email = String(formData.get("email") ?? "").toLowerCase().trim()
  const password = String(formData.get("password") ?? "")
  const h = await headers()
  // Solo X-Real-IP: Nginx resuelve la IP real del visitante con el módulo realip
  // (ver Task 15 del plan) y la sobrescribe en esta cabecera. NO leer
  // CF-Connecting-IP acá: al origen se le puede pegar directo salteando
  // Cloudflare, y esa cabecera llega tal cual la manda el cliente. Rotándola por
  // request, un atacante se regalaría un presupuesto nuevo del limiter en cada
  // intento y escribiría la IP que quisiera en audit_log.
  const ip = h.get("x-real-ip") ?? "unknown"
  const limiterKey = `${email}|${ip}`

  // El orden es `allows` → captcha → `record` → `signIn`, el mismo que
  // `createApplicationAction`. Los techos y sus claves no cambian; lo que cambia
  // con la llegada del captcha es CUÁNDO se cobra el intento.
  //
  // Se consultan los dos cupos primero (son un Map en memoria: cuestan cero, y
  // al que ya está bloqueado no le hacemos una llamada de red por intento) y se
  // registran los dos recién después del captcha:
  //
  //  - Que el registro vaya después del captcha evita que un token vencido —dura
  //    ~5 minutos, y una pestaña de login abierta se pasa de eso sola— le queme
  //    al socio uno de sus 5 intentos por una verificación que él no falló. El
  //    intento que sí interesa contar es el que llega a probar una contraseña, y
  //    ése sigue contándose.
  //  - Que los dos se registren juntos, y no cada uno al consultarse, es la misma
  //    reserva atómica del resto del sistema: con `check` a secas, el techo por
  //    IP se cobraba el intento aunque el del par email|ip fuera a rechazar.
  //
  // Esto NO afloja la fuerza bruta: sin captcha resuelto no se llega nunca a
  // `signIn`, o sea que ningún intento sin verificar toca la base ni gasta un
  // bcrypt. Y la latencia constante que protege la enumeración de cuentas —el
  // `DUMMY_HASH` de `verifyCredentials`— queda intacta del otro lado: el captcha
  // corre idéntico para la cuenta que existe y para la que no.
  //
  // 20 intentos / 15 min por IP: corta el barrido de muchas cuentas desde un
  // mismo origen, que nunca llegaría al techo de ningún par email|ip.
  if (!ipLimiter.allows(ip)) {
    await audit({ action: "login_blocked", detail: { email }, ip })
    return { error: TOO_MANY }
  }

  // 5 intentos / 15 min por cuenta e IP (docs/08)
  if (!loginLimiter.allows(limiterKey)) {
    await audit({ action: "login_blocked", detail: { email }, ip })
    return { error: TOO_MANY }
  }

  // Sin asiento de auditoría a propósito: el intento nunca llegó a la
  // verificación de credenciales, y asentar cada captcha fallido llenaría
  // `audit_log` con el ruido de los bots.
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip)
  if (!captcha) return { error: NO_CAPTCHA }

  ipLimiter.record(ip)
  loginLimiter.record(limiterKey)

  try {
    await signIn("credentials", { email, password, redirectTo: "/redirigir" })
    return {}
  } catch (err) {
    if (err instanceof AuthError) {
      await audit({ action: "login_failed", detail: { email }, ip })
      return { error: "Email o contraseña incorrectos." }
    }
    // Un login exitoso termina en redirect (NEXT_REDIRECT).
    if (isRedirectError(err)) {
      // Liberamos el contador del par para no bloquear a quien entra bien varias
      // veces en la ventana; el presupuesto por IP se mantiene a propósito.
      loginLimiter.reset(limiterKey)
      // La auditoría del login vive acá (y no en events.signIn de auth.ts) porque
      // es el único punto donde tenemos la IP del visitante. Va en try/catch: si
      // la consulta falla, el NEXT_REDIRECT nunca se relanzaría y un login válido
      // terminaría en un 500.
      try {
        const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
        if (user) {
          await audit({ userId: user.id, action: "login", entity: "user", entityId: user.id, ip })
        }
      } catch (e) {
        console.error("[login] post-login audit failed", e)
      }
    }
    throw err // NEXT_REDIRECT debe propagarse
  }
}
