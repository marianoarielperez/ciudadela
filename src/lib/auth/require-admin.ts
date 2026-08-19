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
import { isAdmin } from "@/lib/auth/roles";

export type AdminActor = { ok: true; actorId: number } | { ok: false; error: string };

// Lo mínimo que necesitamos de la sesión de Auth.js. Tipar sólo esto deja el
// helper inyectable y testeable sin levantar NextAuth ni Prisma.
type SessionLike = { user?: { id?: string | null; roles?: string[] | null } | null } | null;
type GetSession = () => Promise<SessionLike>;

const NO_SESSION = "Sesión inválida.";
// Mismo texto que ya usaba el modo carga: el operador no gana nada sabiendo qué
// rol le falta, y el mensaje viaja al formulario tal cual.
const NOT_ADMIN = "No tenés permiso para editar el padrón.";

export function makeRequireAdmin(getSession: GetSession) {
  return async function requireAdmin(): Promise<AdminActor> {
    const session = await getSession();
    const id = session?.user?.id;
    if (!id) return { ok: false, error: NO_SESSION };
    if (!isAdmin(session?.user?.roles)) return { ok: false, error: NOT_ADMIN };
    // Un id no numérico en el token no puede convertirse en NaN silencioso:
    // NaN como actorId iría a parar a la auditoría y a los FKs.
    const actorId = Number(id);
    if (!Number.isInteger(actorId) || actorId <= 0) return { ok: false, error: NO_SESSION };
    return { ok: true, actorId };
  };
}

/**
 * Versión ligada a la sesión real. El `import()` es dinámico a propósito: "@/auth"
 * arrastra NextAuth y Prisma, y este módulo lo importan también los tests.
 */
export async function requireAdmin(): Promise<AdminActor> {
  const { auth } = await import("@/auth");
  return makeRequireAdmin(auth)();
}
