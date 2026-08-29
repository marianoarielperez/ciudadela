"use server";
// Actions de /admin/usuarios. Vale el recordatorio de require-admin.ts: cada
// action es un endpoint público y se autoriza a sí misma con
// `requireSuperadminUsers()` — la pantalla de bloqueo de page.tsx solo esconde
// el formulario. Las guardas de dominio (último superadmin, auto-degradación,
// email con socio) viven en el service y se revalidan dentro de su
// transacción; acá va la autorización, el parseo, la auditoría y el redirect.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { BCRYPT_COST } from "@/lib/auth/password";
import { requireSuperadminUsers } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { sendAdminInvitation } from "@/lib/users/invitation";
import { makeUserAdminService } from "@/lib/users/service";

const service = makeUserAdminService(prisma);

type ActionState = { error?: string };

const BASE = "/admin/usuarios";

async function clientIp(): Promise<string> {
  // Solo X-Real-IP, como en el resto del panel.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Mensajes en castellano SIEMPRE: una server action es un endpoint público y
// el texto de zod por defecto (en inglés) terminaría en pantalla.
const idField = z.coerce
  .number("La cuenta seleccionada no es válida.")
  .int("La cuenta seleccionada no es válida.")
  .positive("La cuenta seleccionada no es válida.");

const createSchema = z.object({
  name: z
    .string("Ingresá el nombre.")
    .trim()
    .min(2, "El nombre tiene que tener al menos 2 caracteres.")
    .max(120, "El nombre no puede superar los 120 caracteres."),
  email: z
    .email("El email no es válido.")
    .max(191, "El email no puede superar los 191 caracteres."),
});

const updateSchema = z.object({
  id: idField,
  name: z
    .string("Ingresá el nombre.")
    .trim()
    .min(2, "El nombre tiene que tener al menos 2 caracteres.")
    .max(120, "El nombre no puede superar los 120 caracteres."),
  email: z
    .email("El email no es válido.")
    .max(191, "El email no puede superar los 191 caracteres.")
    .optional(),
});

const roleSchema = z.object({
  id: idField,
  role: z.enum(["admin", "superadmin"], { error: "El rol seleccionado no es válido." }),
});

const activeSchema = z.object({
  id: idField,
  active: z.enum(["1", "0"], { error: "El estado seleccionado no es válido." }),
});

const idSchema = z.object({ id: idField });

/** Emite y manda la invitación de una cuenta recién creada o reenviada, y deja
 *  el rastro correcto: `_send_failed` SOLO ante un fallo real — el bloqueo de
 *  `EMAIL_ALLOWLIST` es la guarda del entorno de prueba funcionando. */
async function deliverInvitation(input: {
  actorId: number; userId: number; to: string; token: string; ip: string; resent: boolean;
}): Promise<boolean> {
  const delivery = await sendAdminInvitation({ to: input.to, token: input.token });
  const base = { userId: input.actorId, entity: "user", entityId: input.userId, ip: input.ip };
  if (delivery.sent) {
    await audit({ ...base, action: input.resent ? "admin_invitation_resent" : "admin_invitation_sent" });
  } else if (!delivery.blocked) {
    await audit({ ...base, action: "admin_invitation_send_failed" });
  }
  return delivery.sent;
}

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(createSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  // Hash de bytes aleatorios que nadie conoce: la cuenta no puede loguearse
  // hasta el canje. Se calcula acá (~300 ms), nunca dentro de la transacción.
  const unusableHash = await bcrypt.hash(randomBytes(32).toString("base64url"), BCRYPT_COST);
  const res = await service.createManagedUser({
    email: parsed.data.email, name: parsed.data.name, passwordHash: unusableHash,
  });
  if (!res.ok) return { error: res.error };

  const ip = await clientIp();
  await audit({ userId: actor.actorId, action: "user_create", entity: "user", entityId: res.userId, ip });
  const sent = await deliverInvitation({
    actorId: actor.actorId, userId: res.userId, to: parsed.data.email,
    token: res.rawToken, ip, resent: false,
  });
  redirect(`${BASE}/${res.userId}?invitado=${sent ? 1 : 2}`);
}

export async function updateUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(updateSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const res = await service.updateManagedUser({
    targetId: parsed.data.id, name: parsed.data.name, email: parsed.data.email,
  });
  if (!res.ok) return { error: res.error };

  await audit({
    userId: actor.actorId, action: "user_update", entity: "user", entityId: parsed.data.id,
    // Qué campos se tocaron, nunca los valores: el email es dato personal.
    detail: { fields: res.emailChanged ? ["name", "email"] : ["name"] },
    ip: await clientIp(),
  });
  redirect(`${BASE}/${parsed.data.id}?guardado=1`);
}

export async function grantRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(roleSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const res = await service.grantRole({
    actorId: actor.actorId, targetId: parsed.data.id, role: parsed.data.role,
  });
  if (!res.ok) return { error: res.error };

  await audit({
    userId: actor.actorId, action: "role_grant", entity: "user", entityId: parsed.data.id,
    detail: { role: parsed.data.role }, ip: await clientIp(),
  });
  redirect(`${BASE}/${parsed.data.id}?rol=1`);
}

export async function revokeRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(roleSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const res = await service.revokeRole({
    actorId: actor.actorId, targetId: parsed.data.id, role: parsed.data.role,
  });
  if (!res.ok) return { error: res.error };

  await audit({
    userId: actor.actorId, action: "role_revoke", entity: "user", entityId: parsed.data.id,
    detail: { role: parsed.data.role }, ip: await clientIp(),
  });
  redirect(`${BASE}/${parsed.data.id}?rol=2`);
}

export async function setActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(activeSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const active = parsed.data.active === "1";

  const res = await service.setUserActive({
    actorId: actor.actorId, targetId: parsed.data.id, active,
  });
  if (!res.ok) return { error: res.error };

  await audit({
    userId: actor.actorId, action: active ? "user_enable" : "user_disable",
    entity: "user", entityId: parsed.data.id, ip: await clientIp(),
  });
  redirect(`${BASE}/${parsed.data.id}?cuenta=${active ? 1 : 2}`);
}

export async function resendInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const res = await service.resendInvitation({ targetId: parsed.data.id });
  if (!res.ok) return { error: res.error };

  const sent = await deliverInvitation({
    actorId: actor.actorId, userId: parsed.data.id, to: res.email,
    token: res.rawToken, ip: await clientIp(), resent: true,
  });
  redirect(`${BASE}/${parsed.data.id}?invitacion=${sent ? 1 : 2}`);
}

export async function revokeInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const res = await service.revokeInvitation({ targetId: parsed.data.id });
  if (!res.ok) return { error: res.error };

  await audit({
    userId: actor.actorId, action: "admin_invitation_revoked",
    entity: "user", entityId: parsed.data.id, ip: await clientIp(),
  });
  redirect(`${BASE}/${parsed.data.id}?invitacion=3`);
}
