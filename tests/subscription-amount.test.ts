import { describe, expect, it } from "vitest";
import { subscriptionAmountPlan } from "@/lib/members/subscription-amount";

// Task 10: qué suscripción hay que empujar a MP cuando cambia la categoría, sin
// tocar Prisma ni el gateway — tabla pura, mismo criterio que
// `src/lib/treasury/rules.ts` y `src/lib/mp/fee-value-batch.ts`.
//
// Lo que se fija acá y no se ve en pantalla:
//   · entre las sub CHARGEABLE se prefiere la que YA ESTÁ cobrando
//     (`isCharging`, sólo `authorized`) y sólo se cae a la lista blanca
//     completa (`canStillCharge`) si ninguna lo está — revisión de Task 10:
//     con `canStillCharge` a secas, una `pending` abandonada (id bajo) le
//     ganaba a la `authorized` real (id alto) por orden de creación;
//   · sin valor vigente el corte es ANTES de llamar a `feeAmountFor` — su
//     segundo parámetro no acepta `null` (rules.ts:10);
//   · una categoría sin cuota (vitalicio/honorario/cadete) es el hueco
//     documentado del lote REG-34: cancelar es decisión humana, no automática;
//   · monto igual (en centavos, no float crudo) es tan "nada que hacer" como no
//     tener suscripción;
//   · y cada "nada que hacer" trae SU motivo (`SubscriptionSkipReason`,
//     revisión de Task 10, arreglo 4): el asiento tiene que poder distinguir
//     "no tenía suscripción" de "tenía una viva y la categoría nueva no paga
//     cuota" — antes los dos casos escribían el mismo `subscriptionUpdated:
//     false` y quedaban indistinguibles en el Libro.
const feeValue = { activeAmount: 7000, sharedAmount: 3500 };

const chargeable = (preapprovalId: string, amount: number | null, status = "authorized") => ({
  preapprovalId, status, amount,
});

describe("subscriptionAmountPlan", () => {
  it("sin suscripciones: no_subscription", () => {
    expect(subscriptionAmountPlan({ subscriptions: [], newCategory: "active", feeValue })).toEqual({
      plan: null, skipped: "no_subscription",
    });
  });

  it("la única suscripción está cancelada: no_subscription (no es la lista blanca de canStillCharge)", () => {
    const decision = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 3500, "cancelled")],
      newCategory: "active",
      feeValue,
    });
    expect(decision).toEqual({ plan: null, skipped: "no_subscription" });
  });

  it("sin valor vigente: no_fee_value, aunque haya sub viva y la categoría pague cuota", () => {
    const decision = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 3500)],
      newCategory: "active",
      feeValue: null,
    });
    expect(decision).toEqual({ plan: null, skipped: "no_fee_value" });
  });

  it("categoría nueva sin cuota (vitalicio/honorario/cadete): category_without_fee — cancelar es decisión humana", () => {
    for (const cat of ["lifetime", "honorary", "cadet"] as const) {
      const decision = subscriptionAmountPlan({
        subscriptions: [chargeable("pre-1", 3500)],
        newCategory: cat,
        feeValue,
      });
      expect(decision).toEqual({ plan: null, skipped: "category_without_fee" });
    }
  });

  it("el monto esperado coincide con el actual: same_amount", () => {
    const decision = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 7000)],
      newCategory: "active",
      feeValue,
    });
    expect(decision).toEqual({ plan: null, skipped: "same_amount" });
  });

  it("coincide en centavos aunque el float traiga cola de precisión: same_amount", () => {
    const decision = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 7000.0000000001)],
      newCategory: "active",
      feeValue,
    });
    expect(decision).toEqual({ plan: null, skipped: "same_amount" });
  });

  it("monto distinto: el plan trae la sub CHARGEABLE y el monto esperado", () => {
    const decision = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 3500)],
      newCategory: "active",
      feeValue,
    });
    expect(decision).toEqual({ plan: { preapprovalId: "pre-1", amount: 7000 }, skipped: null });
  });

  it("monto null (nunca se supo): cuenta como distinto y arma el plan", () => {
    const decision = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", null)],
      newCategory: "active",
      feeValue,
    });
    expect(decision).toEqual({ plan: { preapprovalId: "pre-1", amount: 7000 }, skipped: null });
  });

  it("usa la PRIMERA sub chargeable, salteando una cancelada anterior en la lista", () => {
    const decision = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-dead", 1, "cancelled"), chargeable("pre-1", 3500, "paused")],
      newCategory: "active",
      feeValue,
    });
    expect(decision).toEqual({ plan: { preapprovalId: "pre-1", amount: 7000 }, skipped: null });
  });

  it("adherente y colaborador comparten el monto compartido", () => {
    const decision = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 7000)],
      newCategory: "collaborator",
      feeValue,
    });
    expect(decision).toEqual({ plan: { preapprovalId: "pre-1", amount: 3500 }, skipped: null });
  });

  // ── Revisión de Task 10: cuál sub gana cuando hay más de una chargeable ──
  describe("prioridad: la que ESTÁ cobrando gana sobre la que sólo PODRÍA", () => {
    it("pending (id bajo, primero en la lista) + authorized (id alto): gana la authorized", () => {
      // Caso real: un intento de adhesión abandonado en /mi/debito (Task 13)
      // deja una `pending` con id bajo; la suscripción real que sí cobra queda
      // con id más alto. El llamador ya ordena `orderBy: { id: "asc" }`, así
      // que en la lista la `pending` aparece primero.
      const decision = subscriptionAmountPlan({
        subscriptions: [
          chargeable("pre-pending-abandonada", 3500, "pending"),
          chargeable("pre-authorized-real", 3500, "authorized"),
        ],
        newCategory: "active",
        feeValue,
      });
      expect(decision).toEqual({ plan: { preapprovalId: "pre-authorized-real", amount: 7000 }, skipped: null });
    });

    it("dos authorized: gana la de id menor (determinismo, primera en la lista ordenada)", () => {
      const decision = subscriptionAmountPlan({
        subscriptions: [
          chargeable("pre-authorized-primera", 3500, "authorized"),
          chargeable("pre-authorized-segunda", 3500, "authorized"),
        ],
        newCategory: "active",
        feeValue,
      });
      expect(decision).toEqual({ plan: { preapprovalId: "pre-authorized-primera", amount: 7000 }, skipped: null });
    });

    it("sólo pending: se elige igual — no hay mejor candidata", () => {
      const decision = subscriptionAmountPlan({
        subscriptions: [chargeable("pre-pending", 3500, "pending")],
        newCategory: "active",
        feeValue,
      });
      expect(decision).toEqual({ plan: { preapprovalId: "pre-pending", amount: 7000 }, skipped: null });
    });

    it("pending y paused, ninguna authorized: gana la primera en la lista ordenada (no se prefieren entre sí)", () => {
      // Entre `pending` y `paused` no hay prioridad — las dos están en la lista
      // blanca por igual (`canStillCharge`) y ninguna `isCharging`. Gana la que
      // el `orderBy: { id: "asc" }` del llamador puso primero.
      const decision = subscriptionAmountPlan({
        subscriptions: [
          chargeable("pre-pending", 3500, "pending"),
          chargeable("pre-paused", 3500, "paused"),
        ],
        newCategory: "active",
        feeValue,
      });
      expect(decision).toEqual({ plan: { preapprovalId: "pre-pending", amount: 7000 }, skipped: null });
    });
  });
});
