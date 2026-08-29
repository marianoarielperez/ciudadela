// Autorización de las server actions del panel.
//
// El proxy (proxy.ts) sólo corre sobre `matcher: ["/admin/:path*", "/mi/:path*"]`,
// y una server action NO se invoca por su URL: Next la despacha por el id del
// encabezado `Next-Action` contra un manifiesto global del build, así que un POST
// a "/" o a "/mi" ejecuta igual una action declarada bajo /admin sin pasar nunca
// por la rama /admin del callback `authorized`. El chequeo de rol de
// admin/layout.tsx tampoco corre: es render, no POST.
//
// Conclusión: cada action que escribe es un endpoint público y tiene que
// autorizarse a sí misma. El padrón es el registro que la asociación presenta
// ante la IGJ; no alcanza con "hay sesión".
//
// Y tampoco alcanza con lo que dice el TOKEN. La sesión es un JWT de 8 horas sin
// estado en la base, así que el rol "admin" que se emitió al entrar sobrevive
// intacto a la revocación que se asienta diez minutos después, y la contraseña
// cambiada por un robo no echa al intruso hasta que el token venza solo. Por eso
// esta guarda hace lo mismo que `require-member`: resuelve contra la fila viva de
// `User` —rol, `active` y `passwordChangedAt`— y no contra el token.
//
// El token conserva un solo papel, y es el barato: si NO trae el rol exigido, se
// rechaza sin tocar la base. O sea que el token puede quitar el permiso pero
// nunca darlo.
import { isAdmin, isSuperadmin } from "@/lib/auth/roles";
import {
  EXPIRED_SESSION_MESSAGE,
  sessionExceededMaxLifetime,
  sessionPredatesPasswordChange,
  STALE_SESSION_MESSAGE,
} from "@/lib/auth/session-freshness";

export type AdminBlockReason =
  | "anonymous"
  | "not_admin"
  | "disabled"
  | "stale_session"
  | "expired_session";

export type AdminActor =
  | { ok: true; actorId: number }
  | { ok: false; reason: AdminBlockReason; error: string };

// Lo mínimo que necesitamos de la sesión de Auth.js. Tipar sólo esto deja el
// helper inyectable y testeable sin levantar NextAuth ni Prisma.
type SessionLike = {
  user?: { id?: string | null; roles?: string[] | null; authAt?: number | null } | null;
} | null;
type GetSession = () => Promise<SessionLike>;

/** Lo mínimo que se necesita de la cuenta viva. Inyectable, igual que el
 *  `MemberLookup` de `require-member.ts`. */
export type AdminAccountLookup = (userId: number) => Promise<{
  active: boolean;
  roles: string[];
  passwordChangedAt: Date | null;
} | null>;

/** Mensajes de cara al operador. Viven acá porque los usa también la pantalla de
 *  bloqueo de /admin, no sólo las actions. */
export const ADMIN_BLOCKED: Record<AdminBlockReason, string> = {
  anonymous: "Sesión inválida.",
  // Mismo texto que ya usaba el modo carga: el operador no gana nada sabiendo qué
  // rol le falta, y el mensaje viaja al formulario tal cual.
  not_admin: "No tenés permiso para editar el padrón.",
  disabled: "Tu cuenta de acceso está deshabilitada. Comunicate con la vecinal.",
  stale_session: STALE_SESSION_MESSAGE,
  expired_session: EXPIRED_SESSION_MESSAGE,
};

// Factory común: la única diferencia entre requireAdmin y requireSuperadmin es
// QUÉ rol exige. Toda la lógica —token barato primero, fila viva después,
// frescura de sesión— queda en un solo lugar y en un solo orden.
function makeRequireRole(
  getSession: GetSession,
  findAccount: AdminAccountLookup,
  hasRole: (roles: readonly string[] | null | undefined) => boolean,
  notAllowed: string,
) {
  return async function requireRole(): Promise<AdminActor> {
    const session = await getSession();
    const id = session?.user?.id;
    if (!id) return { ok: false, reason: "anonymous", error: ADMIN_BLOCKED.anonymous };
    // Filtro barato ANTES de la base: un token que no trae el rol no puede pasar
    // aunque la base diga que sí (para eso está volver a entrar), y así una
    // sesión de socio no le cuesta una consulta al padrón a cada POST.
    if (!hasRole(session?.user?.roles)) {
      return { ok: false, reason: "not_admin", error: notAllowed };
    }
    // Un id no numérico en el token no puede convertirse en NaN silencioso:
    // NaN como actorId iría a parar a la auditoría y a los FKs.
    const actorId = Number(id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      return { ok: false, reason: "anonymous", error: ADMIN_BLOCKED.anonymous };
    }

    const account = await findAccount(actorId);
    // Cuenta borrada: el token la sobrevive y no hay nadie a quien atribuirle la
    // escritura. Mismo texto que el rol faltante: no hay nada que distinguirle.
    if (!account) return { ok: false, reason: "not_admin", error: notAllowed };
    if (!account.active) return { ok: false, reason: "disabled", error: ADMIN_BLOCKED.disabled };
    // La verdad del rol es la fila viva, no el token: acá es donde se cierra el
    // hueco de la revocación de admin.
    if (!hasRole(account.roles)) {
      return { ok: false, reason: "not_admin", error: notAllowed };
    }
    if (sessionPredatesPasswordChange(session?.user?.authAt, account.passwordChangedAt)) {
      return { ok: false, reason: "stale_session", error: ADMIN_BLOCKED.stale_session };
    }
    // El techo absoluto va DESPUÉS del cambio de contraseña: si la sesión murió
    // por las dos cosas, el motivo útil es el que dice qué pasó con la cuenta.
    // Las 8 horas del JWT son de inactividad y se renuevan solas en cada visita:
    // esto es lo único que le pone fin a una sesión que nadie sospecha.
    if (sessionExceededMaxLifetime(session?.user?.authAt)) {
      return { ok: false, reason: "expired_session", error: ADMIN_BLOCKED.expired_session };
    }
    return { ok: true, actorId };
  };
}

export function makeRequireAdmin(getSession: GetSession, findAccount: AdminAccountLookup) {
  return makeRequireRole(getSession, findAccount, isAdmin, ADMIN_BLOCKED.not_admin);
}

/** La Configuración no la comparte el admin común: es la llave que abre y cierra
 *  el alta pública de socios. */
export const SUPERADMIN_BLOCKED_MESSAGE = "Solo el superadmin puede cambiar la configuración.";

export function makeRequireSuperadmin(getSession: GetSession, findAccount: AdminAccountLookup) {
  return makeRequireRole(getSession, findAccount, isSuperadmin, SUPERADMIN_BLOCKED_MESSAGE);
}

/**
 * La consulta de la cuenta viva, compartida por las dos guardas ligadas. El
 * `import()` es dinámico a propósito: "@/lib/prisma" arrastra el cliente y este
 * módulo lo importan también los tests.
 */
async function liveAccount(): Promise<AdminAccountLookup> {
  const { prisma } = await import("@/lib/prisma");
  return async (userId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        active: true,
        passwordChangedAt: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user) return null;
    return {
      active: user.active,
      passwordChangedAt: user.passwordChangedAt,
      roles: user.roles.map((r) => r.role.name),
    };
  };
}

/**
 * Versión ligada a la sesión y a la base reales. El `import()` de "@/auth" es
 * dinámico por el mismo motivo: arrastra NextAuth entero.
 */
export async function requireAdmin(): Promise<AdminActor> {
  const [{ auth }, lookup] = await Promise.all([import("@/auth"), liveAccount()]);
  return makeRequireAdmin(auth, lookup)();
}

/** Igual que `requireAdmin`, pero sólo para superadmin (pantalla de Configuración). */
export async function requireSuperadmin(): Promise<AdminActor> {
  const [{ auth }, lookup] = await Promise.all([import("@/auth"), liveAccount()]);
  return makeRequireSuperadmin(auth, lookup)();
}

/** El mensaje de la pantalla de Usuarios: la de Configuración habla de
 *  "configuración" y acá mentiría. Misma factory, mismo orden de guardas. */
export const USERS_SUPERADMIN_MESSAGE = "Solo el superadmin puede gestionar las cuentas y los roles.";

export function makeRequireSuperadminUsers(getSession: GetSession, findAccount: AdminAccountLookup) {
  return makeRequireRole(getSession, findAccount, isSuperadmin, USERS_SUPERADMIN_MESSAGE);
}

export async function requireSuperadminUsers(): Promise<AdminActor> {
  const [{ auth }, lookup] = await Promise.all([import("@/auth"), liveAccount()]);
  return makeRequireSuperadminUsers(auth, lookup)();
}
