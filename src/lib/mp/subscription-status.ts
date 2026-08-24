// "¿Esta suscripción sigue viva?" — las TRES semánticas que de verdad existen
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
//   isCharging      — UN valor. "¿De acá está saliendo plata AHORA?" Es la más
//                     angosta de las tres y la usa /admin/salud: para un socio
//                     VIGENTE, cualquier estado que no sea `authorized` —incluida
//                     una `paused` que se reanuda, o una `cancelled` que el
//                     vecino canceló desde su app— significa que este mes no
//                     entra la cuota. `canStillCharge` no sirve para esa
//                     pregunta: contesta "puede volver a cobrar", no "cobra".
//
// El lote REG-34 (`fee-value-batch.ts`) usa `authorized` a secas y NO importa
// ninguna de las dos: es una tercera pregunta —"¿a cuál tiene sentido empujarle
// un monto AHORA?"— y está documentada en su propio archivo. Lo mismo
// `subscriptionIsActive` (`applications/query.ts`), que tampoco pregunta ni una
// ni otra: decide qué se puede AFIRMAR en pantalla sobre el débito de una
// solicitud, y por eso es tri-estado (ver `lateEntryNotice`).

/** Lista BLANCA: los estados de los que todavía puede salir un débito.
 *
 *  `authorized` es el obvio. `paused` está porque se reanuda y vuelve a cobrar.
 *  `pending` NO está porque MP cobre —ahí el vecino todavía no autorizó nada—:
 *  está por lo que no sabemos. Un `pending` guardado acá puede ya estar
 *  `authorized` en MP y que el aviso se haya perdido, así que darlo por muerto
 *  es dejar de buscarle los débitos. */
export const CHARGEABLE_STATUSES: readonly string[] = ["authorized", "pending", "paused"];

export function canStillCharge(status: string): boolean {
  return CHARGEABLE_STATUSES.includes(status);
}

/** Cuántas de estas suscripciones todavía pueden cobrar.
 *
 *  Existe como función y no como un `.filter(...).length` suelto en la pantalla
 *  porque es una REGLA, y una regla se prueba por comportamiento: el vinculador
 *  la usa para avisar "este socio ya tiene otra viva" antes de dejarle dos
 *  débitos por mes al mismo vecino. */
export function countChargeable(subs: ReadonlyArray<{ status: string }>): number {
  return subs.filter((s) => canStillCharge(s.status)).length;
}

/** Lista NEGRA de UN valor: lo único que se puede afirmar como muerto. */
export function isKnownDead(status: string): boolean {
  return status === "cancelled";
}

export function isNotCancelled(status: string): boolean {
  return !isKnownDead(status);
}

/** El ÚNICO estado del que sale plata hoy. Angosto a propósito: lo usa el
 *  tablero de salud para preguntar "¿este socio vigente está pagando?", y ahí
 *  `paused` y `pending` son tan "no entra la cuota" como `cancelled`. */
export function isCharging(status: string): boolean {
  return status === "authorized";
}
