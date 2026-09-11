// ¿Este pago de Mercado Pago es un COBRO de la cuenta, o algo que la cuenta
// pagó? `/v1/payments/search` con el token del vendedor devuelve las dos cosas
// (medido el 11/09/2026: la factura mensual de MP por cargos de operar llega
// aprobada, con `collector_id` AUSENTE, y el cron la mandaba a la bandeja como
// un cobro sin referencia). La regla es "propio o nada": falla cerrada, y por
// eso vive en el paso 1 de la conciliación y no en `applyPayment` — si MP
// cambiara el payload, lo que se apaga es la red del cron (visible en
// `/admin/salud`), no el asiento de los cobros reales por webhook.
//
// Puro a propósito: sin Prisma, sin gateway, sin reloj.

/** Acción de auditoría de un pago que la búsqueda trajo y no es un cobro
 *  nuestro. Un asiento por pago, no por corrida (ver `reconcile.ts`). */
export const FOREIGN_PAYMENT_ACTION = "payment_foreign";

export function isOwnCollection(p: { collectorId: string | null }, ownId: string): boolean {
  return p.collectorId !== null && p.collectorId === ownId;
}
