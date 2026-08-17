import { describe, it, expect } from "vitest"
import {
  createRateLimiter,
  DEFAULT_LIMIT,
  DEFAULT_MAX_KEYS,
  DEFAULT_WINDOW_MS,
  ipLimiter,
} from "@/lib/auth/rate-limiter"

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

  // Los valores por defecto SON el control de seguridad (docs/08): un typo que
  // los afloje debe romper un test, no pasar desapercibido.
  it("pins the default limit and window", () => {
    expect(DEFAULT_LIMIT).toBe(5)
    expect(DEFAULT_WINDOW_MS).toBe(15 * 60_000)
    expect(DEFAULT_MAX_KEYS).toBe(10_000)
  })

  // Sin poda, un atacante que rota claves (emails inventados) hace crecer el Map
  // sin techo: memoria del proceso PM2 como vector de DoS.
  it("evicts keys older than the window once maxKeys is exceeded", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 5, windowMs: 1000, maxKeys: 3, now: clock.now })
    for (let i = 0; i <= 3; i++) rl.check(`spray-${i}`) // maxKeys + 1 claves distintas
    expect(rl.size()).toBe(4)
    clock.advance(1001) // todas quedan fuera de la ventana
    expect(rl.check("nueva")).toBe(true)
    expect(rl.size()).toBe(1)
  })

  it("keeps in-window keys when sweeping", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 5, windowMs: 1000, maxKeys: 2, now: clock.now })
    rl.check("vieja-1")
    rl.check("vieja-2")
    clock.advance(1001)
    rl.check("fresca") // dentro de ventana desde ahora
    clock.advance(500)
    rl.check("otra") // dispara el barrido: solo caen las dos viejas
    expect(rl.size()).toBe(2)
    expect(rl.check("fresca")).toBe(true) // seguía viva, no se reinició su historial
  })
})

// Un solo origen que barre muchas cuentas nunca llega a 5 intentos por par
// email|ip: el techo por IP es el que corta el barrido.
describe("ipLimiter", () => {
  it("blocks the 21st attempt from one IP across distinct emails", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 20, windowMs: DEFAULT_WINDOW_MS, now: clock.now })
    const ip = "203.0.113.9"
    for (let i = 0; i < 20; i++) {
      expect(rl.check(ip)).toBe(true) // el email cambia en cada intento; la clave es la IP
      clock.advance(1000)
    }
    expect(rl.check(ip)).toBe(false)
  })

  it("is exported as a singleton with a 20-attempt budget", () => {
    const ip = "198.51.100.77"
    for (let i = 0; i < 20; i++) expect(ipLimiter.check(ip)).toBe(true)
    expect(ipLimiter.check(ip)).toBe(false)
  })
})
