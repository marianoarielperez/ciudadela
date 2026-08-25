// Task 10 (5B): qué suscripción de Mercado Pago hay que empujar cuando la
// Comisión le cambia la categoría a un socio (docs/07, fase 5B).
//
// EL PORQUÉ de que esto sea una función pura aparte: la misma decisión que
// `recategorizeApplicationAction` toma inline (`src/app/admin/solicitudes/actions.ts`
// :296-339) se necesita OTRA VEZ acá, contra un socio ya existente —con
// suscripciones plurales (`mpSubscription.findMany`, no un `preapprovalId`
// suelto en la fila)— y sin Prisma: se prueba con una tabla de casos, sin
// fixtures (mismo criterio que `applications/eligibility.ts`).
//
// Sin `export` de nada más: el cableado en `changeCategoryAction` es quien
// decide CUÁNDO llamar a MP y qué hacer si falla; acá sólo se decide QUÉ
// empujar.
//
// `cents` se REDEFINE acá (idéntica a `@/lib/mp/webhook-processor.ts:167`) en
// vez de importarse: ese módulo importa `@/lib/prisma` al evaluarse —arrastra
// el procesador entero del webhook— y este archivo tiene que quedar puro, sin
// Prisma, para que su test tabla ande sin `.env` (mismo criterio que
// `applications/eligibility.ts`, CLAUDE.md).
import { canStillCharge, isCharging } from "@/lib/mp/subscription-status";
import { feeAmountFor, type FeeValueAmounts } from "@/lib/treasury/rules";
import type { MemberCategory } from "@/generated/prisma/client";

function cents(amount: number): number {
  return Math.round(amount * 100);
}

export type ChargeableSubscription = {
  preapprovalId: string;
  status: string;
  /** Último monto conocido/empujado, o `null` si nunca se supo (mismo campo
   *  que `MpSubscription.amount`, ya convertido a número por el llamador). */
  amount: number | null;
};

export type SubscriptionAmountInput = {
  subscriptions: ChargeableSubscription[];
  newCategory: MemberCategory;
  /** El valor vigente, o `null` si todavía no hay ninguno registrado. */
  feeValue: FeeValueAmounts | null;
};

export type SubscriptionAmountPlan = { preapprovalId: string; amount: number };

/** Motivo por el que no se arma un plan, para el asiento de auditoría
 *  (Task 10, arreglo 4): `subscriptionUpdated: false` sólo decía "no hay
 *  nada que empujar" y esa frase tapaba un hueco real — un socio recategorizado
 *  a vitalicio/honorario/cadete con suscripción viva queda indistinguible en el
 *  Libro de uno que nunca tuvo débito automático, y el lote REG-34 tampoco lo
 *  levanta (saltea las categorías sin cuota). Los cuatro motivos:
 *
 *   - `no_subscription`: no hay ninguna suscripción de la que se pueda cobrar
 *     (vacío, o todas `cancelled`/desconocidas para `canStillCharge`);
 *   - `no_fee_value`: todavía no hay valor de cuota vigente cargado;
 *   - `category_without_fee`: la categoría nueva no paga cuota — el hueco de
 *     arriba, el único que necesita ojo humano (cancelar en el panel de MP);
 *   - `same_amount`: el monto esperado ya coincide con el que la suscripción
 *     tiene, no hay nada que empujar. */
export type SubscriptionSkipReason =
  | "no_subscription" | "no_fee_value" | "category_without_fee" | "same_amount";

export type SubscriptionAmountDecision =
  | { plan: SubscriptionAmountPlan; skipped: null }
  | { plan: null; skipped: SubscriptionSkipReason };

/** Qué suscripción hay que empujar a MP si el socio pasa a `newCategory`, con
 *  el motivo cuando no corresponde tocar nada (ver `SubscriptionSkipReason`):
 *
 *   - no hay ninguna suscripción elegible (ver más abajo cuál se prefiere);
 *   - no hay valor de cuota vigente (el corte va ANTES de `feeAmountFor`: su
 *     segundo parámetro no acepta `null`, `rules.ts:10`);
 *   - la categoría nueva no paga cuota (vitalicio, honorario, cadete): ahí lo
 *     que corresponde es CANCELAR la suscripción, y eso es una decisión
 *     humana, no algo que este cableado dispare solo — hueco documentado del
 *     lote REG-34 (`fee-value-batch.ts`);
 *   - el monto esperado ya coincide con el que la suscripción tiene, EN
 *     CENTAVOS (`cents`, mismo criterio que `fee-value-batch.ts` y el
 *     webhook: comparar floats crudos inventa divergencias que no existen).
 *
 *  Cuál suscripción se elige (revisión de Task 10): primero la que YA ESTÁ
 *  cobrando (`isCharging`, sólo `authorized`) y recién si ninguna lo está cae
 *  a la lista blanca completa (`canStillCharge`: `authorized` | `pending` |
 *  `paused`). La pregunta acá es "¿a cuál tiene sentido empujarle un monto
 *  AHORA?" —la misma que documenta el encabezado de `subscription-status.ts`
 *  para REG-34— y no "¿puede salir plata por acá?": con `canStillCharge` a
 *  secas, un intento de adhesión abandonado (`pending`, típicamente el id más
 *  bajo) le ganaba a la suscripción real (`authorized`) por orden de
 *  creación. La que cobra seguía con el monto viejo, el espejo local se
 *  escribía sobre la fila muerta, y si MP llegaba a rechazar el cambio sobre
 *  esa `pending` el `throw` bloqueaba el cambio de categoría entero — un caso
 *  que va a ser rutina apenas exista `/mi/debito` (Task 13), que produce
 *  `pending` abandonadas cada vez que alguien empieza una adhesión y no la
 *  termina. Dentro de cada lista se prefiere el id MENOR (mismo criterio que
 *  `withdraw-with-debits.ts`: el llamador ordena `orderBy: { id: "asc" }`,
 *  así que sólo hace falta tomar la PRIMERA que matchee).
 *
 *  Tabla de casos:
 *   - `pending` (id bajo) + `authorized` (id alto) → gana la `authorized`;
 *   - dos `authorized` → gana la de id menor (determinismo);
 *   - sólo `pending` → se elige igual: no hay mejor candidata.
 *
 *  Sólo mira UNA suscripción: `mpSubscription.memberId` es índice y no unique,
 *  así que un socio puede tener dos vivas, pero empujarle el monto a más de
 *  una no es la regla que pide esta tarea — un socio con dos débitos por mes
 *  es un caso que ya tiene su propia advertencia en la ficha, y REG-34
 *  termina de sincronizar a la que quede afuera. */
export function subscriptionAmountPlan(input: SubscriptionAmountInput): SubscriptionAmountDecision {
  const sub = input.subscriptions.find((s) => isCharging(s.status))
    ?? input.subscriptions.find((s) => canStillCharge(s.status));
  if (!sub) return { plan: null, skipped: "no_subscription" };
  if (input.feeValue === null) return { plan: null, skipped: "no_fee_value" };
  const expected = feeAmountFor(input.newCategory, input.feeValue);
  if (expected === null) return { plan: null, skipped: "category_without_fee" };
  if (sub.amount !== null && cents(sub.amount) === cents(expected)) {
    return { plan: null, skipped: "same_amount" };
  }
  return { plan: { preapprovalId: sub.preapprovalId, amount: expected }, skipped: null };
}
