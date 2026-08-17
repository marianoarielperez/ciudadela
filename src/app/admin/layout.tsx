import { redirect } from "next/navigation"

import { auth, signOut } from "@/auth"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const roles = session?.user.roles ?? []
  if (!roles.includes("admin") && !roles.includes("superadmin")) redirect("/ingresar")
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
