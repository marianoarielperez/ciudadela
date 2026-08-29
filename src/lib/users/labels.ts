// Etiquetas es-AR y estado derivado de una cuenta. Módulo PURO: sin Prisma y
// sin lucide, para que lo compartan pantalla, query y tests sin arrastrar nada.

/** El estado que la pantalla muestra de una cuenta. No existe en la base: se
 *  deriva de `active` + `passwordChangedAt` + la última invitación de gestión.
 *  Ojo con el null histórico: `passwordChangedAt` nulo en una fila ANTERIOR a
 *  la migración de la columna significa "no se escribió contraseña desde que
 *  existe la columna", no "nunca tuvo" — por eso "invitación vencida" exige
 *  además que exista una invitación de gestión emitida. */
export type UserAccountState = "active" | "disabled" | "invited" | "invitation_expired";

export function accountState(
  user: { active: boolean; passwordChangedAt: Date | null },
  lastInvitation: { expiresAt: Date; usedAt: Date | null } | null,
  now: Date = new Date(),
): UserAccountState {
  if (!user.active) return "disabled";
  if (lastInvitation && lastInvitation.usedAt === null && lastInvitation.expiresAt >= now) {
    return "invited";
  }
  if (user.passwordChangedAt === null && lastInvitation) return "invitation_expired";
  return "active";
}

export const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  socio: "Socio",
};

export const ACCOUNT_STATE_LABELS: Record<UserAccountState, string> = {
  active: "Activa",
  disabled: "Desactivada",
  invited: "Invitación pendiente",
  invitation_expired: "Invitación vencida",
};

/** Traducción de los `action` de audit_log que la sección Actividad muestra.
 *  Fallback a la acción cruda: un asiento nuevo sin etiqueta se ve feo, no
 *  desaparece. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  user_create: "Cuenta creada",
  user_update: "Datos editados",
  user_disable: "Cuenta desactivada",
  user_enable: "Cuenta reactivada",
  role_grant: "Rol otorgado",
  role_revoke: "Rol quitado",
  admin_invitation_sent: "Invitación enviada",
  admin_invitation_resent: "Invitación reenviada",
  admin_invitation_revoked: "Invitación revocada",
  admin_invitation_send_failed: "El correo de invitación no salió",
  admin_password_set: "Creó su contraseña",
  member_user_created: "Creó su cuenta de socio",
  member_password_set: "Restableció su contraseña (invitación de socio)",
  login: "Ingresó al sistema",
  login_failed: "Intento de ingreso fallido",
  password_reset_requested: "Pidió restablecer la contraseña",
  password_reset_completed: "Restableció la contraseña",
  password_reset_failed: "Restablecimiento fallido",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
