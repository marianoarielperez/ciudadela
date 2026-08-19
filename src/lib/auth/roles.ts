// Roles acumulables (docs/03): un usuario puede ser admin y socio a la vez.
// Puro y sin dependencias para que lo puedan usar el proxy, el layout y cada
// server action sin arrastrar Prisma.
export function isAdmin(roles: readonly string[] | null | undefined): boolean {
  return (roles ?? []).some((r) => r === "admin" || r === "superadmin");
}
