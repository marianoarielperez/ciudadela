// Sesiones vivas que ya no deberían estarlo.
//
// El problema: Auth.js lleva la sesión en un JWT firmado, sin estado en la base
// y con 8 horas de vida (`auth.config.ts`). No hay tabla de sesiones que borrar,
// así que hasta acá un token emitido seguía valiendo pase lo que pase con la
// cuenta: le robaron la contraseña a un socio, la cambió, y el intruso siguió
// adentro hasta que el token venciera solo. Lo mismo con un rol de admin
// revocado, porque el rol también viaja dentro del token.
//
// La forma de cerrarlo sin agregar una tabla de sesiones es comparar dos sellos:
//
//   - `session.user.authAt` — cuándo se ABRIÓ la sesión. Lo escribe el callback
//     `jwt` de `auth.config.ts` al entrar (aritmética pura: ese archivo lo
//     comparte el proxy y no puede importar Prisma).
//   - `User.passwordChangedAt` — cuándo se escribió por última vez la contraseña
//     de la cuenta. Lo sellan los tres caminos que la escriben: el recupero
//     (`auth/password-reset`), el alta por invitación (`members/access`) y el
//     seed.
//
// Si la sesión es anterior al cambio, la sesión murió. Y el chequeo se hace en
// `require-admin` y `require-member`, que son las dos guardas por las que pasa
// toda operación autenticada y que igual consultan la fila viva de la cuenta:
// no agrega un viaje a la base que no estuviera ya hecho.
//
// ── Qué pasa con la sesión de quien acaba de cambiar la contraseña ────────────
//
// Se cierra también, sin excepción, y hoy eso no le cuesta nada a nadie: los dos
// caminos que escriben una contraseña son ANÓNIMOS (se llega por un enlace de
// correo, sin sesión) y terminan redirigiendo a /ingresar, así que quien
// restablece no tiene ninguna sesión propia que preservar. Y si la tuviera, la
// decisión correcta seguiría siendo cerrarla: el motivo por el que alguien
// cambia una contraseña es sospechar que se la robaron, y en ese escenario no
// hay forma de distinguir "la sesión del dueño" de "la del intruso" —las dos son
// tokens válidos anteriores al cambio—. Una excepción para la propia sería
// exactamente el agujero que esto viene a tapar.
//
// Cuando el Módulo 2 agregue una pantalla de "cambiar mi contraseña" con sesión
// abierta, lo que corresponde ahí NO es exceptuarla sino volver a emitirla
// (`signIn` después de escribir), que deja al dueño adentro y al intruso afuera.

/** El único texto de cara a la persona. Es el mismo para el socio y para el
 *  administrador a propósito: el hecho es el mismo y no hay nada que matizar. */
export const STALE_SESSION_MESSAGE =
  "Se cambió la contraseña de esta cuenta, así que esta sesión dejó de valer. Cerrá la sesión y volvé a ingresar con la contraseña nueva.";

// ── El techo absoluto ────────────────────────────────────────────────────────
//
// Las 8 horas de `auth.config.ts` NO son la vida de la sesión: son de
// INACTIVIDAD. Auth.js re-firma el token en cada request que pasa por el proxy
// (/admin y /mi) y en cada re-firma reescribe `exp` con `ahora + maxAge`
// (`@auth/core/jwt.js`: `.setExpirationTime(now() + maxAge)` dentro de `encode`,
// que la rama JWT de `lib/actions/session.js` llama incondicionalmente). O sea
// que una sesión que se usa no vence nunca por sí sola.
//
// Cerrada la invalidación por cambio de contraseña, el inventario completo de
// formas de terminar una sesión ajena es: cambiarle la contraseña, desactivarle
// la cuenta, revocarle el rol de admin o dar de baja al socio. Las cuatro
// requieren que alguien sospeche y actúe. Sin techo, una credencial de sesión
// robada y usada discretamente —el caso que justamente nadie detecta— dura para
// siempre.
//
// Por qué 7 días y no las 8 horas: un techo de 8 horas echaría al operador a la
// mitad de la jornada de carga de fichas, que es un cambio de producto agresivo
// y sin relación con la amenaza. 7 días garantizan que una sesión robada muera
// dentro de la semana aunque nadie note nada, y el costo de equivocarse es
// volver a entrar.
//
// Y va acá, en las guardas, y NO en el `maxAge` de `auth.config.ts`: ahí el
// token simplemente deja de decodificar y la persona aparece deslogueada sin
// motivo. En las guardas es un motivo más, con su texto propio, al lado de
// `stale_session`.

/** 7 días, en milisegundos. */
export const SESSION_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export const EXPIRED_SESSION_MESSAGE =
  "Por seguridad, las sesiones duran como máximo 7 días y esta ya los cumplió. Cerrá la sesión y volvé a ingresar.";

/**
 * ¿La sesión es anterior al último cambio de contraseña de la cuenta?
 *
 * Reglas, en orden:
 *
 *  1. Sin `passwordChangedAt` no hay nada contra qué comparar y la sesión vale.
 *     Es el estado de todas las filas anteriores a la migración que creó la
 *     columna: no podemos afirmar que a esas cuentas les cambiaron la contraseña,
 *     y desloguear a todo el mundo por no saberlo sería falso y molesto.
 *  2. Con `passwordChangedAt` pero SIN un `authAt` utilizable, se cierra. Es
 *     fallar cerrado: una sesión emitida antes de que existiera el claim no
 *     puede probar que es posterior al cambio, y el costo es un login de más
 *     para alguien que además acaba de elegir una contraseña nueva.
 *  3. Con los dos, se comparan **exacto y en milisegundos**, que es la unidad de
 *     los dos sellos (`Date.now()` en el callback `jwt`, `Date.prototype.getTime`
 *     en la columna `DATETIME(3)`).
 *
 *     Hubo una versión que truncaba al segundo para evitar que una cuenta creada
 *     a las 10:00:00.500 se echara a sí misma al entrar a las 10:00:00.900. El
 *     truncado no regalaba "menos de un segundo": los dos sellos son fijos, así
 *     que la sesión que caía dentro del mismo segundo del cambio quedaba válida
 *     PARA SIEMPRE —la comparación daba `false` en todas las visitas
 *     siguientes—. Y la tolerancia no hacía falta: `passwordChangedAt` se
 *     escribe con un `new Date()` del mismo proceso Node que después sella el
 *     login, y el login es estrictamente posterior, así que en milisegundos
 *     `authAt >= passwordChangedAt` siempre (y el `>` estricto deja pasar el
 *     empate). No hay dos relojes que puedan cruzarse.
 *
 *     Efecto de borde del cambio de unidad, y es el deseable: un `authAt` viejo
 *     en segundos (~1.7e9) queda muy por debajo de cualquier `passwordChangedAt`
 *     en milisegundos, así que esas sesiones se cierran. Falla cerrada, cuesta
 *     un login, y de todos modos el techo absoluto las alcanzaría.
 */
export function sessionPredatesPasswordChange(
  authAt: number | null | undefined,
  passwordChangedAt: Date | null | undefined,
): boolean {
  if (!passwordChangedAt) return false;
  if (!usableStamp(authAt)) return true;
  return passwordChangedAt.getTime() > authAt;
}

/**
 * ¿La sesión superó el techo absoluto, sin importar cuánto la hayan usado?
 *
 * Sin `authAt` utilizable se cierra, por el mismo motivo que la regla 2: una
 * sesión que no puede probar cuándo empezó no puede probar que esté dentro del
 * techo. El costo es un login para los tokens emitidos antes de que existiera el
 * claim, que además duran a lo sumo las 8 horas de inactividad.
 */
export function sessionExceededMaxLifetime(
  authAt: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!usableStamp(authAt)) return true;
  return now - authAt > SESSION_MAX_LIFETIME_MS;
}

/** Un sello que se pueda usar para comparar. `0`, negativos, `NaN` e `Infinity`
 *  no lo son: los dos chequeos fallan cerrado ante cualquiera de ellos. */
function usableStamp(authAt: number | null | undefined): authAt is number {
  return typeof authAt === "number" && Number.isFinite(authAt) && authAt > 0;
}
