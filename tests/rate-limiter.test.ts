import { describe, it, expect } from "vitest"
import { createRateLimiter } from "@/lib/auth/rate-limiter"

function clockAt(start: number) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe("createRateLimiter", () => {
  it("allows up to limit attempts within the window", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 5, windowMs: 900_000, now: clock.now })
    for (let i = 0; i < 5; i++) expect(rl.check("a@b.c|1.2.3.4")).toBe(true)
    expect(rl.check("a@b.c|1.2.3.4")).toBe(false)
  })
  it("frees attempts after the window slides", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: clock.now })
    rl.check("k"); rl.check("k")
    expect(rl.check("k")).toBe(false)
    clock.advance(1001)
    expect(rl.check("k")).toBe(true)
  })
  it("tracks keys independently", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now })
    expect(rl.check("uno")).toBe(true)
    expect(rl.check("dos")).toBe(true)
    expect(rl.check("uno")).toBe(false)
  })
  it("reset clears a key", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now })
    rl.check("k")
    rl.reset("k")
    expect(rl.check("k")).toBe(true)
  })
  // Un atacante que sigue golpeando no debe extender su propio bloqueo:
  // solo los intentos permitidos cuentan para la ventana.
  it("does not extend the window on blocked attempts", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now })
    expect(rl.check("k")).toBe(true)
    clock.advance(900)
    expect(rl.check("k")).toBe(false)
    clock.advance(200)
    expect(rl.check("k")).toBe(true)
  })
})
