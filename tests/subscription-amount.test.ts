import { describe, expect, it } from "vitest";
import { subscriptionAmountPlan } from "@/lib/members/subscription-amount";

// Task 10: qué suscripción hay que empujar a MP cuando cambia la categoría, sin
// tocar Prisma ni el gateway — tabla pura, mismo criterio que
// `src/lib/treasury/rules.ts` y `src/lib/mp/fee-value-batch.ts`.
//
// Lo que se fija acá y no se ve en pantalla:
//   · sólo la PRIMERA sub con `canStillCharge` importa: las demás (canceladas o
//     inexistentes) no pueden recibir un monto nuevo;
//   · sin valor vigente el corte es ANTES de llamar a `feeAmountFor` — su
//     segundo parámetro no acepta `null` (rules.ts:10);
//   · una categoría sin cuota (vitalicio/honorario/cadete) es el hueco
//     documentado del lote REG-34: cancelar es decisión humana, no automática;
//   · monto igual (en centavos, no float crudo) es tan "nada que hacer" como no
//     tener suscripción.
const feeValue = { activeAmount: 7000, sharedAmount: 3500 };

const chargeable = (preapprovalId: string, amount: number | null, status = "authorized") => ({
  preapprovalId, status, amount,
});

describe("subscriptionAmountPlan", () => {
  it("sin suscripciones: null", () => {
    expect(subscriptionAmountPlan({ subscriptions: [], newCategory: "active", feeValue })).toBeNull();
  });

  it("la única suscripción está cancelada: null (no es la lista blanca de canStillCharge)", () => {
    const plan = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 3500, "cancelled")],
      newCategory: "active",
      feeValue,
    });
    expect(plan).toBeNull();
  });

  it("sin valor vigente: null, aunque haya sub viva y la categoría pague cuota", () => {
    const plan = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 3500)],
      newCategory: "active",
      feeValue: null,
    });
    expect(plan).toBeNull();
  });

  it("categoría nueva sin cuota (vitalicio/honorario/cadete): null — cancelar es decisión humana", () => {
    for (const cat of ["lifetime", "honorary", "cadet"] as const) {
      const plan = subscriptionAmountPlan({
        subscriptions: [chargeable("pre-1", 3500)],
        newCategory: cat,
        feeValue,
      });
      expect(plan).toBeNull();
    }
  });

  it("el monto esperado coincide con el actual: null", () => {
    const plan = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 7000)],
      newCategory: "active",
      feeValue,
    });
    expect(plan).toBeNull();
  });

  it("coincide en centavos aunque el float traiga cola de precisión: null", () => {
    const plan = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 7000.0000000001)],
      newCategory: "active",
      feeValue,
    });
    expect(plan).toBeNull();
  });

  it("monto distinto: el plan trae la sub CHARGEABLE y el monto esperado", () => {
    const plan = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 3500)],
      newCategory: "active",
      feeValue,
    });
    expect(plan).toEqual({ preapprovalId: "pre-1", amount: 7000 });
  });

  it("monto null (nunca se supo): cuenta como distinto y arma el plan", () => {
    const plan = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", null)],
      newCategory: "active",
      feeValue,
    });
    expect(plan).toEqual({ preapprovalId: "pre-1", amount: 7000 });
  });

  it("usa la PRIMERA sub chargeable, salteando una cancelada anterior en la lista", () => {
    const plan = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-dead", 1, "cancelled"), chargeable("pre-1", 3500, "paused")],
      newCategory: "active",
      feeValue,
    });
    expect(plan).toEqual({ preapprovalId: "pre-1", amount: 7000 });
  });

  it("adherente y colaborador comparten el monto compartido", () => {
    const plan = subscriptionAmountPlan({
      subscriptions: [chargeable("pre-1", 7000)],
      newCategory: "collaborator",
      feeValue,
    });
    expect(plan).toEqual({ preapprovalId: "pre-1", amount: 3500 });
  });
});
