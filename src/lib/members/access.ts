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
  /** §7.2 del diagnóstico de la invitación perdida: el token de verificación ya
   *  se usó pero el trámite de fondo SÍ avanzó (email verificado, cuenta sin
   *  crear). "Venció o ya fue usado" a secas es cierto sobre el token y falso
   *  sobre lo que le pasó a la persona. No promete que el correo salió —el
   *  envío de la red es best-effort—: manda a buscarlo y nombra el reenvío. */
  verifiedNoAccount:
    "Tu email ya está confirmado: lo que falta es crear tu contraseña. Buscá en tu casilla el correo para crearla (mirá también el spam) y, si no lo encontrás, pedile a la vecinal que te reenvíe el enlace.",
  withdrawn: "Figurás con baja en el padrón: el enlace ya no es válido. Comunicate con la vecinal.",
  noEmail: "Tu ficha no tiene un email registrado. Comunicate con la vecinal.",
  // Caso típico: un matrimonio (u otro hogar) que comparte casilla. La cuenta es
  // una por email y ya la tiene el primero que la creó; el segundo socio sigue
  // siendo socio pleno (recibe notificaciones ahí, paga en sede, vota), sólo que
  // sin autoservicio web. El texto NO puede nombrar de quién es la cuenta
  // existente ni confirmar ningún dato suyo (nombre, N° de socio, DNI): esta
  // pantalla la puede estar leyendo cualquiera que abra el enlace.
  conflict:
    "Ese email ya tiene una cuenta de acceso creada, así que no podemos vincularla a tu ficha. Tu condición de socio no cambia por esto: vas a seguir recibiendo las notificaciones ahí, podés pagar la cuota en la sede y tenés voz y voto en las asambleas. Si querés tu acceso propio al panel, acercate a la sede vecinal o pedí que te carguen otro email en la ficha.",
  // Distinto del anterior a propósito: acá no hay ninguna cuenta en conflicto,
  // es un problema de datos del servidor (falta el rol "socio" del seed).
  // Mostrarle al socio el texto de arriba sería directamente falso.
  unavailable: "No pudimos completar el alta por un problema técnico. Comunicate con la vecinal.",
} as const;

// ── Lo que las páginas públicas de canje muestran ────────────────────────────
//
// /verificar y /acceso son URLs anónimas: la única credencial es el token que
// viajó dentro de un correo. Y un correo puede haber ido a la casilla
// equivocada, porque la dirección la tipea un operador desde una ficha de papel.
//
// Por eso estas dos páginas NO saludan por nombre. Hasta acá decían
// "Hola <nombre completo>: confirmá que <email> es tu domicilio electrónico ante
// la Asociación Vecinal del Barrio Ciudadela", o sea que un dedazo de una letra
// le entregaba a un tercero, con un solo click, el nombre completo de un socio y
// el hecho de que pertenece a la asociación: dato personal de los que docs/08 y
// la Ley 25.326 mandan no publicar, y la contradicción exacta del principio de
// docs/01 ("ninguna consulta pública revela datos del padrón"). Era además el
// agujero por donde se escapaba el cuidado del correo de mudanza, que
// deliberadamente no nombra al socio (ver `loginEmailMovedNotice`).
//
// La dirección SÍ se muestra, y no es una inconsistencia: es la misma casilla
// donde la persona acaba de recibir el enlace —el token se emite y se manda a
// `Member.email`, y si la ficha cambia de dirección la invariante de
// `revokeStaleMemberTokens` mata el enlace anterior—, así que no le revela nada
// que no supiera. Lo que sí le da es lo que el socio legítimo necesita para no
// abandonar el trámite: cuál de sus direcciones está confirmando.
//
// El equilibrio, entonces: contexto institucional completo (quién pregunta, para
// qué, con qué efecto) y ninguna identidad. Un desconocido que abra el enlace se
// entera de que alguien cargó SU dirección en la vecinal, no de quién es socio.

/** Lo ÚNICO que /verificar y /acceso leen de la ficha. Que `fullName` no esté es
 *  la garantía, y es estructural: las páginas no lo tienen a mano ni por
 *  descuido, igual que `loginEmailMovedNotice()` no puede filtrar la dirección
 *  nueva porque no la recibe. */
export const REDEEM_CARD_SELECT = { email: true, status: true } as const;

/** Los textos de las dos páginas. Son constantes y no funciones: no hay ningún
 *  hueco donde interpolar un nombre. */
export const REDEEM_PAGE_COPY = {
  verifyLead: "Confirmá que esta dirección de correo es tuya:",
  verifyWhy:
    "Con tu confirmación, la Asociación Vecinal del Barrio Ciudadela va a poder notificarte de manera fehaciente a esta casilla (Art. 5° quater del estatuto).",
  verifyNotYou:
    "Si no esperabas este correo, cerrá esta página: sin tu confirmación no queda registrada ninguna dirección.",
  createLead: "Elegí una contraseña para entrar al portal con esta dirección:",
  createWhy:
    "Es la dirección con la que vas a ingresar al portal de la Asociación Vecinal del Barrio Ciudadela.",
  createNotYou:
    "Si no esperabas este correo, cerrá esta página y avisale a la vecinal: puede ser un error de carga.",
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

/** Qué decir ante un enlace de verificación MUERTO cuando la ficha del dueño se
 *  conoce (`tokens.ownerOf` la devuelve aunque el token esté usado o vencido).
 *
 *  No es un oráculo abierto: sólo se llega acá con el hash de un token real,
 *  o sea desde el correo que lo trajo, y la rama no dispara ningún envío. Lo
 *  único que revela es "confirmado, falta la contraseña", que es exactamente lo
 *  que el destinatario legítimo necesita para no abandonar el trámite (el
 *  incidente del socio 106: su verificación funcionó y la pantalla le dijo que
 *  falló).
 *
 *  Vive acá y no en la página NI en la action porque lo usan las dos: es la
 *  lección de `coverageFloor` — compartir la función, no copiarla. */
export function deadVerificationCopy(
  member: Pick<Member, "status" | "emailStatus" | "userId"> | null,
): string {
  if (
    member !== null &&
    member.status !== "withdrawn" &&
    member.emailStatus === "verified" &&
    member.userId === null
  ) {
    return ACCESS_ERRORS.verifiedNoAccount;
  }
  return ACCESS_ERRORS.dead;
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

/** Lo que la verificación ESCRIBE sobre la ficha, una vez que las guardas ya
 *  dijeron que sí: marca la dirección como verificada y, si el socio todavía no
 *  tiene cuenta, revoca sus enlaces vivos y emite la invitación de contraseña.
 *
 *  Está afuera del factory —y recibe el `tx`— porque tiene DOS puntas y ninguna
 *  puede quedarse a mitad de camino:
 *
 *   1. `verifyEmail` de acá abajo: el token de la FICHA (circuito del M1).
 *   2. El canje TARDÍO del token de una SOLICITUD cuya alta ya se asentó
 *      (`/verificar/[token]/actions.ts`). Ese enlace vive 7 días y el vecino
 *      puede abrirlo DESPUÉS del asiento: la ficha nace con la dirección
 *      `declared` —por eso el asiento no le manda la invitación— y sin esto la
 *      verificación moría en la solicitud, dejando al socio sin acceso al portal
 *      y sin un segundo asiento que disparara nada.
 *
 *  Las guardas de estado son de cada punta y corren ANTES (la baja en las dos;
 *  además, del lado de la solicitud, que la ficha siga teniendo la misma
 *  dirección que autorizó el enlace). Acá adentro no hay ninguna decisión: sólo
 *  la escritura, para que las dos puntas escriban exactamente lo mismo.
 *
 *  No toca los campos que vigila la invariante de tokens (`email` y `status`),
 *  así que no hay nada que revocar por el update: lo que sí revoca es la
 *  emisión de la invitación. */
export async function applyEmailVerification(
  tx: Pick<PrismaClient, "actionToken" | "member">,
  member: Pick<Member, "id" | "userId">,
  now: Date,
): Promise<{ memberId: number; invite: string | null }> {
  await tx.member.update({
    where: { id: member.id },
    data: { emailStatus: "verified", emailVerifiedAt: now },
  });

  if (member.userId) return { memberId: member.id, invite: null };

  // Un enlace vivo por socio: si emitimos sin revocar, el correo anterior (o un
  // reenvío que cruzó por el medio) queda como segundo camino válido para crear
  // la contraseña de esta cuenta durante 7 días. El token que se acaba de
  // consumir ya tiene `usedAt`, así que sobrevive como rastro.
  const tokens = makeTokens(tx);
  await tokens.revokeForMember(member.id, MEMBER_EMAIL_TOKEN_PURPOSES);
  const invite = await tokens.issue({ purpose: "password_invitation", memberId: member.id, now });
  return { memberId: member.id, invite };
}

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

        // Escritura de `Member` dentro de la capa dueña del dato, y compartida
        // con el canje tardío del token de una solicitud: ver
        // `applyEmailVerification`.
        return { ok: true as const, ...(await applyEmailVerification(tx, member, now)) };
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
        if (!socioRole) throw new AccessAbort(ACCESS_ERRORS.unavailable);

        const target = linked ?? byEmail;
        // `created` distingue el alta de cuenta del restablecimiento sobre una
        // que ya existía: son dos hechos distintos en la auditoría.
        const user = target
          ? await tx.user.update({
              where: { id: target.id },
              // `active: true` es el reverso del cerrojo que pone la baja: si la
              // ficha volvió a estar vigente (reingreso) y el socio llega hasta
              // acá con un enlace válido, la cuenta tiene que poder entrar.
              //
              // Y `passwordChangedAt` cierra las sesiones anteriores a este
              // cambio: sobre una cuenta que ya existía, esto es un
              // restablecimiento de contraseña como el del recupero, y un JWT
              // emitido con la contraseña vieja no puede sobrevivirle (ver
              // `@/lib/auth/session-freshness`).
              data: { passwordHash, active: true, passwordChangedAt: now },
            })
          : await tx.user.create({
              // La cuenta nace con el sello puesto, aunque todavía no exista
              // ninguna sesión que invalidar: así la columna significa siempre
              // "cuándo se escribió esta contraseña" y no queda un hueco de
              // filas nuevas indistinguibles de las previas a la migración.
              data: {
                email, passwordHash, name: member.fullName, active: true,
                passwordChangedAt: now,
              },
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
