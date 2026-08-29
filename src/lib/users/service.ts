// Escrituras del módulo de usuarios: alta de cuenta de gestión, roles
// admin/superadmin, estado de la cuenta e invitaciones.
//
// Tres reglas de la spec (2026-08-29 §4.2):
//  - TODA escritura pasa por un mutex en memoria de UNA clave ("user-roles"),
//    premisa de un solo proceso (docs/03). El mutex es cinturón;
//  - ...y las guardas se REVALIDAN dentro de la $transaction, que es el
//    tirante (lección del cerrojo optimista de la exención): "nunca cero
//    superadmins activos" se cuenta DESPUÉS de la escritura, adentro.
//  - El rol "socio" no es un valor posible acá: `ManagedRole` lo excluye por
//    construcción, no por validación.
//
// Solo se exporta la FACTORY: el bind con prisma vive en las actions. Un test
// puro que importe este módulo no arrastra `@/lib/prisma` por su propia
// cuenta (sí lo arrastra `@/lib/tokens`, que los tests mockean).
import type { PrismaClient } from "@/generated/prisma/client";
import { createKeyedMutex } from "@/lib/keyed-mutex";
import { makeTokens } from "@/lib/tokens";
import { isUniqueViolation } from "@/lib/treasury/unique-violation";

export type ManagedRole = "admin" | "superadmin";
export const MANAGED_ROLES: readonly ManagedRole[] = ["admin", "superadmin"];

// Los TEXTOS salen del dominio (patrón GRANT_GUARD_MESSAGES de la exención):
// el operador lee lo mismo se corte donde se corte, y la pantalla deshabilita
// con el mismo motivo que la action rechaza.
export const USER_GUARD_MESSAGES = {
  emailTaken: "Ya existe una cuenta con ese email.",
  memberCardEmail:
    "Ese email es el de la ficha de un socio. Si ya tiene cuenta, otorgale el rol a esa cuenta; " +
    "si no, envíale el acceso de socio desde su ficha y después otorgale el rol.",
  roleUnavailable: "Falta un rol base en el sistema. Comunicate con el desarrollador.",
  notFound: "Esa cuenta no existe.",
  alreadyHasRole: "La cuenta ya tiene ese rol.",
  missingRole: "La cuenta no tiene ese rol.",
  selfSuperadmin: "No podés quitarte tu propio rol de superadmin.",
  selfDisable: "No podés desactivar tu propia cuenta.",
  lastSuperadmin: "El sistema no puede quedar sin ningún superadmin activo.",
  notManaged: "Esa cuenta no es de gestión: su estado lo gobierna el ciclo del socio (baja y readmisión).",
  memberEmail: "El email de una cuenta con socio vinculado se cambia desde la ficha del socio.",
  noChange: "La cuenta ya estaba en ese estado.",
  noInvitation: "Esa cuenta no tiene una invitación viva.",
  alreadyRedeemed: "Esa cuenta ya creó su contraseña: no hay invitación que gestionar.",
  inactiveInvitation: "Una cuenta desactivada no puede recibir una invitación: reactivala primero.",
} as const;

/** Rechazo que hace ROLLBACK de la transacción (misma mecánica que
 *  `AccessAbort` en members/access.ts). */
class UserGuardAbort extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "UserGuardAbort";
  }
}

type UsersWriteDb = Pick<
  PrismaClient,
  "$transaction" | "user" | "userRole" | "role" | "actionToken" | "member"
>;
type Tx = Parameters<Parameters<UsersWriteDb["$transaction"]>[0]>[0];

export type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function makeUserAdminService(db: UsersWriteDb) {
  const mutex = createKeyedMutex();
  const LOCK = "user-roles";

  function run<T>(fn: (tx: Tx) => Promise<{ ok: true } & T>): Promise<ServiceResult<T>> {
    return mutex.run(LOCK, async () => {
      try {
        return await db.$transaction(fn);
      } catch (e) {
        if (e instanceof UserGuardAbort) return { ok: false as const, error: e.reason };
        throw e;
      }
    });
  }

  async function managedTarget(tx: Tx, targetId: number) {
    const target = await tx.user.findUnique({
      where: { id: targetId },
      include: { roles: { include: { role: true } } },
    });
    if (!target) throw new UserGuardAbort(USER_GUARD_MESSAGES.notFound);
    const names = target.roles.map((r) => r.role.name);
    return { target, names, managed: names.some((n) => (MANAGED_ROLES as readonly string[]).includes(n)) };
  }

  /** Cuántos superadmins ACTIVOS quedan. Se llama DESPUÉS de la escritura y
   *  dentro de la transacción: es la guarda real, no la de la pantalla. */
  function activeSuperadmins(tx: Tx): Promise<number> {
    return tx.userRole.count({ where: { role: { name: "superadmin" }, user: { active: true } } });
  }

  return {
    /** Alta de cuenta de gestión. `passwordHash` viene calculado de AFUERA
     *  (bcrypt ~300 ms, nunca con la transacción abierta) y es un hash de
     *  bytes aleatorios que nadie conoce: el login es imposible hasta el
     *  canje, con el mismo costo de tiempo de siempre (anti-enumeración). */
    async createManagedUser(input: {
      email: string; name: string; passwordHash: string; now?: Date;
    }): Promise<ServiceResult<{ userId: number; rawToken: string }>> {
      const email = input.email.toLowerCase().trim();
      const now = input.now ?? new Date();
      // Pre-validaciones baratas ANTES de abrir nada (patrón de la exención):
      // por acá se rechaza casi siempre, y con el mensaje útil.
      const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) return { ok: false, error: USER_GUARD_MESSAGES.emailTaken };
      // Cualquier ficha con ese email bloquea el alta: si el socio ya tiene
      // cuenta, el rol se otorga ahí; si no, crear una cuenta de gestión con
      // esa dirección le rompería el canje de su invitación de socio (guarda
      // anti-escalada de members/access.ts, que es deliberada y no se toca).
      const card = await db.member.findFirst({ where: { email }, select: { id: true } });
      if (card) return { ok: false, error: USER_GUARD_MESSAGES.memberCardEmail };

      return run(async (tx) => {
        const adminRole = await tx.role.findUnique({ where: { name: "admin" } });
        if (!adminRole) throw new UserGuardAbort(USER_GUARD_MESSAGES.roleUnavailable);
        try {
          // `passwordChangedAt` queda en null A PROPÓSITO: junto con la
          // invitación viva es lo que la pantalla lee como "invitación
          // pendiente" (accountState).
          const user = await tx.user.create({
            data: { email, name: input.name, passwordHash: input.passwordHash, active: true },
          });
          await tx.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
          const rawToken = await makeTokens(tx).issue({ purpose: "admin_invitation", userId: user.id, now });
          return { ok: true as const, userId: user.id, rawToken };
        } catch (e) {
          // La carrera contra otro alta con el mismo email: el unique decide.
          if (isUniqueViolation(e)) throw new UserGuardAbort(USER_GUARD_MESSAGES.emailTaken);
          throw e;
        }
      });
    },

    /** Nombre siempre; email SOLO sin socio vinculado (spec §2 decisión 10).
     *  El cambio de email revoca los tokens emitidos hacia la casilla vieja
     *  (mismo motivo que members/write.ts: quien tenga el buzón anterior no
     *  puede quedarse con la cuenta). */
    async updateManagedUser(input: {
      targetId: number; name: string; email?: string;
    }): Promise<ServiceResult<{ emailChanged: boolean }>> {
      return run(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: input.targetId },
          include: { member: { select: { id: true } } },
        });
        if (!target) throw new UserGuardAbort(USER_GUARD_MESSAGES.notFound);
        const email = input.email?.toLowerCase().trim();
        const emailChanged = email !== undefined && email !== "" && email !== target.email;
        if (emailChanged && target.member) throw new UserGuardAbort(USER_GUARD_MESSAGES.memberEmail);
        try {
          await tx.user.update({
            where: { id: target.id },
            data: { name: input.name, ...(emailChanged ? { email } : {}) },
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw new UserGuardAbort(USER_GUARD_MESSAGES.emailTaken);
          throw e;
        }
        if (emailChanged) {
          await makeTokens(tx).revokeForUser(target.id, ["admin_invitation", "password_reset"]);
        }
        return { ok: true as const, emailChanged };
      });
    },

    /** Reemite la invitación: revoca la viva y emite una nueva (quien emite
     *  está autenticado como superadmin: revocar al emitir es la regla del
     *  encabezado de tokens.ts). El ENVÍO va después del commit, en la action. */
    async resendInvitation(input: {
      targetId: number; now?: Date;
    }): Promise<ServiceResult<{ rawToken: string; email: string }>> {
      return run(async (tx) => {
        const { target, managed } = await managedTarget(tx, input.targetId);
        if (!managed) throw new UserGuardAbort(USER_GUARD_MESSAGES.notManaged);
        if (target.passwordChangedAt !== null) throw new UserGuardAbort(USER_GUARD_MESSAGES.alreadyRedeemed);
        if (!target.active) throw new UserGuardAbort(USER_GUARD_MESSAGES.inactiveInvitation);
        const tokens = makeTokens(tx);
        await tokens.revokeForUser(target.id, ["admin_invitation"]);
        const rawToken = await tokens.issue({
          purpose: "admin_invitation", userId: target.id, now: input.now ?? new Date(),
        });
        return { ok: true as const, rawToken, email: target.email };
      });
    },

    async revokeInvitation(input: { targetId: number }): Promise<ServiceResult> {
      return run(async (tx) => {
        const count = await makeTokens(tx).revokeForUser(input.targetId, ["admin_invitation"]);
        if (count === 0) throw new UserGuardAbort(USER_GUARD_MESSAGES.noInvitation);
        return { ok: true as const };
      });
    },

    async grantRole(input: {
      actorId: number; targetId: number; role: ManagedRole;
    }): Promise<ServiceResult> {
      return run(async (tx) => {
        const { target, names } = await managedTarget(tx, input.targetId);
        if (names.includes(input.role)) throw new UserGuardAbort(USER_GUARD_MESSAGES.alreadyHasRole);
        const role = await tx.role.findUnique({ where: { name: input.role } });
        if (!role) throw new UserGuardAbort(USER_GUARD_MESSAGES.roleUnavailable);
        await tx.userRole.create({ data: { userId: target.id, roleId: role.id } });
        return { ok: true as const };
      });
    },

    async revokeRole(input: {
      actorId: number; targetId: number; role: ManagedRole;
    }): Promise<ServiceResult> {
      // Guarda 1 (barata, fuera de la tx porque no depende de la base): el
      // superadmin no se degrada a sí mismo.
      if (input.role === "superadmin" && input.targetId === input.actorId) {
        return { ok: false, error: USER_GUARD_MESSAGES.selfSuperadmin };
      }
      return run(async (tx) => {
        const deleted = await tx.userRole.deleteMany({
          where: { userId: input.targetId, role: { name: input.role } },
        });
        if (deleted.count === 0) throw new UserGuardAbort(USER_GUARD_MESSAGES.missingRole);
        // Guarda 2, DESPUÉS de la escritura y adentro: si esta revocación dejó
        // cero superadmins activos, la transacción entera vuelve atrás.
        if (input.role === "superadmin" && (await activeSuperadmins(tx)) === 0) {
          throw new UserGuardAbort(USER_GUARD_MESSAGES.lastSuperadmin);
        }
        return { ok: true as const };
      });
    },

    async setUserActive(input: {
      actorId: number; targetId: number; active: boolean;
    }): Promise<ServiceResult> {
      if (!input.active && input.targetId === input.actorId) {
        return { ok: false, error: USER_GUARD_MESSAGES.selfDisable };
      }
      return run(async (tx) => {
        const { target, names, managed } = await managedTarget(tx, input.targetId);
        // Solo cuentas de gestión: el `active` de un socio puro lo gobierna la
        // baja/readmisión (spec §2 decisión 11).
        if (!managed) throw new UserGuardAbort(USER_GUARD_MESSAGES.notManaged);
        if (target.active === input.active) throw new UserGuardAbort(USER_GUARD_MESSAGES.noChange);
        await tx.user.update({ where: { id: target.id }, data: { active: input.active } });
        // Desactivar a un superadmin también puede dejar cero: misma guarda,
        // mismo lugar (después de la escritura, adentro de la tx).
        if (!input.active && names.includes("superadmin") && (await activeSuperadmins(tx)) === 0) {
          throw new UserGuardAbort(USER_GUARD_MESSAGES.lastSuperadmin);
        }
        return { ok: true as const };
      });
    },
  };
}

export type UserAdminService = ReturnType<typeof makeUserAdminService>;
