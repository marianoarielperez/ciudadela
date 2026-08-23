// Reglas puras de las decisiones de la Comisión sobre una solicitud VIVA
// (recategorizar y rechazar). Separadas de la action para testearlas sin mocks y
// para que la pantalla y el servidor decidan con el mismo criterio: la Card de
// acciones del detalle sólo aparece si `isDecidable`, y la action lo revalida.
import type { ApplicationStatus, MemberCategory } from "@/generated/prisma/client";

/** Los estados desde los que la Comisión todavía puede decidir.
 *
 *  Es un conjunto MÁS AMPLIO que `RECORDABLE_STATUSES`: una solicitud que
 *  todavía no pagó (`pending_payment`) no puede asentarse en el libro, pero sí
 *  puede recategorizarse —justamente para que el débito salga por el monto que
 *  corresponde— y puede rechazarse. `started` queda afuera: es un wizard a medio
 *  llenar que el vecino todavía no envió; `completed` / `rejected` / `expired`,
 *  porque ya están resueltas. */
export const DECIDABLE_STATUSES = [
  "pending_payment", "approved_pending_minute", "pending_board",
] as const;

export function isDecidable(status: ApplicationStatus): boolean {
  return (DECIDABLE_STATUSES as readonly string[]).includes(status);
}

/** ¿La recategorización mueve el monto de la cuota?
 *
 *  Los montos son DOS (`fee_values`, REG-34): el del socio activo por un lado y
 *  el compartido por adherente y colaborador por el otro. O sea que
 *  adherente ↔ colaborador NO toca a Mercado Pago, y cualquier cruce contra
 *  `active` sí. */
export function changesFeeAmount(from: MemberCategory, to: MemberCategory): boolean {
  return (from === "active") !== (to === "active");
}
