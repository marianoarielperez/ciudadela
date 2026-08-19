// Roles acumulables (docs/03): un usuario puede ser admin y socio a la vez.
// Puro y sin dependencias para que lo puedan usar el proxy, el layout y cada
// server action sin arrastrar Prisma.
export function isAdmin(roles: readonly string[] | null | undefined): boolean {
  return (roles ?? []).some((r) => r === "admin" || r === "superadmin");
}

// La pantalla de Configuración es solo superadmin (docs/05:129): cambiar
// asociate_activo abre/cierra el alta de socios de cara al público.
export function isSuperadmin(roles: readonly string[] | null | undefined): boolean {
  return (roles ?? []).some((r) => r === "superadmin");
}
