import { describe, expect, it } from "vitest";
import { resolveMpPayment, type Decision, type ResolveContext } from "@/lib/mp/resolve";

const empty: ResolveContext = { existingPayment: null, subscription: null, subscriptionByReference: null, application: null, linkMember: null };
const facts = (over: Partial<{ preapprovalId: string | null; externalReference: string | null }> = {}) =>
  ({ mpPaymentId: "777", preapprovalId: null, externalReference: null, ...over });

describe("resolveMpPayment", () => {
  it("1. ya asentado (existe el Payment) → already_processed", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1" }), { ...empty, existingPayment: { id: 3 }, subscription: { memberId: 14, applicationId: null } }))
      .toEqual({ kind: "already_processed", paymentId: 3 });
  });
  it("1 bis. la marca de ingreso NO corta: con el Payment presente manda la regla 1", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, existingPayment: { id: 3 }, application: { id: 9, mpPaymentIdEntry: "777", memberId: 306 } }))
      .toEqual({ kind: "already_processed", paymentId: 3 });
  });

  // Fila 2. La marca `mpPaymentIdEntry` se escribe ANTES de crear el `Payment`:
  // si está la marca de ESTE cobro y no está el `Payment` (la fila 1 no cortó),
  // lo que falta es el `Payment` y hay que reponerlo. Devolver "ya registrado"
  // acá dejaba el cobro sin `Payment` para siempre, y con eso sin la única
  // barrera que impide que después se aplique como CUOTA.
  it("2a. la solicitud tiene la marca de ESTE cobro pero no hay Payment → entry (se repone)", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, application: { id: 9, mpPaymentIdEntry: "777", memberId: 306 } }))
      .toEqual({ kind: "entry", applicationId: 9 });
  });
  // El caso que motivó anteponer la fila 2: el proceso murió antes del
  // `Payment`, MP agotó sus reintentos y DESPUÉS la Comisión asentó el acta, así
  // que `record.ts` le puso socio a la suscripción. Con la fila de suscripción
  // primero, la conciliación re-aplicaba la cuota de INGRESO como cuota social.
  it("2b. marca de este cobro Y suscripción ya con socio → entry, no debit (REG-14)", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1", externalReference: "solicitud:9" }), {
      ...empty, subscription: { memberId: 306, applicationId: 9 }, application: { id: 9, mpPaymentIdEntry: "777", memberId: 306 },
    })).toEqual({ kind: "entry", applicationId: 9 });
  });
  it("2c. marca de este cobro y suscripción todavía sin socio → entry", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1", externalReference: "solicitud:9" }), {
      ...empty, subscription: { memberId: null, applicationId: 9 }, application: { id: 9, mpPaymentIdEntry: "777", memberId: null },
    })).toEqual({ kind: "entry", applicationId: 9 });
  });
  // Ninguna fila posterior puede pisar la marca: se barre todo el espacio de
  // contextos que podría desviar la decisión (suscripción con y sin socio,
  // referencia de solicitud y de link, con y sin preapproval).
  it("2 invariante. con la marca de ESTE cobro la respuesta es SIEMPRE entry", () => {
    const application = { id: 9, mpPaymentIdEntry: "777", memberId: 306 };
    const subscriptions = [null, { memberId: null, applicationId: 9 }, { memberId: 306, applicationId: 9 }];
    const references = [null, "solicitud:9", "pago:306:2"];
    const preapprovals = [null, "pre-1"];
    for (const subscription of subscriptions) {
      for (const externalReference of references) {
        for (const preapprovalId of preapprovals) {
          expect(resolveMpPayment(facts({ preapprovalId, externalReference }), {
            ...empty, application, subscription, subscriptionByReference: { memberId: 306 }, linkMember: { id: 306 },
          })).toEqual({ kind: "entry", applicationId: 9 });
        }
      }
    }
  });

  it("3. suscripción con socio → débito, aunque la referencia apunte a una solicitud borrada (caso 306)", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1", externalReference: "solicitud:9" }), { ...empty, subscription: { memberId: 306, applicationId: null } }))
      .toEqual({ kind: "debit", memberId: 306, preapprovalId: "pre-1" });
  });
  it("4a. suscripción sin socio, solicitud sin ingreso cobrado → entry", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1", externalReference: "solicitud:9" }), {
      ...empty, subscription: { memberId: null, applicationId: 9 }, application: { id: 9, mpPaymentIdEntry: null, memberId: null },
    })).toEqual({ kind: "entry", applicationId: 9 });
  });
  it("4b. suscripción sin socio, solicitud YA con otro ingreso → bandeja duplicate_entry", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1", externalReference: "solicitud:9" }), {
      ...empty, subscription: { memberId: null, applicationId: 9 }, application: { id: 9, mpPaymentIdEntry: "111", memberId: null },
    })).toEqual({ kind: "unmatched", reason: "duplicate_entry" });
  });
  it("5. pago:{memberId}:{n} con socio existente → link n cuotas; socio inexistente → bandeja no_reference", () => {
    expect(resolveMpPayment(facts({ externalReference: "pago:14:2" }), { ...empty, linkMember: { id: 14 } })).toEqual({ kind: "link", memberId: 14, n: 2 });
    expect(resolveMpPayment(facts({ externalReference: "pago:14:2" }), empty)).toEqual({ kind: "unmatched", reason: "no_reference" });
  });
  it("6. solicitud viva sin ingreso, sin suscripción local → entry", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, application: { id: 9, mpPaymentIdEntry: null, memberId: null } }))
      .toEqual({ kind: "entry", applicationId: 9 });
  });
  it("7a. solicitud borrada pero suscripción con esa referencia y socio → débito", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, subscriptionByReference: { memberId: 306 } }))
      .toEqual({ kind: "debit", memberId: 306, preapprovalId: null });
  });
  it("7b. solicitud borrada y nada más → bandeja application_missing", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), empty)).toEqual({ kind: "unmatched", reason: "application_missing" });
  });
  it("7c. solicitud con ingreso de OTRO id y socio ya asentado, sin suscripción → débito del socio", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, application: { id: 9, mpPaymentIdEntry: "111", memberId: 306 } }))
      .toEqual({ kind: "debit", memberId: 306, preapprovalId: null });
  });
  it("8. preapproval sin suscripción local → bandeja no_subscription", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-x" }), empty)).toEqual({ kind: "unmatched", reason: "no_subscription" });
  });
  it("9. sin nada → bandeja no_reference", () => {
    expect(resolveMpPayment(facts(), empty)).toEqual({ kind: "unmatched", reason: "no_reference" });
  });

  // SIN HUECOS: el `return` final es incondicional, así que ningún contexto
  // puede salir sin decisión. Se barre el espacio entero de combinaciones y se
  // verifica que todas caen en un `kind` conocido (un `undefined` que TypeScript
  // no viera en un refactor futuro se cazaría acá).
  it("tabla sin huecos: toda combinación devuelve una decisión conocida", () => {
    const kinds: Decision["kind"][] = ["already_processed", "debit", "link", "entry", "unmatched"];
    const existings = [null, { id: 3 }];
    const subscriptions = [null, { memberId: null, applicationId: 9 }, { memberId: 306, applicationId: 9 }];
    const byRefs = [null, { memberId: null }, { memberId: 306 }];
    const applications = [
      null,
      { id: 9, mpPaymentIdEntry: null, memberId: null },
      { id: 9, mpPaymentIdEntry: "777", memberId: 306 },
      { id: 9, mpPaymentIdEntry: "111", memberId: null },
      { id: 9, mpPaymentIdEntry: "111", memberId: 306 },
    ];
    const linkMembers = [null, { id: 306 }];
    const references = [null, "solicitud:9", "pago:306:2", "basura"];
    const preapprovals = [null, "pre-1"];
    let cases = 0;
    for (const existingPayment of existings) {
      for (const subscription of subscriptions) {
        for (const subscriptionByReference of byRefs) {
          for (const application of applications) {
            for (const linkMember of linkMembers) {
              for (const externalReference of references) {
                for (const preapprovalId of preapprovals) {
                  const d = resolveMpPayment(facts({ preapprovalId, externalReference }), {
                    existingPayment, subscription, subscriptionByReference, application, linkMember,
                  });
                  expect(kinds).toContain(d.kind);
                  cases += 1;
                }
              }
            }
          }
        }
      }
    }
    expect(cases).toBe(2 * 3 * 3 * 5 * 2 * 4 * 2);
  });
});
