// Canje de los enlaces públicos que le llegan al socio por correo: verificación
// del domicilio electrónico y alta de la contraseña de acceso.
//
// Vive en `src/lib/members/` —la capa dueña de las escrituras sobre `Member`— y
// no en las server actions, por tres motivos:
//
//  1. **Todo el canje es UNA transacción.** El `consume` del token, la
//     revalidación del estado del socio y la escritura van juntos. Leer el socio
//     fuera de la transacción es exactamente la carrera que quedó abierta en el
//     envío (Task 13): entre que se lee la ficha y se escribe, una baja puede
//     commitear en el medio. Acá el `UPDATE ... WHERE used_at IS NULL` del
//     `consume` toma el lock de la fila del token y todo lo demás ocurre dentro.
//  2. **Se testea sin base**, con el mismo patrón de fakes del resto del módulo.
//  3. Las páginas públicas quedan reducidas a lo que sí es suyo: la sesión que
//     no hay, el rate limit, el hash de la contraseña y la auditoría.
//
// Regla de oro del circuito: **nunca se consume un token en un GET**. Las
// páginas renderizan con `peek`; el `consume` sólo ocurre acá, invocado desde la
// server action del formulario.
import type { Member, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth/roles";
import { makeTokens, MEMBER_EMAIL_TOKEN_PURPOSES } from "@/lib/tokens";

/** Mensajes de cara al socio (es-AR). Exportados para que los tests los fijen y
 *  las páginas los reusen sin duplicar texto. */
export const ACCESS_ERRORS = {
  dead: "El enlace venció o ya fue usado. Pedí a la vecinal que te lo reenvíe.",
  withdrawn: "Figurás con baja en el padrón: el enlace ya no es válido. Comunicate con la vecinal.",
  noEmail: "Tu ficha no tiene un email registrado. Comunicate con la vecinal.",
  conflict: "Ya existe una cuenta con ese email que no podemos vincular a tu ficha. Comunicate con la vecinal.",
} as const;

export type VerifyResult =
  | { ok: true; memberId: number; invite: string | null }
  | { ok: false; error: string };

export type CreatePasswordResult =
  | { ok: true; memberId: number; userId: number; created: boolean }
  | { ok: false; error: string };

/** ¿La ficha sigue habilitando el canje?
 *
 *  Sólo la baja lo cierra. La suspensión NO: es temporal, no le saca al socio el
 *  domicilio electrónico —es cuando más falta hace poder notificarlo— y el envío
 *  a un suspendido está expresamente habilitado (`verificationTarget`). Lo que
 *  un suspendido no puede es OPERAR el panel, y eso lo cierra `requireMember`
 *  contra la fila viva en cada visita (REG-20), no el alta de la contraseña. */
export function canRedeem(member: Pick<Member, "status">): { ok: true } | { ok: false; error: string } {
  if (member.status === "withdrawn") return { ok: false, error: ACCESS_ERRORS.withdrawn };
  return { ok: true };
}

/** Rechazo que además tiene que DESHACER el consumo del token.
 *
 *  La diferencia importa y es de seguridad de un lado y de operación del otro:
 *  - Un rechazo por estado (baja) commitea: el enlace llegó a un buzón que ya no
 *    representa a nadie y no puede quedar vivo esperando otro click.
 *  - Un rechazo por dato mal cargado (ficha sin email, cuenta ajena con esa
 *    dirección) hace rollback: no es un ataque, y el socio no hizo nada mal. El
 *    panel hoy puede reemitirle el enlace (`verificationTarget` habilita la
 *    invitación mientras la ficha no tenga cuenta), pero eso es un llamado
 *    telefónico a la vecinal: conservarle el enlace le deja el camino abierto
 *    para cuando el dato se corrija. */
class AccessAbort extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "AccessAbort";
  }
}

type AccessDb = Pick<
  PrismaClient,
  "$transaction" | "actionToken" | "member" | "role" | "user" | "userRole"
>;

export function makeMemberAccess(db: AccessDb) {
  /** Corre el canje en una transacción y traduce el aborto en `{ ok: false }`. */
  async function redeem<T>(run: (tx: Parameters<Parameters<AccessDb["$transaction"]>[0]>[0]) => Promise<T>) {
    try {
      return await db.$transaction(run);
    } catch (e) {
      if (e instanceof AccessAbort) return { ok: false as const, error: e.reason };
      throw e;
    }
  }

  return {
    /** Confirma el domicilio electrónico y, si el socio todavía no tiene cuenta,
     *  devuelve el token crudo de la invitación de contraseña para redirigirlo.
     *  El token de invitación se emite ACÁ (no se pide otro correo): la persona
     *  ya demostró tener el buzón al abrir este enlace. Si pierde esa pantalla,
     *  el panel le puede mandar la invitación sola por correo (`verificationTarget`
     *  → `password_invitation`), que revoca ésta y emite una nueva. */
    async verifyEmail(rawToken: string, now = new Date()): Promise<VerifyResult> {
      return redeem(async (tx) => {
        const tokens = makeTokens(tx);
        const t = await tokens.consume(rawToken, "email_verification", now);
        if (!t?.memberId) return { ok: false as const, error: ACCESS_ERRORS.dead };

        const member = await tx.member.findUnique({ where: { id: t.memberId } });
        if (!member) return { ok: false as const, error: ACCESS_ERRORS.dead };
        // Revalidación en vivo: entre el envío y el click pudo asentarse una baja.
        const allowed = canRedeem(member);
        if (!allowed.ok) return { ok: false as const, error: allowed.error };
        if (!member.email) throw new AccessAbort(ACCESS_ERRORS.noEmail);

        // Escritura de `Member` dentro de la capa dueña del dato. No toca los
        // campos que vigila la invariante de tokens (`email` y `status`), así
        // que no hay nada que revocar por este update: lo que sí revocamos es
        // por la emisión de la invitación, unas líneas más abajo.
        await tx.member.update({
          where: { id: member.id },
          data: { emailStatus: "verified", emailVerifiedAt: now },
        });

        if (member.userId) return { ok: true as const, memberId: member.id, invite: null };

        // Un enlace vivo por socio: si emitimos sin revocar, el correo anterior
        // (o un reenvío que cruzó por el medio) queda como segundo camino válido
        // para crear la contraseña de esta cuenta durante 7 días. El token que
        // acabamos de consumir ya tiene `usedAt`, así que sobrevive como rastro.
        await tokens.revokeForMember(member.id, MEMBER_EMAIL_TOKEN_PURPOSES);
        const invite = await tokens.issue({ purpose: "password_invitation", memberId: member.id, now });
        return { ok: true as const, memberId: member.id, invite };
      });
    },

    /** Crea (o restablece) la cuenta del socio con el hash ya calculado.
     *  El bcrypt se hace AFUERA a propósito: son ~300 ms y no pueden transcurrir
     *  con la transacción abierta y la fila del token bloqueada. */
    async createPassword(rawToken: string, passwordHash: string, now = new Date()): Promise<CreatePasswordResult> {
      return redeem(async (tx) => {
        const t = await makeTokens(tx).consume(rawToken, "password_invitation", now);
        if (!t?.memberId) return { ok: false as const, error: ACCESS_ERRORS.dead };

        const member = await tx.member.findUnique({ where: { id: t.memberId } });
        if (!member) return { ok: false as const, error: ACCESS_ERRORS.dead };
        const allowed = canRedeem(member);
        if (!allowed.ok) return { ok: false as const, error: allowed.error };

        // El login busca la cuenta en minúsculas (`verify-credentials`): la
        // dirección de la ficha se normaliza igual acá.
        const email = member.email?.toLowerCase().trim();
        if (!email) throw new AccessAbort(ACCESS_ERRORS.noEmail);

        const linked = member.userId
          ? await tx.user.findUnique({ where: { id: member.userId } })
          : null;
        const byEmail = await tx.user.findUnique({
          where: { email },
          include: { roles: { include: { role: true } } },
        });

        // Qué cuenta se puede escribir con una invitación de socio:
        //  - la que ya está vinculada a ESTA ficha, o
        //  - una cuenta libre con esa dirección (sin ficha ajena y sin rol de
        //    administración), o
        //  - ninguna: se crea una nueva.
        // El tercer caso a evitar es el que motiva la guarda: una ficha con el
        // email de un administrador convertiría la invitación en un cambio de
        // contraseña de esa cuenta de gestión. Que el correo haya ido a ese buzón
        // no lo hace legítimo: el padrón lo edita un admin, no el titular.
        if (byEmail && (!linked || byEmail.id !== linked.id)) {
          if (linked) throw new AccessAbort(ACCESS_ERRORS.conflict);
          if (isAdmin(byEmail.roles.map((r) => r.role.name))) throw new AccessAbort(ACCESS_ERRORS.conflict);
          const otherCard = await tx.member.findUnique({ where: { userId: byEmail.id } });
          if (otherCard && otherCard.id !== member.id) throw new AccessAbort(ACCESS_ERRORS.conflict);
        }

        const socioRole = await tx.role.findUnique({ where: { name: "socio" } });
        // El seed crea los tres roles; si falta, es un problema de datos del
        // servidor y no algo que el socio pueda resolver reintentando: se aborta
        // sin quemarle el enlace.
        if (!socioRole) throw new AccessAbort(ACCESS_ERRORS.conflict);

        const target = linked ?? byEmail;
        // `created` distingue el alta de cuenta del restablecimiento sobre una
        // que ya existía: son dos hechos distintos en la auditoría.
        const user = target
          ? await tx.user.update({
              where: { id: target.id },
              // `active: true` es el reverso del cerrojo que pone la baja: si la
              // ficha volvió a estar vigente (reingreso) y el socio llega hasta
              // acá con un enlace válido, la cuenta tiene que poder entrar.
              data: { passwordHash, active: true },
            })
          : await tx.user.create({
              data: { email, passwordHash, name: member.fullName, active: true },
            });

        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: socioRole.id } },
          create: { userId: user.id, roleId: socioRole.id },
          update: {},
        });
        if (member.userId !== user.id) {
          await tx.member.update({ where: { id: member.id }, data: { userId: user.id } });
        }
        return { ok: true as const, memberId: member.id, userId: user.id, created: !target };
      });
    },
  };
}

export const memberAccess = makeMemberAccess(prisma);
