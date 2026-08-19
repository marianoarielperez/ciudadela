// Escritura de la ficha del socio con las invariantes de la dirección adentro:
// los tokens que el cambio invalida y la cuenta de acceso vinculada.
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

/** Mensaje para el OPERADOR del panel (es-AR). No nombra ni describe a la otra
 *  cuenta: quién es el titular de esa casilla no es asunto de esta pantalla, y
 *  el mensaje termina copiado en un mail o leído en voz alta en el mostrador. */
export const MEMBER_WRITE_ERRORS = {
  emailConflict:
    "Ese email ya está asociado a otra cuenta de acceso del sistema, así que no se puede " +
    "asignar a esta ficha. No se guardó ningún cambio: revisá que la dirección esté bien " +
    "escrita o cargale otra al socio.",
} as const;

/** La edición pedía moverle a la cuenta del socio una dirección que ya es la de
 *  OTRA cuenta. Aborta la escritura entera (la transacción hace rollback): la
 *  ficha no se guarda a medias con la cuenta apuntando a otro lado. */
export class MemberEmailConflictError extends Error {
  constructor() {
    super(MEMBER_WRITE_ERRORS.emailConflict);
    this.name = "MemberEmailConflictError";
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "P2002";
}

/** Lleva la dirección de la ficha a la CUENTA vinculada, dentro de la misma
 *  transacción que la escribió.
 *
 *  Sin esto, `User.email` queda congelado en la dirección con la que se creó la
 *  cuenta — y `User.email` es, en los hechos, la dirección que puede TOMAR la
 *  cuenta: con el recupero de contraseña andando, quien controle la casilla
 *  vieja (el email laboral que el socio dejó, la casilla familiar que después se
 *  separa, el "vecino@gmial.com" del dedazo) le restablece la contraseña al
 *  socio cuando quiera, aunque el padrón diga hace meses que su dirección es
 *  otra. Es la misma clase de ataque que ya cierra `memberTokensLostAuthorization`
 *  entrando por otra puerta: allá el vector es `ActionToken.memberId`, acá
 *  `User.email`. Y desde el panel no había forma de arreglarlo: `verificationTarget`
 *  se niega a reinvitar una ficha que ya tiene cuenta y `memberAccess.createPassword`
 *  escribe `passwordHash` y `active`, nunca `email`.
 *
 *  Devuelve true si la cuenta quedó con otra dirección (lo usa la auditoría del
 *  llamador: cambiar la dirección de acceso de un socio es un hecho propio, no
 *  un campo más de la ficha).
 *
 *  Dos casos en los que NO escribe:
 *  - **La ficha no tiene cuenta** (`userId === null`): no hay nada que mover, y
 *    que la ficha lleve una dirección que ya es de otra cuenta es un conflicto
 *    que se resuelve recién al canjear la invitación (`ACCESS_ERRORS.conflict`).
 *  - **La ficha se quedó SIN dirección**: `User.email` es la identidad con la
 *    que se ingresa y la columna es única y no nula, así que no hay ningún valor
 *    con el cual reemplazarla. La cuenta conserva la anterior; lo que sí se hace
 *    es revocarle los enlaces de recupero vivos, porque el padrón ya no declara
 *    esa casilla como del socio. Borrar el email de una ficha con cuenta creada
 *    NO es, entonces, la forma de sacarle el acceso a nadie: eso es una baja. */
async function syncAccountEmail(
  tx: Pick<PrismaClient, "actionToken" | "user">,
  before: Pick<Member, "email">,
  after: Pick<Member, "email" | "userId">,
): Promise<boolean> {
  if (sameAddress(before.email, after.email)) return false;
  const userId = after.userId;
  if (userId === null) return false;

  // Un enlace de recupero emitido hacia la casilla anterior deja de estar
  // autorizado por el mismo motivo por el que se revocan los de la ficha. Va
  // antes del posible conflicto sólo por claridad: si hay conflicto, la
  // transacción entera vuelve atrás y esta revocación tampoco ocurre.
  await makeTokens(tx).revokeForUser(userId, ["password_reset"]);

  // El login busca la cuenta en minúsculas (`verify-credentials`), igual que
  // `memberAccess.createPassword`.
  const email = after.email?.toLowerCase().trim();
  if (!email) return false;

  const account = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!account || sameAddress(account.email, email)) return false;

  // GUARDA DE COLISIÓN. `User.email` es único: sin esto, propagar abriría un
  // agujero peor que el que cierra. Un admin que le carga a la ficha de un
  // vecino la dirección de otro socio —o la de una cuenta de gestión— estaría
  // moviéndole la identidad de acceso a esa otra cuenta, o chocando contra el
  // índice único con un error crudo de Prisma en pantalla. Es el mismo criterio
  // con el que `memberAccess.createPassword` levanta `ACCESS_ERRORS.conflict`, y
  // acá alcanza con una sola regla —cualquier OTRA cuenta con esa dirección
  // bloquea— porque la ficha ya tiene la suya: no hay ningún caso en que
  // corresponda escribirle encima a una cuenta ajena.
  const other = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (other && other.id !== userId) throw new MemberEmailConflictError();

  try {
    await tx.user.update({ where: { id: userId }, data: { email } });
  } catch (e) {
    // La lectura de arriba y esta escritura no son atómicas entre sí frente a un
    // alta de cuenta concurrente: si el índice único gana la carrera, el
    // operador tiene que leer el mismo motivo y no un error de infraestructura.
    if (isUniqueViolation(e)) throw new MemberEmailConflictError();
    throw e;
  }
  return true;
}

type WriterDb = Pick<PrismaClient, "$transaction" | "member" | "actionToken" | "user">;

export function makeMemberWriter(db: WriterDb) {
  return {
    /** Guarda datos de ficha y, en la MISMA transacción, revoca los tokens que la
     *  escritura invalida y le lleva la dirección nueva a la cuenta vinculada: si
     *  cualquiera de las dos cosas falla, el email NO queda cambiado. (Al revés
     *  —el orden anterior, dos sentencias sueltas— la falla barata quedaba
     *  protegida y la cara, no: el email cambiado con los enlaces viejos vivos es
     *  exactamente la situación que la revocación viene a evitar.)
     *
     *  Lanza `MemberEmailConflictError` si la dirección nueva ya es la de otra
     *  cuenta de acceso; la transacción vuelve atrás entera.
     *
     *  Qué campos se pueden escribir es problema del llamador: la lista blanca
     *  estatutaria del modo carga es `Patch` en `@/lib/members/card-edit`. Lo que
     *  garantiza esta capa es la invariante de tokens y la de la cuenta. */
    async updateMember(memberId: number, data: Prisma.MemberUncheckedUpdateInput) {
      return db.$transaction(async (tx) => {
        const before = await tx.member.findUniqueOrThrow({ where: { id: memberId } });
        const member = await tx.member.update({ where: { id: memberId }, data });
        const revokedTokens = await revokeStaleMemberTokens(tx, memberId, before, member);
        const accountEmailUpdated = await syncAccountEmail(tx, before, member);
        return { member, revokedTokens, accountEmailUpdated };
      });
    },
  };
}

export const memberWriter = makeMemberWriter(prisma);
