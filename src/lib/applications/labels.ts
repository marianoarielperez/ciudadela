// Etiquetas es-AR de los estados de la solicitud de alta web. Un solo lugar: la
// bandeja del panel, la ficha de la solicitud y el seguimiento del vecino tienen
// que nombrar lo mismo (patrón members/labels).
import type { ApplicationStatus } from "@/generated/prisma/client";

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  started: "Iniciada",
  pending_payment: "Esperando pago",
  approved_pending_minute: "Aceptada — pendiente de acta",
  pending_board: "A tratar por la CD",
  completed: "Alta completada",
  rejected: "Rechazada",
  expired: "Vencida",
};
