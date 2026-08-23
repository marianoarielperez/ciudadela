// Las DOS formas de `external_reference` que SIGeV escribe y lee (spec 4B §5):
//   solicitud:{id}      preapproval del wizard (M3)
//   pago:{memberId}:{n} preferencia de Checkout Pro que aplica `n` cuotas (4B)
// Un solo lugar para parsear: el webhook, la conciliación y la bandeja leen lo
// mismo, y un formato nuevo se agrega acá y no en tres regex repartidas.
export const APPLICATION_REF = /^solicitud:(\d+)$/;
export const PAYMENT_LINK_REF = /^pago:(\d+):(\d+)$/;
/** Tope de cuotas por link: el mismo techo que un pago en efectivo. */
export const MAX_LINK_FEES = 60;

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
