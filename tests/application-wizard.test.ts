import { describe, expect, it } from "vitest";
import {
  categoryAllowedForResidence, civilTodayAr, isAdult, WEB_CATEGORIES,
} from "@/lib/applications/wizard";

describe("isAdult", () => {
  const now = new Date("2026-08-20T12:00:00Z");
  it("cumple 18 exactamente hoy → adulto", () => {
    expect(isAdult(new Date("2008-08-20T12:00:00Z"), now)).toBe(true);
  });
  it("los cumple mañana → menor", () => {
    expect(isAdult(new Date("2008-08-21T12:00:00Z"), now)).toBe(false);
  });
  it("los cumplió ayer → adulto", () => {
    expect(isAdult(new Date("2008-08-19T12:00:00Z"), now)).toBe(true);
  });
  it("un cadete de 14 no pasa", () => {
    expect(isAdult(new Date("2012-01-01T12:00:00Z"), now)).toBe(false);
  });
});

describe("civilTodayAr", () => {
  // El día civil que manda es el argentino, no el del reloj UTC del server. Sin
  // esto, entre las 21 y las 24 de Comodoro el server ya está en el día
  // siguiente y quien cumple 18 MAÑANA pasaría el corte esta noche: un menor
  // asociado como adulto, que es exactamente lo que REG-02 no permite.
  it("21:00 de Comodoro (00:00Z del día siguiente) sigue siendo el día anterior", () => {
    expect(civilTodayAr(new Date("2026-08-21T00:30:00Z")).toISOString())
      .toBe("2026-08-20T12:00:00.000Z");
  });
  it("mediodía UTC cae en el mismo día civil", () => {
    expect(civilTodayAr(new Date("2026-08-20T12:00:00Z")).toISOString())
      .toBe("2026-08-20T12:00:00.000Z");
  });
});

describe("categoryAllowedForResidence (REG-01 + Art. 5 bis)", () => {
  it("Ciudadela: active y adherent sí, collaborator no", () => {
    expect(categoryAllowedForResidence("active", true)).toBe(true);
    expect(categoryAllowedForResidence("adherent", true)).toBe(true);
    expect(categoryAllowedForResidence("collaborator", true)).toBe(false);
  });
  it("otro barrio: solo collaborator", () => {
    expect(categoryAllowedForResidence("collaborator", false)).toBe(true);
    expect(categoryAllowedForResidence("active", false)).toBe(false);
    expect(categoryAllowedForResidence("adherent", false)).toBe(false);
  });
  it("las categorías web son exactamente tres", () => {
    expect(WEB_CATEGORIES).toEqual(["active", "adherent", "collaborator"]);
  });
  it("las categorías del padrón que NO se piden por la web quedan afuera", () => {
    // cadet, honorary y lifetime existen en el enum de Member pero no se
    // solicitan: el cadete se asocia en la sede, los otros dos los otorga la
    // Comisión.
    for (const cat of ["cadet", "honorary", "lifetime"] as const) {
      expect(categoryAllowedForResidence(cat, true)).toBe(false);
      expect(categoryAllowedForResidence(cat, false)).toBe(false);
    }
  });
});
