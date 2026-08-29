import { describe, expect, it, vi } from "vitest";
// `makeTokens` importa `@/lib/prisma` para su versión ligada: se mockea para
// que el test puro no exija DATABASE_URL.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeFakeUsersDb } from "./helpers/fake-users-db";
import { hashToken } from "@/lib/tokens";
import { ADMIN_REDEEM_ERRORS, makeAdminAccess } from "@/lib/users/admin-access";

const OLD_HASH = "$2b$12$XHfiAzolMFmdVT8v4PxyjuE0zE.lYU0I3W.1mn8IuVLg6LFDwN1QS";
const NOW = new Date("2026-08-29T12:00:00Z");
const IN_7_DAYS = new Date("2026-09-05T12:00:00Z");

/** El doble implementa SOLO los métodos que el dominio usa; el módulo se tipa
 *  con los delegates completos de Prisma. Mismo cast que `users-service.test.ts`:
 *  apaga al compilador, no a la verificación (el doble sigue tirando ante un
 *  `where` que no sabe honrar). */
function asDb(db: ReturnType<typeof makeFakeUsersDb>) {
  return db as unknown as Parameters<typeof makeAdminAccess>[0];
}

function seeded(opts?: { active?: boolean }) {
  const db = makeFakeUsersDb({
    users: [{
      id: 9, email: "invitada@x.com", passwordHash: OLD_HASH, passwordChangedAt: null,
      name: "Invitada", active: opts?.active ?? true, lastLoginAt: null,
    }],
    userRoles: [{ userId: 9, roleId: 2 }],
    actionTokens: [
      { id: 1, purpose: "admin_invitation", tokenHash: hashToken("raw-1"), memberId: null,
        applicationId: null, userId: 9, expiresAt: IN_7_DAYS, usedAt: null, createdAt: NOW },
      // una segunda invitación paralela viva, para verificar que el canje revoca
      { id: 2, purpose: "admin_invitation", tokenHash: hashToken("raw-2"), memberId: null,
        applicationId: null, userId: 9, expiresAt: IN_7_DAYS, usedAt: null, createdAt: NOW },
    ],
  });
  return { db, access: makeAdminAccess(asDb(db)) };
}

describe("redeemInvitation", () => {
  it("escribe hash + passwordChangedAt y revoca las invitaciones paralelas", async () => {
    const { db, access } = seeded();
    const res = await access.redeemInvitation("raw-1", "$2b$12$nuevo", NOW);
    expect(res).toEqual({ ok: true, userId: 9 });
    const u = db.state.users[0];
    expect(u.passwordHash).toBe("$2b$12$nuevo");
    expect(u.passwordChangedAt).toEqual(NOW);
    // el consumido queda como rastro (usedAt), el paralelo se borra
    expect(db.state.actionTokens.find((t) => t.id === 1)?.usedAt).toEqual(NOW);
    expect(db.state.actionTokens.find((t) => t.id === 2)).toBeUndefined();
  });

  it("el segundo POST con el mismo token pierde", async () => {
    const { access } = seeded();
    await access.redeemInvitation("raw-1", "$2b$12$nuevo", NOW);
    const again = await access.redeemInvitation("raw-1", "$2b$12$otro", NOW);
    expect(again).toEqual({ ok: false, error: ADMIN_REDEEM_ERRORS.dead });
  });

  it("token vencido o inventado → dead", async () => {
    const { access } = seeded();
    expect(await access.redeemInvitation("inventado", "$2b$12$x", NOW))
      .toEqual({ ok: false, error: ADMIN_REDEEM_ERRORS.dead });
    expect(await access.redeemInvitation("raw-1", "$2b$12$x", new Date("2026-10-01T00:00:00Z")))
      .toEqual({ ok: false, error: ADMIN_REDEEM_ERRORS.dead });
  });

  it("cuenta desactivada: rechaza SIN quemar el enlace (rollback)", async () => {
    const { db, access } = seeded({ active: false });
    const res = await access.redeemInvitation("raw-1", "$2b$12$x", NOW);
    expect(res).toEqual({ ok: false, error: ADMIN_REDEEM_ERRORS.disabled });
    // el rollback conserva el token vivo: si el superadmin reactiva la cuenta,
    // el enlace del buzón sigue sirviendo.
    expect(db.state.actionTokens.find((t) => t.id === 1)?.usedAt).toBeNull();
    expect(db.state.users[0].passwordHash).toBe(OLD_HASH);
  });
});
