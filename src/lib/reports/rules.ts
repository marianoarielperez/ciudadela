// Reglas de negocio del envío de un reporte (spec §4-§5). PURO: sin Prisma.
// Las usa `service.submit` (la guarda real) y el wizard (para apagar el botón
// antes de un viaje al server): compartir la función y no copiarla es la
// lección de `coverageFloor` (CLAUDE.md).
import { findClaimCategory, findInitiativeCategory, findSubtype, type ReportKindSlug } from "./catalog";

export const DRAFT_TTL_HOURS = 48;
export const DNI_RETENTION_DAYS = 360;
export const MAX_PHOTOS = 2;
export const MAX_DESCRIPTION = 2000;
/** El motivo de una desestimación (spec §5.3): mínimo real y tope de la columna. */
export const MIN_DISMISS_REASON = 5;
export const MAX_DISMISS_REASON = 300;

/** Textos únicos por causal: el wizard y el servicio dicen lo mismo se corte
 *  donde se corte (patrón `GRANT_GUARD_MESSAGES`). */
export const REPORT_MESSAGES = {
  category: "Elegí una categoría.",
  subtype: "Elegí el tipo de problema.",
  description: "Contanos qué pasa: la descripción es obligatoria.",
  descriptionLong: `La descripción no puede superar los ${MAX_DESCRIPTION} caracteres.`,
  location: "Marcá en el mapa dónde está el problema.",
  identity: "Faltan tus datos: nombre, DNI, teléfono y email.",
  dni: "Falta subir el frente y el dorso de tu DNI.",
  photos: `Podés adjuntar hasta ${MAX_PHOTOS} fotos.`,
  notDraft: "Este reporte ya fue enviado.",
  // La ausencia CONFIRMADA por el server: la ranura del wizard la trata como
  // quitado (el archivo ya no está, que es lo que el vecino pidió), así que el
  // texto es único y se compara contra él. No duplicarlo en la action.
  fileGone: "Ese archivo ya no está.",
  linkDead: "No encontramos tu reporte: el enlace puede estar incompleto o vencido. Empezá de nuevo desde Reportes.",
  notPending: "El reporte ya fue resuelto o no existe.",
  consent: "Tenés que aceptar el consentimiento de datos personales.",
  agencyOther: "Indicá ante qué organismo se presentó.",
  dismissReason: `Escribí el motivo (al menos ${MIN_DISMISS_REASON} caracteres).`,
} as const;

export function isLocationRequired(input: { kind: ReportKindSlug; category: string | null }): boolean {
  return input.kind === "claim" && input.category !== "other";
}

export type SubmissionInput = {
  kind: ReportKindSlug;
  category: string | null;
  subtype: string | null;
  description: string;
  lat: number | null;
  lng: number | null;
  /** El socio no declara identidad ni sube DNI: viene de su ficha. */
  isMember: boolean;
  reporter: { name: string | null; dni: string | null; phone: string | null; email: string | null };
  files: { dniFront: boolean; dniBack: boolean; photos: number };
};

export type SubmissionVerdict = { ok: true } | { ok: false; error: string };

function validCoords(lat: number | null, lng: number | null): boolean {
  return (
    lat !== null && lng !== null &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

export function validateSubmission(input: SubmissionInput): SubmissionVerdict {
  const fail = (error: string): SubmissionVerdict => ({ ok: false, error });

  // La normalización vive ACÁ y no en el parseo del POST: el wizard puede dejar
  // el `""` de un `<select>` sin elegir cuando cambia la categoría, y una
  // categoría sin tipos no puede rechazarlo con un mensaje que la pantalla no
  // tiene cómo satisfacer (no muestra tipos). Un solo lugar para los dos
  // call-sites, la lección de `coverageFloor`.
  const subtype = input.subtype?.trim() || null;

  if (input.kind === "claim") {
    const category = findClaimCategory(input.category);
    if (!category) return fail(REPORT_MESSAGES.category);
    if (category.subtypes.length > 0 && !findSubtype(category.slug, subtype)) {
      return fail(REPORT_MESSAGES.subtype);
    }
    if (category.subtypes.length === 0 && subtype !== null) return fail(REPORT_MESSAGES.subtype);
  } else if (!findInitiativeCategory(input.category)) {
    return fail(REPORT_MESSAGES.category);
  }

  const description = input.description.trim();
  if (description === "") return fail(REPORT_MESSAGES.description);
  if (description.length > MAX_DESCRIPTION) return fail(REPORT_MESSAGES.descriptionLong);

  const hasAny = input.lat !== null || input.lng !== null;
  if (isLocationRequired(input) || hasAny) {
    if (!validCoords(input.lat, input.lng)) return fail(REPORT_MESSAGES.location);
  }

  if (!input.isMember) {
    const r = input.reporter;
    if (!r.name?.trim() || !r.dni?.trim() || !r.phone?.trim() || !r.email?.trim()) {
      return fail(REPORT_MESSAGES.identity);
    }
    if (!input.files.dniFront || !input.files.dniBack) return fail(REPORT_MESSAGES.dni);
  }

  if (input.files.photos > MAX_PHOTOS) return fail(REPORT_MESSAGES.photos);
  return { ok: true };
}

export function retentionDueAt(closedAt: Date): Date {
  return new Date(closedAt.getTime() + DNI_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function draftExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DRAFT_TTL_HOURS * 60 * 60 * 1000);
}
