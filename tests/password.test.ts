import { describe, it, expect } from "vitest"
import { validatePassword } from "@/lib/auth/password"

describe("validatePassword", () => {
  it("rejects passwords shorter than 8 chars", () => {
    expect(validatePassword("corta12").ok).toBe(false)
  })
  it("accepts 8+ chars", () => {
    expect(validatePassword("unaClave8").ok).toBe(true)
  })
})
