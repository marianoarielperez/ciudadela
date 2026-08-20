// POST /api/webhooks/mp — recepción de webhooks (docs/06 §4).
// 1. Firma inválida → 401 SIN persistir el payload (no llenar la base con
//    basura anónima). 2. Registro crudo con idempotencia [origin, event id]:
//    un duplicado YA procesado responde 200 sin efectos; uno que quedó sin
//    processedAt (el intento anterior falló) se reprocesa sobre la misma fila.
// 3. Error de procesamiento → queda en `error` y se responde 500: MP reintenta
//    con backoff y el paso 2 garantiza que reintentar es seguro.
import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { validateMpSignature } from "@/lib/mp/signature";
import { webhookProcessor } from "@/lib/mp/webhook-processor";
import type { Prisma, WebhookEvent } from "@/generated/prisma/client";

// `timingSafeEqual` y `Buffer` (dentro de validateMpSignature) exigen Node: en
// el runtime Edge la validación de firma no existiría.
export const runtime = "nodejs";

// El data.id entra al manifiesto HMAC sin escapar
// (`id:{data.id};request-id:...;ts:...;`), así que un id con `;` o `:` podría
// reinterpretarlo. La forma de todo id de MP —pagos numéricos, preapprovals hex
// alfanuméricos— entra holgada en esta allowlist.
//
// NOTA sobre la nota de T5 ("validar que sea numérico"): los preapproval_id de
// las suscripciones NO son numéricos (son hex de 32 caracteres) y son
// exactamente el caso alfanumérico que documenta la cabecera de signature.ts.
// Un filtro solo-dígitos rechazaría con 401 todos los webhooks de suscripción,
// así que la guarda valida forma segura + longitud y normaliza a minúsculas,
// que es lo que la nota buscaba proteger.
const SAFE_DATA_ID = /^[a-z0-9-]{1,64}$/;

export async function POST(req: NextRequest) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 500 });

  const url = new URL(req.url);
  let body: { id?: unknown; type?: unknown; topic?: unknown; data?: { id?: unknown } } | null = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  // MP firma el data.id que viaja en la query string de la notificación, y lo
  // firma en minúsculas cuando es alfanumérico: se normaliza acá porque el
  // helper delega la normalización al caller (ver su cabecera).
  const dataId = (url.searchParams.get("data.id") ?? String(body?.data?.id ?? "")).toLowerCase();
  if (!SAFE_DATA_ID.test(dataId)) {
    await audit({
      action: "webhook_rejected_signature",
      entity: "webhook",
      detail: { reason: "malformed_data_id" },
      ip: req.headers.get("x-real-ip") ?? "unknown",
    });
    return Response.json({ error: "bad_data_id" }, { status: 400 });
  }

  const valid = validateMpSignature({
    xSignature: req.headers.get("x-signature"),
    xRequestId: req.headers.get("x-request-id"),
    dataId,
    secret,
  });
  if (!valid) {
    await audit({
      action: "webhook_rejected_signature", entity: "webhook",
      ip: req.headers.get("x-real-ip") ?? "unknown",
    });
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  const topic = String(body?.type ?? body?.topic ?? url.searchParams.get("type") ?? "unknown");
  const externalEventId = String(body?.id ?? `${topic}:${dataId}`).slice(0, 128);

  // Insert-or-find: la unique [origin, externalEventId] decide.
  let event: WebhookEvent;
  try {
    event = await prisma.webhookEvent.create({
      data: {
        origin: "mp",
        externalEventId,
        topic: topic.slice(0, 64),
        // El payload se guarda crudo, tal cual llegó: es la prueba de qué dijo
        // MP. Ya pasó la firma, así que no es JSON anónimo.
        payload: (body ?? {}) as Prisma.InputJsonObject,
      },
    });
  } catch {
    const existing = await prisma.webhookEvent
      .findUnique({ where: { origin_externalEventId: { origin: "mp", externalEventId } } })
      .catch(() => null);
    if (!existing) return Response.json({ error: "storage" }, { status: 500 });
    if (existing.processedAt) {
      return Response.json({ result: "ignored_duplicate" }, { status: 200 });
    }
    event = existing; // el intento anterior murió a mitad: reprocesar
  }

  try {
    const result = await webhookProcessor.process({ topic, dataId });
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), result: result.slice(0, 64), error: null },
    });
    return Response.json({ result }, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 500) : "unknown";
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { error: message } }).catch(() => {});
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
}
