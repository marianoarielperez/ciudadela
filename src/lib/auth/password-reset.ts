// Recupero de contraseña: emisión y canje del enlace de un solo uso.
//
// Vive acá y NO en `@/lib/members/access` —donde está el canje de los enlaces
// del circuito de alta— porque lo que se toca es otra cosa: `access` decide
// sobre la FICHA del socio (`Member.status`, `Member.email`, el vínculo con la
// cuenta) y el recupero decide sobre la CUENTA (`User.active`, `passwordHash`),
// que también existe para los administradores, que no tienen ficha. Meterlo en
// `members/` lo ataría a un padrón que en este flujo no se consulta nunca.
//
// Lo que sí se copia de allá es la forma: una transacción por operación, el
// `consume` adentro (el `UPDATE ... WHERE used_at IS NULL` toma el lock de la
// fila del token y todo lo demás ocurre bajo ese lock) y la validación en vivo
// del estado de la cuenta, porque entre el envío y el clic pueden pasar cosas.
//
// Regla de oro del circuito: **nunca se consume un token en un GET**. La página
// de /ingresar/restablecer renderiza con `peek`; el `consume` sólo ocurre acá,
// invocado desde la server action del formulario.
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { makeTokens } from "@/lib/tokens";

/** Mensajes de cara a la persona (es-AR). Exportados para que los tests los
 *  fijen y las páginas los reusen sin duplicar texto. */
export const RESET_ERRORS = {
  // UN SOLO mensaje para el enlace inexistente, el vencido y el ya usado: la
  // diferencia sólo le sirve a quien está probando enlaces ajenos. Es política
  // del proyecto (misma decisión que `ACCESS_ERRORS.dead`).
  dead: "El enlace venció o ya fue usado. Pedí uno nuevo desde la pantalla de ingreso.",
  // Este sí se distingue, y se lo mostramos únicamente a quien YA demostró tener
  // la casilla (llegó con un enlace válido): decirle "venció" sería mentirle y
  // lo dejaría pidiendo enlaces nuevos para siempre.
  disabled: "Tu cuenta de acceso está deshabilitada. Comunicate con la vecinal.",
} as const;

export type ResetResult =
  | { ok: true; userId: number }
  | { ok: false; error: string; reason: "dead" | "disabled" };

type ResetDb = Pick<PrismaClient, "$transaction" | "actionToken" | "user">;

export function makePasswordReset(db: ResetDb) {
  return {
    /** Emite el enlace si —y sólo si— hay una cuenta HABILITADA con esa
     *  dirección. Devuelve `null` en cualquier otro caso, sin distinguirlos:
     *  quien llama no puede contestar distinto porque no sabe nada distinto.
     *
     *  La cuenta deshabilitada (`active: false`, lo que deja la baja del socio)
     *  no recibe enlace: el login rechaza esas cuentas (`verifyCredentials`), o
     *  sea que la contraseña nueva no serviría para entrar, y mandar el correo
     *  igual sería avisarle a quien pidió el recupero que la dirección está
     *  registrada. El camino de vuelta de un socio reingresado es la invitación
     *  del panel, que reactiva la cuenta (`memberAccess.createPassword`). */
    async request(email: string, now = new Date()): Promise<{ userId: number; token: string } | null> {
      // El login busca la cuenta en minúsculas: normalizamos igual acá, si no
      // "Vecino@…" no encontraría nada y el recupero fallaría en silencio.
      const normalized = email.toLowerCase().trim();
      return db.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { email: normalized },
          select: { id: true, active: true },
        });
        if (!user?.active) return null;

        const tokens = makeTokens(tx);
        // Emitir NO revoca los enlaces vivos anteriores de la cuenta, y es
        // deliberado: este formulario es público y anónimo, o sea el lado de la
        // regla del proyecto (ver el encabezado de `tokens.ts`) donde revocar al
        // emitir es un arma. Cualquiera que conociera la dirección de un socio
        // —sin cuenta, sin captcha— apretaba "olvidé mi contraseña" y le mataba
        // el enlace que el socio ya tenía en el buzón; el socio pedía otro y se
        // lo volvían a matar.
        //
        // La salida obvia —reenviar el enlace vivo en vez de emitir uno nuevo—
        // acá NO es implementable: de un token guardamos SÓLO el sha256 (ver
        // `tokens.ts`), el texto crudo viaja una vez, dentro del correo, y no se
        // puede reconstruir desde la base. Guardarlo en claro para poder
        // reenviarlo cambiaría un problema de disponibilidad por una toma de
        // cuenta masiva ante cualquier lectura de la tabla o cualquier backup.
        //
        // Hay una tercera salida que tampoco exige releer el token y que sí
        // sostiene las dos propiedades a la vez: NO emitir mientras haya un
        // `password_reset` vivo y sin usar de esta cuenta (el enlace que el
        // tercero provocó igual llegó al buzón del socio, así que ya lo tiene).
        // No se eligió por su propia contra: el socio que borró ese correo
        // creyéndolo spam se queda sin pedir hasta media hora. O sea que la
        // convivencia de varios enlaces es una decisión de producto entre dos
        // opciones viables, no la única posible.
        //
        // Que convivan varios enlaces vivos es aceptable y está acotado: todos
        // van SIEMPRE a la misma casilla (la de la cuenta, no la que se tipeó en
        // el formulario), viven media hora, y cuántos puede haber a la vez lo
        // fija el techo por dirección (`PASSWORD_RESET_EMAIL_LIMIT`). Quien no
        // tiene el buzón no ve ninguno. Y el canje exitoso revoca todos los que
        // sigan vivos (ver `reset`), así que después de un restablecimiento no
        // queda ninguno.
        const token = await tokens.issue({ purpose: "password_reset", userId: user.id, now });
        return { userId: user.id, token };
      });
    },

    /** Canjea el enlace y escribe el hash ya calculado. El bcrypt se hace
     *  AFUERA a propósito: son ~300 ms y no pueden transcurrir con la
     *  transacción abierta y la fila del token bloqueada. */
    async reset(rawToken: string, passwordHash: string, now = new Date()): Promise<ResetResult> {
      return db.$transaction(async (tx) => {
        const tokens = makeTokens(tx);
        const t = await tokens.consume(rawToken, "password_reset", now);
        if (!t?.userId) return { ok: false as const, error: RESET_ERRORS.dead, reason: "dead" as const };

        const user = await tx.user.findUnique({
          where: { id: t.userId },
          select: { id: true, active: true },
        });
        if (!user) return { ok: false as const, error: RESET_ERRORS.dead, reason: "dead" as const };
        // Revalidación en vivo: la baja pudo asentarse dentro de la media hora
        // que dura el enlace. El rechazo commitea —el enlace queda quemado, como
        // el rechazo por estado de `memberAccess`— y NO reactiva la cuenta: el
        // reingreso es un acto del padrón, no algo que se resuelva desde acá.
        if (!user.active) {
          return { ok: false as const, error: RESET_ERRORS.disabled, reason: "disabled" as const };
        }

        // `passwordChangedAt` NO es un dato informativo: es lo que cierra las
        // sesiones que se emitieron antes de este cambio. Sin este sello, a un
        // socio al que le robaron la contraseña no le alcanzaba con cambiarla —el
        // intruso seguía adentro con su JWT hasta ocho horas más—. Ver
        // `@/lib/auth/session-freshness`. Va en el mismo `update` que el hash: si
        // uno se escribe, el otro también.
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash, passwordChangedAt: now },
        });
        // Cambiar la contraseña invalida todo enlace de recupero que siguiera
        // vivo para esta cuenta, y ACÁ es donde se recupera la invariante: como
        // emitir ya no revoca (ver `request`), un socio que apretó "no me llegó"
        // tres veces tiene tres enlaces vivos en su buzón, y el primero que se
        // usa cierra la puerta de los otros dos. Las sesiones abiertas se
        // cierran por el otro lado: Auth.js las lleva en un JWT firmado sin
        // estado en la base, así que no hay ninguna fila que borrar, y lo que
        // las invalida es el sello `passwordChangedAt` de arriba, que
        // `require-admin` y `require-member` comparan contra el momento en que
        // se emitió cada sesión (`@/lib/auth/session-freshness`).
        await tokens.revokeForUser(user.id, ["password_reset"]);
        return { ok: true as const, userId: user.id };
      });
    },
  };
}

export const passwordReset = makePasswordReset(prisma);
