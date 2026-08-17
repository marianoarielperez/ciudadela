import { describe, it, expect } from "vitest"
import { validatePassword, MIN_PASSWORD_LENGTH } from "@/lib/auth/password"
import { makeVerifyCredentials } from "@/lib/auth/verify-credentials"

describe("validatePassword", () => {
  it("rejects passwords shorter than 8 chars", () => {
    expect(validatePassword("corta12").ok).toBe(false)
  })
  it("accepts 8+ chars", () => {
    expect(validatePassword("unaClave8").ok).toBe(true)
  })
  // El borde exacto: 8 caracteres pasa, 7 no. Un `<=` mal puesto lo rompe.
  it("accepts exactly the minimum length", () => {
    const exact = "a".repeat(MIN_PASSWORD_LENGTH)
    expect(exact).toHaveLength(8)
    expect(validatePassword(exact).ok).toBe(true)
  })
})

describe("empty password at login", () => {
  // Un usuario sin hash utilizable no debe poder entrar mandando "": el schema
  // de credenciales lo corta con min(1), antes de cualquier comparación.
  it("returns null without touching the database", async () => {
    const calls: unknown[] = []
    const db = {
      user: {
        findUnique: async (args: unknown) => {
          calls.push(args)
          return null
        },
      },
    } as never
    const verify = makeVerifyCredentials(db)
    expect(await verify("socio@test.com", "")).toBeNull()
    expect(calls).toHaveLength(0)
  })
})
