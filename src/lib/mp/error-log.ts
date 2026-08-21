// Diagnóstico de los fallos de Mercado Pago.
//
// EL PORQUÉ: el SDK oficial NO lanza `Error`. Su cliente HTTP hace, literal,
// `throw await response.json()` (node_modules/mercadopago/dist/utils/restClient
// /index.js): lo que llega al `catch` es el CUERPO de la respuesta de MP tal
// cual, un objeto plano con la forma
//
//     { message, error, status, cause: [{ code, description }] }
//
// Por eso los dos helpers genéricos del proyecto se quedaban mudos justo acá:
// `codeOf(e)` lee `e.code` —que MP no manda— y escribía "unknown" en TODOS los
// fallos de MP; `safeMessage(e)` cae a `String(e)` cuando no es `Error` y
// escribía "[object Object]". Un `POST /preapproval` rechazado dejaba en el log
// exactamente cero información: dos rondas de diagnóstico a ciegas, la segunda
// con el mismo request andando por curl desde el mismo servidor.
//
// Lo que distingue "falta un campo" de "el token no tiene permisos sobre este
// recurso" es `cause[].code`. Va al log, con el `status` HTTP y la operación.
//
// PRIVACIDAD (docs/08, Ley 25.326): el `message` de MP puede arrastrar el
// `payer_email` del vecino ("payer_email is invalid: juan@..."), así que todo
// lo que sale de acá pasa por el enmascarado de `@/lib/log-safe`. El access
// token no viaja en el cuerpo de la respuesta y el request NO se loguea nunca.
import { maskEmails } from "@/lib/log-safe";

const MESSAGE_MAX = 300;
const DESCRIPTION_MAX = 160;
const CODE_MAX = 60;
const REF_MAX = 80;
/** MP puede devolver una lista larga de validaciones; con las primeras alcanza
 *  para saber qué pasa, y el log de PM2 no es lugar para volcar un array. */
const MAX_CAUSES = 5;
const MAX_KEYS = 10;

/** Una entrada del array `cause` de Mercado Pago. */
export type MpErrorCause = { code: string; description: string };

export type MpErrorDetail = {
  /** El status HTTP que contestó MP, o `null` si el error ni llegó a la API
   *  (DNS, timeout, TLS). */
  status: number | null;
  /** El `message` de MP —o el de un `Error` común—, enmascarado y en una línea. */
  message: string;
  /** El `code` de sistema (`ETIMEDOUT`), el `error` corto de MP
   *  (`bad_request`), o el `name` del `Error` cuando aporta algo. */
  code: string | null;
  cause: MpErrorCause[];
  /** Último recurso: los nombres de campo de lo que se lanzó, cuando no hubo
   *  ningún texto legible. Son nombres, no valores: no hay dato personal. */
  keys: string[];
};

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function asText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Enmascarado + una sola línea + recorte. Lo de la línea única no es estética:
 *  un mensaje con saltos parte la entrada en varias y se pierde en el `grep`. */
function clean(raw: string, max: number): string {
  return maskEmails(raw).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Acepta el array de MP, un objeto suelto, o el `cause` de un `Error` de
 *  ES2022 (que es otro error, no una lista): nada de esto puede tirar. */
function causesOf(value: unknown): MpErrorCause[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  const out: MpErrorCause[] = [];
  for (const item of items) {
    if (out.length >= MAX_CAUSES) break;
    const text = asText(item);
    if (text !== null) {
      out.push({ code: "", description: clean(text, DESCRIPTION_MAX) });
      continue;
    }
    const o = asObject(item);
    if (!o) continue;
    const code = asText(o.code) ?? asText(o.error) ?? "";
    const description = asText(o.description) ?? asText(o.message) ?? "";
    if (code === "" && description === "") continue;
    out.push({ code: clean(code, CODE_MAX), description: clean(description, DESCRIPTION_MAX) });
  }
  return out;
}

/** Lo que sirve de un error desconocido de Mercado Pago, extraído a la
 *  defensiva: anda con un `Error` común, con el objeto plano del SDK y con
 *  cualquier basura (`undefined`, un número, un array) sin explotar. */
export function describeMpError(e: unknown): MpErrorDetail {
  const o = asObject(e);
  const status = o
    ? asNumber(o.status) ?? asNumber(o.statusCode) ?? asNumber(asObject(o.api_response)?.status)
    : null;
  const code =
    (o ? asText(o.code) ?? asText(o.error) : null) ??
    (e instanceof Error && e.name !== "Error" ? e.name : null);

  let raw: string | null = null;
  if (e instanceof Error) raw = asText(e.message);
  else if (o) raw = asText(o.message) ?? asText(o.error);
  else if (e !== undefined && e !== null) raw = asText(String(e));

  const message = raw === null ? "" : clean(raw, MESSAGE_MAX);
  return {
    status,
    message,
    code: code === null ? null : clean(code, CODE_MAX),
    cause: causesOf(o?.cause),
    // Sólo cuando no quedó texto: si MP cambia la forma del cuerpo, esto es lo
    // que evita otra ronda a ciegas.
    keys: message === "" && o ? Object.keys(o).slice(0, MAX_KEYS) : [],
  };
}

/** Qué llamada, sobre qué, y qué contestó MP: la referencia son ids nuestros o
 *  de MP (solicitud, preapproval, plan), nunca datos personales. */
export type MpErrorRef = Record<string, string | number | null | undefined>;

/** Una línea de log lista para `console.error`, con la operación y la
 *  referencia adelante para que no haya que adivinar de qué llamada se trata.
 *
 *  Ejemplo:
 *  `mp:createPreapproval applicationId=5 status=400 code=bad_request message="..." cause=[...]` */
export function mpErrorLog(operation: string, ref: MpErrorRef, e: unknown): string {
  const d = describeMpError(e);
  const parts = [`mp:${operation}`];
  for (const [key, value] of Object.entries(ref)) {
    if (value === null || value === undefined || value === "") continue;
    parts.push(`${key}=${clean(String(value), REF_MAX)}`);
  }
  parts.push(`status=${d.status ?? "?"}`);
  if (d.code) parts.push(`code=${d.code}`);
  parts.push(`message=${JSON.stringify(d.message === "" ? "(sin mensaje)" : d.message)}`);
  if (d.cause.length > 0) {
    const causes = d.cause
      .map((c) => (c.code === "" ? c.description : `${c.code}: ${c.description}`))
      .join(" | ");
    parts.push(`cause=[${causes}]`);
  }
  if (d.keys.length > 0) parts.push(`keys=[${d.keys.join(",")}]`);
  return parts.join(" ");
}
