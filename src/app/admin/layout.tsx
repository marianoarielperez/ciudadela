import { redirect } from "next/navigation"

import { signOut } from "@/auth"
import { requireAdmin } from "@/lib/auth/require-admin"

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
        <span className="font-bold">SIGeV — Panel de administración</span>
        <form
          action={async () => {
            "use server"
            await signOut({ redirectTo: "/" })
          }}
        >
          <button className="text-sm underline">Cerrar sesión</button>
        </form>
      </header>
      <main className="p-4">{children}</main>
    </div>
  )
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Los roles del token NO alcanzan: la sesión es un JWT de 8 horas sin estado en
  // la base, así que el "admin" que se emitió al entrar sobrevive a la revocación
  // del rol y al cambio de contraseña que vienen después. `requireAdmin` resuelve
  // contra la fila viva de `User` (rol, `active` y `passwordChangedAt`) — la
  // misma guarda que ya usa cada server action del panel.
  const actor = await requireAdmin()
  if (actor.ok) return <Shell>{children}</Shell>

  // Sin sesión: al login. Con sesión pero sin habilitación NO se puede redirigir
  // ahí, y es el mismo rebote que documenta /mi: /ingresar manda a /redirigir
  // cuando hay sesión, /redirigir manda a /admin por el rol del TOKEN —que sigue
  // diciendo admin, justamente— y el ciclo no termina nunca. Se explica el motivo
  // y se ofrece cerrar la sesión, que es lo que hace falta en los tres casos.
  if (actor.reason === "anonymous") redirect("/ingresar")
  return (
    <Shell>
      <div className="space-y-3 rounded border bg-background p-4">
        <h1 className="text-xl font-bold">El panel no está disponible</h1>
        <p className="text-sm" role="alert">
          {actor.error}
        </p>
      </div>
    </Shell>
  )
}
