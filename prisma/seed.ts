import bcrypt from "bcryptjs"

import type { Prisma } from "../src/generated/prisma/client"
import { BCRYPT_COST } from "../src/lib/auth/password"
import { prisma } from "../src/lib/prisma"

async function upsertUser(email: string, name: string, password: string, roleNames: string[]) {
  const roles = await prisma.role.findMany({ where: { name: { in: roleNames } } })
  const existing = await prisma.user.findUnique({ where: { email } })
  // Nunca pisar la contraseña de un usuario existente
  const user = existing
    ? existing
    : await prisma.user.create({
        data: { email, name, passwordHash: await bcrypt.hash(password, BCRYPT_COST) },
      })
  for (const role of roles) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    })
  }
  console.log(`${existing ? "ok  " : "new "} usuario ${email} [${roleNames.join(", ")}]`)
  return user
}

async function main() {
  for (const name of ["superadmin", "admin", "socio"]) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } })
  }

  const superPass = process.env.SEED_SUPERADMIN_PASSWORD
  if (!superPass) throw new Error("SEED_SUPERADMIN_PASSWORD no está definida")
  await upsertUser("marianoaperez@yahoo.com.ar", "Mariano Perez", superPass, ["superadmin", "admin"])

  if (process.env.SEED_TEST_USERS === "true") {
    const testPass = process.env.SEED_TEST_PASSWORD
    if (!testPass) throw new Error("SEED_TEST_USERS=true pero falta SEED_TEST_PASSWORD")
    await upsertUser("admin.prueba@sigev.local", "Admin de Prueba", testPass, ["admin"])
    await upsertUser("socio.prueba@sigev.local", "Socio de Prueba", testPass, ["socio"])
  }

  const defaults: Record<string, Prisma.InputJsonValue> = {
    asociate_activo: false,
    elecciones_en_curso: false,
  }
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.configuration.upsert({ where: { key }, update: {}, create: { key, value } })
  }
  console.log(`ok   configuración: ${Object.keys(defaults).join(", ")}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
