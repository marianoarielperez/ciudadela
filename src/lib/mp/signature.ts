// Validación del header `x-signature` de los webhooks de Mercado Pago
// (docs/06 §4: rechazar si no valida). Formato del header: "ts=...,v1=..." y
// manifiesto HMAC-SHA256: `id:{data.id};request-id:{x-request-id};ts:{ts};`.
// OJO: si data.id es alfanumérico, MP lo firma en minúsculas — el caller pasa
// `dataId` ya normalizado (los ids de pagos/suscripciones son numéricos, así
// que en la práctica no cambia nada, pero queda documentado).
//
// La tolerancia de ts NO rompe los reintentos de MP: cada reintento se firma
// de nuevo con un ts fresco. Lo que raciona es el replay de una captura vieja.
import { createHmac, timingSafeEqual } from "node:crypto";

export const MP_SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export function validateMpSignature(input: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
  secret: string;
  nowMs?: number;
  toleranceMs?: number;
}): boolean {
  if (!input.xSignature || !input.xRequestId || !input.secret) return false;
  const parts = new Map<string, string>();
  for (const piece of input.xSignature.split(",")) {
    const idx = piece.indexOf("=");
    if (idx > 0) parts.set(piece.slice(0, idx).trim(), piece.slice(idx + 1).trim());
  }
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1) return false;

  const tsMs = Number(ts) * 1000;
  const now = input.nowMs ?? Date.now();
  const tolerance = input.toleranceMs ?? MP_SIGNATURE_TOLERANCE_MS;
  if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > tolerance) return false;

  const manifest = `id:${input.dataId};request-id:${input.xRequestId};ts:${ts};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
