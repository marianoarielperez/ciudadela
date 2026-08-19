import { describe, expect, it, vi } from "vitest";
import { ADMIN_BLOCKED, makeRequireAdmin } from "@/lib/auth/require-admin";
import { STALE_SESSION_MESSAGE } from "@/lib/auth/session-freshness";

type SessionLike = {
  user?: { id?: string | null; roles?: string[] | null; authAt?: number | null } | null;
} | null;
type Account = { active: boolean; roles: string[]; passwordChangedAt: Date | null };

// Momento en que se abrió la sesión de referencia, en segundos epoch.
const AUTH_AT = Math.floor(Date.parse("2026-08-19T10:00:00Z") / 1000);

/** Liga el helper a una sesión y a una cuenta fijas, sin NextAuth ni base.
 *
 *  Por defecto la cuenta viva coincide con lo que dice el token (habilitada y
 *  con los mismos roles): así los casos que sólo miran el token se leen igual
 *  que antes, y los que prueban la divergencia la declaran explícitamente. */
function bind(sessionLike: SessionLike, account?: Account | null) {
  const fallback: Account = {
    active: true,
    roles: sessionLike?.user?.roles ?? [],
    passwordChangedAt: null,
  };
  const lookup = vi.fn(async () => (account === undefined ? fallback : account));
  return { run: makeRequireAdmin(async () => sessionLike, lookup), lookup };
}

function withSession(sessionLike: SessionLike) {
  return bind(sessionLike).run;
}

function session(id: string, roles: string[], authAt: number | null = AUTH_AT): SessionLike {
  return { user: { id, roles, authAt } };
}

describe("requireAdmin", () => {
  it("rejects an anonymous visitor", async () => {
    expect(await withSession(null)()).toEqual({
      ok: false, reason: "anonymous", error: ADMIN_BLOCKED.anonymous,
    });
    expect(await withSession({ user: null })()).toEqual({
      ok: false, reason: "anonymous", error: ADMIN_BLOCKED.anonymous,
    });
  });

  // El agujero que motivó este helper: `socio.prueba@sigev.local` está en la base
  // y podía invocar las actions del panel por el encabezado Next-Action.
  it("rejects an authenticated member with only the socio role", async () => {
    expect(await withSession(session("3", ["socio"]))()).toEqual({
      ok: false, reason: "not_admin", error: ADMIN_BLOCKED.not_admin,
    });
  });

  it("rejects a session with no roles at all", async () => {
    expect(await withSession(session("3", []))()).toMatchObject({ ok: false, reason: "not_admin" });
    expect(await withSession({ user: { id: "3" } })()).toMatchObject({
      ok: false, reason: "not_admin",
    });
  });

  it("accepts admin", async () => {
    expect(await withSession(session("1", ["admin"]))()).toEqual({ ok: true, actorId: 1 });
  });

  it("accepts superadmin", async () => {
    expect(await withSession(session("2", ["superadmin"]))()).toEqual({ ok: true, actorId: 2 });
  });

  // Roles acumulables (docs/03): ser socio no le quita el panel a un admin.
  it("accepts accumulated roles", async () => {
    expect(await withSession(session("4", ["socio", "admin"]))()).toEqual({ ok: true, actorId: 4 });
    expect(await withSession(session("5", ["socio", "superadmin"]))()).toEqual({ ok: true, actorId: 5 });
  });

  it("does not fall for a lookalike role name", async () => {
    expect(await withSession(session("6", ["administrativo", "Admin"]))()).toMatchObject({
      ok: false, reason: "not_admin",
    });
  });

  // Un id no numérico se volvería NaN y viajaría a audit_log y a los FKs.
  it("rejects a session whose id is not a positive integer", async () => {
    for (const id of ["", "abc", "0", "-1", "1.5"]) {
      expect(await withSession(session(id, ["admin"]))()).toMatchObject({
        ok: false, reason: "anonymous", error: ADMIN_BLOCKED.anonymous,
      });
    }
  });

  it("re-reads the session on every call", async () => {
    let roles = ["admin"];
    const requireAdmin = makeRequireAdmin(
      async () => ({ user: { id: "1", roles, authAt: AUTH_AT } }),
      async () => ({ active: true, roles, passwordChangedAt: null }),
    );
    expect(await requireAdmin()).toEqual({ ok: true, actorId: 1 });
    roles = ["socio"];
    expect((await requireAdmin()).ok).toBe(false);
  });
});

// Lo que el token dice ya no alcanza: la sesión es un JWT de 8 horas sin estado
// en la base, así que el "admin" que se emitió al entrar sobrevive intacto a
// todo lo que pase después con la cuenta.
describe("requireAdmin — la fila viva manda sobre el token", () => {
  it("rejects an admin whose role was revoked after the token was issued", async () => {
    const { run } = bind(session("1", ["admin"]), {
      active: true, roles: ["socio"], passwordChangedAt: null,
    });
    expect(await run()).toEqual({ ok: false, reason: "not_admin", error: ADMIN_BLOCKED.not_admin });
  });

  it("rejects an admin whose account was disabled", async () => {
    const { run } = bind(session("1", ["admin"]), {
      active: false, roles: ["admin"], passwordChangedAt: null,
    });
    expect(await run()).toEqual({ ok: false, reason: "disabled", error: ADMIN_BLOCKED.disabled });
  });

  it("rejects an account that no longer exists", async () => {
    const { run } = bind(session("1", ["admin"]), null);
    expect(await run()).toMatchObject({ ok: false, reason: "not_admin" });
  });

  // El token no puede DAR el permiso, pero sigue pudiendo quitarlo — y ese
  // rechazo es gratis: no se consulta la base.
  it("rejects a non admin token without touching the database", async () => {
    const { run, lookup } = bind(session("3", ["socio"]), {
      active: true, roles: ["admin"], passwordChangedAt: null,
    });
    expect(await run()).toMatchObject({ ok: false, reason: "not_admin" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not touch the database for an anonymous visitor either", async () => {
    const { run, lookup } = bind(null);
    await run();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("looks the account up by the session user id", async () => {
    const { run, lookup } = bind(session("42", ["admin"]));
    await run();
    expect(lookup).toHaveBeenCalledWith(42);
  });
});

// El hueco de las sesiones vivas: cambiar la contraseña tiene que echar al
// intruso que entró con la vieja.
describe("requireAdmin — sesiones anteriores al cambio de contraseña", () => {
  const changedAfter = new Date((AUTH_AT + 60) * 1000);
  const changedBefore = new Date((AUTH_AT - 60) * 1000);

  it("rejects a session opened before the password changed", async () => {
    const { run } = bind(session("1", ["admin"]), {
      active: true, roles: ["admin"], passwordChangedAt: changedAfter,
    });
    expect(await run()).toEqual({
      ok: false, reason: "stale_session", error: STALE_SESSION_MESSAGE,
    });
  });

  it("accepts the session opened after the change", async () => {
    const { run } = bind(session("1", ["admin"]), {
      active: true, roles: ["admin"], passwordChangedAt: changedBefore,
    });
    expect(await run()).toEqual({ ok: true, actorId: 1 });
  });

  // Falla cerrada: un token emitido antes de que existiera el claim no puede
  // probar que es posterior al cambio.
  it("rejects a token with no authAt once the account has a password change", async () => {
    const { run } = bind(session("1", ["admin"], null), {
      active: true, roles: ["admin"], passwordChangedAt: changedBefore,
    });
    expect(await run()).toMatchObject({ ok: false, reason: "stale_session" });
  });

  // …pero una cuenta sin cambios asentados (todas las filas previas a la
  // migración) no echa a nadie por no saber.
  it("keeps a token with no authAt when the account never changed its password", async () => {
    const { run } = bind(session("1", ["admin"], null), {
      active: true, roles: ["admin"], passwordChangedAt: null,
    });
    expect(await run()).toEqual({ ok: true, actorId: 1 });
  });
});
