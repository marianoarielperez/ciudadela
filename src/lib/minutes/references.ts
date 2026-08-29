// Cuántas cosas respalda un acta, contadas SIN duplicar.
//
// Las exenciones (`feeExemptions` / `feeExemptionsRevoked`) no se cuentan ni se
// listan aparte a propósito: conceder y anular escriben también un `Movement`
// (`fee_exemption` / `fee_exemption_revoked`) con la misma acta, así que ya
// están representadas en `movements` — sumarlas otra vez contaría el mismo
// hecho dos veces. `discardUnusedMinute` sí las chequea aparte, pero ese es un
// resguardo de integridad, no un conteo para mostrar.
export const REFERENCE_COUNT_SELECT = {
  movements: true,
  applications: true,
  feeValues: true,
  booksOpened: true,
  booksClosed: true,
  processesCalled: true,
  processesClosed: true,
} as const;

export type ReferenceCounts = Record<keyof typeof REFERENCE_COUNT_SELECT, number>;

export function referenceCount(c: ReferenceCounts): number {
  return (
    c.movements + c.applications + c.feeValues + c.booksOpened + c.booksClosed +
    c.processesCalled + c.processesClosed
  );
}

export function referenceCountLabel(n: number): string {
  if (n === 0) return "Sin asientos";
  return n === 1 ? "1 asiento" : `${n} asientos`;
}
