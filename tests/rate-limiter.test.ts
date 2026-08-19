import { describe, it, expect } from "vitest"
import {
  createRateLimiter,
  DEFAULT_LIMIT,
  DEFAULT_MAX_KEYS,
  DEFAULT_WINDOW_MS,
  ipLimiter,
  PASSWORD_RESET_EMAIL_LIMIT,
  PASSWORD_RESET_IP_LIMIT,
  PASSWORD_RESET_WINDOW_MS,
  passwordResetEmailLimiter,
  passwordResetIpLimiter,
  PUBLIC_TOKEN_LIMIT,
  PUBLIC_TOKEN_WINDOW_MS,
  publicTokenLimiter,
  VERIFICATION_ACTOR_LIMIT,
  VERIFICATION_MEMBER_LIMIT,
  VERIFICATION_WINDOW_MS,
  verificationActorLimiter,
  verificationMemberLimiter,
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

// `allows` + `record` existen para consultar dos limitadores y recién registrar
// cuando los dos dieron cupo; `refund` devuelve la reserva cuando la operación no
// llegó a ocurrir. Sin ellos, el orden de evaluación le cobra el intento a la
// primera clave aunque la segunda rechace.
describe("allows / record / refund", () => {
  it("allows does not consume budget", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now })
    expect(rl.allows("k")).toBe(true)
    expect(rl.allows("k")).toBe(true) // consultar diez veces no gasta nada
    expect(rl.check("k")).toBe(true)
    expect(rl.allows("k")).toBe(false)
  })

  it("allows does not create an entry for an unseen key", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now })
    rl.allows("nunca-vista")
    expect(rl.size()).toBe(0) // si no, consultar claves rotadas es el mismo DoS que la poda evita
  })

  it("record consumes budget and refund gives it back", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: clock.now })
    rl.record("k")
    rl.record("k")
    expect(rl.allows("k")).toBe(false)
    rl.refund("k")
    expect(rl.allows("k")).toBe(true)
    rl.refund("k")
    rl.refund("k") // de más: no puede regalar cupo por encima del techo
    expect(rl.size()).toBe(0)
    for (let i = 0; i < 2; i++) expect(rl.check("k")).toBe(true)
    expect(rl.check("k")).toBe(false)
  })

  it("frees the window from the recorded attempt, not from the refund", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now })
    rl.record("k")
    clock.advance(500)
    rl.record("k")
    rl.refund("k") // el segundo intento no ocurrió: queda el sello del primero
    clock.advance(501) // 1001 desde el primero
    expect(rl.allows("k")).toBe(true)
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

// Cada envío de verificación acredita una Notification con carácter fehaciente y
// deja un enlace vivo: el "apretá de nuevo que no me llegó" no puede escribir 20
// asientos del mismo hecho.
describe("verification limiters", () => {
  // Los singletons corren con el reloj real: adentro de un test no se puede
  // adelantar una hora. Así que se pinea la configuración del singleton —no sólo
  // la constante: `verificationMemberLimiter.limit` es lo que el limitador
  // aplica— y el comportamiento se ejercita con uno equivalente y reloj propio.
  it("pins the budget and the window of the exported singletons", () => {
    expect(VERIFICATION_MEMBER_LIMIT).toBe(3)
    expect(VERIFICATION_ACTOR_LIMIT).toBe(20)
    expect(VERIFICATION_WINDOW_MS).toBe(60 * 60_000)
    expect(verificationMemberLimiter.limit).toBe(3)
    expect(verificationMemberLimiter.windowMs).toBe(60 * 60_000)
    expect(verificationActorLimiter.limit).toBe(20)
    expect(verificationActorLimiter.windowMs).toBe(60 * 60_000)
  })

  // El canje de /verificar y /acceso es anónimo: la única clave es la IP, y
  // detrás de un CGNAT móvil hay muchos vecinos. Un socio gasta 2 POST en todo
  // el circuito, así que el techo tiene que dejar entrar a una docena larga.
  it("pins the budget and the window of the public token limiter", () => {
    expect(PUBLIC_TOKEN_LIMIT).toBe(30)
    expect(PUBLIC_TOKEN_WINDOW_MS).toBe(60 * 60_000)
    expect(publicTokenLimiter.limit).toBe(30)
    expect(publicTokenLimiter.windowMs).toBe(60 * 60_000)
  })

  // El techo por dirección es lo único que le puede gastar los pedidos a un
  // socio que no pidió nada (Turnstile sigue diferido al M3), y además fija
  // cuántos enlaces de recupero pueden convivir vivos para una misma cuenta,
  // porque emitir ya no revoca el anterior.
  it("pins the budget and the window of the password reset limiters", () => {
    expect(PASSWORD_RESET_IP_LIMIT).toBe(10)
    expect(PASSWORD_RESET_EMAIL_LIMIT).toBe(5)
    expect(PASSWORD_RESET_WINDOW_MS).toBe(60 * 60_000)
    expect(passwordResetIpLimiter.limit).toBe(10)
    expect(passwordResetIpLimiter.windowMs).toBe(60 * 60_000)
    expect(passwordResetEmailLimiter.limit).toBe(5)
    expect(passwordResetEmailLimiter.windowMs).toBe(60 * 60_000)
  })

  it("blocks the 31st redemption from the same origin", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({
      limit: publicTokenLimiter.limit,
      windowMs: publicTokenLimiter.windowMs,
      now: clock.now,
    })
    for (let i = 0; i < 30; i++) expect(rl.check("186.0.0.1")).toBe(true)
    expect(rl.check("186.0.0.1")).toBe(false)
    // Otro origen conserva su presupuesto entero.
    expect(rl.check("186.0.0.2")).toBe(true)
    clock.advance(publicTokenLimiter.windowMs)
    expect(rl.check("186.0.0.1")).toBe(true)
  })

  it("stops the 4th send to the same member until the whole window has passed", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({
      limit: verificationMemberLimiter.limit,
      windowMs: verificationMemberLimiter.windowMs,
      now: clock.now,
    })
    const key = "member:4242"
    for (let i = 0; i < 3; i++) expect(rl.check(key)).toBe(true)
    expect(rl.check(key)).toBe(false)
    // El tope es por socio: otro socio arranca con el cupo entero.
    expect(rl.check("member:4243")).toBe(true)
    clock.advance(verificationMemberLimiter.windowMs - 1)
    expect(rl.check(key)).toBe(false) // un milisegundo menos de la ventana NO alcanza
    clock.advance(2)
    expect(rl.check(key)).toBe(true)
  })

  it("stops the 21st send from the same admin across members", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({
      limit: verificationActorLimiter.limit,
      windowMs: verificationActorLimiter.windowMs,
      now: clock.now,
    })
    const key = "actor:99"
    for (let i = 0; i < 20; i++) expect(rl.check(key)).toBe(true)
    expect(rl.check(key)).toBe(false)
    clock.advance(verificationActorLimiter.windowMs + 1)
    expect(rl.check(key)).toBe(true)
  })

  // El escenario real del panel: 21 clicks sobre el mismo socio. Si el cupo del
  // admin se cobrara antes de mirar el del socio, el operador quedaría bloqueado
  // una hora para TODOS los socios habiendo salido 3 correos.
  it("a click blocked by the member cap does not consume the admin budget", () => {
    const clock = clockAt(0)
    const perMember = createRateLimiter({ limit: 3, windowMs: VERIFICATION_WINDOW_MS, now: clock.now })
    const perActor = createRateLimiter({ limit: 20, windowMs: VERIFICATION_WINDOW_MS, now: clock.now })
    const memberKey = "member:7"
    const actorKey = "actor:1"
    let sent = 0
    for (let i = 0; i < 21; i++) {
      // El mismo orden que `sendVerificationAction`: consultar los dos cupos y
      // registrar en los dos sólo si ninguno rechaza.
      if (!perMember.allows(memberKey)) continue
      if (!perActor.allows(actorKey)) continue
      perMember.record(memberKey)
      perActor.record(actorKey)
      sent++
    }
    expect(sent).toBe(3)
    // Y al admin le quedan 17 envíos para el resto de la jornada de carga.
    expect(perActor.allows(actorKey)).toBe(true)
    for (let i = 0; i < 17; i++) expect(perActor.check(`actor:1`)).toBe(true)
    expect(perActor.check(actorKey)).toBe(false)
  })

  // Un fallo del SMTP no acredita Notification ni deja enlace vivo: no hay nada
  // que racionar, y tres errores de configuración no pueden dejar al socio sin
  // reintentos por una hora.
  it("a failed send gives the budget back", () => {
    const clock = clockAt(0)
    const perMember = createRateLimiter({ limit: 3, windowMs: VERIFICATION_WINDOW_MS, now: clock.now })
    const key = "member:7"
    for (let i = 0; i < 5; i++) {
      expect(perMember.allows(key)).toBe(true)
      perMember.record(key)
      perMember.refund(key) // el envío falló
    }
    expect(perMember.allows(key)).toBe(true)
  })
})

// El singleton se usa como lo usa la action, con su reloj real: alcanza para
// verificar que está cableado. La clave se limpia para no ensuciar a nadie.
describe("verificationMemberLimiter singleton", () => {
  it("blocks the 4th attempt on the same key", () => {
    const key = "member:test-singleton"
    try {
      for (let i = 0; i < 3; i++) expect(verificationMemberLimiter.check(key)).toBe(true)
      expect(verificationMemberLimiter.check(key)).toBe(false)
    } finally {
      verificationMemberLimiter.reset(key)
    }
    expect(verificationMemberLimiter.check(key)).toBe(true)
    verificationMemberLimiter.reset(key)
  })
})
