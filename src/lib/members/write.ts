// Escritura de la ficha del socio con la invariante de tokens adentro.
//
// Un `ActionToken` vive atado al `memberId`, NO a la dirección ni al estado con
// los que se emitió. Mientras la regla "si cambia el email hay que revocar" viva
// en una server action, cada camino nuevo que escriba `Member` tiene que
// acordarse de repetirla — y el primero que se olvidó fue
// `scripts/import-padron.ts --update-existing`, que pisa `email`/`emailStatus`
// sin revocar nada. Por eso la regla vive acá, del lado del dueño del dato: se
// deriva de la fila ANTES y DESPUÉS del update, dentro de la misma transacción,
// y no de que el llamador se acuerde de avisar.
import type { Member, Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { makeTokens, MEMBER_EMAIL_TOKEN_PURPOSES } from "@/lib/tokens";

/** Lo único que la invariante necesita mirar del socio. */
export type TokenRelevantMember = Pick<Member, "email" | "status">;

// El modo carga guarda el email en minúsculas y varias fichas del padrón
// importado lo tienen con mayúsculas: normalizar la dirección no es cambiarla,
// así que no revoca (y tampoco baja la verificación, ver `buildPatch`).
function sameAddress(a: string | null, b: string | null): boolean {
  if (!a || !b) return !a && !b; // sin dirección de un lado: iguales sólo si tampoco hay del otro
  return a.toLowerCase() === b.toLowerCase();
}

/** ¿Los enlaces vivos de este socio dejaron de estar autorizados?
 *
 *  Dos causas, las dos verificadas contra la fila guardada:
 *  1. **La dirección dejó de ser la suya** (cambio o borrado): el enlace quedó en
 *     un buzón ajeno y en `/verificar` + `/acceso` alcanza para tomar la cuenta.
 *     Es el caso del dedazo ("vecino@gmial.com").
 *  2. **El socio quedó dado de baja**: la invitación que salió la semana pasada
 *     le abriría el alta de contraseña a quien tenga ese buzón —muchas veces el
 *     familiar que declaró una baja por fallecimiento— cuando ya no hay socio
 *     que representar. Se mira el estado FINAL y no la transición: la invariante
 *     es "una baja no tiene enlaces vivos", más fácil de sostener que una lista
 *     de transiciones (revocar de más es inofensivo, revocar de menos no).
 *
 *  La suspensión NO revoca: es temporal y no le saca al socio el domicilio
 *  electrónico (de hecho es cuando más falta hace notificarlo fehacientemente),
 *  y `verificationTarget` habilita expresamente el envío a un suspendido. */
export function memberTokensLostAuthorization(
  before: TokenRelevantMember,
  after: TokenRelevantMember,
): boolean {
  if (!sameAddress(before.email, after.email)) return true;
  return after.status === "withdrawn";
}

/** Aplica la invariante dentro de una transacción ya abierta. La usan los dos
 *  escritores de `Member`: este módulo y las acciones estatutarias
 *  (`memberService.withdraw`), que no pueden pasar por `updateMember` porque su
 *  transacción también asienta el acta y el movimiento. */
export async function revokeStaleMemberTokens(
  tx: Pick<PrismaClient, "actionToken">,
  memberId: number,
  before: TokenRelevantMember,
  after: TokenRelevantMember,
): Promise<number> {
  if (!memberTokensLostAuthorization(before, after)) return 0;
  return makeTokens(tx).revokeForMember(memberId, MEMBER_EMAIL_TOKEN_PURPOSES);
}

type WriterDb = Pick<PrismaClient, "$transaction" | "member" | "actionToken">;

export function makeMemberWriter(db: WriterDb) {
  return {
    /** Guarda datos de ficha y revoca los tokens que la escritura invalida, en
     *  una sola transacción: si la revocación falla, el email NO queda cambiado.
     *  (Al revés —el orden anterior, dos sentencias sueltas— la falla barata
     *  quedaba protegida y la cara, no: el email cambiado con los enlaces viejos
     *  vivos es exactamente la situación que la revocación viene a evitar.)
     *
     *  Qué campos se pueden escribir es problema del llamador: la lista blanca
     *  estatutaria del modo carga es `Patch` en `@/lib/members/card-edit`. Lo que
     *  garantiza esta capa es la invariante de tokens. */
    async updateMember(memberId: number, data: Prisma.MemberUncheckedUpdateInput) {
      return db.$transaction(async (tx) => {
        const before = await tx.member.findUniqueOrThrow({ where: { id: memberId } });
        const member = await tx.member.update({ where: { id: memberId }, data });
        const revokedTokens = await revokeStaleMemberTokens(tx, memberId, before, member);
        return { member, revokedTokens };
      });
    },
  };
}

export const memberWriter = makeMemberWriter(prisma);
