// La política de tandas del lote REG-34, aparte del lote.
//
// EL PORQUÉ DE UN ARCHIVO PROPIO: esto lo comparten el servidor y la PANTALLA,
// y `fee-value-batch.ts` importa Prisma, el gateway de Mercado Pago y el
// procesador de webhooks para armar su singleton. Un `"use client"` que
// importara de ahí se llevaría medio backend al bundle del navegador. Acá no
// hay más que dos constantes y una comparación.
//
// `fee-value-batch.ts` los re-exporta, así que el servidor sigue teniendo un
// solo lugar de donde importar.

/** Cuántas suscripciones toca una sola llamada a la action. No es un número de
 *  rendimiento: Mercado Pago tarda ~1 s por update y este es el techo que
 *  mantiene la action bajo el timeout de la plataforma. */
export const BATCH_SIZE = 25;

/** ¿Hay que pedir otra tanda?
 *
 *  El `remaining > 0` solo NO alcanza: si el token de MP está vencido fallan
 *  las 25, la cola de divergentes no se achica y `remaining` se queda clavado
 *  en el mismo número. Un bucle que mire sólo eso llama a Mercado Pago para
 *  siempre. Una tanda que FALLÓ entera no va a mejorar en la siguiente: se
 *  corta y la pantalla lo dice.
 *
 *  Pero "no actualizó ninguna" no alcanza como motivo: una tanda que no tenía
 *  NADA que hacer —otro superadmin corrió el lote entre medio, no hay mutex—
 *  vuelve con `updated: 0` y `failed: []`, y cortar ahí haría que la pantalla
 *  dijera "la última tanda no pudo actualizar ninguna", que es mentira: no
 *  falló nada. Por eso se corta sólo cuando hubo fallos de verdad. */
export function shouldContinue(r: { updated: number; failed: number; remaining: number }): boolean {
  if (r.remaining <= 0) return false;
  if (r.updated > 0) return true;
  // Ninguna actualizada: sólo es motivo de corte si el motivo fueron fallos.
  return r.failed === 0;
}
