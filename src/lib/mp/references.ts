// Las DOS formas de `external_reference` que SIGeV escribe y lee (spec 4B §5):
//   solicitud:{id}      preapproval del wizard (M3)
//   pago:{memberId}:{n} preferencia de Checkout Pro que aplica `n` cuotas (4B)
// Un solo lugar para parsear: el webhook, la conciliación y la bandeja leen lo
// mismo, y un formato nuevo se agrega acá y no en tres regex repartidas.
export const APPLICATION_REF = /^solicitud:(\d+)$/;
export const PAYMENT_LINK_REF = /^pago:(\d+):(\d+)$/;
/** Tope de cuotas por link: el mismo techo que un pago en efectivo. */
export const MAX_LINK_FEES = 60;

/** Cuánto vale un link de pago antes de vencer.
 *
 *  EL PORQUÉ: el importe de la preferencia queda CONGELADO al valor de cuota
 *  del día en que se generó. Si el link no venciera, uno olvidado en el buzón
 *  se pagaría meses después al precio viejo: el webhook imputa igual las `n`
 *  cuotas y sólo queda un asiento de divergencia que ninguna pantalla muestra.
 *  Con hasta 4 actualizaciones de cuota por año (REG-34), 72 h es más corto que
 *  cualquier ventana en la que un valor nuevo pase inadvertido, y alcanza para
 *  el caso real que hay que cubrir: el operador manda el link un viernes a la
 *  tarde, el vecino lo lee el sábado y lo paga el lunes.
 *
 *  Vive acá —módulo puro, sin gateway— porque lo leen tres lugares: el cuerpo
 *  de la preferencia, el texto de la pantalla del operador y el del email. */
export const PAYMENT_LINK_TTL_HOURS = 72;
export const PAYMENT_LINK_TTL_MS = PAYMENT_LINK_TTL_HOURS * 60 * 60 * 1000;

export function applicationReference(applicationId: number): string {
  return `solicitud:${applicationId}`;
}

export function parseApplicationReference(ref: string | null | undefined): number | null {
  const m = ref?.match(APPLICATION_REF);
  return m ? Number(m[1]) : null;
}

export function paymentLinkReference(memberId: number, n: number): string {
  if (!Number.isInteger(memberId) || memberId <= 0) throw new Error("memberId inválido");
  if (!Number.isInteger(n) || n < 1 || n > MAX_LINK_FEES) throw new Error("n fuera de rango");
  return `pago:${memberId}:${n}`;
}

export function parsePaymentLinkReference(ref: string | null | undefined): { memberId: number; n: number } | null {
  const m = ref?.match(PAYMENT_LINK_REF);
  if (!m) return null;
  const memberId = Number(m[1]);
  const n = Number(m[2]);
  if (memberId <= 0 || n < 1 || n > MAX_LINK_FEES) return null;
  return { memberId, n };
}

/** Preapproval que SIGeV crea para un SOCIO existente desde su panel (M5B).
 *  El formato estaba reservado desde la 4B (docs/06 §2). Los cobros NO se
 *  resuelven por esta referencia —la fila local nace con memberId y la regla 3
 *  de resolve.ts ("la suscripción manda") los imputa sola—: la referencia es
 *  para el operador que mira MP o la bandeja, no para la imputación. */
export const MEMBER_SUBSCRIPTION_REF = /^socio:(\d+)$/;

export function memberSubscriptionReference(memberId: number): string {
  if (!Number.isInteger(memberId) || memberId <= 0) throw new Error("memberId inválido");
  return `socio:${memberId}`;
}

export function parseMemberSubscriptionReference(ref: string | null | undefined): number | null {
  const m = ref?.match(MEMBER_SUBSCRIPTION_REF);
  const id = m ? Number(m[1]) : null;
  return id && id > 0 ? id : null;
}
