// El catálogo de Reportes es la ÚNICA fuente de categorías, tipos y organismos
// (spec §3). Lo que se fija acá: la lista que dio el operador el 01/09/2026 —con
// sus tipos SCPL—, que "Otro reporte" no tiene tipos, que cada slug es único, y
// que el organismo sugerido sale del tipo (SCPL) o del reclamo (MCR).
import { describe, expect, it } from "vitest";
import {
  AGENCIES, CLAIM_CATEGORIES, INITIATIVE_CATEGORIES, KIND_LABELS, STATUS_LABELS,
  categoryLabel, filedVerb, findClaimCategory, findSubtype, isScplSubtype,
  subtypeLabel, suggestedAgency, SCPL_WHATSAPP,
} from "@/lib/reports/catalog";

describe("CLAIM_CATEGORIES", () => {
  it("son las ocho categorías del operador, en su orden", () => {
    expect(CLAIM_CATEGORIES.map((c) => c.slug)).toEqual([
      "water", "sewage", "electricity", "waste", "streets", "trees", "transport", "other",
    ]);
  });

  it("los slugs de categorías y de tipos son únicos", () => {
    const slugs = CLAIM_CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of CLAIM_CATEGORIES) {
      const sub = c.subtypes.map((s) => s.slug);
      expect(new Set(sub).size, c.slug).toBe(sub.length);
    }
  });

  it("'Otro reporte' no tiene tipos: va directo a la descripción", () => {
    expect(findClaimCategory("other")?.subtypes).toEqual([]);
  });

  it("los tipos SCPL son exactamente los que marcó el operador", () => {
    const scpl = CLAIM_CATEGORIES.flatMap((c) =>
      c.subtypes.filter((s) => s.scpl).map((s) => `${c.slug}/${s.slug}`),
    );
    expect(scpl).toEqual([
      "water/no_water", "water/low_pressure", "water/leak",
      "sewage/blocked", "sewage/internal_overflow", "sewage/manhole_overflow", "sewage/manhole_cover",
      "electricity/voltage", "electricity/streetlight", "electricity/pole",
    ]);
    expect(isScplSubtype("water", "leak")).toBe(true);
    expect(isScplSubtype("water", "other")).toBe(false);
    expect(isScplSubtype("waste", "dump")).toBe(false);
  });

  it("Árboles y espacios verdes no tiene 'Otro' (lista del operador tal cual)", () => {
    expect(findClaimCategory("trees")?.subtypes.map((s) => s.slug)).toEqual([
      "pruning", "fall_risk", "roots", "green_space",
    ]);
  });

  it("findSubtype devuelve null para combinaciones que no existen", () => {
    expect(findSubtype("water", "pothole")).toBeNull();
    expect(findSubtype("nope", "leak")).toBeNull();
    expect(findSubtype("streets", "pothole")?.label).toBe("Baches / pozos en calzada");
  });
});

describe("INITIATIVE_CATEGORIES", () => {
  it("son las seis aprobadas", () => {
    expect(INITIATIVE_CATEGORIES.map((c) => c.slug)).toEqual([
      "social", "cultural", "sports", "works", "safety", "other",
    ]);
  });
});

describe("AGENCIES y suggestedAgency", () => {
  it("lista fija con 'Otro' al final", () => {
    expect(AGENCIES.map((a) => a.slug)).toEqual(["mcr", "scpl", "council", "province", "camuzzi", "other"]);
  });

  it("un tipo SCPL sugiere SCPL; el resto de los reclamos, MCR; una iniciativa, nada", () => {
    expect(suggestedAgency({ kind: "claim", category: "water", subtype: "leak" })).toBe("scpl");
    expect(suggestedAgency({ kind: "claim", category: "water", subtype: "other" })).toBe("mcr");
    expect(suggestedAgency({ kind: "claim", category: "streets", subtype: "pothole" })).toBe("mcr");
    expect(suggestedAgency({ kind: "claim", category: "other", subtype: null })).toBe("mcr");
    expect(suggestedAgency({ kind: "initiative", category: "social", subtype: null })).toBeNull();
  });
});

describe("etiquetas", () => {
  it("KIND_LABELS y STATUS_LABELS cubren los enums", () => {
    expect(KIND_LABELS).toEqual({ claim: "Reclamo", initiative: "Iniciativa" });
    expect(STATUS_LABELS).toEqual({
      draft: "Borrador", received: "Recibido", filed: "Presentado", dismissed: "Desestimado",
    });
  });

  it("el segundo estado se lee distinto por tipo", () => {
    expect(filedVerb("claim")).toBe("Presentado");
    expect(filedVerb("initiative")).toBe("Tratada");
  });

  it("categoryLabel y subtypeLabel caen a un texto neutro si el slug no existe", () => {
    expect(categoryLabel("claim", "water")).toBe("Agua potable");
    expect(categoryLabel("initiative", "works")).toBe("Obras e infraestructura");
    expect(categoryLabel("claim", "zzz")).toBe("Sin categoría");
    expect(subtypeLabel("water", "leak")).toBe("Pérdida de agua en la red");
    expect(subtypeLabel("water", null)).toBe("");
  });

  it("el WhatsApp del bot de la SCPL es el que dio el operador", () => {
    expect(SCPL_WHATSAPP.display).toBe("+54 9 2975 26-0760");
    expect(SCPL_WHATSAPP.href).toBe("https://wa.me/5492975260760");
  });
});
