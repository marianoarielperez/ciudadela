// Etiquetas es-AR y estado derivado de una cuenta. Módulo PURO: sin Prisma y
// sin lucide, para que lo compartan pantalla, query y tests sin arrastrar nada.

/** Qué roles hacen que una cuenta sea "de gestión". Vive ACÁ y no en
 *  `service.ts` porque las tres piezas que la necesitan —el `where` de los chips
 *  (`query.ts`), el veredicto de la pantalla (`detail-verdict.ts`) y las guardas
 *  del dominio (`service.ts`)— tienen que decidir con la MISMA lista, y
 *  `query.ts` no puede importar de `service.ts` sin arrastrar `@/lib/prisma`
 *  (vía `@/lib/tokens`). Es la misma definición que decide el chip "Gestión", el
 *  conteo, el estado de la cuenta y las cinco guardas: compartir la función, no
 *  copiarla. */
export type ManagedRole = "admin" | "superadmin";
export const MANAGED_ROLES: readonly ManagedRole[] = ["admin", "superadmin"];

export function hasManagedRole(roles: readonly string[]): boolean {
  return roles.some((r) => (MANAGED_ROLES as readonly string[]).includes(r));
}

/** El estado que la pantalla muestra de una cuenta. No existe en la base: se
 *  deriva de `active` + `passwordChangedAt` + la última invitación de gestión.
 *  Ojo con el null histórico: `passwordChangedAt` nulo en una fila ANTERIOR a
 *  la migración de la columna significa "no se escribió contraseña desde que
 *  existe la columna", no "nunca tuvo" — por eso "invitación vencida" exige
 *  además que exista una invitación de gestión emitida. Esa salvedad vale para
 *  las cuentas de SOCIO, que es donde aplica: nacen del canje de su propia
 *  invitación (`password_invitation`) y nunca tuvieron una fila
 *  `admin_invitation` que mirar. */
export type UserAccountState =
  | "active" | "disabled" | "invited" | "invitation_expired" | "no_access";

export function accountState(
  user: { active: boolean; passwordChangedAt: Date | null },
  lastInvitation: { expiresAt: Date; usedAt: Date | null } | null,
  /** Si la cuenta tiene rol de gestión (`hasManagedRole`). Es lo que distingue
   *  el null histórico de un socio —que sí puede entrar— de una cuenta de
   *  gestión que nunca canjeó nada y no puede. */
  managed: boolean,
  now: Date = new Date(),
): UserAccountState {
  if (!user.active) return "disabled";
  if (lastInvitation && lastInvitation.usedAt === null && lastInvitation.expiresAt >= now) {
    return "invited";
  }
  if (user.passwordChangedAt === null) {
    if (lastInvitation) return "invitation_expired";
    // Una cuenta de gestión nace con `passwordChangedAt: null` y un hash de
    // bytes aleatorios que nadie conoce: sin invitación viva NO puede entrar. Y
    // la fila de la invitación se borra por dos caminos NORMALES —revocarla, y
    // cambiarle el email antes del canje (`revokeForUser`)—, así que "no hay
    // token" no significa "canjeó". Sin este caso la lista mostraba "Activa" en
    // verde sobre una cuenta muerta, que es justo la pregunta que la pantalla
    // contesta en un recambio de Comisión ("¿quién tiene acceso?").
    if (managed) return "no_access";
  }
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
  no_access: "Sin invitación",
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
