import { describe, expect, it, vi } from "vitest";
// El módulo importa los tres singletons ligados (gateway, reader, prisma) para
// exportar `paymentLinks`. En un test puro ninguno tiene que evaluarse de
// verdad: `@/lib/prisma` tira sin DATABASE_URL y el gateway armaría el SDK.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: {} }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: {} }));
import { makePaymentLinks, PAYMENT_LINK_ERRORS, paymentLinkTitle } from "@/lib/mp/payment-link";

function deps(value: { activeAmount: number; sharedAmount: number } | null = { activeAmount: 6000, sharedAmount: 3000 }) {
  const gateway = { createPreference: vi.fn(async () => ({ id: "pref-1", initPoint: "https://mp/pref-1" })) };
  const feeValues = { current: vi.fn(async () => value) };
  return {
    gateway,
    feeValues,
    links: makePaymentLinks({
      gateway: gateway as never,
      feeValues: feeValues as never,
      baseUrl: () => "https://vecinalciudadela.ar",
    }),
  };
}

describe("paymentLinkTitle", () => {
  it("singular sin multiplicador, plural con ×", () => {
    expect(paymentLinkTitle(1)).toBe("Cuota Vecinal Ciudadela");
    expect(paymentLinkTitle(3)).toBe("Cuota Vecinal Ciudadela × 3");
  });
});

describe("paymentLinks.create", () => {
  it("crea la preferencia por n × valor de la categoría con referencia pago:{id}:{n} y URLs del sitio", async () => {
    const d = deps();
    const r = await d.links.create({ member: { id: 14, category: "active" }, n: 2 });
    expect(r).toEqual({ ok: true, initPoint: "https://mp/pref-1", amount: 12000, unit: 6000, reference: "pago:14:2" });
    expect(d.gateway.createPreference).toHaveBeenCalledWith({
      title: "Cuota Vecinal Ciudadela × 2",
      amount: 12000,
      externalReference: "pago:14:2",
      backUrl: "https://vecinalciudadela.ar/mi/cuenta?volvio=1",
      notificationUrl: "https://vecinalciudadela.ar/api/webhooks/mp",
    });
  });

  it("adherente usa el monto compartido", async () => {
    const d = deps();
    expect(await d.links.create({ member: { id: 306, category: "adherent" }, n: 1 })).toMatchObject({ ok: true, amount: 3000 });
  });

  it("sin valor vigente / categoría sin cuota / n fuera de rango → errores sin tocar MP", async () => {
    expect(await deps(null).links.create({ member: { id: 1, category: "active" }, n: 1 })).toEqual({ ok: false, error: "no_fee_value" });
    const d = deps();
    expect(await d.links.create({ member: { id: 1, category: "lifetime" }, n: 1 })).toEqual({ ok: false, error: "category_without_fee" });
    expect(await d.links.create({ member: { id: 1, category: "active" }, n: 0 })).toEqual({ ok: false, error: "bad_n" });
    expect(await d.links.create({ member: { id: 1, category: "active" }, n: 61 })).toEqual({ ok: false, error: "bad_n" });
    expect(d.gateway.createPreference).not.toHaveBeenCalled();
  });

  it("un n fraccionario no crea una preferencia por un monto quebrado", async () => {
    // `paymentLinkReference` lo rechazaría tirando, pero recién DESPUÉS de que
    // el monto se calculó: la guarda tiene que estar antes de tocar MP, y la
    // pantalla necesita un error, no una excepción.
    const d = deps();
    expect(await d.links.create({ member: { id: 1, category: "active" }, n: 1.5 })).toEqual({ ok: false, error: "bad_n" });
    expect(d.gateway.createPreference).not.toHaveBeenCalled();
  });

  it("el valor vigente se pide al instante de `now`, no al del arranque del proceso", async () => {
    // El monto es el que rige HOY (REG-34): si el reader recibiera un instante
    // congelado, un valor nuevo no se aplicaría hasta reiniciar PM2.
    const at = new Date("2026-08-23T12:00:00.000Z");
    const gateway = { createPreference: vi.fn(async () => ({ id: "p", initPoint: "https://mp/p" })) };
    const feeValues = { current: vi.fn(async () => ({ activeAmount: 6000, sharedAmount: 3000 })) };
    const links = makePaymentLinks({
      gateway: gateway as never, feeValues: feeValues as never,
      baseUrl: () => "https://vecinalciudadela.ar", now: () => at,
    });
    await links.create({ member: { id: 1, category: "collaborator" }, n: 1 });
    expect(feeValues.current).toHaveBeenCalledWith(at);
  });

  it("cada motivo de rechazo tiene un mensaje de pantalla en castellano", () => {
    for (const key of ["no_fee_value", "category_without_fee", "bad_n"] as const) {
      expect(PAYMENT_LINK_ERRORS[key]).toMatch(/\S/);
    }
  });
});
