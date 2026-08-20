// Mapa único estado→variante de Badge. Antes cada pantalla tenía su ternario y
// divergieron: un suspendido se veía "secondary" en el padrón y "outline" en su
// propia ficha. El del padrón era el más expresivo: queda como canónico.
import type { ApplicationStatus, MemberStatus, NewsStatus } from "@/generated/prisma/client";

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

// La bandeja resalta lo accionable: la aceptada que espera acta es "default"
// (celeste); lo terminal va apagado.
export function applicationStatusBadgeVariant(status: ApplicationStatus): BadgeVariant {
  if (status === "approved_pending_minute") return "default";
  if (status === "pending_board" || status === "pending_payment") return "secondary";
  if (status === "rejected") return "destructive";
  return "outline"; // started, completed, expired
}
