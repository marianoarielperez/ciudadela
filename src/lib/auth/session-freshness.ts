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
 *  3. Con los dos, se comparan **truncados al segundo**. El sello de la base
 *     tiene milisegundos y `authAt` no: sin truncar, una cuenta creada a las
 *     10:00:00.500 que entra a las 10:00:00.900 se echaría a sí misma. La
 *     ventana que se regala es de menos de un segundo.
 */
export function sessionPredatesPasswordChange(
  authAt: number | null | undefined,
  passwordChangedAt: Date | null | undefined,
): boolean {
  if (!passwordChangedAt) return false;
  if (typeof authAt !== "number" || !Number.isFinite(authAt) || authAt <= 0) return true;
  return Math.floor(passwordChangedAt.getTime() / 1000) > Math.floor(authAt);
}
