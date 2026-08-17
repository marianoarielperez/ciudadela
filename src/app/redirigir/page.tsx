import { redirect } from "next/navigation"

import { auth } from "@/auth"

export default async function RedirigirPage() {
  const session = await auth()
  if (!session) redirect("/ingresar")
  const roles = session.user.roles
  if (roles.includes("superadmin") || roles.includes("admin")) redirect("/admin")
  if (roles.includes("socio")) redirect("/mi")
  redirect("/")
}
