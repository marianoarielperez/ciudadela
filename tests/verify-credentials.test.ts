import { describe, it, expect } from "vitest"
import bcrypt from "bcryptjs"
import { makeVerifyCredentials } from "@/lib/auth/verify-credentials"

const hash = bcrypt.hashSync("clave-correcta", 4) // cost bajo solo para tests

function fakeDb(user: object | null) {
  return { user: { findUnique: async () => user } } as never
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
    const verify = makeVerifyCredentials(fakeDb(baseUser))
    const result = await verify("socio@test.com", "clave-correcta")
    expect(result).toEqual({ id: "7", email: "socio@test.com", name: "Socia Prueba", roles: ["socio"] })
  })
  it("returns null on wrong password", async () => {
    const verify = makeVerifyCredentials(fakeDb(baseUser))
    expect(await verify("socio@test.com", "clave-incorrecta")).toBeNull()
  })
  it("returns null for unknown email", async () => {
    const verify = makeVerifyCredentials(fakeDb(null))
    expect(await verify("nadie@test.com", "clave-correcta")).toBeNull()
  })
  it("returns null for inactive user even with right password", async () => {
    const verify = makeVerifyCredentials(fakeDb({ ...baseUser, active: false }))
    expect(await verify("socio@test.com", "clave-correcta")).toBeNull()
  })
  it("returns null on malformed input", async () => {
    const verify = makeVerifyCredentials(fakeDb(baseUser))
    expect(await verify(undefined, undefined)).toBeNull()
    expect(await verify("no-es-email", "clave-correcta")).toBeNull()
  })
})
