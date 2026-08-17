"use server"

import { AuthError } from "next-auth"
import { headers } from "next/headers"

import { signIn } from "@/auth"
import { audit } from "@/lib/audit"
import { loginLimiter } from "@/lib/auth/rate-limiter"

export type LoginState = { error?: string }

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
  const ip = (await headers()).get("x-real-ip") ?? "unknown"
  const limiterKey = `${email}|${ip}`

  // 5 intentos / 15 min por cuenta e IP (docs/08)
  if (!loginLimiter.check(limiterKey)) {
    return { error: "Demasiados intentos. Probá de nuevo más tarde." }
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/redirigir" })
    return {}
  } catch (err) {
    if (err instanceof AuthError) {
      await audit({ action: "login_failed", detail: { email }, ip })
      return { error: "Email o contraseña incorrectos." }
    }
    // Un login exitoso termina en redirect (NEXT_REDIRECT): liberamos el contador
    // para no bloquear a quien entra bien varias veces dentro de la ventana.
    if (isRedirectError(err)) loginLimiter.reset(limiterKey)
    throw err // NEXT_REDIRECT debe propagarse
  }
}
