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
  paymentGet: vi.fn(),
  preapprovalGet: vi.fn(),
  preferenceCreate: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {
    constructor(public opts: unknown) {}
  },
  PreApproval: class {
    create = mocks.create;
    update = mocks.update;
    get = mocks.preapprovalGet;
  },
  PreApprovalPlan: class {
    get = mocks.planGet;
  },
  Payment: class {
    get = mocks.paymentGet;
  },
  Preference: class {
    create = mocks.preferenceCreate;
  },
}));

// Las búsquedas y `/authorized_payments` no pasan por el SDK: van por `fetch`
// autenticado directo. Mockeamos el global para fijar la URL exacta que se le
// pide a MP (no hay red en vitest).
vi.stubGlobal("fetch", mocks.fetch);

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

// ── 4B: fechas reales de acreditación, el `payment.id` de un cobro de
// suscripción, las búsquedas de la conciliación y Checkout Pro. ──────────────

describe("getPayment (4B)", () => {
  it("devuelve dateApproved como Date UTC, payerEmail y description", async () => {
    mocks.paymentGet.mockResolvedValue({
      id: 777,
      status: "approved",
      status_detail: "accredited",
      transaction_amount: 6000,
      external_reference: "solicitud:9",
      // MP manda el offset argentino: el gateway es el ÚNICO que lo parsea.
      date_approved: "2026-09-10T08:15:30.000-03:00",
      payer: { email: "v@x.com" },
      description: "Cuota Vecinal Ciudadela",
    });
    const p = await makeMpGateway().getPayment("777");
    expect(p).toMatchObject({
      id: "777",
      status: "approved",
      statusDetail: "accredited",
      transactionAmount: 6000,
      externalReference: "solicitud:9",
      payerEmail: "v@x.com",
      description: "Cuota Vecinal Ciudadela",
    });
    expect(p.dateApproved?.toISOString()).toBe("2026-09-10T11:15:30.000Z");
  });

  it("sin date_approved → null; sin payer → null", async () => {
    mocks.paymentGet.mockResolvedValue({ id: 1, status: "in_process", transaction_amount: 1 });
    const p = await makeMpGateway().getPayment("1");
    expect(p.dateApproved).toBeNull();
    expect(p.payerEmail).toBeNull();
  });

  // Verificado contra la API real el 23/08/2026: en un cobro de suscripción, el
  // preapproval llega acá y en ningún campo de primer nivel. Es lo que hace que
  // la notificación `payment` de un débito se baste sola.
  it("saca el preapproval de point_of_interaction en un cobro de suscripción", async () => {
    mocks.paymentGet.mockResolvedValue({
      id: 9,
      status: "approved",
      transaction_amount: 6000,
      external_reference: "t14b:debito",
      point_of_interaction: {
        type: "SUBSCRIPTIONS",
        transaction_data: { subscription_id: "616cb7f93d7f43fa814d2c5437a38b35" },
      },
    });
    const p = await makeMpGateway().getPayment("9");
    expect(p.subscriptionId).toBe("616cb7f93d7f43fa814d2c5437a38b35");
  });

  it("un pago que no viene de una suscripción no inventa preapproval", async () => {
    mocks.paymentGet.mockResolvedValue({ id: 9, status: "approved", transaction_amount: 500 });
    expect((await makeMpGateway().getPayment("9")).subscriptionId).toBeNull();
    // Cadena vacía tratada como ausente: resolvería contra una fila inexistente.
    mocks.paymentGet.mockResolvedValue({
      id: 9, status: "approved", transaction_amount: 500,
      point_of_interaction: { transaction_data: { subscription_id: "" } },
    });
    expect((await makeMpGateway().getPayment("9")).subscriptionId).toBeNull();
  });
});

describe("getAuthorizedPayment (4B)", () => {
  it("trae paymentId, amount y dateCreated del cobro", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 55,
          preapproval_id: "pre-1",
          status: "processed",
          payment: { id: 777, status: "approved" },
          transaction_amount: 6000,
          date_created: "2026-09-10T08:00:00.000-03:00",
          external_reference: "x",
        }),
        { status: 200 },
      ),
    );
    const a = await makeMpGateway().getAuthorizedPayment("55");
    expect(a).toMatchObject({
      id: "55",
      preapprovalId: "pre-1",
      status: "processed",
      paymentId: "777",
      amount: 6000,
      externalReference: "x",
    });
    expect(a.dateCreated?.toISOString()).toBe("2026-09-10T11:00:00.000Z");
    expect(mocks.fetch.mock.calls[0][0]).toBe("https://api.mercadopago.com/authorized_payments/55");
    expect(mocks.fetch.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer TEST-token" });
  });

  it("sin `payment` el paymentId queda en null (el cobro todavía no existe)", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ id: 56, preapproval_id: "pre-1", status: "scheduled" }), {
        status: 200,
      }),
    );
    expect((await makeMpGateway().getAuthorizedPayment("56")).paymentId).toBeNull();
  });
});

describe("getPreapproval (4B)", () => {
  it("suma amount, reason y nextPaymentDate", async () => {
    mocks.preapprovalGet.mockResolvedValue({
      id: "pre-1",
      status: "authorized",
      payer_email: "v@x.com",
      external_reference: null,
      reason: "Cuota",
      auto_recurring: { transaction_amount: 6000 },
      next_payment_date: "2026-09-10T03:00:00.000Z",
    });
    const s = await makeMpGateway().getPreapproval("pre-1");
    expect(s).toMatchObject({ amount: 6000, reason: "Cuota", externalReference: null });
    expect(s.nextPaymentDate?.toISOString()).toBe("2026-09-10T03:00:00.000Z");
  });
});

describe("searchPreapprovals", () => {
  it("pagina de a 100 hasta agotar y filtra por status", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            paging: { total: 101, limit: 100, offset: 0 },
            results: Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, status: "authorized" })),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            paging: { total: 101, limit: 100, offset: 100 },
            results: [{ id: "p100", status: "authorized" }],
          }),
          { status: 200 },
        ),
      );
    const rows = await makeMpGateway().searchPreapprovals({ status: "authorized" });
    expect(rows).toHaveLength(101);
    expect(String(mocks.fetch.mock.calls[0][0])).toContain("/preapproval/search?");
    expect(String(mocks.fetch.mock.calls[0][0])).toContain("status=authorized");
    expect(String(mocks.fetch.mock.calls[1][0])).toContain("offset=100");
  });

  it("una respuesta no-2xx lanza (fallo técnico, no result)", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(makeMpGateway().searchPreapprovals()).rejects.toThrow(
      "preapproval/search respondió 500",
    );
  });
});

describe("searchAuthorizedPayments", () => {
  it("consulta por preapproval_id y mapea los resultados", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          paging: { total: 1, limit: 100, offset: 0 },
          results: [
            {
              id: 9,
              preapproval_id: "pre-1",
              status: "processed",
              payment: { id: 777 },
              transaction_amount: 6000,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const rows = await makeMpGateway().searchAuthorizedPayments("pre-1");
    expect(rows[0]).toMatchObject({ id: "9", paymentId: "777", amount: 6000 });
    expect(String(mocks.fetch.mock.calls[0][0])).toContain(
      "authorized_payments/search?preapproval_id=pre-1",
    );
  });

  // El bug que la batería de la T14 encontró contra la API real: este endpoint
  // RECHAZA `limit` por encima de ~15 con `Invalid value for limit` (400), así
  // que mandarle el PAGE de 100 lo hacía fallar SIEMPRE. Como es el que sostiene
  // el paso 2 de la conciliación —recuperar un débito cuyo webhook no llegó—, la
  // red de contención estuvo caída desde que se escribió, y en silencio: el cron
  // sumaba el error a `errors[]` y seguía.
  it("NO manda `limit`: la API lo rechaza en este endpoint", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ paging: { total: 0, limit: 12, offset: 0 }, results: [] }),
        { status: 200 },
      ),
    );
    await makeMpGateway().searchAuthorizedPayments("pre-1");
    const url = String(mocks.fetch.mock.calls[0][0]);
    expect(url).not.toContain("limit=");
    expect(url).toContain("offset=0");
  });

  // Sin `limit` el tamaño de página lo elige MP (hoy 12). El bucle tiene que
  // seguir paginando contra `paging.total` y no contra un tamaño supuesto.
  it("pagina con el tamaño que elige MP, no con uno propio", async () => {
    const page = (offset: number, n: number) =>
      new Response(
        JSON.stringify({
          paging: { total: 14, limit: 12, offset },
          results: Array.from({ length: n }, (_, i) => ({
            id: offset + i,
            preapproval_id: "pre-1",
            status: "processed",
            payment: { id: 1000 + offset + i },
            transaction_amount: 6000,
          })),
        }),
        { status: 200 },
      );
    mocks.fetch.mockResolvedValueOnce(page(0, 12)).mockResolvedValueOnce(page(12, 2));
    const rows = await makeMpGateway().searchAuthorizedPayments("pre-1");
    expect(rows).toHaveLength(14);
    expect(String(mocks.fetch.mock.calls[1][0])).toContain("offset=12");
    expect(String(mocks.fetch.mock.calls[1][0])).not.toContain("limit=");
  });
});

describe("searchPayments", () => {
  it("busca approved por date_approved desde `since`", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          paging: { total: 1, limit: 100, offset: 0 },
          results: [
            {
              id: 777,
              status: "approved",
              transaction_amount: 6000,
              date_approved: "2026-09-10T11:15:30.000Z",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const rows = await makeMpGateway().searchPayments({ since: new Date("2026-09-07T11:00:00Z") });
    expect(rows[0]).toMatchObject({ id: "777", status: "approved", transactionAmount: 6000 });
    const url = String(mocks.fetch.mock.calls[0][0]);
    expect(url).toContain("/v1/payments/search?");
    expect(url).toContain("range=date_approved");
    expect(url).toContain("status=approved");
    expect(decodeURIComponent(url)).toContain("begin_date=2026-09-07T11:00:00.000Z");
  });
});

describe("createPreference", () => {
  it("manda título, monto, referencia, back_urls, notification_url y vencimiento; devuelve init_point", async () => {
    mocks.preferenceCreate.mockResolvedValue({
      id: "pref-1",
      init_point: "https://mp/checkout/pref-1",
    });
    const r = await makeMpGateway().createPreference({
      title: "Cuota Vecinal Ciudadela × 2",
      amount: 12000,
      externalReference: "pago:14:2",
      backUrl: "https://vecinalciudadela.ar/mi/cuenta?volvio=1",
      notificationUrl: "https://vecinalciudadela.ar/api/webhooks/mp",
      expiresAt: new Date("2026-08-26T12:00:00.000Z"),
    });
    expect(r).toEqual({ id: "pref-1", initPoint: "https://mp/checkout/pref-1" });
    const body = mocks.preferenceCreate.mock.calls[0][0].body;
    expect(body.items[0]).toMatchObject({
      title: "Cuota Vecinal Ciudadela × 2",
      quantity: 1,
      unit_price: 12000,
      currency_id: "ARS",
    });
    expect(body.external_reference).toBe("pago:14:2");
    expect(body.back_urls).toEqual({
      success: "https://vecinalciudadela.ar/mi/cuenta?volvio=1",
      pending: "https://vecinalciudadela.ar/mi/cuenta?volvio=1",
      failure: "https://vecinalciudadela.ar/mi/cuenta?volvio=1",
    });
    expect(body.auto_return).toBe("approved");
    expect(body.notification_url).toBe("https://vecinalciudadela.ar/api/webhooks/mp");
    // El enlace VENCE. Sin esto la preferencia no caduca nunca y el importe,
    // congelado al valor del día en que se generó, sobrevive a una
    // actualización de cuota (REG-34). `expires` y `expiration_date_to` van
    // juntos: uno sin el otro no hace nada.
    expect(body.expires).toBe(true);
    // Formato de MP: ISO 8601 con offset argentino, no con "Z".
    expect(body.expiration_date_to).toBe("2026-08-26T09:00:00.000-03:00");
    // Y NO se manda `expiration_date_from`: sería "ahora", y un reloj de MP
    // unos segundos adelantado rechazaría la preferencia entera.
    expect(body.expiration_date_from).toBeUndefined();
  });
});

// ── Reintento ante 429 (hallazgo de producción, 24/08/2026) ──────────────────
// La primera conciliación real terminó con tres pasos caídos por límite de
// ráfaga: MP no rechazó nada, cortó por velocidad. Las LECTURAS se reintentan;
// las escrituras NO, que un reintento ahí puede duplicar una suscripción.

describe("reintento ante 429", () => {
  const rateLimited = () => ({ message: "rate limited", error: "local_rate_limited", status: 429 });

  it("getPlan: 429 → 429 → éxito, sin que el llamador se entere", async () => {
    vi.useFakeTimers();
    try {
      mocks.planGet
        .mockRejectedValueOnce(rateLimited())
        .mockRejectedValueOnce(rateLimited())
        .mockResolvedValueOnce({ id: "PLAN-1", reason: "SOCIO ACTIVO", auto_recurring: { transaction_amount: 6000 } });

      const p = makeMpGateway().getPlan("PLAN-1");
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(p).resolves.toMatchObject({ id: "PLAN-1", amount: 6000 });
      expect(mocks.planGet).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  // El 429 de las búsquedas no viene del SDK sino del `fetch` directo: el
  // `Error` que lanza `searchAll` lleva el `status` colgado para que el helper
  // de reintento lo reconozca. Sin eso el mensaje decía "respondió 429" y el
  // status leído era `null`: no se reintentaba nunca.
  it("searchAuthorizedPayments: el 429 del fetch directo también se reintenta", async () => {
    vi.useFakeTimers();
    try {
      mocks.fetch
        .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ paging: { total: 0 }, results: [] }), { status: 200 }),
        );

      const p = makeMpGateway().searchAuthorizedPayments("pre-1");
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(p).resolves.toEqual([]);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // MP a veces manda `Retry-After` en el 429; el borde que corta (Envoy) lo
  // emite en segundos. El gateway lo cuelga del error y el reintento lo
  // respeta: reintentar antes de lo que el servidor pidió es regalar el tiro.
  it("searchAuthorizedPayments: el Retry-After del 429 gobierna la espera", async () => {
    vi.useFakeTimers();
    try {
      mocks.fetch
        .mockResolvedValueOnce(
          new Response("local_rate_limited", { status: 429, headers: { "Retry-After": "7" } }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ paging: { total: 0 }, results: [] }), { status: 200 }),
        );

      const p = makeMpGateway().searchAuthorizedPayments("pre-1");
      // Antes de los 7 s del header no hay segundo intento, aunque la espera
      // propia (1 s + jitter ≤ 1 s) ya haya pasado de sobra.
      await vi.advanceTimersByTimeAsync(6_000);
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(p).resolves.toEqual([]);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un 500 no se reintenta: se propaga en el primer intento", async () => {
    mocks.fetch.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(makeMpGateway().searchPreapprovals()).rejects.toThrow(
      "preapproval/search respondió 500",
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("y el 429 persistente termina propagándose con su status legible", async () => {
    vi.useFakeTimers();
    try {
      mocks.fetch.mockResolvedValue(new Response("slow down", { status: 429 }));
      const p = makeMpGateway().searchPayments({ since: new Date("2026-08-21T00:00:00Z") });
      const caught = p.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10_000);
      const e = (await caught) as { status?: number; message?: string };
      expect(e.status).toBe(429);
      expect(e.message).toContain("payments/search respondió 429");
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  // Una escritura reintentada puede cobrarle dos veces a un vecino o dejarle
  // dos suscripciones vivas: acá el 429 se propaga y lo resuelve una persona.
  it("createPreapproval NO se reintenta ante un 429", async () => {
    mocks.create.mockRejectedValue(rateLimited());
    await expect(
      makeMpGateway().createPreapproval({
        reason: "Cuota", amount: 6000, payerEmail: "v@x.com",
        externalReference: "solicitud:7", backUrl: "https://vecinalciudadela.ar/x",
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("cancelPreapproval tampoco se reintenta", async () => {
    mocks.update.mockRejectedValue(rateLimited());
    await expect(makeMpGateway().cancelPreapproval("pre-1")).rejects.toMatchObject({ status: 429 });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
