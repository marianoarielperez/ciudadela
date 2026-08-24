// "¿Esta suscripción sigue viva?" — las DOS semánticas que de verdad existen
// (spec 4C §10). Antes había cinco definiciones repartidas y dos de ellas
// producían daño observable: la del reconcile no incluía `pending` (una
// suscripción que autorizó sin webhook nunca se sincronizaba ni se le buscaban
// los débitos: plata no recuperada) y la del vinculador no incluía `paused` (no
// avisaba "ya tiene otra viva" y el vecino terminaba con dos débitos por mes).
//
// No se aplanan en una sola a propósito: son preguntas distintas.
//
//   canStillCharge  — LISTA BLANCA. "¿Puede salir plata por acá?" Se usa para
//                     prometer un débito, para buscarle cobros y para decidir a
//                     quién sincronizar. Un estado que MP invente mañana NO se
//                     afirma como cobrable: prometer un débito que no existe es
//                     peor que no prometer nada.
//   isNotCancelled  — LISTA NEGRA de un solo valor. "¿Puedo afirmar que acá NO
//                     hay débito?" Se usa para avisarle al operador. Acá el
//                     estado desconocido cuenta como débito posible: no saber es
//                     peor que avisar de más (el argumento original vive en
//                     `members/auto-debit.ts:44-49`).
//
// El lote REG-34 (`fee-value-batch.ts`) usa `authorized` a secas y NO importa
// ninguna de las dos: es una tercera pregunta —"¿a cuál tiene sentido empujarle
// un monto AHORA?"— y está documentada en su propio archivo. Lo mismo
// `subscriptionIsActive` (`applications/query.ts`), que tampoco pregunta ni una
// ni otra: decide qué se puede AFIRMAR en pantalla sobre el débito de una
// solicitud, y por eso es tri-estado (ver `lateEntryNotice`).

/** Lista BLANCA: los estados con los que MP todavía puede cobrar. */
export const CHARGEABLE_STATUSES: readonly string[] = ["authorized", "pending", "paused"];

export function canStillCharge(status: string): boolean {
  return CHARGEABLE_STATUSES.includes(status);
}

/** Lista NEGRA de UN valor: lo único que se puede afirmar como muerto. */
export function isKnownDead(status: string): boolean {
  return status === "cancelled";
}

export function isNotCancelled(status: string): boolean {
  return !isKnownDead(status);
}
