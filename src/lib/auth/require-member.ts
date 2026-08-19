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
//   - `suspended` → REG-20: no puede operar desde su panel mientras dure la
//     suspensión. Se mira `status` y no `suspendedFrom/To`: el estado es la
//     única fuente de verdad y lo mueven las actas (`suspend`/`endSuspension`).
//   - sin ficha vinculada → el usuario no es socio, sea lo que diga el token.
//
// Y la misma consulta trae el sello del último cambio de contraseña de la cuenta
// (`User.passwordChangedAt`): la otra mitad del mismo problema es que un token
// robado sobrevive a que el socio cambie la contraseña. Ver
// `@/lib/auth/session-freshness`.
//
// El rol del JWT no participa de la decisión: es un dato de conveniencia para el
// proxy (que sí puede seguir usándolo como filtro barato), no la autorización.
import type { MemberStatus } from "@/generated/prisma/client";
import { sessionPredatesPasswordChange, STALE_SESSION_MESSAGE } from "@/lib/auth/session-freshness";

export type MemberBlockReason =
  | "anonymous"
  | "not_member"
  | "stale_session"
  | "suspended"
  | "withdrawn";

export type MemberActor =
  | { ok: true; userId: number; memberId: number; fullName: string }
  | { ok: false; reason: MemberBlockReason; error: string };

/** Los mensajes son de cara al socio (es-AR) y los usa también la pantalla de
 *  bloqueo de /mi, así que viven acá y no repartidos por la UI. */
export const MEMBER_BLOCKED: Record<MemberBlockReason, string> = {
  anonymous: "Ingresá a tu cuenta para ver tu panel de socio.",
  not_member: "Tu usuario no está vinculado a ninguna ficha del padrón. Comunicate con la vecinal.",
  stale_session: STALE_SESSION_MESSAGE,
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
  /** De `User.passwordChangedAt`, por el vínculo de la ficha. */
  passwordChangedAt: Date | null;
} | null>;

export function makeRequireMember(getSession: GetSession, findMemberByUserId: MemberLookup) {
  return async function requireMember(): Promise<MemberActor> {
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
    if (member.status === "withdrawn") {
      return { ok: false, reason: "withdrawn", error: MEMBER_BLOCKED.withdrawn };
    }
    if (member.status === "suspended") {
      return { ok: false, reason: "suspended", error: MEMBER_BLOCKED.suspended };
    }
    return { ok: true, userId, memberId: member.id, fullName: member.fullName };
  };
}

/**
 * Versión ligada a la sesión y a la base reales. Los `import()` son dinámicos a
 * propósito, igual que en `require-admin.ts`: "@/auth" arrastra NextAuth y
 * Prisma, y este módulo lo importan también los tests.
 */
export async function requireMember(): Promise<MemberActor> {
  const [{ auth }, { prisma }] = await Promise.all([import("@/auth"), import("@/lib/prisma")]);
  return makeRequireMember(auth, async (userId) => {
    const member = await prisma.member.findUnique({
      where: { userId },
      select: {
        id: true,
        fullName: true,
        status: true,
        user: { select: { passwordChangedAt: true } },
      },
    });
    if (!member) return null;
    // `user` no puede faltar —la búsqueda es POR `userId`—, pero el tipo lo
    // admite y un `undefined` colado acá desactivaría la comparación en silencio.
    return {
      id: member.id,
      fullName: member.fullName,
      status: member.status,
      passwordChangedAt: member.user?.passwordChangedAt ?? null,
    };
  })();
}
