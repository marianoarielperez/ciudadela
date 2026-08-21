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
import { mpErrorLog } from "@/lib/mp/error-log";
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
  const ip = req.headers.get("x-real-ip") ?? "unknown";

  // El IPN legacy de MP manda `?topic=payment&id=123` — `id=`, NO `data.id=` —
  // y con el CUERPO VACÍO: eso muere en el catch de abajo (`bad_json`), antes
  // de que exista ningún `body` que inspeccionar. Por eso la señal se calcula
  // ACÁ, desde la query string sola, ANTES de intentar parsear el JSON — es la
  // única forma de que la auditoría sea alcanzable para un IPN legacy real. No
  // implementamos el formato legacy: sólo que quede diagnosticable.
  const legacyIpn = url.searchParams.has("topic") && !url.searchParams.has("data.id");

  let body: {
    id?: unknown; type?: unknown; topic?: unknown; action?: unknown; data?: { id?: unknown };
  } | null = null;
  try {
    body = await req.json();
  } catch {
    // Se audita SIEMPRE que sea legacy, sin condicionar a `claimsSignature`:
    // un IPN legacy es anterior al esquema de firma, así que nunca trae
    // `x-signature`/`x-request-id` — exigirlas dejaría esta rama inalcanzable
    // otra vez. `?topic=` sin `data.id=` no es ruido genérico de escáner, es
    // una notificación mal configurada, así que auditarla sin cabeceras no
    // reabre el canal de escritura anónimo que se cerró para el resto.
    if (legacyIpn) {
      await audit({
        action: "webhook_rejected_signature",
        entity: "webhook",
        detail: { reason: "legacy_ipn_shape" },
        ip,
      });
    }
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");

  // La auditoría de este endpoint corre ANTES de autenticar, o sea que es un
  // canal de escritura anónimo sobre `audit_log` —la tabla de cumplimiento
  // estatutario—: un insert por request, desde una URL pública, sin techo.
  // Criterio: se audita sólo cuando venían AMBOS headers de firma, que es lo
  // que distingue un intento de falsificación de un escaneo. Una request sin
  // `x-signature` se rechaza igual (401), pero sin asiento — así el volumen de
  // `webhook_rejected_signature` sigue siendo señal y no ruido de internet.
  const claimsSignature = Boolean(xSignature && xRequestId);

  // MP firma el data.id que viaja en la query string de la notificación, y lo
  // firma en minúsculas cuando es alfanumérico: se normaliza acá porque el
  // helper delega la normalización al caller (ver su cabecera).
  const dataId = (url.searchParams.get("data.id") ?? String(body?.data?.id ?? "")).toLowerCase();
  if (!SAFE_DATA_ID.test(dataId)) {
    if (claimsSignature) {
      await audit({
        action: "webhook_rejected_signature",
        entity: "webhook",
        detail: { reason: legacyIpn ? "legacy_ipn_shape" : "malformed_data_id" },
        ip,
      });
    }
    return Response.json({ error: "bad_data_id" }, { status: 400 });
  }

  const valid = validateMpSignature({ xSignature, xRequestId, dataId, secret });
  if (!valid) {
    if (claimsSignature) {
      await audit({ action: "webhook_rejected_signature", entity: "webhook", ip });
    }
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  const topic = String(body?.type ?? body?.topic ?? url.searchParams.get("type") ?? "unknown");
  // El fallback lleva el `action` (`payment.created` / `payment.updated`) además
  // del tópico y el id del recurso. Sin ese discriminador, TODAS las
  // notificaciones del pago 777 compartirían la clave `payment:777`: la primera
  // (`created`, status `in_process`) se registraría procesada como
  // `payment_ignored` y la segunda (`updated`, ya `approved`) se respondería
  // `ignored_duplicate` sin procesar nunca — el vecino pagó y la solicitud
  // quedaría en `pending_payment` para siempre.
  const externalEventId = String(
    body?.id ?? `${topic}:${dataId}:${String(body?.action ?? "")}`,
  ).slice(0, 128);

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
    // El procesador llama a MP (`getPayment`, `getPreapproval`,
    // `getAuthorizedPayment`) sin atajar nada: un rechazo de la API cae acá. Y
    // el SDK NO lanza `Error`, así que `e instanceof Error ? e.message :
    // "unknown"` escribía literalmente "unknown" en la columna —el mismo agujero
    // de diagnóstico que en `asociate`—. `mpErrorLog` desarma el cuerpo de MP y
    // enmascara las direcciones antes de que toquen la base o el log.
    const detail = mpErrorLog("webhook", { topic, dataId, eventId: String(event.id) }, e);
    console.error("[mp-webhook] el procesamiento falló —", detail);
    await prisma.webhookEvent
      .update({ where: { id: event.id }, data: { error: detail.slice(0, 500) } })
      .catch(() => {});
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
}
