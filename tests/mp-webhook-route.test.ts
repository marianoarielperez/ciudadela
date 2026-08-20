import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Por acá entra la plata: la ruta se ejercita entera (firma → registro crudo →
// procesamiento → respuesta) con todo lo de afuera mockeado, módulo por módulo,
// como en tests/padron-export-route.test.ts. La firma se calcula con el HMAC
// real (el helper de T5 NO se mockea): si la ruta arma mal el manifiesto o no
// normaliza el data.id, estos tests caen.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    webhookEvent: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/mp/webhook-processor", () => ({
  webhookProcessor: { process: vi.fn() },
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { POST } from "@/app/api/webhooks/mp/route";
import { audit } from "@/lib/audit";
import { webhookProcessor } from "@/lib/mp/webhook-processor";
import { prisma } from "@/lib/prisma";

type MockedFn = ReturnType<typeof vi.fn>;

const SECRET = "test-secret";
const create = prisma.webhookEvent.create as unknown as MockedFn;
const findUnique = prisma.webhookEvent.findUnique as unknown as MockedFn;
const update = prisma.webhookEvent.update as unknown as MockedFn;
const process_ = webhookProcessor.process as unknown as MockedFn;

function sign(dataId: string, requestId: string, tsSeconds = Math.floor(Date.now() / 1000)) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${tsSeconds};`;
  const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
  return `ts=${tsSeconds},v1=${v1}`;
}

type ReqOpts = {
  dataId?: string;
  signedAs?: string; // qué data.id se firmó, si difiere del que viaja en la query
  body?: unknown;
  xSignature?: string | null;
  xRequestId?: string | null;
  rawBody?: string;
};

function webhookRequest(opts: ReqOpts = {}) {
  const dataId = opts.dataId ?? "777";
  const requestId = opts.xRequestId === undefined ? "req-1" : opts.xRequestId;
  const headers = new Headers({ "content-type": "application/json", "x-real-ip": "10.0.0.9" });
  const signature =
    opts.xSignature === undefined ? sign(opts.signedAs ?? dataId, requestId ?? "") : opts.xSignature;
  if (signature !== null) headers.set("x-signature", signature);
  if (requestId !== null) headers.set("x-request-id", requestId);
  const body =
    opts.rawBody ??
    JSON.stringify(opts.body ?? { id: 12345, type: "payment", data: { id: dataId } });
  return new Request(`https://vecinalciudadela.ar/api/webhooks/mp?data.id=${dataId}&type=payment`, {
    method: "POST",
    headers,
    body,
  }) as unknown as Parameters<typeof POST>[0];
}

function storedEvent(over: Record<string, unknown> = {}) {
  return {
    id: BigInt(1),
    origin: "mp",
    externalEventId: "12345",
    topic: "payment",
    payload: {},
    receivedAt: new Date(),
    processedAt: null,
    result: null,
    error: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MP_WEBHOOK_SECRET = SECRET;
  create.mockResolvedValue(storedEvent());
  update.mockResolvedValue(storedEvent());
  findUnique.mockResolvedValue(null);
  process_.mockResolvedValue("application_approved");
});

describe("POST /api/webhooks/mp — firma", () => {
  it("rechaza con 401 una firma inválida y NO persiste el payload", async () => {
    const res = await POST(webhookRequest({ signedAs: "otro-id" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "invalid_signature" });
    expect(create).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(process_).not.toHaveBeenCalled();
  });

  it("audita el rechazo con la IP y sin filtrar el secreto", async () => {
    await POST(webhookRequest({ signedAs: "otro-id" }));

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as unknown as MockedFn).mock.calls[0][0];
    expect(entry).toMatchObject({ action: "webhook_rejected_signature", entity: "webhook", ip: "10.0.0.9" });
    expect(JSON.stringify(entry)).not.toContain(SECRET);
  });

  it("rechaza sin headers de firma en vez de explotar", async () => {
    const res = await POST(webhookRequest({ xSignature: null }));
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  // La guarda de longitud del helper existe justo para esto: un v1 corto tiene
  // que devolver false, no un RangeError de timingSafeEqual. Si tirara, la ruta
  // respondería 500 y MP reintentaría para siempre.
  it("un v1 corto da 401 y no 500 (no rompe la guarda de longitud del helper)", async () => {
    const res = await POST(webhookRequest({ xSignature: `ts=${Math.floor(Date.now() / 1000)},v1=ab` }));
    expect(res.status).toBe(401);
  });

  it("responde 500 not_configured si falta MP_WEBHOOK_SECRET, sin tocar la base", async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    const res = await POST(webhookRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "not_configured" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/mp — validación del data.id", () => {
  // El data.id entra al manifiesto HMAC sin escapar: un id con `;` o `:` puede
  // reinterpretar el manifiesto. Se valida ANTES de llamar al helper.
  it("rechaza un data.id que podría envenenar el manifiesto, sin persistir nada", async () => {
    const poisoned = "777;request-id:otro";
    const res = await POST(webhookRequest({ dataId: poisoned }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_data_id" });
    expect(create).not.toHaveBeenCalled();
    expect(process_).not.toHaveBeenCalled();
  });

  it("rechaza un data.id vacío", async () => {
    const req = new Request("https://vecinalciudadela.ar/api/webhooks/mp", {
      method: "POST",
      headers: new Headers({ "x-signature": sign("", "req-1"), "x-request-id": "req-1" }),
      body: JSON.stringify({ id: 1, type: "payment", data: {} }),
    }) as unknown as Parameters<typeof POST>[0];

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  // Los preapproval_id de MP son hex alfanuméricos y MP los firma en
  // MINÚSCULAS: la ruta normaliza antes de validar, o toda suscripción entrante
  // se caería con 401.
  it("normaliza a minúsculas el data.id alfanumérico antes de validar la firma", async () => {
    const upper = "2C93808457D8AD4A0157DCF3B4F80317";
    const res = await POST(webhookRequest({ dataId: upper, signedAs: upper.toLowerCase() }));

    expect(res.status).toBe(200);
    expect(process_).toHaveBeenCalledWith(expect.objectContaining({ dataId: upper.toLowerCase() }));
  });

  it("responde 400 a un body que no es JSON", async () => {
    const res = await POST(webhookRequest({ rawBody: "no-json" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_json" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/mp — registro e idempotencia", () => {
  it("evento nuevo: registra el crudo, procesa y marca processedAt", async () => {
    const res = await POST(webhookRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "application_approved" });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      origin: "mp",
      externalEventId: "12345",
      topic: "payment",
    });
    expect(process_).toHaveBeenCalledWith({ topic: "payment", dataId: "777" });

    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0][0];
    expect(patch.where).toMatchObject({ id: BigInt(1) });
    expect(patch.data.processedAt).toBeInstanceOf(Date);
    expect(patch.data).toMatchObject({ result: "application_approved", error: null });
  });

  it("duplicado YA procesado: 200 ignored_duplicate y el procesador ni se toca", async () => {
    create.mockRejectedValue(new Error("unique constraint"));
    findUnique.mockResolvedValue(storedEvent({ processedAt: new Date(), result: "application_approved" }));

    const res = await POST(webhookRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "ignored_duplicate" });
    expect(process_).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  // El intento anterior murió a mitad (proceso caído entre el create y el
  // update): la fila existe sin processedAt y el reintento de MP la completa.
  it("duplicado SIN processedAt: reprocesa sobre la misma fila", async () => {
    create.mockRejectedValue(new Error("unique constraint"));
    findUnique.mockResolvedValue(storedEvent({ id: BigInt(42) }));

    const res = await POST(webhookRequest());

    expect(res.status).toBe(200);
    expect(process_).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toMatchObject({ id: BigInt(42) });
    expect(update.mock.calls[0][0].data.processedAt).toBeInstanceOf(Date);
  });

  it("si el create falla y tampoco hay fila, responde 500 sin procesar", async () => {
    create.mockRejectedValue(new Error("db down"));
    findUnique.mockResolvedValue(null);

    const res = await POST(webhookRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "storage" });
    expect(process_).not.toHaveBeenCalled();
  });

  it("sin `id` en el body usa topic:dataId como clave de idempotencia", async () => {
    await POST(webhookRequest({ body: { type: "payment", data: { id: "777" } } }));

    expect(create.mock.calls[0][0].data).toMatchObject({ externalEventId: "payment:777" });
  });
});

describe("POST /api/webhooks/mp — fallo de procesamiento", () => {
  it("un error del procesador deja el mensaje en `error` y responde 500 para que MP reintente", async () => {
    process_.mockRejectedValue(new Error("MP 500"));

    const res = await POST(webhookRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "processing_failed" });
    const patch = update.mock.calls[0][0];
    expect(patch.where).toMatchObject({ id: BigInt(1) });
    expect(patch.data).toMatchObject({ error: "MP 500" });
    // No se marca procesado: el reintento tiene que volver a entrar.
    expect(patch.data.processedAt).toBeUndefined();
  });

  it("si además falla el update del error, igual responde 500 (no explota)", async () => {
    process_.mockRejectedValue(new Error("MP 500"));
    update.mockRejectedValue(new Error("db down"));

    const res = await POST(webhookRequest());
    expect(res.status).toBe(500);
  });

  it("un result desconocido igual responde 200 (no es un error)", async () => {
    process_.mockResolvedValue("unknown_topic");

    const res = await POST(webhookRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "unknown_topic" });
    expect(update.mock.calls[0][0].data).toMatchObject({ result: "unknown_topic" });
  });
});
