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

/** ¿Son la misma dirección? Sin distinguir mayúsculas ni espacios al borde.
 *
 *  El modo carga guarda el email en minúsculas, varias fichas del padrón
 *  importado lo tienen con mayúsculas y una solicitud web puede traerlo con un
 *  espacio pegado del copiar y pegar: normalizar la dirección no es cambiarla,
 *  así que no revoca (y tampoco baja la verificación, ver `buildPatch`). El trim
 *  además coincide con lo que `syncAccountEmail` termina ESCRIBIENDO en la
 *  cuenta (`.toLowerCase().trim()`): comparar con un criterio y escribir con
 *  otro dejaba la puerta a una "mudanza" hacia la misma casilla.
 *
 *  Se exporta porque el asiento en acta (`@/lib/applications/record`) hace la
 *  misma pregunta para decidir si un reingreso conserva la verificación de la
 *  ficha. Dos definiciones de "misma dirección" serían dos criterios distintos
 *  sobre el mismo hecho. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = a?.trim().toLowerCase() ?? "";
  const y = b?.trim().toLowerCase() ?? "";
  if (!x || !y) return !x && !y; // sin dirección de un lado: iguales sólo si tampoco hay del otro
  return x === y;
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

/** Mensajes para el OPERADOR del panel (es-AR). Ninguno nombra ni describe a la
 *  otra cuenta: quién es el titular de esa casilla no es asunto de esta
 *  pantalla, y el mensaje termina copiado en un mail o leído en voz alta en el
 *  mostrador. */
export const MEMBER_WRITE_ERRORS = {
  emailConflict:
    "Ese email ya está asociado a otra cuenta de acceso del sistema, así que no se puede " +
    "asignar a esta ficha. No se guardó ningún cambio: revisá que la dirección esté bien " +
    "escrita o cargale otra al socio.",
  emailRequired:
    "Este socio ya tiene cuenta de acceso al portal y esa dirección es con la que ingresa, " +
    "así que no se puede dejar la ficha sin email. No se guardó ningún cambio: cargale la " +
    "dirección nueva. Si lo que querés es sacarle el acceso, eso es una baja.",
} as const;

/** Base de los dos rechazos que puede levantar `updateMember`.
 *
 *  Los dos abortan la escritura ENTERA (la transacción hace rollback) y los dos
 *  traen en `message` un texto de cara al operador. `reason` es la etiqueta
 *  estable para la auditoría y para el import, que necesitan distinguirlos sin
 *  mirar el texto. */
export abstract class MemberWriteError extends Error {
  abstract readonly reason: "email_conflict" | "email_required";
}

/** La edición pedía moverle a la cuenta del socio una dirección que ya es la de
 *  OTRA cuenta. Aborta la escritura entera: la ficha no se guarda a medias con
 *  la cuenta apuntando a otro lado. */
export class MemberEmailConflictError extends MemberWriteError {
  readonly reason = "email_conflict" as const;
  constructor() {
    super(MEMBER_WRITE_ERRORS.emailConflict);
    this.name = "MemberEmailConflictError";
  }
}

/** La edición dejaba sin email a una ficha que YA tiene cuenta de acceso.
 *  Aborta, por el mismo motivo y con el mismo mecanismo que el conflicto: ver el
 *  comentario de `syncAccountEmail`. */
export class MemberEmailRequiredError extends MemberWriteError {
  readonly reason = "email_required" as const;
  constructor() {
    super(MEMBER_WRITE_ERRORS.emailRequired);
    this.name = "MemberEmailRequiredError";
  }
}

/** La mudanza de la dirección de INGRESO de un socio: la que tenía la cuenta y
 *  la que quedó. Las dos normalizadas en minúsculas, que es como las guarda y
 *  las busca el login (`verify-credentials`). */
export type AccountEmailMove = { from: string; to: string };

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
 *  Devuelve la mudanza (`{ from, to }`) si la cuenta quedó con otra dirección, y
 *  `null` si no hubo nada que mover. Lo usa el llamador para dos cosas: la
 *  auditoría —cambiar la dirección de acceso de un socio es un hecho propio, no
 *  un campo más de la ficha— y los dos avisos por correo que hacen que la
 *  mudanza no sea silenciosa (`@/lib/members/account-email-notice`), que
 *  necesitan la dirección ANTERIOR y ya no la pueden leer de ningún lado: la
 *  transacción se la llevó puesta.
 *
 *  Un solo caso en el que NO escribe y no aborta: **la ficha no tiene cuenta**
 *  (`userId === null`). No hay nada que mover, y que la ficha lleve una
 *  dirección que ya es de otra cuenta es un conflicto que se resuelve recién al
 *  canjear la invitación (`ACCESS_ERRORS.conflict`).
 *
 *  Y dos en los que ABORTA la edición entera, con un mensaje para el operador:
 *  la dirección nueva ya es de otra cuenta (ver la guarda de colisión más
 *  abajo), y la ficha se quedaría SIN dirección.
 *
 *  Exportada por el mismo motivo que `revokeStaleMemberTokens`: el asiento en
 *  acta de un REINGRESO (`@/lib/applications/record`) escribe `Member` sin poder
 *  pasar por `updateMember` —su transacción también asienta el acta y el
 *  movimiento— y le copia a la ficha la dirección declarada en la solicitud. Sin
 *  esta llamada, un ex socio con cuenta que vuelve declarando otra casilla
 *  quedaba con el padrón diciendo una dirección y el login pidiendo otra, y con
 *  la casilla vieja todavía capaz de tomarle la cuenta por recupero. */
export async function syncAccountEmail(
  tx: Pick<PrismaClient, "actionToken" | "user">,
  before: Pick<Member, "email">,
  after: Pick<Member, "email" | "userId">,
): Promise<AccountEmailMove | null> {
  if (sameAddress(before.email, after.email)) return null;
  const userId = after.userId;
  if (userId === null) return null;

  // El login busca la cuenta en minúsculas (`verify-credentials`), igual que
  // `memberAccess.createPassword`.
  const email = after.email?.toLowerCase().trim();

  // GUARDA DE FICHA SIN EMAIL. `User.email` es la identidad con la que se
  // ingresa: es única y no nula, así que borrar el email de la ficha no tiene
  // ningún valor con el cual reemplazarla en la cuenta. Dejar que la edición
  // pase igual —la cuenta conservando la dirección anterior— sería dejar en pie
  // exactamente la amenaza que este módulo viene a cerrar: quien controle la
  // casilla vieja se emite un recupero cuando quiera, aunque el padrón ya no
  // declare esa casilla como del socio, y revocar los enlaces vivos no alcanza
  // porque el atacante pide uno nuevo. Y el camino del operador es natural ("ese
  // mail ya no es de él y no sabemos el nuevo" → borra el campo), así que la
  // divergencia se produciría en silencio y sin rastro.
  //
  // Por eso se aborta, con el mismo mecanismo que el conflicto: excepción,
  // rollback y mensaje. Sacarle el acceso a un socio no es borrarle el email:
  // eso es una baja (`memberService.withdraw`, que deshabilita la cuenta).
  if (!email) throw new MemberEmailRequiredError();

  // Un enlace de recupero emitido hacia la casilla anterior deja de estar
  // autorizado por el mismo motivo por el que se revocan los de la ficha. Va
  // antes del posible conflicto sólo por claridad: si hay conflicto, la
  // transacción entera vuelve atrás y esta revocación tampoco ocurre.
  await makeTokens(tx).revokeForUser(userId, ["password_reset"]);

  const account = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!account || sameAddress(account.email, email)) return null;

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
  return { from: account.email, to: email };
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
     *  Lanza un `MemberWriteError` —`MemberEmailConflictError` si la dirección
     *  nueva ya es la de otra cuenta de acceso, `MemberEmailRequiredError` si la
     *  edición dejaría sin email a una ficha que ya tiene cuenta— y en los dos
     *  casos la transacción vuelve atrás entera.
     *
     *  Qué campos se pueden escribir es problema del llamador: la lista blanca
     *  estatutaria del modo carga es `Patch` en `@/lib/members/card-edit`. Lo que
     *  garantiza esta capa es la invariante de tokens y la de la cuenta. */
    async updateMember(memberId: number, data: Prisma.MemberUncheckedUpdateInput) {
      return db.$transaction(async (tx) => {
        const before = await tx.member.findUniqueOrThrow({ where: { id: memberId } });
        const member = await tx.member.update({ where: { id: memberId }, data });
        const revokedTokens = await revokeStaleMemberTokens(tx, memberId, before, member);
        // `accountEmailMove` sale de la transacción para que el llamador pueda
        // avisar por correo: la dirección ANTERIOR ya no está en ninguna fila
        // después del commit, así que si no se devuelve acá se pierde. Los
        // envíos NO van adentro de la transacción —un SMTP lento la dejaría
        // abierta con la fila de la cuenta bloqueada, y un correo no se puede
        // "revertir" con un rollback—: son posteriores y su falla no deshace el
        // cambio (ver `@/lib/members/account-email-notice`).
        const accountEmailMove = await syncAccountEmail(tx, before, member);
        return { member, revokedTokens, accountEmailMove, accountEmailUpdated: accountEmailMove !== null };
      });
    },
  };
}

export const memberWriter = makeMemberWriter(prisma);
