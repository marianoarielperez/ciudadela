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
        // Un solo enlace vivo por cuenta, la misma regla que rige los envíos del
        // panel: si no revocamos, "no me llegó" deja varios enlaces válidos en
        // paralelo, cada uno capaz de cambiar la contraseña de esta cuenta.
        await tokens.revokeForUser(user.id, ["password_reset"]);
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

        await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
        // Cambiar la contraseña invalida todo enlace de recupero que siguiera
        // vivo para esta cuenta. Normalmente no hay ninguno (emitir ya revoca el
        // anterior), pero dos pedidos que se cruzan pueden dejar dos: el que se
        // usó cierra la puerta del otro. Lo que NO se puede invalidar desde acá
        // son las sesiones abiertas: Auth.js las lleva en un JWT firmado sin
        // estado en la base, así que sobreviven al cambio (ver informe).
        await tokens.revokeForUser(user.id, ["password_reset"]);
        return { ok: true as const, userId: user.id };
      });
    },
  };
}

export const passwordReset = makePasswordReset(prisma);
