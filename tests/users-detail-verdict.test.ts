import { describe, expect, it, vi } from "vitest";
// `detail-verdict` importa `USER_GUARD_MESSAGES` de `service.ts`, que arrastra
// `@/lib/tokens` → `@/lib/prisma`: se mockea para que el test puro no exija
// DATABASE_URL (mismo truco que users-service.test.ts).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { userDetailVerdict, type UserDetailVerdictInput } from "@/lib/users/detail-verdict";
import { USER_GUARD_MESSAGES } from "@/lib/users/service";

const ACTOR = 1;

/** Una cuenta cualquiera: activa, admin, con su contraseña ya creada y sin
 *  invitación pendiente. Cada caso pisa sólo lo que le importa. */
function user(over: Partial<UserDetailVerdictInput> = {}): UserDetailVerdictInput {
  return {
    id: 2,
    active: true,
    roles: ["admin"],
    passwordChangedAt: new Date("2026-08-01T12:00:00Z"),
    invitation: null,
    activeSuperadmins: 2,
    ...over,
  };
}

const liveInvitation = { expiresAt: new Date("2026-09-05T12:00:00Z") };

describe("quitar el rol de superadmin", () => {
  it("el propio superadmin no puede quitarse el rol", () => {
    const v = userDetailVerdict(user({ id: ACTOR, roles: ["superadmin"], activeSuperadmins: 5 }), ACTOR);
    expect(v.revokeSuperadmin).toBe(USER_GUARD_MESSAGES.selfSuperadmin);
  });

  it("el último superadmin activo no puede perder el rol", () => {
    const v = userDetailVerdict(user({ roles: ["superadmin"], activeSuperadmins: 1 }), ACTOR);
    expect(v.revokeSuperadmin).toBe(USER_GUARD_MESSAGES.lastSuperadmin);
  });

  it("con DOS superadmins activos sí se le puede quitar", () => {
    const v = userDetailVerdict(user({ roles: ["superadmin"], activeSuperadmins: 2 }), ACTOR);
    expect(v.revokeSuperadmin).toBeUndefined();
  });

  it("una cuenta sin el rol no tiene motivo de bloqueo (el botón está en modo otorgar)", () => {
    expect(userDetailVerdict(user({ roles: ["admin"] }), ACTOR).revokeSuperadmin).toBeUndefined();
  });

  it("un superadmin YA desactivado no es 'el último': no suma al conteo", () => {
    const v = userDetailVerdict(
      user({ roles: ["superadmin"], active: false, activeSuperadmins: 1 }),
      ACTOR,
    );
    expect(v.revokeSuperadmin).toBeUndefined();
  });
});

describe("quitar el rol de admin", () => {
  it("no tiene guarda propia en el dominio: nunca se bloquea", () => {
    expect(userDetailVerdict(user({ id: ACTOR, roles: ["admin"] }), ACTOR).revokeAdmin).toBeUndefined();
    expect(
      userDetailVerdict(user({ roles: ["admin", "superadmin"], activeSuperadmins: 1 }), ACTOR).revokeAdmin,
    ).toBeUndefined();
  });
});

describe("activar / desactivar la cuenta", () => {
  it("nadie desactiva su propia cuenta", () => {
    expect(userDetailVerdict(user({ id: ACTOR }), ACTOR).setActive)
      .toBe(USER_GUARD_MESSAGES.selfDisable);
  });

  it("el último superadmin activo no puede ser desactivado", () => {
    const v = userDetailVerdict(user({ roles: ["superadmin"], activeSuperadmins: 1 }), ACTOR);
    expect(v.setActive).toBe(USER_GUARD_MESSAGES.lastSuperadmin);
  });

  it("con dos superadmins activos sí se puede desactivar", () => {
    expect(userDetailVerdict(user({ roles: ["superadmin"], activeSuperadmins: 2 }), ACTOR).setActive)
      .toBeUndefined();
  });

  it("reactivar a un superadmin desactivado no tiene guarda", () => {
    const v = userDetailVerdict(
      user({ roles: ["superadmin"], active: false, activeSuperadmins: 0 }),
      ACTOR,
    );
    expect(v.setActive).toBeUndefined();
  });

  it("una cuenta sin roles de gestión no ofrece activar/desactivar", () => {
    expect(userDetailVerdict(user({ roles: ["socio"] }), ACTOR).setActive)
      .toBe(USER_GUARD_MESSAGES.notManaged);
  });
});

describe("editar datos", () => {
  it("una cuenta sin roles de gestión no ofrece editar datos", () => {
    const v = userDetailVerdict(user({ roles: ["socio"] }), ACTOR);
    expect(v.managed).toBe(false);
    expect(v.editData).toBe(USER_GUARD_MESSAGES.notManaged);
  });

  it("una cuenta de gestión sí", () => {
    const v = userDetailVerdict(user({ roles: ["admin"] }), ACTOR);
    expect(v.managed).toBe(true);
    expect(v.editData).toBeUndefined();
  });

  it("una cuenta sin ningún rol tampoco es de gestión", () => {
    expect(userDetailVerdict(user({ roles: [] }), ACTOR).editData)
      .toBe(USER_GUARD_MESSAGES.notManaged);
  });
});

describe("reenviar la invitación", () => {
  it("bloqueado en una cuenta desactivada", () => {
    const v = userDetailVerdict(user({ active: false, passwordChangedAt: null }), ACTOR);
    expect(v.resendInvitation).toBe(USER_GUARD_MESSAGES.inactiveInvitation);
  });

  it("bloqueado en una cuenta que ya creó su contraseña", () => {
    const v = userDetailVerdict(user({ passwordChangedAt: new Date() }), ACTOR);
    expect(v.resendInvitation).toBe(USER_GUARD_MESSAGES.alreadyRedeemed);
  });

  it("habilitado en una cuenta de gestión activa que todavía no la creó", () => {
    expect(userDetailVerdict(user({ passwordChangedAt: null }), ACTOR).resendInvitation)
      .toBeUndefined();
  });

  it("una cuenta sin roles de gestión corta antes, por notManaged", () => {
    const v = userDetailVerdict(user({ roles: ["socio"], passwordChangedAt: null }), ACTOR);
    expect(v.resendInvitation).toBe(USER_GUARD_MESSAGES.notManaged);
  });
});

describe("revocar la invitación", () => {
  it("bloqueado sin invitación viva", () => {
    expect(userDetailVerdict(user({ invitation: null }), ACTOR).revokeInvitation)
      .toBe(USER_GUARD_MESSAGES.noInvitation);
  });

  it("habilitado con una invitación sin usar", () => {
    expect(userDetailVerdict(user({ invitation: liveInvitation }), ACTOR).revokeInvitation)
      .toBeUndefined();
  });
});

describe("la sección Invitación", () => {
  it("se muestra en una cuenta de gestión que todavía no creó su contraseña", () => {
    expect(userDetailVerdict(user({ passwordChangedAt: null }), ACTOR).showInvitation).toBe(true);
  });

  // EL caso del hallazgo: invitada, ignoró el enlace y entró por "olvidé mi
  // contraseña". `passwordReset.reset` sella `passwordChangedAt` y revoca sólo
  // los `password_reset`: el `admin_invitation` sigue vivo y todavía deja
  // fijarle la contraseña a esa cuenta. La sección TIENE que aparecer, con
  // "revocar" habilitado y "reenviar" bloqueado por alreadyRedeemed — que es
  // exactamente lo que las dos actions hacen.
  it("se muestra con la contraseña ya creada si quedó una invitación sin usar", () => {
    const v = userDetailVerdict(
      user({ passwordChangedAt: new Date("2026-08-28T12:00:00Z"), invitation: liveInvitation }),
      ACTOR,
    );
    expect(v.showInvitation).toBe(true);
    expect(v.revokeInvitation).toBeUndefined();
    expect(v.resendInvitation).toBe(USER_GUARD_MESSAGES.alreadyRedeemed);
  });

  it("se esconde con la contraseña creada y ninguna invitación pendiente", () => {
    expect(userDetailVerdict(user(), ACTOR).showInvitation).toBe(false);
  });

  it("se esconde en una cuenta sin roles de gestión", () => {
    const v = userDetailVerdict(user({ roles: ["socio"], passwordChangedAt: null }), ACTOR);
    expect(v.showInvitation).toBe(false);
  });

  // El segundo hallazgo del mismo tipo: quitarle el ÚLTIMO rol a una cuenta que
  // todavía no canjeó dejaba el `admin_invitation` vivo hasta 7 días con la
  // sección —y su botón Revocar— escondida, o sea sin ninguna manera de matar
  // el enlace desde el producto. `revokeInvitation` no tiene guarda `managed`
  // (service.ts): acepta ese caso perfectamente.
  it("se muestra en una cuenta sin roles si quedó una invitación viva", () => {
    const v = userDetailVerdict(
      user({ roles: [], passwordChangedAt: null, invitation: liveInvitation }),
      ACTOR,
    );
    expect(v.managed).toBe(false);
    expect(v.showInvitation).toBe(true);
    expect(v.revokeInvitation).toBeUndefined();
    // Reenviarla sí queda cortado: `resendInvitation` exige gestión.
    expect(v.resendInvitation).toBe(USER_GUARD_MESSAGES.notManaged);
  });

  it("sigue escondida en una cuenta sin roles y SIN invitación (no hay nada que revocar)", () => {
    const v = userDetailVerdict(user({ roles: [], passwordChangedAt: null, invitation: null }), ACTOR);
    expect(v.showInvitation).toBe(false);
  });
});
