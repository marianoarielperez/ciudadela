import { describe, expect, it } from "vitest";
import { makeFakeUsersDb, type FakeState } from "./helpers/fake-users-db";
import { uniqueViolationTarget } from "@/lib/treasury/unique-violation";

// Tests DEL DOBLE, no del dominio. El doble va a sostener las guardas de
// seguridad del módulo de usuarios ("el superadmin no se quita su propio rol",
// "nunca cero superadmins activos", "no se desactiva la propia cuenta"), y un
// doble que miente hace pasar el test de una guarda rota. Acá se fijan sus dos
// garantías fundacionales —HONRA el `where` que recibe y emula ROLLBACK— y el
// corolario: ante una forma que no implementa, TIRA en vez de devolver 0 o null.

const seed: Partial<FakeState> = {
  users: [
    { id: 1, email: "sa@x.ar", passwordHash: "h", passwordChangedAt: null, name: "Super", active: true, lastLoginAt: null },
    { id: 2, email: "sa2@x.ar", passwordHash: "h", passwordChangedAt: null, name: "Super 2", active: true, lastLoginAt: null },
    { id: 3, email: "off@x.ar", passwordHash: "h", passwordChangedAt: null, name: "Inactivo", active: false, lastLoginAt: null },
  ],
  userRoles: [
    { userId: 1, roleId: 1 },
    { userId: 2, roleId: 1 },
    { userId: 3, roleId: 1 },
    { userId: 2, roleId: 2 },
  ],
  members: [
    { id: 10, email: "socio@x.ar", userId: 99 }, // ya vinculado a un usuario
    { id: 11, email: "libre@x.ar", userId: null },
  ],
};

const db = () => makeFakeUsersDb(structuredClone(seed));
/** Doble sin una sola fila: el `where` tiene que validarse igual. */
const empty = () => makeFakeUsersDb({ users: [], userRoles: [], members: [], actionTokens: [] });

describe("fake-users-db: rollback", () => {
  it("restaura las filas creadas cuando el callback de $transaction tira", async () => {
    const fake = db();
    const before = fake.state.users.length;

    await expect(fake.$transaction(async (tx) => {
      await tx.user.create({ data: { email: "nuevo@x.ar" } });
      await tx.userRole.create({ data: { userId: 1, roleId: 3 } });
      throw new Error("boom");
    })).rejects.toThrow("boom");

    expect(fake.state.users).toHaveLength(before);
    expect(fake.state.users.some((u) => u.email === "nuevo@x.ar")).toBe(false);
    expect(fake.state.userRoles.some((ur) => ur.userId === 1 && ur.roleId === 3)).toBe(false);
  });

  it("deshace también las escrituras sobre filas existentes", async () => {
    const fake = db();

    await expect(fake.$transaction(async (tx) => {
      await tx.user.update({ where: { id: 1 }, data: { active: false } });
      await tx.userRole.deleteMany({ where: { userId: 1 } });
      throw new Error("boom");
    })).rejects.toThrow("boom");

    expect(fake.state.users.find((u) => u.id === 1)!.active).toBe(true);
    expect(fake.state.userRoles.filter((ur) => ur.userId === 1)).toHaveLength(1);
  });

  it("conserva lo escrito cuando el callback termina bien", async () => {
    const fake = db();
    await fake.$transaction(async (tx) => {
      await tx.user.update({ where: { id: 1 }, data: { name: "Cambiado" } });
    });
    expect(fake.state.users.find((u) => u.id === 1)!.name).toBe("Cambiado");
  });
});

describe("fake-users-db: una clave de where desconocida TIRA, con la tabla vacía", () => {
  // Con la tabla vacía es donde importa: validando por fila, un filtro no
  // soportado devolvería 0 (o null) en silencio y el test de una guarda pasaría
  // por el motivo equivocado.
  it("user.count", async () => {
    await expect(empty().user.count({ where: { nombre: "x" } })).rejects.toThrow(/user where no soportado: nombre/);
  });
  it("user.findUnique", async () => {
    await expect(empty().user.findUnique({ where: { active: true } as never })).rejects.toThrow(/findUnique where no soportado: active/);
  });
  it("user.findUnique sin id ni email", async () => {
    await expect(empty().user.findUnique({ where: {} })).rejects.toThrow(/sin id ni email/);
  });
  it("userRole.count", async () => {
    await expect(empty().userRole.count({ where: { roleId: 1 } })).rejects.toThrow(/userRole where no soportado: roleId/);
  });
  it("userRole.deleteMany", async () => {
    await expect(empty().userRole.deleteMany({ where: { roleId: 1 } })).rejects.toThrow(/userRole where no soportado: roleId/);
  });
  it("userRole where user.<campo>", async () => {
    await expect(empty().userRole.count({ where: { user: { email: "x" } } })).rejects.toThrow(/user\.email no soportado/);
  });
  it("member.findFirst", async () => {
    await expect(empty().member.findFirst({ where: { dni: "1" } })).rejects.toThrow(/member where no soportado: dni/);
  });
  it("actionToken.deleteMany", async () => {
    await expect(empty().actionToken.deleteMany({ where: { expiresAt: null } })).rejects.toThrow(/actionToken where no soportado: expiresAt/);
  });
  it("role.name con una forma que no es string ni { in }", async () => {
    await expect(empty().userRole.count({ where: { role: { name: { not: "socio" } } } })).rejects.toThrow(/filtro de role\.name no soportado/);
  });
});

describe("fake-users-db: un filtro-objeto sobre un escalar TIRA, no matchea cero", () => {
  // El caso que motiva todo: la guarda "nunca cero superadmins activos" se
  // escribe naturalmente así. Con `===` el doble devolvía 0, la guarda disparaba
  // y el test pasaba CON LA GUARDA ROTA.
  it("userRole.count con userId: { not }", async () => {
    await expect(db().userRole.count({
      where: { userId: { not: 1 }, role: { name: "superadmin" }, user: { active: true } },
    })).rejects.toThrow(/filtro no escalar sobre userId no soportado/);
  });
  it("userRole.count con user.active: { not }", async () => {
    await expect(db().userRole.count({ where: { user: { active: { not: false } } } }))
      .rejects.toThrow(/filtro no escalar sobre user\.active/);
  });
  it("user.count con id: { in }", async () => {
    await expect(db().user.count({ where: { id: { in: [1, 2] } } }))
      .rejects.toThrow(/filtro no escalar sobre id no soportado/);
  });
  it("user.findUnique con email: { equals }", async () => {
    await expect(db().user.findUnique({ where: { email: { equals: "sa@x.ar" } } as never }))
      .rejects.toThrow(/filtro no escalar sobre email no soportado/);
  });
  it("member.findFirst con userId: { not: null }", async () => {
    await expect(db().member.findFirst({ where: { userId: { not: null } } }))
      .rejects.toThrow(/filtro no escalar sobre userId no soportado/);
  });
  it("actionToken.deleteMany con usedAt: { not: null }", async () => {
    await expect(db().actionToken.deleteMany({ where: { usedAt: { not: null } } }))
      .rejects.toThrow(/filtro no escalar sobre usedAt no soportado/);
  });
});

describe("fake-users-db: los where soportados filtran de verdad", () => {
  it("user.count({ where: { active: true } }) no devuelve el total", async () => {
    const fake = db();
    expect(await fake.user.count()).toBe(3);
    expect(await fake.user.count({ where: { active: true } })).toBe(2);
    expect(await fake.user.count({ where: { active: false } })).toBe(1);
    expect(await fake.user.count({ where: { email: "sa@x.ar" } })).toBe(1);
    expect(await fake.user.count({ where: { id: 1, active: false } })).toBe(0);
  });

  it("member.findFirst honra el userId: null y no devuelve un socio ya vinculado", async () => {
    const fake = db();
    expect(await fake.member.findFirst({ where: { email: "socio@x.ar" } })).toMatchObject({ id: 10 });
    // El caso del dominio: "un socio con esta casilla y todavía sin usuario".
    expect(await fake.member.findFirst({ where: { email: "socio@x.ar", userId: null } })).toBeNull();
    expect(await fake.member.findFirst({ where: { email: "libre@x.ar", userId: null } })).toMatchObject({ id: 11 });
  });

  it("userRole.count cruza rol y estado del usuario", async () => {
    const fake = db();
    expect(await fake.userRole.count({ where: { role: { name: "superadmin" } } })).toBe(3);
    expect(await fake.userRole.count({
      where: { role: { name: "superadmin" }, user: { active: true } },
    })).toBe(2);
    expect(await fake.userRole.count({ where: { userId: 2, role: { name: { in: ["admin"] } } } })).toBe(1);
  });
});

describe("fake-users-db: escrituras", () => {
  it("el P2002 de email duplicado lo lee el lector real del proyecto", async () => {
    const fake = db();
    const e = await fake.user.create({ data: { email: "sa@x.ar" } }).catch((err: unknown) => err);
    expect(uniqueViolationTarget(e)).toBe("users_email_key");
    // Y el update por email ajeno también.
    const e2 = await fake.user.update({ where: { id: 2 }, data: { email: "sa@x.ar" } }).catch((err: unknown) => err);
    expect(uniqueViolationTarget(e2)).toBe("users_email_key");
  });

  it("userRole.create enforcea la clave compuesta (userId, roleId)", async () => {
    const fake = db();
    const e = await fake.userRole.create({ data: { userId: 1, roleId: 1 } }).catch((err: unknown) => err);
    expect(uniqueViolationTarget(e)).toBe("PRIMARY");
    expect(fake.state.userRoles.filter((ur) => ur.userId === 1 && ur.roleId === 1)).toHaveLength(1);
  });

  it("user.create tira ante un write anidado en vez de perderlo", async () => {
    const fake = db();
    await expect(fake.user.create({
      data: { email: "n@x.ar", roles: { create: [{ roleId: 1 }] } },
    })).rejects.toThrow(/data\.roles no soportado/);
    expect(fake.state.users.some((u) => u.email === "n@x.ar")).toBe(false);
    expect(fake.state.userRoles).toHaveLength(seed.userRoles!.length);
  });

  it("user.update tira ante un write anidado en vez de escribir basura sobre la fila", async () => {
    const fake = db();
    await expect(fake.user.update({
      where: { id: 1 }, data: { roles: { deleteMany: {} } },
    })).rejects.toThrow(/data\.roles anidado no soportado/);
    expect(fake.state.users.find((u) => u.id === 1)).not.toHaveProperty("roles");
    expect(fake.state.userRoles.filter((ur) => ur.userId === 1)).toHaveLength(1);
  });

  it("user.update escribe escalares, null y Date", async () => {
    const fake = db();
    const when = new Date("2026-08-29T12:00:00Z");
    const u = await fake.user.update({
      where: { id: 1 }, data: { name: null, active: false, passwordChangedAt: when },
    });
    expect(u).toMatchObject({ name: null, active: false, passwordChangedAt: when });
  });

  it("role.findUnique devuelve una copia: mutarla no corrompe el seed", async () => {
    const fake = db();
    const r = (await fake.role.findUnique({ where: { name: "superadmin" } }))!;
    r.name = "roto";
    expect((await fake.role.findUnique({ where: { name: "superadmin" } }))!.id).toBe(1);
  });
});
