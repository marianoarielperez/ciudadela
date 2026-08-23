// Etiquetas es-AR de tesorería. Un solo lugar: pantalla, PDF y email dicen lo mismo.
import type { FeeStatus, IncomeMethod, PaymentType } from "@/generated/prisma/client";
import { addMonths, comparePeriods, monthName, periodLabel, periodMonth, periodYear, type Period } from "./periods";
import type { CashConcept } from "./rules";

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  debit: "Débito automático",
  link: "Link de pago",
  cash: "Efectivo",
  voluntary: "Aporte voluntario",
  entry: "Cuota de ingreso",
  extraordinary: "Aporte extraordinario",
};

export const FEE_STATUS_LABELS: Record<FeeStatus, string> = {
  pending: "Pendiente",
  paid: "Pagada",
  exempt: "Exenta",
  voided: "Anulada",
};

// Por dónde entró un ingreso NO societario. "Efectivo" dice lo mismo que en
// `PAYMENT_TYPE_LABELS` a propósito: para el operador es el mismo mostrador,
// aunque acá no haya socio ni recibo.
export const INCOME_METHOD_LABELS: Record<IncomeMethod, string> = {
  cash: "Efectivo",
  mp: "Mercado Pago",
};

// Sugerencias del campo "Concepto" de un ingreso no societario. NO son
// categorías: el cliente descartó una lista fija y el campo es texto libre. Lo
// que resuelven es la ortografía —que dos alquileres cargados con seis meses de
// diferencia se escriban igual—, no la clasificación.
//
// Viven acá, en un solo lugar, y no en cada pantalla: el formulario de Otros
// ingresos y el de la bandeja sin conciliar ofrecen exactamente lo mismo. Si el
// cliente decide que no las quiere, sacarlas es borrar el `options`/`<datalist>`
// de los dos lados y esta constante.
export const INCOME_CONCEPT_SUGGESTIONS = ["Alquiler del salón", "Evento", "Rifa", "Donación"];

/** La aclaración que acompaña a esas sugerencias. Va en los dos formularios: un
 *  desplegable sin explicación es lo más fácil de leer como lista cerrada. */
export const INCOME_CONCEPT_HINT =
  "Texto libre: escribí a qué corresponde. Las sugerencias son sólo eso.";

export const CASH_CONCEPT_LABELS: Record<CashConcept, string> = {
  fees: "Cuotas sociales",
  voluntary: "Aporte voluntario",
  extraordinary: "Aporte extraordinario",
};

/** "marzo a mayo 2025 (3 cuotas)" para rangos contiguos; lista separada por
 *  comas cuando no lo son. Un solo período va sin contador. */
export function describePeriods(periods: Period[]): string {
  const sorted = [...periods].sort(comparePeriods);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return periodLabel(sorted[0]);
  const contiguous = sorted.every((p, i) => i === 0 || addMonths(sorted[i - 1], 1) === p);
  const count = ` (${sorted.length} cuotas)`;
  if (!contiguous) return sorted.map(periodLabel).join(", ") + count;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (periodYear(first) === periodYear(last)) {
    return `${monthName(periodMonth(first))} a ${monthName(periodMonth(last))} ${periodYear(first)}${count}`;
  }
  return `${periodLabel(first)} a ${periodLabel(last)}${count}`;
}

export function paymentConcept(type: PaymentType, periods: Period[]): string {
  if (type === "voluntary" || type === "extraordinary" || type === "entry") return PAYMENT_TYPE_LABELS[type];
  const described = describePeriods(periods);
  return described ? `Cuota social · ${described}` : "Cuota social";
}
