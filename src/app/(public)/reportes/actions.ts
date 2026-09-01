"use server";
// Las actions públicas del wizard de Reportes (M7, spec §5.1 y §10). No hay
// sesión: el paso 1 se protege con Turnstile + cupo por IP, y todo lo demás con
// la LLAVE del borrador (256 bits, sólo el hash en la base). Ninguna recibe un
// id por el formulario: el cliente no puede apuntar al reporte de otro.
//
// Y NINGUNA revalida rutas: el wizard estampa la llave en la URL con
// `history.replaceState` (el patrón de ASOCIATE) y esa invariante depende de
// que no haya payload de flight en la respuesta. Ver `asociate-wizard.tsx`.
//
// Las mismas actions las usa el wizard del SOCIO desde /mi: el socio ya tiene
// borrador (lo crea `startMemberReportAction`, en /mi/solicitudes/reportes/
// actions.ts), y a partir de ahí la llave manda igual que para el vecino.
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import {
  publicTokenLimiter, reportDraftLimiter, reportSubmitLimiter, reportUploadLimiter,
} from "@/lib/auth/rate-limiter";
import { CONFIG_KEYS, configReader, parseRecipients } from "@/lib/config";
import { parseForm } from "@/lib/forms";
import { isClaimShaped } from "@/lib/reports/claim";
import { MAX_IMAGE_BYTES } from "@/lib/reports/images";
import { reportNotifier } from "@/lib/reports/notify";
import { MAX_DESCRIPTION, REPORT_MESSAGES } from "@/lib/reports/rules";
import { reports, type ReportWithFiles } from "@/lib/reports/service";
import { ReportFileError, reportFileStore, userMessageOf } from "@/lib/reports/storage";
import { verifyTurnstile } from "@/lib/turnstile";

type StartState = { error?: string; started?: { claim: string } };
type ReporterState = { error?: string; saved?: true };
type UploadState = { error?: string; uploaded?: { id: number; kind: "photo" | "dni_front" | "dni_back" } };
type RemoveState = { error?: string; removed?: true };
type SubmitState = { error?: string; done?: { number: number } };

const TOO_MANY = "Demasiados intentos desde esta conexión. Probá de nuevo en un rato.";
const NO_CAPTCHA = "No pudimos verificar que sos una persona. Recargá la página y probá de nuevo.";
const SAVE_FAILED = "No pudimos guardar la foto. Probá de nuevo en unos minutos.";
const FILE_KINDS = ["photo", "dni_front", "dni_back"] as const;

const dniSchema = z.string().regex(/^\d{7,9}$/, "DNI inválido (solo números, sin puntos)");

const startSchema = z.object({
  kind: z.enum(["reclamo", "iniciativa"], { error: "Elegí qué querés reportar." }),
  anonymous: z.enum(["si", "no"], { error: "Contanos cómo querés figurar." }),
});

const reporterSchema = z.object({
  claim: z.string(),
  name: z.string().min(3, "Ingresá tu nombre y apellido").max(160, "El nombre no puede superar los 160 caracteres"),
  dni: dniSchema,
  phone: z.string().min(6, "Ingresá tu teléfono").max(40, "El teléfono no puede superar los 40 caracteres"),
  email: z.email("Ingresá un email válido").max(191, "El email no puede superar los 191 caracteres"),
});

const coord = z.coerce.number({ error: REPORT_MESSAGES.location }).optional();

const submitSchema = z.object({
  claim: z.string(),
  category: z.string().min(1, REPORT_MESSAGES.category).max(40, REPORT_MESSAGES.category),
  subtype: z.string().max(60, REPORT_MESSAGES.subtype).optional(),
  description: z.string().min(1, REPORT_MESSAGES.description).max(MAX_DESCRIPTION, REPORT_MESSAGES.descriptionLong),
  lat: coord,
  lng: coord,
  streetId: z.coerce.number().int().positive().optional(),
  streetName: z.string().max(120, "La calle no puede superar los 120 caracteres").optional(),
  addressDetail: z.string().max(160, "La referencia no puede superar los 160 caracteres").optional(),
  scplTicket: z.string().max(40, "El número de reclamo no puede superar los 40 caracteres").optional(),
  consent: z.literal("on", { error: REPORT_MESSAGES.consent }),
});

async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-real-ip") ?? "unknown", userAgent: (h.get("user-agent") ?? "").slice(0, 255) };
}

function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "unknown";
}

type Lookup = { ok: true; report: ReportWithFiles } | { ok: false; error: string };

/** El borrador desde la llave del formulario. Forma → cupo → base. Sólo
 *  `draft` admite escritura; el resto contesta que ya fue enviado. */
async function draftFromClaim(raw: string, limiter: { check(key: string): boolean }): Promise<Lookup> {
  if (!isClaimShaped(raw)) return { ok: false, error: REPORT_MESSAGES.linkDead };
  const { ip } = await requestMeta();
  if (!limiter.check(ip)) return { ok: false, error: TOO_MANY };
  const report = await reports.findByClaim(raw);
  if (!report) return { ok: false, error: REPORT_MESSAGES.linkDead };
  if (report.status !== "draft") return { ok: false, error: REPORT_MESSAGES.notDraft };
  return { ok: true, report };
}

export async function startReportAction(_prev: StartState, formData: FormData): Promise<StartState> {
  const { ip, userAgent } = await requestMeta();
  if (!reportDraftLimiter.allows(ip)) return { error: TOO_MANY };
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip);
  if (!captcha) return { error: NO_CAPTCHA };
  const parsed = parseForm(startSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  reportDraftLimiter.record(ip);

  const { claim } = await reports.startDraft({
    kind: parsed.data.kind === "reclamo" ? "claim" : "initiative",
    anonymous: parsed.data.anonymous === "si",
    memberId: null,
    reporter: null,
    ip,
    userAgent,
  });
  return { started: { claim } };
}

export async function saveReporterAction(_prev: ReporterState, formData: FormData): Promise<ReporterState> {
  const parsed = parseForm(reporterSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const found = await draftFromClaim(parsed.data.claim, publicTokenLimiter);
  if (!found.ok) return { error: found.error };
  // Las dos caras del DNI se exigen ACÁ y no sólo en el cliente (spec §5.1 paso
  // 3): el paso se envía por POST y un formulario armado a mano no pasa por el
  // botón deshabilitado. `submit` vuelve a mirarlo, pero entonces el vecino ya
  // cargó todo lo demás; el mensaje es el mismo para que no diverjan.
  const faces = new Set(found.report.files.map((f) => f.kind));
  if (!faces.has("dni_front") || !faces.has("dni_back")) return { error: REPORT_MESSAGES.dni };
  const result = await reports.saveReporter({
    reportId: found.report.id,
    name: parsed.data.name,
    dni: parsed.data.dni,
    phone: parsed.data.phone,
    email: parsed.data.email.toLowerCase(),
  });
  return result.ok ? { saved: true } : { error: result.error };
}

export async function uploadReportFileAction(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const kind = String(formData.get("kind") ?? "");
  if (!(FILE_KINDS as readonly string[]).includes(kind)) return { error: "Tipo de archivo inválido." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Elegí una foto." };
  // El tope se mira ANTES de leer el buffer: sin esto un archivo de 30 MB se lee
  // entero a memoria antes de que nadie lo rechace.
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: "La foto supera el máximo de 10 MB. Probá con una de menor calidad." };
  }
  const found = await draftFromClaim(String(formData.get("claim") ?? ""), reportUploadLimiter);
  if (!found.ok) return { error: found.error };

  // El tope de fotos lo cuenta el store al guardar, así que dos subidas
  // simultáneas sobre el MISMO borrador pueden ver las dos `count === 1` y
  // dejar una tercera foto. Es a propósito que no haya mutex por llave: el caso
  // es recuperable —`submit` rechaza con `REPORT_MESSAGES.photos` y
  // `removeReportFileAction` deja al vecino quitar una— y un mutex con llave en
  // el camino caliente de la subida no se paga con ese borde.
  try {
    const saved = await reportFileStore.save({
      reportId: found.report.id,
      kind: kind as (typeof FILE_KINDS)[number],
      data: Buffer.from(await file.arrayBuffer()),
    });
    return { uploaded: { id: saved.id, kind: kind as (typeof FILE_KINDS)[number] } };
  } catch (e) {
    // Los rechazos INTENCIONALES del store viajan como `ReportFileError` y su
    // texto es para el vecino. Cualquier otra cosa es un fallo de abajo: su
    // `message` trae la ruta absoluta (Ley 25.326), así que a la pantalla va el
    // genérico y al log sólo el CÓDIGO.
    if (!(e instanceof ReportFileError)) {
      console.error("[reportes] falló el guardado de un archivo", found.report.id, "code:", codeOf(e));
    }
    return { error: userMessageOf(e, SAVE_FAILED) };
  }
}

export async function removeReportFileAction(_prev: RemoveState, formData: FormData): Promise<RemoveState> {
  const fileId = Number(formData.get("fileId"));
  if (!Number.isInteger(fileId) || fileId <= 0) return { error: "Archivo inválido." };
  const found = await draftFromClaim(String(formData.get("claim") ?? ""), reportUploadLimiter);
  if (!found.ok) return { error: found.error };
  const removed = await reportFileStore.remove({ reportId: found.report.id, fileId });
  return removed ? { removed: true } : { error: "Ese archivo ya no está." };
}

export async function submitReportAction(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const { ip } = await requestMeta();
  if (!reportSubmitLimiter.allows(ip)) return { error: TOO_MANY };
  const parsed = parseForm(submitSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const found = await draftFromClaim(parsed.data.claim, publicTokenLimiter);
  if (!found.ok) return { error: found.error };
  reportSubmitLimiter.record(ip);

  const d = parsed.data;
  const result = await reports.submit({
    reportId: found.report.id,
    category: d.category,
    subtype: d.subtype ?? null,
    description: d.description,
    lat: d.lat ?? null,
    lng: d.lng ?? null,
    streetId: d.streetId ?? null,
    streetName: d.streetName ?? null,
    addressDetail: d.addressDetail ?? null,
    scplTicket: d.scplTicket ?? null,
    consent: d.consent === "on",
  });
  if (!result.ok) {
    // Un rechazo por regla de negocio no manda ningún correo, y el cupo de 5/h
    // raciona correos: se devuelve el intento. Una escritura EXITOSA no se
    // devuelve nunca, ni siquiera si falla el acuse — el reporte existe.
    reportSubmitLimiter.refund(ip);
    return { error: result.error };
  }

  // Todo lo que sigue es best-effort y DESPUÉS de la escritura: el reporte ya
  // entró y la pantalla lo dice. Un SMTP caído no puede convertirlo en error.
  try {
    await reportNotifier.sendReceived(result.id);
  } catch (e) {
    console.error("[reportes] falló el acuse", result.id, "code:", codeOf(e));
  }
  try {
    const recipients = parseRecipients(await configReader.getString(CONFIG_KEYS.digestRecipients));
    if (recipients.length > 0) await reportNotifier.sendBoardAlert(result.id, recipients);
  } catch (e) {
    console.error("[reportes] falló la alerta a la Comisión", result.id, "code:", codeOf(e));
  }
  // Ids, códigos y flags. Ni la calle, ni la descripción, ni la identidad.
  await audit({
    action: "report_submitted",
    entity: "report",
    entityId: result.id,
    detail: {
      kind: found.report.kind,
      category: d.category,
      subtype: d.subtype ?? null,
      member: found.report.memberId !== null,
      anonymous: found.report.anonymous,
    },
    ip,
  });
  return { done: { number: result.id } };
}
