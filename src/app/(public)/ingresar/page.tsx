import { redirect } from "next/navigation"

import { LoginForm } from "./login-form"
import { auth } from "@/auth"

export const metadata = { title: "Ingresar — Vecinal Ciudadela" }

export default async function IngresarPage(props: {
  searchParams: Promise<{ cuenta?: string }>
}) {
  const session = await auth()
  if (session) redirect("/redirigir")
  // El alta de contraseña (/acceso) termina acá: sin este aviso, la pantalla de
  // login pelada no le dice a nadie que la cuenta quedó creada.
  const { cuenta } = await props.searchParams
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center p-4">
      <h1 className="mb-6 text-2xl font-bold">Ingresá a tu cuenta</h1>
      {cuenta === "lista" && (
        <p className="mb-4 rounded border border-primary/40 bg-primary/10 p-3 text-sm" role="status">
          Tu contraseña quedó creada. Ingresá con tu email y la contraseña que elegiste.
        </p>
      )}
      {/* Y el recupero (/ingresar/restablecer) termina acá por el mismo motivo:
          sin el aviso, la pantalla de login pelada no confirma que el cambio se
          guardó y el socio no sabe con cuál de las dos contraseñas entrar. */}
      {cuenta === "restablecida" && (
        <p className="mb-4 rounded border border-primary/40 bg-primary/10 p-3 text-sm" role="status">
          Tu contraseña quedó actualizada. Ingresá con la nueva.
        </p>
      )}
      <LoginForm siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} />
    </main>
  )
}
