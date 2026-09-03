// El catálogo de Reportes es la ÚNICA fuente de categorías, tipos y organismos
// (spec §3). Lo que se fija acá: la lista que dio el operador el 01/09/2026 —con
// sus tipos SCPL—, que "Otro reporte" no tiene tipos, que cada slug es único, y
// que el organismo sugerido sale del tipo (SCPL) o del reclamo (MCR).
import { describe, expect, it } from "vitest";
import {
  AGENCIES, CLAIM_CATEGORIES, INITIATIVE_CATEGORIES, KIND_LABELS, STATUS_LABELS,
  categoryLabel, filedVerb, findClaimCategory, findSubtype, isScplSubtype,
  dismissedLabel, statusLabel, subtypeLabel, suggestedAgency, SCPL_WHATSAPP, directAgency, DIRECT_AGENCY_LABELS, MCR_RECLAMOS,
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
      c.subtypes.filter((s) => s.direct === "scpl").map((s) => `${c.slug}/${s.slug}`),
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

describe("organismo directo", () => {
  it("los tipos MCR son los tres de calles que marcó el operador (02/09/2026)", () => {
    const mcr = CLAIM_CATEGORIES.flatMap((c) =>
      c.subtypes.filter((s) => s.direct === "mcr").map((s) => `${c.slug}/${s.slug}`),
    );
    expect(mcr).toEqual(["streets/pothole", "streets/dirt_road", "streets/sidewalk"]);
  });

  it("directAgency sale del tipo; sólo la SCPL tiene número de reclamo", () => {
    expect(directAgency("streets", "pothole")).toBe("mcr");
    expect(directAgency("water", "leak")).toBe("scpl");
    expect(directAgency("streets", "other")).toBeNull();
    expect(directAgency(null, null)).toBeNull();
    expect(isScplSubtype("streets", "pothole")).toBe(false);
    expect(DIRECT_AGENCY_LABELS).toEqual({ scpl: "SCPL", mcr: "MCR" });
    expect(MCR_RECLAMOS.href).toBe("https://www.comodoro.gov.ar/reclamosmicalle/");
  });

  it("un tipo MCR sugiere MCR al marcarlo presentado, como cualquier reclamo no SCPL", () => {
    expect(suggestedAgency({ kind: "claim", category: "streets", subtype: "pothole" })).toBe("mcr");
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

  // La función que tienen que llamar las pantallas: `filed` se lee por tipo y el
  // resto sale de STATUS_LABELS tal cual.
  it("statusLabel lee 'filed' y 'dismissed' por tipo, y el resto de STATUS_LABELS", () => {
    expect(statusLabel("initiative", "filed")).toBe("Tratada");
    expect(statusLabel("claim", "filed")).toBe("Presentado");
    expect(statusLabel("claim", "received")).toBe("Recibido");
    expect(statusLabel("initiative", "received")).toBe("Recibido");
    expect(statusLabel("claim", "dismissed")).toBe("Desestimado");
    expect(statusLabel("initiative", "draft")).toBe("Borrador");
  });

  // El género del estado terminal: `STATUS_LABELS.dismissed` está en masculino
  // y a una iniciativa la dejaba diciendo "Desestimado" en la pastilla de la
  // tarjeta del socio. Vive en el dominio y no en la pantalla, como `filedVerb`.
  it("dismissedLabel concuerda con el sujeto, y statusLabel lo usa", () => {
    expect(dismissedLabel("claim")).toBe("Desestimado");
    expect(dismissedLabel("initiative")).toBe("Desestimada");
    expect(statusLabel("initiative", "dismissed")).toBe(dismissedLabel("initiative"));
    expect(statusLabel("claim", "dismissed")).toBe(dismissedLabel("claim"));
    // El masculino crudo de la tabla sigue existiendo (es la etiqueta neutra del
    // panel, sobre la palabra "reporte"): lo que no puede es llegar a una
    // iniciativa por `statusLabel`.
    expect(statusLabel("initiative", "dismissed")).not.toBe(STATUS_LABELS.dismissed);
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
