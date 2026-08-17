import { redirect } from "next/navigation"

import { auth, signOut } from "@/auth"

export default async function MiLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const roles = session?.user.roles ?? []
  if (!roles.includes("socio")) redirect("/ingresar")
  return (
    <div className="min-h-screen bg-secondary/40">
      <header className="flex items-center justify-between border-b-4 border-primary bg-background px-4 py-3">
        <span className="font-bold">Mi cuenta — Vecinal Ciudadela</span>
        <form
          action={async () => {
            "use server"
            await signOut({ redirectTo: "/" })
          }}
        >
          <button className="text-sm underline">Cerrar sesión</button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-2xl p-4">{children}</main>
    </div>
  )
}
