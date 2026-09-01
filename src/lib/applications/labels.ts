// Etiquetas es-AR de los estados de la solicitud de alta web. Un solo lugar: la
// bandeja del panel, la ficha de la solicitud y el seguimiento del vecino tienen
// que nombrar lo mismo (patrón members/labels).
import type { ApplicationStatus, DocumentType } from "@/generated/prisma/client";

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  started: "Iniciada",
  pending_payment: "Esperando pago",
  approved_pending_minute: "Completa — pendiente de resolución",
  pending_board: "A resolver por la CD",
  completed: "Alta completada",
  rejected: "Rechazada",
  expired: "Vencida",
};

// El enum es polimórfico (M6 lo reutiliza para el re-empadronamiento), pero hoy
// los tres tipos son los del wizard de alta y se nombran desde acá.
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  dni_front: "DNI — frente",
  dni_back: "DNI — dorso",
  annex: "Anexo",
};
