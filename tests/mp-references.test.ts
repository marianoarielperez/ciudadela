import { describe, expect, it } from "vitest";
import {
  applicationReference, memberSubscriptionReference, parseApplicationReference,
  parseMemberSubscriptionReference, parsePaymentLinkReference, paymentLinkReference,
} from "@/lib/mp/references";

describe("referencias de MP", () => {
  it("solicitud:{id} ida y vuelta", () => {
    expect(applicationReference(9)).toBe("solicitud:9");
    expect(parseApplicationReference("solicitud:9")).toBe(9);
    expect(parseApplicationReference("solicitud:x")).toBeNull();
    expect(parseApplicationReference(null)).toBeNull();
  });
  it("pago:{memberId}:{n} ida y vuelta, n entre 1 y 60", () => {
    expect(paymentLinkReference(14, 2)).toBe("pago:14:2");
    expect(parsePaymentLinkReference("pago:14:2")).toEqual({ memberId: 14, n: 2 });
    expect(parsePaymentLinkReference("pago:14:0")).toBeNull();
    expect(parsePaymentLinkReference("pago:14:61")).toBeNull();
    expect(parsePaymentLinkReference("pago:0:1")).toBeNull();
    expect(parsePaymentLinkReference("pago:14")).toBeNull();
    expect(parsePaymentLinkReference(undefined)).toBeNull();
  });
  it("armar con valores fuera de rango tira", () => {
    expect(() => paymentLinkReference(14, 0)).toThrow();
    expect(() => paymentLinkReference(14, 61)).toThrow();
  });

  it("socio:{id} ida y vuelta", () => {
    expect(memberSubscriptionReference(298)).toBe("socio:298");
    expect(parseMemberSubscriptionReference("socio:298")).toBe(298);
    expect(parseMemberSubscriptionReference("socio:0")).toBeNull();
    expect(parseMemberSubscriptionReference("socio:x")).toBeNull();
    expect(parseMemberSubscriptionReference("solicitud:298")).toBeNull();
    expect(parseMemberSubscriptionReference(null)).toBeNull();
    expect(parseMemberSubscriptionReference(undefined)).toBeNull();
  });

  it("armar socio:{id} con valores inválidos tira", () => {
    expect(() => memberSubscriptionReference(0)).toThrow();
    expect(() => memberSubscriptionReference(-1)).toThrow();
    expect(() => memberSubscriptionReference(1.5)).toThrow();
  });
});
