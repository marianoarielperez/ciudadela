// Autorización del panel de socio (/mi) y de toda server action de socio.
//
// El equivalente de `require-admin.ts` para el otro lado del sistema, pero con
// una diferencia que es el motivo de que exista: acá NO alcanza con mirar el
// token. La sesión es un JWT de 8 horas sin revalidación (`auth.config.ts`), así
// que el rol "socio" que se emitió al entrar sobrevive intacto a la baja o a la
// suspensión que se asienta diez minutos después. Con el callback `authorized`
// como única defensa, un socio dado de baja siguió operando su panel hasta que
// el token venciera solo — y revocarle los enlaces de acceso no sirve de nada si
// la cuenta que esos enlaces crearon sigue entrando.
//
// Por eso la autorización se resuelve contra la fila viva de `Member`:
//   - `withdrawn` → no hay socio que representar (Art. 9).
//   - `suspended` → REG-20: por defecto no puede operar desde su panel mientras
//     dure la suspensión. Se mira `status` y no `suspendedFrom/To`: el estado es
//     la única fuente de verdad y lo mueven las actas (`suspend`/`endSuspension`).
//     Enmienda M5 (spec §5, docs/02 vs. docs/05): el llamador puede pasar
//     `allowSuspended` para dejarlo entrar en modo LECTURA —ve su cuenta y puede
//     pagar, ninguna otra acción—; las actions que mutan datos no la pasan.
//   - sin ficha vinculada → el usuario no es socio, sea lo que diga el token.
//   - `User.active` en `false` → la cuenta de acceso está cerrada, aunque la
//     ficha esté impecable. Es la misma palanca que mira `require-admin`.
//
// Y la misma consulta trae el sello del último cambio de contraseña de la cuenta
// (`User.passwordChangedAt`): la otra mitad del mismo problema es que un token
// robado sobrevive a que el socio cambie la contraseña. Ver
// `@/lib/auth/session-freshness`.
//
// El rol del JWT no participa de la decisión: es un dato de conveniencia para el
// proxy (que sí puede seguir usándolo como filtro barato), no la autorización.
import type { MemberStatus } from "@/generated/prisma/client";
import {
  EXPIRED_SESSION_MESSAGE,
  sessionExceededMaxLifetime,
  sessionPredatesPasswordChange,
  STALE_SESSION_MESSAGE,
} from "@/lib/auth/session-freshness";

export type MemberBlockReason =
  | "anonymous"
  | "not_member"
  | "stale_session"
  | "expired_session"
  | "suspended"
  | "withdrawn"
  | "disabled";

export type RequireMemberOptions = {
  /** Deja pasar al SUSPENDIDO en modo lectura (spec M5 §5: ve su cuenta y puede
   *  pagar; ninguna otra acción). Las actions que muten datos NO pasan esta
   *  opción y siguen bloqueando. El cesante queda afuera siempre. */
  allowSuspended?: boolean;
};

export type MemberSuspension = { from: Date | null; to: Date | null };

export type MemberActor =
  | {
      ok: true;
      userId: number;
      memberId: number;
      fullName: string;
      /** `null` si el socio está vigente; con fechas si entró como suspendido
       *  vía `allowSuspended` (el banner del shell las muestra). */
      suspension: MemberSuspension | null;
    }
  | { ok: false; reason: MemberBlockReason; error: string };

/** Los mensajes son de cara al socio (es-AR) y los usa también la pantalla de
 *  bloqueo de /mi, así que viven acá y no repartidos por la UI. */
export const MEMBER_BLOCKED: Record<MemberBlockReason, string> = {
  anonymous: "Ingresá a tu cuenta para ver tu panel de socio.",
  not_member: "Tu usuario no está vinculado a ninguna ficha del padrón. Comunicate con la vecinal.",
  stale_session: STALE_SESSION_MESSAGE,
  expired_session: EXPIRED_SESSION_MESSAGE,
  // Mismo texto que `ADMIN_BLOCKED.disabled`: es el mismo hecho, la cuenta de
  // acceso está cerrada, y no hay nada que matizarle al socio.
  disabled: "Tu cuenta de acceso está deshabilitada. Comunicate con la vecinal.",
  suspended:
    "Tu condición de socio está suspendida: mientras dure la suspensión no podés operar desde tu panel (Art. 10). Comunicate con la vecinal.",
  withdrawn: "Figurás con baja en el padrón, así que tu panel de socio no está disponible.",
};

type SessionLike = { user?: { id?: string | null; authAt?: number | null } | null } | null;
type GetSession = () => Promise<SessionLike>;

/** Lo mínimo que se necesita de la ficha viva y de la cuenta que la opera.
 *  Inyectable: el helper se testea sin NextAuth ni Prisma. */
export type MemberLookup = (userId: number) => Promise<{
  id: number;
  fullName: string;
  status: MemberStatus;
  /** De `User.active`, por el vínculo de la ficha. */
  active: boolean;
  /** De `User.passwordChangedAt`, por el vínculo de la ficha. */
  passwordChangedAt: Date | null;
  suspendedFrom: Date | null;
  suspendedTo: Date | null;
} | null>;

export function makeRequireMember(getSession: GetSession, findMemberByUserId: MemberLookup) {
  return async function requireMember(opts: RequireMemberOptions = {}): Promise<MemberActor> {
    const session = await getSession();
    const id = session?.user?.id;
    // Un id no numérico no puede convertirse en NaN silencioso: NaN como clave
    // de búsqueda es una consulta que nadie escribió.
    const userId = Number(id);
    if (!id || !Number.isInteger(userId) || userId <= 0) {
      return { ok: false, reason: "anonymous", error: MEMBER_BLOCKED.anonymous };
    }
    const member = await findMemberByUserId(userId);
    if (!member) return { ok: false, reason: "not_member", error: MEMBER_BLOCKED.not_member };
    // Va antes que el estado de la ficha: si la contraseña cambió, esta sesión
    // ya no representa a nadie, sea cual sea la situación del socio en el padrón.
    if (sessionPredatesPasswordChange(session?.user?.authAt, member.passwordChangedAt)) {
      return { ok: false, reason: "stale_session", error: MEMBER_BLOCKED.stale_session };
    }
    // El techo absoluto de la sesión. Las 8 horas del JWT son de inactividad y
    // se renuevan solas en cada visita, así que sin esto un token robado y usado
    // discretamente no vence nunca. Ver `@/lib/auth/session-freshness`.
    if (sessionExceededMaxLifetime(session?.user?.authAt)) {
      return { ok: false, reason: "expired_session", error: MEMBER_BLOCKED.expired_session };
    }
    if (member.status === "withdrawn") {
      return { ok: false, reason: "withdrawn", error: MEMBER_BLOCKED.withdrawn };
    }
    const isSuspended = member.status === "suspended";
    if (isSuspended && !opts.allowSuspended) {
      return { ok: false, reason: "suspended", error: MEMBER_BLOCKED.suspended };
    }
    // `User.active` es la palanca de "cuenta deshabilitada", y hasta acá sólo la
    // miraba `/admin`. Hoy toda cuenta deshabilitada es además una baja del
    // padrón (`memberService.withdraw` hace las dos cosas en la misma
    // transacción), así que el bloqueo ocurría igual — pero por coincidencia, no
    // por una guarda. Cualquier camino futuro que cierre una cuenta sin dar de
    // baja al socio (una suspensión administrativa del acceso, una respuesta a
    // un incidente) dejaba /mi abierto con el JWT viejo.
    //
    // Va DESPUÉS del estado de la ficha justamente por esa superposición: al
    // socio dado de baja le sigue correspondiendo el mensaje que le explica el
    // hecho que le importa —la baja en el padrón— y no el genérico de la cuenta.
    if (!member.active) {
      return { ok: false, reason: "disabled", error: MEMBER_BLOCKED.disabled };
    }
    return {
      ok: true,
      userId,
      memberId: member.id,
      fullName: member.fullName,
      suspension: isSuspended
        ? { from: member.suspendedFrom, to: member.suspendedTo }
        : null,
    };
  };
}

/**
 * Versión ligada a la sesión y a la base reales. Los `import()` son dinámicos a
 * propósito, igual que en `require-admin.ts`: "@/auth" arrastra NextAuth y
 * Prisma, y este módulo lo importan también los tests.
 */
export async function requireMember(opts: RequireMemberOptions = {}): Promise<MemberActor> {
  const [{ auth }, { prisma }] = await Promise.all([import("@/auth"), import("@/lib/prisma")]);
  return makeRequireMember(auth, async (userId) => {
    const member = await prisma.member.findUnique({
      where: { userId },
      select: {
        id: true,
        fullName: true,
        status: true,
        suspendedFrom: true,
        suspendedTo: true,
        user: { select: { active: true, passwordChangedAt: true } },
      },
    });
    if (!member) return null;
    // `user` no puede faltar —la búsqueda es POR `userId`—, pero el tipo lo
    // admite y un `undefined` colado acá desactivaría la comparación en
    // silencio. Por eso el `active` ausente se lee como `false`: si no sabemos
    // si la cuenta está habilitada, no está.
    return {
      id: member.id,
      fullName: member.fullName,
      status: member.status,
      suspendedFrom: member.suspendedFrom,
      suspendedTo: member.suspendedTo,
      active: member.user?.active ?? false,
      passwordChangedAt: member.user?.passwordChangedAt ?? null,
    };
  })(opts);
}
