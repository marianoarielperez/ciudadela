import { describe, expect, it } from "vitest";
import { isSuperadmin } from "@/lib/auth/roles";
import { makeRequireSuperadmin } from "@/lib/auth/require-admin";

const account = (roles: string[]) => async () => ({
  active: true,
  roles,
  passwordChangedAt: null,
});
const session = (roles: string[]) => async () => ({
  user: { id: "7", roles, authAt: Date.now() },
});

describe("isSuperadmin", () => {
  it("solo superadmin pasa", () => {
    expect(isSuperadmin(["superadmin"])).toBe(true);
    expect(isSuperadmin(["admin"])).toBe(false);
    expect(isSuperadmin(["admin", "socio"])).toBe(false);
    expect(isSuperadmin(null)).toBe(false);
  });
});

describe("makeRequireSuperadmin", () => {
  it("acepta superadmin con fila viva superadmin", async () => {
    const guard = makeRequireSuperadmin(
      session(["superadmin", "admin"]),
      account(["superadmin", "admin"]),
    );
    const r = await guard();
    expect(r).toEqual({ ok: true, actorId: 7 });
  });

  it("rechaza a un admin común aunque el token lo diga", async () => {
    const guard = makeRequireSuperadmin(session(["admin"]), account(["admin"]));
    const r = await guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_admin");
  });

  it("el token puede quitar pero nunca dar: fila viva superadmin con token admin se rechaza sin tocar la base", async () => {
    let dbCalled = false;
    const lookup = async () => {
      dbCalled = true;
      return { active: true, roles: ["superadmin"], passwordChangedAt: null };
    };
    const guard = makeRequireSuperadmin(session(["admin"]), lookup);
    const r = await guard();
    expect(r.ok).toBe(false);
    expect(dbCalled).toBe(false);
  });

  it("rechaza si la fila viva ya no es superadmin (revocación)", async () => {
    const guard = makeRequireSuperadmin(session(["superadmin"]), account(["admin"]));
    const r = await guard();
    expect(r.ok).toBe(false);
  });

  it("rechaza cuenta deshabilitada", async () => {
    const guard = makeRequireSuperadmin(session(["superadmin"]), async () => ({
      active: false,
      roles: ["superadmin"],
      passwordChangedAt: null,
    }));
    const r = await guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
  });
});
