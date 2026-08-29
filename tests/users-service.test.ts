import { describe, expect, it, vi } from "vitest";
// `makeTokens` importa `@/lib/prisma` para su versión ligada: se mockea para
// que el test puro no exija DATABASE_URL.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeFakeUsersDb } from "./helpers/fake-users-db";
import { makeUserAdminService, USER_GUARD_MESSAGES } from "@/lib/users/service";

const HASH = "$2b$12$XHfiAzolMFmdVT8v4PxyjuE0zE.lYU0I3W.1mn8IuVLg6LFDwN1QS";

/** El doble implementa SOLO los métodos que el dominio usa; el servicio se tipa
 *  con los delegates completos de Prisma. El cast es el mismo que documentó la
 *  Task 3, y por eso el doble tira ante un `where` que no sabe honrar: el cast
 *  apaga al compilador, no a la verificación. */
function asDb(db: ReturnType<typeof makeFakeUsersDb>) {
  return db as unknown as Parameters<typeof makeUserAdminService>[0];
}

function seeded() {
  const db = makeFakeUsersDb({
    users: [
      { id: 1, email: "root@x.com", passwordHash: HASH, passwordChangedAt: new Date(), name: "Root", active: true, lastLoginAt: null },
      { id: 2, email: "ana@x.com", passwordHash: HASH, passwordChangedAt: new Date(), name: "Ana", active: true, lastLoginAt: null },
      { id: 3, email: "socio@x.com", passwordHash: HASH, passwordChangedAt: new Date(), name: "Socio", active: true, lastLoginAt: null },
    ],
    // 1 = superadmin+admin, 2 = admin, 3 = socio
    userRoles: [
      { userId: 1, roleId: 1 }, { userId: 1, roleId: 2 },
      { userId: 2, roleId: 2 }, { userId: 3, roleId: 3 },
    ],
    members: [{ id: 50, email: "socio@x.com", userId: 3 }, { id: 51, email: "sin-cuenta@x.com", userId: null }],
  });
  return { db, service: makeUserAdminService(asDb(db)) };
}

describe("createManagedUser", () => {
  it("crea la cuenta con rol admin y una invitación admin_invitation viva", async () => {
    const { db, service } = seeded();
    const res = await service.createManagedUser({ email: "Nueva@X.com", name: "Nueva", passwordHash: HASH });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const u = db.state.users.find((x) => x.id === res.userId)!;
    expect(u.email).toBe("nueva@x.com"); // normalizado como verify-credentials
    expect(u.passwordChangedAt).toBeNull();
    expect(db.state.userRoles.some((ur) => ur.userId === res.userId && ur.roleId === 2)).toBe(true);
    const t = db.state.actionTokens.find((x) => x.userId === res.userId)!;
    expect(t.purpose).toBe("admin_invitation");
    expect(res.rawToken.length).toBeGreaterThan(20);
  });

  it("rechaza un email que ya tiene cuenta", async () => {
    const { service } = seeded();
    const res = await service.createManagedUser({ email: "ana@x.com", name: "Otra", passwordHash: HASH });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.emailTaken });
  });

  it("rechaza el email de la ficha de un socio (con o sin cuenta)", async () => {
    const { service } = seeded();
    const res = await service.createManagedUser({ email: "sin-cuenta@x.com", name: "X", passwordHash: HASH });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.memberCardEmail });
  });
});

describe("updateManagedUser", () => {
  it("edita nombre y email de una cuenta sin socio, revocando los tokens vivos", async () => {
    const { db, service } = seeded();
    const created = await service.createManagedUser({ email: "temp@x.com", name: "Temp", passwordHash: HASH });
    if (!created.ok) throw new Error("seed");
    const res = await service.updateManagedUser({ targetId: created.userId, name: "Temp 2", email: "temp2@x.com" });
    expect(res.ok).toBe(true);
    const u = db.state.users.find((x) => x.id === created.userId)!;
    expect(u.email).toBe("temp2@x.com");
    // el cambio de email mata la invitación emitida hacia la casilla anterior
    expect(db.state.actionTokens.filter((t) => t.userId === created.userId && t.usedAt === null)).toHaveLength(0);
  });

  it("no toca el email de una cuenta con socio vinculado", async () => {
    const { service } = seeded();
    const res = await service.updateManagedUser({ targetId: 3, name: "Socio", email: "otro@x.com" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.memberEmail });
  });

  it("traduce la colisión de unique a su mensaje", async () => {
    const { service } = seeded();
    const created = await service.createManagedUser({ email: "temp@x.com", name: "Temp", passwordHash: HASH });
    if (!created.ok) throw new Error("seed");
    const res = await service.updateManagedUser({ targetId: created.userId, name: "Temp", email: "ana@x.com" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.emailTaken });
  });
});

describe("invitaciones", () => {
  it("resend revoca la anterior y emite una nueva", async () => {
    const { db, service } = seeded();
    const created = await service.createManagedUser({ email: "temp@x.com", name: "Temp", passwordHash: HASH });
    if (!created.ok) throw new Error("seed");
    const res = await service.resendInvitation({ targetId: created.userId });
    expect(res.ok).toBe(true);
    const live = db.state.actionTokens.filter((t) => t.userId === created.userId && t.usedAt === null);
    expect(live).toHaveLength(1);
  });

  it("resend rechaza una cuenta que ya creó su contraseña", async () => {
    const { service } = seeded();
    const res = await service.resendInvitation({ targetId: 2 });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.alreadyRedeemed });
  });

  it("revoke borra la invitación viva y rechaza si no hay ninguna", async () => {
    const { db, service } = seeded();
    const created = await service.createManagedUser({ email: "temp@x.com", name: "Temp", passwordHash: HASH });
    if (!created.ok) throw new Error("seed");
    expect((await service.revokeInvitation({ targetId: created.userId })).ok).toBe(true);
    expect(db.state.actionTokens.filter((t) => t.userId === created.userId && t.usedAt === null)).toHaveLength(0);
    const again = await service.revokeInvitation({ targetId: created.userId });
    expect(again).toEqual({ ok: false, error: USER_GUARD_MESSAGES.noInvitation });
  });
});

describe("grantRole", () => {
  it("otorga admin a una cuenta de socio (roles acumulables)", async () => {
    const { db, service } = seeded();
    const res = await service.grantRole({ actorId: 1, targetId: 3, role: "admin" });
    expect(res.ok).toBe(true);
    expect(db.state.userRoles.some((ur) => ur.userId === 3 && ur.roleId === 2)).toBe(true);
    // el rol socio sigue ahí: otorgar no pisa nada
    expect(db.state.userRoles.some((ur) => ur.userId === 3 && ur.roleId === 3)).toBe(true);
  });

  it("rechaza otorgar un rol que ya tiene", async () => {
    const { service } = seeded();
    const res = await service.grantRole({ actorId: 1, targetId: 2, role: "admin" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.alreadyHasRole });
  });
});

describe("revokeRole", () => {
  it("quita admin y deja el resto de los roles intactos", async () => {
    const { db, service } = seeded();
    await service.grantRole({ actorId: 1, targetId: 3, role: "admin" });
    const res = await service.revokeRole({ actorId: 1, targetId: 3, role: "admin" });
    expect(res.ok).toBe(true);
    expect(db.state.userRoles.some((ur) => ur.userId === 3 && ur.roleId === 2)).toBe(false);
    expect(db.state.userRoles.some((ur) => ur.userId === 3 && ur.roleId === 3)).toBe(true);
  });

  it("el superadmin no puede quitarse su propio superadmin", async () => {
    const { service } = seeded();
    const res = await service.revokeRole({ actorId: 1, targetId: 1, role: "superadmin" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.selfSuperadmin });
  });

  it("quitar el ÚLTIMO superadmin activo hace rollback y no escribe nada", async () => {
    const { db, service } = seeded();
    // el actor 2 (admin) le quita superadmin al 1, que es el único: la
    // autorización de rol del ACTOR es de la action (requireSuperadminUsers);
    // acá se prueba la guarda del dominio con actorId ≠ targetId.
    const res = await service.revokeRole({ actorId: 2, targetId: 1, role: "superadmin" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.lastSuperadmin });
    // ROLLBACK: la fila del rol sigue en la base
    expect(db.state.userRoles.some((ur) => ur.userId === 1 && ur.roleId === 1)).toBe(true);
  });

  it("con DOS superadmins activos, quitarle el rol a uno sí pasa", async () => {
    const { db, service } = seeded();
    await service.grantRole({ actorId: 1, targetId: 2, role: "superadmin" });
    const res = await service.revokeRole({ actorId: 2, targetId: 1, role: "superadmin" });
    expect(res.ok).toBe(true);
    expect(db.state.userRoles.some((ur) => ur.userId === 1 && ur.roleId === 1)).toBe(false);
  });

  it("un superadmin DESACTIVADO no cuenta para la guarda", async () => {
    const { service } = seeded();
    await service.grantRole({ actorId: 1, targetId: 2, role: "superadmin" });
    // Este paso tiene que PASAR: con el 1 todavía activo quedaba un superadmin.
    // Se asevera para que el test no pueda pasar por un conteo cero accidental
    // —si `activeSuperadmins` midiera siempre 0, la baja del 2 se rechazaría y
    // el `lastSuperadmin` de abajo llegaría por el motivo equivocado—.
    expect((await service.setUserActive({ actorId: 1, targetId: 2, active: false })).ok).toBe(true);
    // el 2 quedó superadmin pero inactivo: el 1 vuelve a ser el último ACTIVO
    const res = await service.revokeRole({ actorId: 2, targetId: 1, role: "superadmin" });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.lastSuperadmin });
  });
});

describe("setUserActive", () => {
  it("no permite desactivarse a sí mismo", async () => {
    const { service } = seeded();
    const res = await service.setUserActive({ actorId: 1, targetId: 1, active: false });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.selfDisable });
  });

  it("no toca cuentas de socios puros", async () => {
    const { service } = seeded();
    const res = await service.setUserActive({ actorId: 1, targetId: 3, active: false });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.notManaged });
  });

  it("desactivar al último superadmin activo hace rollback", async () => {
    const { db, service } = seeded();
    const res = await service.setUserActive({ actorId: 2, targetId: 1, active: false });
    expect(res).toEqual({ ok: false, error: USER_GUARD_MESSAGES.lastSuperadmin });
    expect(db.state.users.find((u) => u.id === 1)!.active).toBe(true); // rollback
  });

  it("desactiva y reactiva una cuenta admin común", async () => {
    const { db, service } = seeded();
    expect((await service.setUserActive({ actorId: 1, targetId: 2, active: false })).ok).toBe(true);
    expect(db.state.users.find((u) => u.id === 2)!.active).toBe(false);
    expect((await service.setUserActive({ actorId: 1, targetId: 2, active: true })).ok).toBe(true);
    const noChange = await service.setUserActive({ actorId: 1, targetId: 2, active: true });
    expect(noChange).toEqual({ ok: false, error: USER_GUARD_MESSAGES.noChange });
  });
});
