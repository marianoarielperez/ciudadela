// Canje de la invitación de una cuenta de GESTIÓN (/acceso/[token], rama
// admin). Calca la mecánica de members/access.ts sin tocarla: consume dentro
// de la transacción (gana exactamente un POST), bcrypt AFUERA (~300 ms, nunca
// con la transacción abierta), y el rechazo por cuenta desactivada hace
// ROLLBACK para conservar el enlace — si el superadmin la reactiva, el correo
// del buzón sigue sirviendo. No toca roles ni Member: los roles se otorgaron
// al crear la cuenta o se otorgan desde /admin/usuarios.
//
// Son dos circuitos que se parecen y se mantienen SEPARADOS a propósito: el del
// socio decide contra el estado de la ficha (baja) y puede crear la cuenta;
// éste decide contra `User.active` y la cuenta ya existe desde el alta.
//
// Solo se exporta la FACTORY: el bind con prisma vive en la ruta pública. Un
// test puro que importe este módulo no arrastra `@/lib/prisma` por su propia
// cuenta (sí lo arrastra `@/lib/tokens`, que los tests mockean).
import type { PrismaClient } from "@/generated/prisma/client";
import { makeTokens } from "@/lib/tokens";

/** Mensajes de cara a quien abre el enlace (es-AR). Exportados para que los
 *  tests los fijen y la página los reuse sin duplicar texto. */
export const ADMIN_REDEEM_ERRORS = {
  dead: "Este enlace ya no sirve. Pedile a la vecinal que te reenvíe la invitación.",
  disabled: "Tu cuenta de acceso está deshabilitada. Comunicate con la vecinal.",
} as const;

// Los textos de la variante admin de la página de canje. Constantes y sin
// nombre propio, mismo criterio que REDEEM_PAGE_COPY: la dirección la tipeó
// el superadmin y el correo pudo ir a la casilla equivocada.
export const ADMIN_REDEEM_PAGE_COPY = {
  createLead: "Elegí una contraseña para entrar al panel de administración con esta dirección:",
  createWhy:
    "Es la cuenta de gestión que la Asociación Vecinal del Barrio Ciudadela creó para esta casilla.",
  createNotYou:
    "Si no esperabas este correo, cerrá esta página y avisale a la vecinal: puede ser un error de carga.",
} as const;

/** Rechazo que además tiene que DESHACER el consumo del token.
 *
 *  La diferencia con un `return { ok: false }` —que commitea, y por eso quema el
 *  enlace— es de operación: una cuenta desactivada no es un enlace muerto, es un
 *  estado que el superadmin puede revertir. Si el canje le quemara el token, la
 *  reactivación no alcanzaría y habría que reemitir la invitación. */
class AdminAccessAbort extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "AdminAccessAbort";
  }
}

type AdminAccessDb = Pick<PrismaClient, "$transaction" | "actionToken" | "user">;

export type AdminRedeemResult =
  | { ok: true; userId: number }
  | { ok: false; error: string };

export function makeAdminAccess(db: AdminAccessDb) {
  return {
    /** Escribe la contraseña de la cuenta de gestión con el hash ya calculado.
     *  El bcrypt se hace AFUERA a propósito: son ~300 ms y no pueden transcurrir
     *  con la transacción abierta y la fila del token bloqueada. */
    async redeemInvitation(
      rawToken: string,
      passwordHash: string,
      now = new Date(),
    ): Promise<AdminRedeemResult> {
      try {
        return await db.$transaction(async (tx) => {
          const tokens = makeTokens(tx);
          // El `consume` va DENTRO de la transacción: su UPDATE condicional
          // (`usedAt IS NULL`) es lo que decide quién gana entre dos POST
          // simultáneos (doble clic, reintento del cliente de correo).
          const t = await tokens.consume(rawToken, "admin_invitation", now);
          if (!t?.userId) return { ok: false as const, error: ADMIN_REDEEM_ERRORS.dead };
          const user = await tx.user.findUnique({ where: { id: t.userId } });
          if (!user) return { ok: false as const, error: ADMIN_REDEEM_ERRORS.dead };
          // Revalidación en vivo: entre el envío y el click pudieron desactivar
          // la cuenta. Aborta (rollback) en vez de devolver, para conservar el
          // enlace del buzón.
          if (!user.active) throw new AdminAccessAbort(ADMIN_REDEEM_ERRORS.disabled);
          await tx.user.update({
            where: { id: user.id },
            // `passwordChangedAt` no es decoración: `accountState` (query.ts)
            // deriva de él que la cuenta ya creó su contraseña. Sin este sello,
            // la pantalla mostraría "Invitación vencida" sobre una cuenta recién
            // canjeada. Además cierra las sesiones anteriores al cambio
            // (`@/lib/auth/session-freshness`).
            data: { passwordHash, passwordChangedAt: now },
          });
          // Un enlace vivo por cuenta: los reenvíos paralelos mueren acá, el
          // consumido queda como rastro (usedAt).
          await tokens.revokeForUser(user.id, ["admin_invitation"]);
          return { ok: true as const, userId: user.id };
        });
      } catch (e) {
        if (e instanceof AdminAccessAbort) return { ok: false as const, error: e.reason };
        throw e;
      }
    },
  };
}

export type AdminAccess = ReturnType<typeof makeAdminAccess>;
