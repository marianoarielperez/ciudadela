import { describe, it, expect, vi } from "vitest"
import bcrypt from "bcryptjs"
import { makeVerifyCredentials } from "@/lib/auth/verify-credentials"

const hash = bcrypt.hashSync("clave-correcta", 4) // cost bajo solo para tests

type FindUniqueArgs = { where: { email: string } }

/** Devuelve el fake y la lista de argumentos con que se llamó a findUnique. */
function fakeDb(user: object | null) {
  const calls: FindUniqueArgs[] = []
  const db = {
    user: {
      findUnique: async (args: FindUniqueArgs) => {
        calls.push(args)
        return user
      },
    },
  } as never
  return { db, calls }
}

const baseUser = {
  id: 7,
  email: "socio@test.com",
  passwordHash: hash,
  name: "Socia Prueba",
  active: true,
  roles: [{ role: { name: "socio" } }],
}

describe("verifyCredentials", () => {
  it("returns AuthUser with flattened roles on valid credentials", async () => {
    const verify = makeVerifyCredentials(fakeDb(baseUser).db)
    const result = await verify("socio@test.com", "clave-correcta")
    expect(result).toEqual({ id: "7", email: "socio@test.com", name: "Socia Prueba", roles: ["socio"] })
  })
  it("returns null on wrong password", async () => {
    const verify = makeVerifyCredentials(fakeDb(baseUser).db)
    expect(await verify("socio@test.com", "clave-incorrecta")).toBeNull()
  })
  it("returns null for unknown email", async () => {
    const verify = makeVerifyCredentials(fakeDb(null).db)
    expect(await verify("nadie@test.com", "clave-correcta")).toBeNull()
  })
  it("returns null for inactive user even with right password", async () => {
    const verify = makeVerifyCredentials(fakeDb({ ...baseUser, active: false }).db)
    expect(await verify("socio@test.com", "clave-correcta")).toBeNull()
  })
  it("returns null on malformed input", async () => {
    const verify = makeVerifyCredentials(fakeDb(baseUser).db)
    expect(await verify(undefined, undefined)).toBeNull()
    expect(await verify("no-es-email", "clave-correcta")).toBeNull()
  })

  // El email se guarda normalizado: la búsqueda tiene que normalizar igual o
  // "Socio@Test.com" no encuentra a nadie y un login válido falla.
  it("looks the user up by lowercased email", async () => {
    const { db, calls } = fakeDb(baseUser)
    const verify = makeVerifyCredentials(db)
    await verify("Socio@Test.COM", "clave-correcta")
    expect(calls).toHaveLength(1)
    expect(calls[0].where.email).toBe("socio@test.com")
  })

  // El `.trim()` de verifyCredentials es inalcanzable: z.email() rechaza los
  // espacios antes. Quien normaliza de verdad es la server action del login.
  it("rejects a padded email before touching the database", async () => {
    const { db, calls } = fakeDb(baseUser)
    const verify = makeVerifyCredentials(db)
    expect(await verify("  socio@test.com  ", "clave-correcta")).toBeNull()
    expect(calls).toHaveLength(0)
  })

  // Si solo el camino "usuario existe" gastara tiempo en bcrypt, la diferencia de
  // latencia delataría qué emails están registrados (enumeración de cuentas).
  it("compares against a dummy hash when the user does not exist", async () => {
    const spy = vi.spyOn(bcrypt, "compare")
    const verify = makeVerifyCredentials(fakeDb(null).db)
    expect(await verify("nadie@test.com", "clave-correcta")).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it("compares against a dummy hash when the user is inactive", async () => {
    const spy = vi.spyOn(bcrypt, "compare")
    const verify = makeVerifyCredentials(fakeDb({ ...baseUser, active: false }).db)
    expect(await verify("socio@test.com", "clave-correcta")).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
    // Nunca contra el hash real del usuario inactivo.
    expect(spy.mock.calls[0][1]).not.toBe(hash)
    spy.mockRestore()
  })
})
