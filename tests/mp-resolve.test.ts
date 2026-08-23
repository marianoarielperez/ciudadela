import { describe, expect, it } from "vitest";
import { resolveMpPayment, type ResolveContext } from "@/lib/mp/resolve";

const empty: ResolveContext = { existingPayment: null, subscription: null, subscriptionByReference: null, application: null, linkMember: null };
const facts = (over: Partial<{ preapprovalId: string | null; externalReference: string | null }> = {}) =>
  ({ mpPaymentId: "777", preapprovalId: null, externalReference: null, ...over });

describe("resolveMpPayment", () => {
  it("1. ya asentado → already_processed", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1" }), { ...empty, existingPayment: { id: 3 }, subscription: { memberId: 14, applicationId: null } }))
      .toEqual({ kind: "already_processed", paymentId: 3, result: "already_processed" });
  });
  it("2. suscripción con socio → débito, aunque la referencia apunte a una solicitud borrada (caso 306)", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1", externalReference: "solicitud:9" }), { ...empty, subscription: { memberId: 306, applicationId: null } }))
      .toEqual({ kind: "debit", memberId: 306, preapprovalId: "pre-1" });
  });
  it("3a. suscripción sin socio, solicitud sin ingreso cobrado → entry", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1", externalReference: "solicitud:9" }), {
      ...empty, subscription: { memberId: null, applicationId: 9 }, application: { id: 9, mpPaymentIdEntry: null, memberId: null },
    })).toEqual({ kind: "entry", applicationId: 9 });
  });
  it("3b. suscripción sin socio, solicitud YA con otro ingreso → bandeja duplicate_entry", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1", externalReference: "solicitud:9" }), {
      ...empty, subscription: { memberId: null, applicationId: 9 }, application: { id: 9, mpPaymentIdEntry: "111", memberId: null },
    })).toEqual({ kind: "unmatched", reason: "duplicate_entry" });
  });
  it("3c. el ingreso ya registrado en la solicitud con ESTE id (pre-4B) → entry_already_recorded", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, application: { id: 9, mpPaymentIdEntry: "777", memberId: 306 } }))
      .toEqual({ kind: "already_processed", paymentId: null, result: "entry_already_recorded" });
  });
  it("4. pago:{memberId}:{n} con socio existente → link n cuotas; socio inexistente → bandeja no_reference", () => {
    expect(resolveMpPayment(facts({ externalReference: "pago:14:2" }), { ...empty, linkMember: { id: 14 } })).toEqual({ kind: "link", memberId: 14, n: 2 });
    expect(resolveMpPayment(facts({ externalReference: "pago:14:2" }), empty)).toEqual({ kind: "unmatched", reason: "no_reference" });
  });
  it("5. solicitud viva sin ingreso, sin suscripción local → entry", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, application: { id: 9, mpPaymentIdEntry: null, memberId: null } }))
      .toEqual({ kind: "entry", applicationId: 9 });
  });
  it("6a. solicitud borrada pero suscripción con esa referencia y socio → débito", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, subscriptionByReference: { memberId: 306 } }))
      .toEqual({ kind: "debit", memberId: 306, preapprovalId: null });
  });
  it("6b. solicitud borrada y nada más → bandeja application_missing", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), empty)).toEqual({ kind: "unmatched", reason: "application_missing" });
  });
  it("6c. solicitud con ingreso de OTRO id y socio ya asentado, sin suscripción → débito del socio", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, application: { id: 9, mpPaymentIdEntry: "111", memberId: 306 } }))
      .toEqual({ kind: "debit", memberId: 306, preapprovalId: null });
  });
  it("7. preapproval sin suscripción local → bandeja no_subscription", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-x" }), empty)).toEqual({ kind: "unmatched", reason: "no_subscription" });
  });
  it("8. sin nada → bandeja no_reference", () => {
    expect(resolveMpPayment(facts(), empty)).toEqual({ kind: "unmatched", reason: "no_reference" });
  });
});
