import { redirect } from "next/navigation"

import { LoginForm } from "./login-form"
import { auth } from "@/auth"

export const metadata = { title: "Ingresar — Vecinal Ciudadela" }

export default async function IngresarPage() {
  const session = await auth()
  if (session) redirect("/redirigir")
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center p-4">
      <h1 className="mb-6 text-2xl font-bold">Ingresá a tu cuenta</h1>
      <LoginForm />
    </main>
  )
}
