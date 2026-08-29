// Cuántas cosas respalda un acta, contadas SIN duplicar.
//
// Dos clases de referentes son SOMBRA de un movimiento y no se cuentan aparte:
//
// - Las exenciones (`feeExemptions` / `feeExemptionsRevoked`): conceder y
//   anular escriben también un `Movement` (`fee_exemption` /
//   `fee_exemption_revoked`) con la misma acta.
// - Las solicitudes ASENTADAS: el asiento escribe el `Movement` de alta o
//   reingreso con la misma acta Y deja `Application.minuteId` apuntándola
//   (`applications/record.ts`). Por eso `applications` se cuenta FILTRADO a
//   las rechazadas, que son las únicas sin movimiento espejo (el rechazo no
//   crea ningún movimiento; sólo escribe `Application.minuteId`).
//
// Sumar cualquiera de las dos sin filtrar contaría el mismo hecho dos veces:
// un acta con 3 altas web diría "6 asientos" y la constancia le imprimiría a
// la secretaría dos renglones por vecino. `discardUnusedMinute` sí las chequea
// todas aparte, pero ese es un resguardo de integridad, no un conteo para
// mostrar.
export const REFERENCE_COUNT_SELECT = {
  movements: true,
  applications: { where: { status: "rejected" as const } },
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
