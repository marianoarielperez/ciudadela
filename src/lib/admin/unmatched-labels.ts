// Etiquetas de la bandeja sin conciliar y de las suscripciones de MP.
//
// Viven separadas de `UNMATCHED_REASONS` (src/lib/mp/unmatched.ts) a propósito:
// aquello es el vocabulario del dominio —lo escribe el webhook, lo lee la
// conciliación— y esto es lo que ve un operador. Cambiar cómo se dice un motivo
// en pantalla no puede obligar a migrar filas ya escritas.
import type { UnmatchedStatus } from "@/generated/prisma/client";
import type { UnmatchedReason } from "@/lib/mp/unmatched";

export const UNMATCHED_REASON_LABELS: Record<UnmatchedReason, string> = {
  no_reference: "Sin referencia",
  no_subscription: "Suscripción sin vincular",
  application_missing: "Solicitud inexistente",
  duplicate_entry: "Segundo cobro de ingreso",
  withdrawn_no_pending: "Cesante sin deuda",
  treasury_rejected: "Rechazado por tesorería",
};

export const UNMATCHED_STATUS_LABELS: Record<UnmatchedStatus, string> = {
  open: "Pendiente",
  matched: "Aplicado",
  dismissed: "Descartado",
  // La tercera salida: la plata entró y es de la asociación, pero no es de
  // ningún socio. No dice "aplicado" (no hay socio ni recibo) ni "descartado"
  // (la plata no se fue a ningún lado).
  other_income: "Ingreso no societario",
};

// El catálogo de estados de una suscripción es de Mercado Pago y puede crecer
// sin avisar: el mapa traduce los que conocemos y `subscriptionStatusLabel`
// devuelve el código crudo para el resto. Mostrar el código es preferible a
// inventarle un nombre en castellano que no significa nada.
export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  authorized: "Activa",
  paused: "Pausada",
  cancelled: "Cancelada",
  pending: "Pendiente",
};

export function subscriptionStatusLabel(status: string): string {
  return SUBSCRIPTION_STATUS_LABELS[status] ?? status;
}
