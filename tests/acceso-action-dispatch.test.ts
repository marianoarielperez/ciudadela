import { describe, expect, it, vi, beforeEach } from "vitest";

// /acceso/[token] es UNA página anónima con DOS circuitos detrás: la invitación
// del socio (`password_invitation`, en producción hace tiempo) y la de una
// cuenta de gestión (`admin_invitation`, nueva). El despacho lo decide un `peek`
// barato antes del bcrypt, y hasta acá no lo miraba ningún test: `redeem-pages`
// sólo fija los copys y el `select`, y la suite de `member-access` prueba
// `memberAccess.createPassword`, no la ruta. Lo que este archivo cierra es que
// un refactor de esas 20 líneas no pueda mandar un token de socio a la rama
// admin —ni al revés— sin ponerse en rojo.
const memberMock = vi.hoisted(() => ({ createPassword: vi.fn() }));
const adminMock = vi.hoisted(() => ({ redeemInvitation: vi.fn() }));
const peek = vi.hoisted(() => vi.fn());
// El `redirect` real señaliza con una EXCEPCIÓN, y la action se apoya en eso:
// después del `redirect` de la rama admin no hay `return`, así que un doble
// mudo dejaría seguir hasta `memberAccess.createPassword`. El doble tiene que
// tirar igual que el de verdad.
class RedirectSignal extends Error {
  constructor(readonly to: string) { super(`NEXT_REDIRECT:${to}`); }
}

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/tokens", () => ({ tokens: { peek } }));
vi.mock("@/lib/members/access", async (importOriginal) => ({
  // Los textos (`ACCESS_ERRORS`) son los de verdad: si cambian, este test los
  // sigue sin quedar fijando una copia.
  ...(await importOriginal<typeof import("@/lib/members/access")>()),
  memberAccess: memberMock,
}));
vi.mock("@/lib/users/admin-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/users/admin-access")>()),
  makeAdminAccess: () => adminMock,
}));
// bcrypt real son ~300 ms por caso y no aporta nada acá: lo que se prueba es a
// quién se llama, no el hash.
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "HASH") } }));
vi.mock("@/lib/auth/rate-limiter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/rate-limiter")>()),
  publicTokenLimiter: { check: () => true },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => { throw new RedirectSignal(to); }),
}));

import { audit } from "@/lib/audit";
import { ACCESS_ERRORS } from "@/lib/members/access";
import { createPasswordAction } from "@/app/(public)/acceso/[token]/actions";

/** El formulario tal cual lo manda la página: token + contraseña repetida. */
function form(token: string): FormData {
  const f = new FormData();
  f.set("token", token);
  f.set("password", "unaClaveLarga1");
  f.set("confirm", "unaClaveLarga1");
  return f;
}

/** Corre la action tolerando el `redirect`, que en el camino feliz siempre
 *  tira. Devuelve el estado sólo cuando la action volvió con un error. */
async function run(token: string): Promise<{ error?: string } | "redirected"> {
  try {
    return await createPasswordAction({}, form(token));
  } catch (e) {
    if (e instanceof RedirectSignal) return "redirected";
    throw e;
  }
}

/** El `peek` de verdad devuelve la fila del token sólo para SU propósito. */
function tokenOfPurpose(purpose: string | null) {
  peek.mockImplementation(async (_raw: string, p: string) =>
    p === purpose ? { id: 1, purpose } : null);
}

beforeEach(() => {
  vi.mocked(audit).mockClear();
  memberMock.createPassword.mockReset();
  adminMock.redeemInvitation.mockReset();
  peek.mockReset();
});

describe("despacho de /acceso/[token]", () => {
  it("un token de SOCIO va a memberAccess y nunca a la rama admin", async () => {
    tokenOfPurpose("password_invitation");
    memberMock.createPassword.mockResolvedValue({
      ok: true, userId: 7, memberId: 3, created: true,
    });

    expect(await run("raw-socio")).toBe("redirected");

    expect(memberMock.createPassword).toHaveBeenCalledTimes(1);
    expect(memberMock.createPassword).toHaveBeenCalledWith("raw-socio", "HASH");
    expect(adminMock.redeemInvitation).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, action: "member_user_created", entity: "member", entityId: 3,
    }));
  });

  it("la cuenta de socio que YA existía audita member_password_set", async () => {
    tokenOfPurpose("password_invitation");
    memberMock.createPassword.mockResolvedValue({
      ok: true, userId: 7, memberId: 3, created: false,
    });

    expect(await run("raw-socio")).toBe("redirected");

    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "member_password_set", entity: "member", entityId: 3,
    }));
    expect(adminMock.redeemInvitation).not.toHaveBeenCalled();
  });

  it("un token de GESTIÓN va a adminAccess y nunca a la rama de socios", async () => {
    tokenOfPurpose("admin_invitation");
    adminMock.redeemInvitation.mockResolvedValue({ ok: true, userId: 42 });

    expect(await run("raw-admin")).toBe("redirected");

    expect(adminMock.redeemInvitation).toHaveBeenCalledTimes(1);
    expect(adminMock.redeemInvitation).toHaveBeenCalledWith("raw-admin", "HASH");
    // La rama de socios está EN PRODUCCIÓN: que no se la roce es la mitad del
    // valor de este archivo.
    expect(memberMock.createPassword).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42, action: "admin_password_set", entity: "user", entityId: 42,
    }));
  });

  it("un rechazo del canje admin no cae a la rama de socios", async () => {
    // Sin el `return` del `if (!res.ok)`, un enlace admin rechazado seguiría
    // hasta `memberAccess.createPassword` con el mismo token.
    tokenOfPurpose("admin_invitation");
    adminMock.redeemInvitation.mockResolvedValue({ ok: false, error: "Tu cuenta está deshabilitada." });

    expect(await run("raw-admin")).toEqual({ error: "Tu cuenta está deshabilitada." });
    expect(memberMock.createPassword).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("un token desconocido muere con el texto genérico y no llama a ninguna de las dos", async () => {
    tokenOfPurpose(null);

    expect(await run("raw-basura")).toEqual({ error: ACCESS_ERRORS.dead });
    expect(memberMock.createPassword).not.toHaveBeenCalled();
    expect(adminMock.redeemInvitation).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
