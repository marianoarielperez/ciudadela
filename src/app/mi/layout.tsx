import { redirect } from "next/navigation"

import { SignOutButton } from "@/components/admin/sign-out-button"
import { requireMember } from "@/lib/auth/require-member"

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-secondary/40">
      <header className="flex items-center justify-between border-b-4 border-primary bg-background px-4 py-3">
        <span className="font-bold">Mi cuenta — Vecinal Ciudadela</span>
        <SignOutButton />
      </header>
      <main className="mx-auto w-full max-w-2xl p-4">{children}</main>
    </div>
  )
}

export default async function MiLayout({ children }: { children: React.ReactNode }) {
  // El rol "socio" del token NO alcanza: la sesión es un JWT de 8 horas sin
  // revalidación, así que sobrevive a la baja y a la suspensión que se asientan
  // después de entrar. `requireMember` consulta la fila viva de `Member` en cada
  // visita (REG-20). El callback `authorized` del proxy sigue siendo el filtro
  // barato de la puerta; la autorización de verdad es esta.
  const actor = await requireMember()
  if (actor.ok) return <Shell>{children}</Shell>

  // Sin sesión: al login. Con sesión pero sin habilitación (baja, suspensión,
  // usuario sin ficha) NO se puede redirigir a /ingresar: esa página manda a
  // /redirigir cuando hay sesión, /redirigir manda a /mi por el rol del token y
  // el rebote no termina nunca. Se explica el motivo y se ofrece salir.
  if (actor.reason === "anonymous") redirect("/ingresar")
  return (
    <Shell>
      <div className="space-y-3 rounded border bg-background p-4">
        <h1 className="text-xl font-bold">Tu panel no está disponible</h1>
        <p className="text-sm" role="alert">
          {actor.error}
        </p>
      </div>
    </Shell>
  )
}
