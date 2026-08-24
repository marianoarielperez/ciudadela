// Reglas puras de tesorería (spec §3). Sin Prisma: la tabla de casos se prueba
// sin fixtures. Los mensajes que llegan a pantalla viven en las actions.
import type { MemberCategory, MemberStatus } from "@/generated/prisma/client";
import { DEBT_SNAPSHOT_DATE } from "./debt-import";
import { addMonths, comparePeriods, periodOf, periodRange, type Period } from "./periods";

export type FeeValueAmounts = { activeAmount: number; sharedAmount: number };

/** Monto mensual de la categoría, o `null` si la categoría no paga cuota. */
export function feeAmountFor(category: MemberCategory, v: FeeValueAmounts): number | null {
  switch (category) {
    case "active":
      return v.activeAmount;
    case "adherent":
    case "collaborator":
      return v.sharedAmount;
    default:
      return null; // honorary, lifetime, cadet
  }
}

/** Si la categoría paga cuota, con independencia de que haya un valor vigente.
 *
 *  `feeAmountFor` devuelve `null` por DOS motivos que tienen salidas opuestas
 *  —la categoría no paga cuota, o todavía no hay valor registrado—, y una
 *  pantalla que no los distingue le dice a un socio activo "tu categoría no
 *  paga cuota". Este predicado responde el primero de los dos, y se deriva de
 *  `feeAmountFor` con montos centinela para que no puedan divergir. */
export function categoryPaysFee(category: MemberCategory): boolean {
  return feeAmountFor(category, { activeAmount: 1, sharedAmount: 1 }) !== null;
}

/** Quién devenga cuota obligatoria (docs/02 tabla Art. 5). Adherente es voluntaria. */
export const ACCRUING_CATEGORIES: readonly MemberCategory[] = ["active", "collaborator"];

/** Primer mes completo posterior al ingreso: la cuota de ingreso cubre el mes
 *  de alta (REG-14). Ingresó el 21/08 → primera cuota septiembre. */
export function firstAccrualPeriod(joinedAt: Date): Period {
  return addMonths(periodOf(joinedAt), 1);
}

/** El primer período que la FOTO de deuda NO cubre.
 *
 *  `datos/deuda.xlsx` (21/08/2026) contó las cuotas impagas hasta agosto de 2026
 *  INCLUSIVE: los morosos completos de ese año traen un 8 (enero..agosto) y el
 *  import las materializó. La contracara es la que rompía: un socio del padrón
 *  que estaba al día NO tiene ninguna fila, y "sin filas" no significa "sin
 *  cuotas devengadas" sino **cubierto hasta la fecha de la foto**. Sale de
 *  `DEBT_SNAPSHOT_DATE` y no de un literal suelto: si alguna vez se re-mide el
 *  padrón de deuda, el piso se mueve con el archivo. */
export const IMPORT_COVERAGE_FLOOR: Period = addMonths(periodOf(DEBT_SNAPSHOT_DATE), 1);

/** El primer período que un pago de este socio puede llegar a CREAR.
 *
 *  Existe porque la cuenta corriente no tiene fila para lo que ya está cubierto,
 *  y sin piso `allocate` arrancaba a crear en el mes calendario corriente — que
 *  para un socio al día es justamente un mes ya cubierto (el 23/08/2026 un socio
 *  del padrón sin deuda pagó y el sistema le cobró agosto de nuevo).
 *
 *  Tres términos, y gana el más nuevo:
 *  - la foto de deuda cubre hasta agosto de 2026 (`IMPORT_COVERAGE_FLOOR`);
 *  - para un alta posterior al padrón, la cuota de ingreso cubre el mes de alta
 *    (REG-14), así que el piso es el mes siguiente — es `firstAccrualPeriod`;
 *  - para un reingreso, lo mismo desde el mes del reingreso. Este término NO se
 *    puede derivar de `joinedAt`: el reingreso deliberadamente no lo toca (REG-11,
 *    la antigüedad no se reinicia), así que la fecha tiene que llegar de afuera
 *    —el `Movement` de tipo `readmission` más nuevo—. Sin él, a un ex socio que
 *    vuelve en noviembre se le crearían cuotas de septiembre y octubre, meses en
 *    los que no fue socio y en los que no se devenga nada.
 *
 *  Puro a propósito, y compartido entre el servicio que imputa y las pantallas
 *  que anuncian a qué período va el pago: si cada uno lo calculara por su cuenta,
 *  la pantalla diría un mes y el recibo otro. */
export function coverageFloor(m: { joinedAt: Date; readmittedAt?: Date | null }): Period {
  const candidates: Period[] = [IMPORT_COVERAGE_FLOOR, firstAccrualPeriod(m.joinedAt)];
  if (m.readmittedAt) candidates.push(addMonths(periodOf(m.readmittedAt), 1));
  return candidates.reduce((a, b) => (comparePeriods(b, a) > 0 ? b : a));
}

// La suspensión es disciplinaria, no eximición: el suspendido sigue devengando.
// La baja no devenga: sus pendientes quedan congeladas (deuda al momento de la baja).
// Contrato: se llama para el período CORRIENTE (o uno futuro), nunca para recorrer
// el pasado de un socio que estuvo dado de baja y reingresó — el predicado decide
// con el status ACTUAL y no conoce el intervalo de baja. Si algún día hace falta
// backfill histórico, hay que pasarle ese intervalo aparte.
export function accrues(
  m: { status: MemberStatus; category: MemberCategory; joinedAt: Date },
  period: Period,
): boolean {
  if (m.status === "withdrawn") return false;
  if (!ACCRUING_CATEGORIES.includes(m.category)) return false;
  return comparePeriods(period, firstAccrualPeriod(m.joinedAt)) >= 0;
}

/** Qué períodos hay que CREARLE a este socio para que su cuenta esté completa
 *  hasta `upTo` inclusive. Vacío si la categoría no devenga, si está de baja, o
 *  si ya está todo cubierto.
 *
 *  Es la contracara de `allocate`: las dos arrancan en `coverageFloor(m)`, así
 *  que el mes que el devengo materializa es exactamente el mes que un pago
 *  habría cubierto. Si cada una calculara su propio piso, el sistema le crearía
 *  una cuota de un mes y le imputaría el pago a otro.
 *
 *  A diferencia de `accrues`, ésta SÍ sirve para recorrer el pasado: no
 *  pregunta por un período suelto contra el status de hoy, sino que recorre un
 *  rango cuyo piso ya conoce el reingreso (`readmittedAt`, que el llamador trae
 *  del `Movement` más nuevo — REG-11 impide derivarlo de `joinedAt`).
 *
 *  `existing` son TODOS los períodos que el socio ya tiene, con cualquier
 *  estado y cualquier origen: una cuota `import` manda sobre el devengo porque
 *  ya representa ese mes, y una `paid` no puede volver a nacer pendiente. */
export function periodsToAccrue(
  m: { status: MemberStatus; category: MemberCategory; joinedAt: Date; readmittedAt?: Date | null },
  upTo: Period,
  existing: Period[],
): Period[] {
  if (m.status === "withdrawn") return [];
  if (!ACCRUING_CATEGORIES.includes(m.category)) return [];
  const taken = new Set(existing);
  return periodRange(coverageFloor(m), upTo).filter((p) => !taken.has(p));
}

export const ARREARS_WARNING = 2; // alerta desde la 2ª (REG-15)
export const ARREARS_THRESHOLD = 4; // habilita la cesantía (REG-15)

export type ArrearsLevel = 0 | 1 | 2 | 4;

/** Devuelve el umbral de exhibición (0, 1, 2 o 4), no la cantidad real de cuotas
 *  pendientes: si se cambia `ARREARS_WARNING` o `ARREARS_THRESHOLD` hay que cambiar
 *  también estos literales devueltos. */
export function arrearsLevel(pending: number): ArrearsLevel {
  if (pending >= ARREARS_THRESHOLD) return 4;
  if (pending >= ARREARS_WARNING) return 2;
  if (pending === 1) return 1;
  return 0;
}

/** REG-16 generalizado: deuda = pendientes × valor vigente de la categoría. */
export function debtAmount(pending: number, category: MemberCategory, v: FeeValueAmounts): number {
  const amount = feeAmountFor(category, v);
  return amount === null ? 0 : pending * amount;
}

/** Qué cuotas cubre un pago de `n` cuotas: las pendientes más antiguas primero;
 *  si faltan, períodos nuevos desde `startAt`, salteando los que ya tienen fila
 *  en `existing` — TODOS los períodos ya creados, incluidas las pendientes, no solo
 *  pagados/exentos — para no chocar con el unique (memberId, period).
 *
 *  `startAt` es el PISO DE COBERTURA del socio (`coverageFloor`), no el mes
 *  calendario corriente, y puede quedar ANTERIOR a hoy: un socio que no pagó
 *  septiembre y paga en octubre tiene que cubrir septiembre primero. El
 *  parámetro se llama así, y no `currentPeriod`, para que la semántica vieja
 *  —"empezar por el mes en curso", que le cobraba de nuevo un mes ya cubierto a
 *  todo socio al día— no se pueda pasar por accidente. */
export function allocate(input: {
  pending: Period[];
  existing: Period[];
  n: number;
  startAt: Period;
}): { toPay: Period[]; toCreate: Period[] } {
  const toPay = [...input.pending].sort(comparePeriods).slice(0, input.n);
  const toCreate: Period[] = [];
  const taken = new Set([...input.existing, ...toPay]);
  let p = input.startAt;
  while (toPay.length < input.n) {
    if (!taken.has(p)) {
      toPay.push(p);
      toCreate.push(p);
      taken.add(p);
    }
    p = addMonths(p, 1);
  }
  return { toPay, toCreate };
}

/** Al anular un pago: una cuota de un período futuro no puede quedar pendiente
 *  (contaría como deuda antes de tiempo), así que se borra; las demás vuelven a
 *  pendientes. `toDelete` asume que toda cuota futura ligada a este pago fue creada
 *  POR este pago — vale porque `allocate` solo crea períodos que no existían antes;
 *  si eso deja de cumplirse, esta función borraría una fila que no creó. */
export function revertFees(periods: Period[], currentPeriod: Period): { toPending: Period[]; toDelete: Period[] } {
  const toPending: Period[] = [];
  const toDelete: Period[] = [];
  for (const p of [...periods].sort(comparePeriods)) {
    (comparePeriods(p, currentPeriod) > 0 ? toDelete : toPending).push(p);
  }
  return { toPending, toDelete };
}

export type CashConcept = "fees" | "voluntary" | "extraordinary";

export function cashConceptsFor(category: MemberCategory): CashConcept[] {
  if (ACCRUING_CATEGORIES.includes(category)) return ["fees", "voluntary", "extraordinary"];
  if (category === "adherent") return ["voluntary", "extraordinary"];
  return ["extraordinary"];
}
