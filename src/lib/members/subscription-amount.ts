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
import { canStillCharge } from "@/lib/mp/subscription-status";
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

/** Qué suscripción hay que empujar a MP si el socio pasa a `newCategory`, o
 *  `null` si no corresponde tocar nada:
 *
 *   - no hay ninguna suscripción de la que `canStillCharge` (lista BLANCA:
 *     `authorized` | `pending` | `paused` — una cancelada no puede recibir un
 *     monto nuevo);
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
 *  Sólo mira la PRIMERA suscripción chargeable: `mpSubscription.memberId` es
 *  índice y no unique, así que un socio puede tener dos vivas, pero empujarle
 *  el monto a más de una no es la regla que pide esta tarea — un socio con dos
 *  débitos por mes es un caso que ya tiene su propia advertencia en la ficha,
 *  y REG-34 termina de sincronizar a la que quede afuera. */
export function subscriptionAmountPlan(input: SubscriptionAmountInput): SubscriptionAmountPlan | null {
  const sub = input.subscriptions.find((s) => canStillCharge(s.status));
  if (!sub) return null;
  if (input.feeValue === null) return null;
  const expected = feeAmountFor(input.newCategory, input.feeValue);
  if (expected === null) return null;
  if (sub.amount !== null && cents(sub.amount) === cents(expected)) return null;
  return { preapprovalId: sub.preapprovalId, amount: expected };
}
