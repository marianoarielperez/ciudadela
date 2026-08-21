import { describe, expect, it } from "vitest"

import { resolveTestUsers, TEST_USERS_OPT_IN } from "../prisma/seed-guard"

// `NodeJS.ProcessEnv` con lo justo: los tests pasan un env explícito para no
// depender del entorno del corredor (que es justamente el bug que se arregla).
function env(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv
}

describe("resolveTestUsers", () => {
  // LA propiedad del arreglo: sin el opt-in no se crean cuentas de prueba,
  // aunque NODE_ENV no esté definida — que es exactamente lo que pasa cuando
  // `deploy.sh` corre `npx prisma db seed` en el VPS desde un bash plano.
  it("no crea cuentas de prueba sin el opt-in, con NODE_ENV sin definir", () => {
    expect(resolveTestUsers(env({}))).toEqual({
      create: false,
      reason: expect.stringContaining(TEST_USERS_OPT_IN),
    })
  })

  // El escenario real del VPS: el `.env` que dejó el plan del M0 tiene
  // SEED_TEST_USERS="true" y no tiene NODE_ENV. Antes esto creaba
  // admin.prueba@sigev.local con rol admin sobre el padrón real.
  it('no crea cuentas de prueba con SEED_TEST_USERS="true" y sin NODE_ENV', () => {
    const decision = resolveTestUsers(env({ SEED_TEST_USERS: "true", SEED_TEST_PASSWORD: "x" }))
    expect(decision.create).toBe(false)
  })

  it("no crea cuentas de prueba sin el opt-in ni con NODE_ENV=development", () => {
    expect(resolveTestUsers(env({ NODE_ENV: "development" })).create).toBe(false)
  })

  it("crea cuentas de prueba con el opt-in explícito fuera de producción", () => {
    expect(resolveTestUsers(env({ [TEST_USERS_OPT_IN]: "true" }))).toEqual({ create: true })
    expect(
      resolveTestUsers(env({ [TEST_USERS_OPT_IN]: "true", NODE_ENV: "development" })).create,
    ).toBe(true)
  })

  it("acepta sólo el string exacto \"true\" como opt-in", () => {
    for (const value of ["1", "yes", "TRUE", "true ", ""]) {
      expect(resolveTestUsers(env({ [TEST_USERS_OPT_IN]: value })).create).toBe(false)
    }
  })

  // Compatibilidad hacia atrás: la variable vieja sigue sirviendo para APAGAR.
  it('SEED_TEST_USERS="false" apaga incluso con el opt-in puesto', () => {
    const decision = resolveTestUsers(
      env({ [TEST_USERS_OPT_IN]: "true", SEED_TEST_USERS: "false" }),
    )
    expect(decision).toEqual({ create: false, reason: expect.stringContaining("SEED_TEST_USERS") })
  })

  // Cinturón y tirantes: deploy.sh corre el seed con NODE_ENV=production.
  it("lanza si el opt-in aparece con NODE_ENV=production", () => {
    expect(() =>
      resolveTestUsers(env({ [TEST_USERS_OPT_IN]: "true", NODE_ENV: "production" })),
    ).toThrow(/prohibido/)
  })

  it("no lanza en producción cuando el opt-in no está", () => {
    expect(
      resolveTestUsers(env({ NODE_ENV: "production", SEED_TEST_USERS: "true" })).create,
    ).toBe(false)
  })
})
