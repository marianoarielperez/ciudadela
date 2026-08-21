"use client"

import Link from "next/link"
import { useActionState } from "react"

import { loginAction, type LoginState } from "./actions"
import { TurnstileWidget } from "@/components/public/turnstile-widget"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function LoginForm({ siteKey }: { siteKey: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {})
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {/* Adentro del <form>: el widget inyecta ahí su input oculto
          `cf-turnstile-response`, que es lo que lee la action. El `resetKey` es
          el estado de la action —un objeto nuevo por respuesta— porque el token
          es de UN SOLO USO: sin esto, después de errar la contraseña una vez,
          el segundo intento fallaría por el captcha y no por la clave. */}
      <TurnstileWidget
        siteKey={siteKey}
        resetKey={state}
        unavailable="No podés ingresar ahora por un problema de configuración del sitio. Probá más tarde o escribinos."
      />
      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Ingresando…" : "Ingresar"}
      </Button>
      {/* La salida del socio que olvidó la contraseña: es la que el panel le
          promete al admin cuando se niega a reinvitar a una ficha que ya tiene
          cuenta ("tiene que pedir el restablecimiento desde la pantalla de
          ingreso", ver verificationTarget en @/lib/members/card-edit). */}
      <p className="text-center text-sm">
        <Link href="/ingresar/recuperar" className="text-primary hover:underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </p>
    </form>
  )
}
