// Mapa único estado→variante de Badge. Antes cada pantalla tenía su ternario y
// divergieron: un suspendido se veía "secondary" en el padrón y "outline" en su
// propia ficha. El del padrón era el más expresivo: queda como canónico.
import type { ApplicationStatus, FeeStatus, MemberStatus, NewsStatus } from "@/generated/prisma/client";
import type { ArrearsLevel } from "@/lib/treasury/rules";

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

// La mora escala con el estatuto (REG-15): desde la 2ª cuota es alerta, desde
// la 4ª habilita la cesantía. El argumento es el UMBRAL que devuelve
// `arrearsLevel`, no la cantidad de cuotas pendientes.
export function arrearsBadgeVariant(level: ArrearsLevel): BadgeVariant {
  if (level === 4) return "destructive";
  if (level === 2) return "default";
  if (level === 1) return "secondary";
  return "outline";
}

// Un recibo anulado no es "apagado": es un asiento que sigue existiendo y que
// hay que poder ver de lejos en la lista.
export function receiptBadgeVariant(voided: boolean): BadgeVariant {
  return voided ? "destructive" : "default";
}

export function feeStatusBadgeVariant(status: FeeStatus): BadgeVariant {
  if (status === "paid") return "default";
  if (status === "pending") return "secondary";
  return "outline"; // exempt, voided
}
