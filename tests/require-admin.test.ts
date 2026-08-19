import { describe, expect, it } from "vitest";
import { makeRequireAdmin } from "@/lib/auth/require-admin";

type SessionLike = { user?: { id?: string | null; roles?: string[] | null } | null } | null;

/** Devuelve el helper ligado a una sesión fija, sin NextAuth ni base. */
function withSession(session: SessionLike) {
  return makeRequireAdmin(async () => session);
}

function session(id: string, roles: string[]): SessionLike {
  return { user: { id, roles } };
}

describe("requireAdmin", () => {
  it("rejects an anonymous visitor", async () => {
    expect(await withSession(null)()).toEqual({ ok: false, error: "Sesión inválida." });
    expect(await withSession({ user: null })()).toEqual({ ok: false, error: "Sesión inválida." });
  });

  // El agujero que motivó este helper: `socio.prueba@sigev.local` está en la base
  // y podía invocar las actions del panel por el encabezado Next-Action.
  it("rejects an authenticated member with only the socio role", async () => {
    expect(await withSession(session("3", ["socio"]))()).toEqual({
      ok: false,
      error: "No tenés permiso para editar el padrón.",
    });
  });

  it("rejects a session with no roles at all", async () => {
    expect(await withSession(session("3", []))()).toEqual({
      ok: false,
      error: "No tenés permiso para editar el padrón.",
    });
    expect(await withSession({ user: { id: "3" } })()).toEqual({
      ok: false,
      error: "No tenés permiso para editar el padrón.",
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
    expect(await withSession(session("6", ["administrativo", "Admin"]))()).toEqual({
      ok: false,
      error: "No tenés permiso para editar el padrón.",
    });
  });

  // Un id no numérico se volvería NaN y viajaría a audit_log y a los FKs.
  it("rejects a session whose id is not a positive integer", async () => {
    for (const id of ["", "abc", "0", "-1", "1.5"]) {
      expect(await withSession(session(id, ["admin"]))()).toEqual({ ok: false, error: "Sesión inválida." });
    }
  });

  it("re-reads the session on every call", async () => {
    let roles = ["admin"];
    const requireAdmin = makeRequireAdmin(async () => ({ user: { id: "1", roles } }));
    expect(await requireAdmin()).toEqual({ ok: true, actorId: 1 });
    roles = ["socio"];
    expect((await requireAdmin()).ok).toBe(false);
  });
});
