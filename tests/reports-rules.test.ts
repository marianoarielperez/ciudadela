// Reglas puras del envío de un reporte (spec §4 y §5): ubicación obligatoria en
// reclamos salvo "Otro reporte", identidad y DNI completos para el vecino (no
// para el socio), categoría y tipo del catálogo, y las dos aritméticas de
// retención. Sin Prisma: la tabla de casos se prueba sin fixtures.
import { describe, expect, it } from "vitest";
import {
  DNI_RETENTION_DAYS, DRAFT_TTL_HOURS, draftExpiresAt, isLocationRequired,
  REPORT_MESSAGES, retentionDueAt, validateSubmission, type SubmissionInput,
} from "@/lib/reports/rules";

const base: SubmissionInput = {
  kind: "claim", category: "streets", subtype: "pothole",
  description: "Hay un pozo enorme frente al 120.",
  lat: -45.797, lng: -67.494,
  isMember: false,
  reporter: { name: "Ana López", dni: "30123456", phone: "2974000000", email: "ana@example.com" },
  files: { dniFront: true, dniBack: true, photos: 1 },
};

describe("isLocationRequired", () => {
  it("reclamo con categoría → obligatoria; 'Otro reporte' e iniciativas → opcional", () => {
    expect(isLocationRequired({ kind: "claim", category: "water" })).toBe(true);
    expect(isLocationRequired({ kind: "claim", category: "other" })).toBe(false);
    expect(isLocationRequired({ kind: "initiative", category: "social" })).toBe(false);
  });
});

describe("validateSubmission", () => {
  it("acepta un reclamo completo", () => {
    expect(validateSubmission(base)).toEqual({ ok: true });
  });

  it("rechaza sin categoría, o con una que no existe para el tipo", () => {
    expect(validateSubmission({ ...base, category: null })).toEqual({ ok: false, error: REPORT_MESSAGES.category });
    expect(validateSubmission({ ...base, category: "social" })).toEqual({ ok: false, error: REPORT_MESSAGES.category });
    expect(validateSubmission({ ...base, kind: "initiative", category: "water", subtype: null })).toEqual({
      ok: false, error: REPORT_MESSAGES.category,
    });
  });

  it("un reclamo con tipos exige uno del catálogo; 'Otro reporte' no lleva tipo", () => {
    expect(validateSubmission({ ...base, subtype: null })).toEqual({ ok: false, error: REPORT_MESSAGES.subtype });
    expect(validateSubmission({ ...base, subtype: "leak" })).toEqual({ ok: false, error: REPORT_MESSAGES.subtype });
    expect(validateSubmission({ ...base, category: "other", subtype: null })).toEqual({ ok: true });
  });

  it("la descripción es obligatoria y tiene tope", () => {
    expect(validateSubmission({ ...base, description: "   " })).toEqual({ ok: false, error: REPORT_MESSAGES.description });
    expect(validateSubmission({ ...base, description: "x".repeat(2001) })).toEqual({ ok: false, error: REPORT_MESSAGES.descriptionLong });
  });

  it("ubicación obligatoria sólo donde corresponde", () => {
    expect(validateSubmission({ ...base, lat: null, lng: null })).toEqual({ ok: false, error: REPORT_MESSAGES.location });
    expect(validateSubmission({ ...base, category: "other", subtype: null, lat: null, lng: null })).toEqual({ ok: true });
    expect(validateSubmission({ ...base, kind: "initiative", category: "social", subtype: null, lat: null, lng: null })).toEqual({ ok: true });
  });

  it("un par de coordenadas a medias o fuera de rango se rechaza", () => {
    expect(validateSubmission({ ...base, lat: -45.79, lng: null })).toEqual({ ok: false, error: REPORT_MESSAGES.location });
    expect(validateSubmission({ ...base, lat: 91, lng: -67 })).toEqual({ ok: false, error: REPORT_MESSAGES.location });
  });

  it("el vecino necesita identidad completa y las dos caras del DNI; el socio no", () => {
    expect(validateSubmission({ ...base, reporter: { ...base.reporter, name: "" } })).toEqual({ ok: false, error: REPORT_MESSAGES.identity });
    expect(validateSubmission({ ...base, files: { ...base.files, dniBack: false } })).toEqual({ ok: false, error: REPORT_MESSAGES.dni });
    expect(validateSubmission({ ...base, isMember: true, files: { dniFront: false, dniBack: false, photos: 0 } })).toEqual({ ok: true });
  });

  it("más de dos fotos no puede pasar aunque el POST lo intente", () => {
    expect(validateSubmission({ ...base, files: { ...base.files, photos: 3 } })).toEqual({ ok: false, error: REPORT_MESSAGES.photos });
  });
});

describe("retención", () => {
  it("el DNI vence 360 días después del cierre; el borrador, 48 h después de nacer", () => {
    expect(DNI_RETENTION_DAYS).toBe(360);
    expect(DRAFT_TTL_HOURS).toBe(48);
    const closed = new Date("2026-09-01T15:00:00Z");
    expect(retentionDueAt(closed).toISOString()).toBe("2027-08-27T15:00:00.000Z");
    expect(draftExpiresAt(new Date("2026-09-01T15:00:00Z")).toISOString()).toBe("2026-09-03T15:00:00.000Z");
  });
});
