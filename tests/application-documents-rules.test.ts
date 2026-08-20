import { describe, expect, it } from "vitest";
import { MAX_ANNEXES, requiredDocsComplete } from "@/lib/applications/documents-rules";

// La regla es PURA a propósito: la usan la pantalla del paso 4 (para habilitar
// "Continuar") y las dos actions de envío (para no confiar en el cliente). Este
// archivo fija que las dos puntas leen exactamente lo mismo.
const d = (types: string[]) => types.map((type) => ({ type })) as never;

describe("requiredDocsComplete", () => {
  it("activo/adherente: frente + dorso alcanzan", () => {
    expect(requiredDocsComplete(d(["dni_front", "dni_back"]), "active").ok).toBe(true);
    expect(requiredDocsComplete(d(["dni_front", "dni_back"]), "adherent").ok).toBe(true);
  });

  it("falta el dorso → error nombrándolo", () => {
    const r = requiredDocsComplete(d(["dni_front"]), "active");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dorso/i);
  });

  it("falta el frente → error nombrándolo", () => {
    const r = requiredDocsComplete(d(["dni_back"]), "active");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/frente/i);
  });

  it("sin nada: reclama el frente primero, no los dos a la vez", () => {
    // Un solo pendiente por vez: el paso 4 muestra el error debajo del botón y
    // dos reclamos juntos se leen como un muro.
    const r = requiredDocsComplete(d([]), "adherent");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/frente/i);
      expect(r.error).not.toMatch(/dorso/i);
    }
  });

  it("colaborador exige al menos un anexo (REG-03)", () => {
    expect(requiredDocsComplete(d(["dni_front", "dni_back"]), "collaborator").ok).toBe(false);
    expect(requiredDocsComplete(d(["dni_front", "dni_back", "annex"]), "collaborator").ok).toBe(true);
  });

  it("el anexo del colaborador se reclama nombrando qué sirve como comprobante", () => {
    const r = requiredDocsComplete(d(["dni_front", "dni_back"]), "collaborator");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/vinculación/i);
  });

  it("un anexo suelto no reemplaza al DNI en ninguna categoría", () => {
    expect(requiredDocsComplete(d(["annex"]), "collaborator").ok).toBe(false);
    expect(requiredDocsComplete(d(["annex", "annex"]), "adherent").ok).toBe(false);
  });

  it("anexos de más no rompen la regla (el tope lo aplica la action de subida)", () => {
    expect(MAX_ANNEXES).toBe(2);
    expect(requiredDocsComplete(d(["dni_front", "dni_back", "annex", "annex"]), "collaborator").ok)
      .toBe(true);
  });
});
