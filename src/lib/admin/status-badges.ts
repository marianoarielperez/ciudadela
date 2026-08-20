// Mapa único estado→variante de Badge. Antes cada pantalla tenía su ternario y
// divergieron: un suspendido se veía "secondary" en el padrón y "outline" en su
// propia ficha. El del padrón era el más expresivo: queda como canónico.
import type { MemberStatus, NewsStatus } from "@/generated/prisma/client";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";

export function memberStatusBadgeVariant(status: MemberStatus): BadgeVariant {
  if (status === "active") return "default";
  if (status === "suspended") return "secondary";
  return "outline";
}

export function newsStatusBadgeVariant(status: NewsStatus): BadgeVariant {
  return status === "published" ? "default" : "secondary";
}

export function activityBadgeVariant(active: boolean): BadgeVariant {
  return active ? "default" : "secondary";
}
