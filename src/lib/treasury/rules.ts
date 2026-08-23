// Reglas puras de tesorería (spec §3). Sin Prisma: la tabla de casos se prueba
// sin fixtures. Los mensajes que llegan a pantalla viven en las actions.
import type { MemberCategory, MemberStatus } from "@/generated/prisma/client";
import { addMonths, comparePeriods, periodOf, type Period } from "./periods";

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
 *  si faltan, períodos nuevos desde el corriente, salteando los que ya tienen fila
 *  en `existing` — TODOS los períodos ya creados, incluidas las pendientes, no solo
 *  pagados/exentos — para no chocar con el unique (memberId, period). */
export function allocate(input: {
  pending: Period[];
  existing: Period[];
  n: number;
  currentPeriod: Period;
}): { toPay: Period[]; toCreate: Period[] } {
  const toPay = [...input.pending].sort(comparePeriods).slice(0, input.n);
  const toCreate: Period[] = [];
  const taken = new Set([...input.existing, ...toPay]);
  let p = input.currentPeriod;
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
