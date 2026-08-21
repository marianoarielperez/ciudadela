import { beforeEach, describe, expect, it, vi } from "vitest";

// El gateway es el único lugar del sistema que arma cuerpos para la API de
// Mercado Pago, y su forma es un contrato con MP que no se puede verificar
// corriendo tests (no hay red en vitest, y las credenciales viven en el VPS).
// Este archivo fija el cuerpo exacto de `POST /preapproval` mockeando el SDK,
// porque el error que motivó el arreglo —`card_token_id is required`— era
// justamente una diferencia entre lo que mandábamos y lo que MP acepta.
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  planGet: vi.fn(),
}));

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {
    constructor(public opts: unknown) {}
  },
  PreApproval: class {
    create = mocks.create;
    update = mocks.update;
    get = vi.fn();
  },
  PreApprovalPlan: class {
    get = mocks.planGet;
  },
  Payment: class {
    get = vi.fn();
  },
}));

import { makeMpGateway } from "@/lib/mp/gateway";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MP_ACCESS_TOKEN = "TEST-token";
  mocks.create.mockResolvedValue({
    id: "PRE-1",
    init_point: "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=PRE-1",
    status: "pending",
  });
});

describe("createPreapproval", () => {
  const input = {
    reason: "Cuota societaria Vecinal Ciudadela — SOCIO ACTIVO",
    amount: 6000,
    payerEmail: "vecina@x.com",
    externalReference: "solicitud:7",
    backUrl: "https://vecinalciudadela.ar/asociate/retomar/T",
  };

  it("manda `auto_recurring` inline y NO manda `preapproval_plan_id`", async () => {
    await makeMpGateway().createPreapproval(input);

    const body = mocks.create.mock.calls[0][0].body;
    // El flujo CON plan asociado exige `card_token_id` + `status: "authorized"`
    // (o sea, la tarjeta tomada en nuestro sitio) y no devuelve `init_point`:
    // mandar el plan acá rompe la redirección del wizard. Ver docs/06 §2.
    expect(body).not.toHaveProperty("preapproval_plan_id");
    expect(body).not.toHaveProperty("card_token_id");
    expect(body.auto_recurring).toEqual({
      frequency: 1,
      frequency_type: "months",
      transaction_amount: 6000,
      currency_id: "ARS",
    });
  });

  it("manda reason, payer_email, external_reference, back_url y status pending", async () => {
    await makeMpGateway().createPreapproval(input);

    expect(mocks.create.mock.calls[0][0].body).toMatchObject({
      reason: "Cuota societaria Vecinal Ciudadela — SOCIO ACTIVO",
      payer_email: "vecina@x.com",
      // Obligatorio en las suscripciones sin plan, y lo que el webhook matchea.
      external_reference: "solicitud:7",
      back_url: "https://vecinalciudadela.ar/asociate/retomar/T",
      status: "pending",
    });
  });

  it("devuelve el init_point que responde MP, sin reconstruirlo", async () => {
    const res = await makeMpGateway().createPreapproval(input);
    expect(res).toEqual({
      id: "PRE-1",
      initPoint: "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=PRE-1",
      status: "pending",
    });
  });

  it("si MP no devuelve la suscripción creada, tira: no hay a dónde redirigir", async () => {
    mocks.create.mockResolvedValue({ id: "PRE-1" });
    await expect(makeMpGateway().createPreapproval(input)).rejects.toThrow(/no devolvió/i);
  });
});

describe("getPlan", () => {
  it("devuelve el monto vigente del plan (la lectura fresca del wizard)", async () => {
    mocks.planGet.mockResolvedValue({
      id: "PLAN-123",
      reason: "SOCIO ACTIVO",
      auto_recurring: { transaction_amount: 6000 },
    });
    await expect(makeMpGateway().getPlan("PLAN-123")).resolves.toEqual({
      id: "PLAN-123",
      reason: "SOCIO ACTIVO",
      amount: 6000,
    });
  });

  it("plan sin monto: tira en vez de devolver un importe inventado", async () => {
    mocks.planGet.mockResolvedValue({ id: "PLAN-123", reason: "SOCIO ACTIVO", auto_recurring: {} });
    await expect(makeMpGateway().getPlan("PLAN-123")).rejects.toThrow(/no tiene monto/i);
  });
});
