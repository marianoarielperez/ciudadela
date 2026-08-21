// Decide si el seed puede crear las cuentas de prueba
// (`admin.prueba@sigev.local` con rol admin, `socio.prueba@sigev.local`), que
// llevan una contraseña conocida y compartida.
//
// Vive en su propio módulo —y no dentro de `seed.ts`— porque `seed.ts` ejecuta
// `main()` al importarse: un test que lo importara correría el seed contra la
// base de verdad.
//
// POR QUÉ NO ALCANZA CON `NODE_ENV`
// ---------------------------------
// La guarda original se apoyaba en `NODE_ENV === "production"`, pero el seed
// corre en el VPS desde `deploy.sh`, un bash plano donde NADIE setea esa
// variable: ni el script (evita `NODE_ENV=production` a propósito, para que
// `npm ci` no pode las devDependencies que el propio seed necesita), ni el CLI
// de Prisma, ni `tsx`. O sea que la guarda no se disparaba justamente en el
// único lugar donde importaba. Una decisión de seguridad no puede depender de
// una variable que no está garantizada donde la decisión se toma.
//
// La regla ahora es un opt-in EXPLÍCITO: sin `SEED_ALLOW_TEST_USERS="true"` no
// se crean cuentas de prueba, sin importar `NODE_ENV` ni `SEED_TEST_USERS`.
// La ausencia de configuración significa NO crear. Falla cerrado.
export const TEST_USERS_OPT_IN = "SEED_ALLOW_TEST_USERS"

export type TestUsersDecision = { create: true } | { create: false; reason: string }

/**
 * Resuelve si corresponde crear las cuentas de prueba.
 *
 * - Sin `SEED_ALLOW_TEST_USERS="true"` → no se crean (caso por defecto).
 * - Con el opt-in pero `SEED_TEST_USERS="false"` → tampoco: la variable vieja
 *   se mantiene como apagado explícito (compatibilidad hacia atrás). Lo que YA
 *   NO alcanza es `SEED_TEST_USERS="true"` a secas: ése es exactamente el valor
 *   que quedó escrito en el `.env` del VPS.
 * - Con el opt-in y `NODE_ENV === "production"` → LANZA. Es cinturón y
 *   tirantes: `deploy.sh` corre el seed con `NODE_ENV=production`, así que si
 *   alguien activara el opt-in en el servidor el deploy se rompe ruidosamente
 *   en vez de dejar un admin con contraseña conocida sobre el padrón real.
 */
export function resolveTestUsers(env: NodeJS.ProcessEnv = process.env): TestUsersDecision {
  if (env[TEST_USERS_OPT_IN] !== "true") {
    return {
      create: false,
      reason: `${TEST_USERS_OPT_IN} no está en "true"`,
    }
  }
  if (env.SEED_TEST_USERS === "false") {
    return {
      create: false,
      reason: `${TEST_USERS_OPT_IN}="true" pero SEED_TEST_USERS="false" (apagado explícito)`,
    }
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      `${TEST_USERS_OPT_IN}="true" está prohibido con NODE_ENV=production: las cuentas de ` +
        "prueba tienen contraseña conocida y una de ellas es admin. Sacá la variable del .env.",
    )
  }
  return { create: true }
}
