// El `payloadSummary` con que se acredita el aviso de un recibo, y su lectura.
//
// Vive en un módulo propio —sin una sola importación— porque sus dos mitades se
// usan de los dos lados del proyecto: lo ESCRIBE el mailer de tesorería
// (`receipt-email.ts`) y lo LEEN /admin/salud (`@/lib/admin/health`, que se
// prueba sin `.env` y por eso no puede importar el mailer, que evalúa Prisma) y
// la dedupe de sus dos acciones de reenvío.
//
// Es una casa de TESORERÍA y no de admin porque el recibo es una entidad de
// tesorería: el tablero de salud lo consume, no al revés.
//
// El formato era un literal repetido en cuatro archivos y la fila de
// `Notification` no guarda el id del recibo: es el ÚNICO nexo entre el aviso y
// el recibo, así que una deriva entre el escritor y el lector no rompe nada
// ruidosamente —rompe la dedupe EN SILENCIO, dejando avisos fallidos que ningún
// reenvío exitoso saca de la lista—. Por eso builder y parser son un solo
// módulo, y no una constante compartida por dos.

const PREFIX = "recibo ";

/** El resumen que se guarda en `Notification.payloadSummary` de un aviso de
 *  tipo `receipt`. El número es único, así que identifica al recibo. */
export function receiptSummaryOf(number: string): string {
  return `${PREFIX}${number}`;
}

/** El número de recibo escondido en un `payloadSummary`, o `null` si el aviso no
 *  era un recibo.
 *
 *  Sale de acá porque no hay de dónde más: la fila de `Notification` no guarda
 *  el id de la entidad y `payloadSummary` es texto libre de 300 caracteres, no
 *  un payload re-armable. Ésa es la limitación, y por eso /admin/salud NO tiene
 *  cola genérica de reintentos: el recibo es el único camino de reenvío que
 *  existe (spec 4C §7.5), y los demás avisos se muestran con su error y de qué
 *  entidad vienen, para rehacerlos desde la pantalla que los origina. */
export function receiptNumberOf(payloadSummary: string | null): string | null {
  if (!payloadSummary?.startsWith(PREFIX)) return null;
  const n = payloadSummary.slice(PREFIX.length).trim();
  return n === "" ? null : n;
}
