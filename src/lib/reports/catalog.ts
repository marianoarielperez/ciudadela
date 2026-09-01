// Catálogo de Reportes (Módulo 7, spec §3). Módulo PURO: sin Prisma, sin React,
// sin lucide. Es la ÚNICA fuente de categorías, tipos, organismos y etiquetas:
// el wizard público, el panel del socio, la bandeja admin, el PDF y los correos
// leen de acá. Los íconos viajan como NOMBRE (`ReportIconName`); el mapa a
// componentes de lucide vive en un componente cliente, como `nav-icons.ts`.
//
// La lista de reclamos la dio el operador el 01/09/2026 (calcada de Comodoro
// Reporta, con "Semáforos" fuera y "Otro reporte" como salida libre). Los tipos
// con `scpl: true` son los que el vecino puede y debe reclamar TAMBIÉN ante la
// SCPL por WhatsApp; el wizard lo avisa y pide el número de reclamo.

export type ReportKindSlug = "claim" | "initiative";
export type ReportStatusSlug = "draft" | "received" | "filed" | "dismissed";
export type AgencySlug = "mcr" | "scpl" | "council" | "province" | "camuzzi" | "other";

export type ReportIconName =
  | "droplets" | "waves" | "zap" | "trash-2" | "traffic-cone" | "tree-deciduous"
  | "bus-front" | "message-square-warning"
  | "users" | "palette" | "trophy" | "hard-hat" | "shield" | "lightbulb";

export type ClaimSubtype = { slug: string; label: string; scpl?: true };
export type ClaimCategory = {
  slug: string;
  label: string;
  icon: ReportIconName;
  /** Vacío = la categoría no tiene tipos y el vecino va directo a la descripción. */
  subtypes: readonly ClaimSubtype[];
};
export type InitiativeCategory = { slug: string; label: string; icon: ReportIconName };

export const CLAIM_CATEGORIES: readonly ClaimCategory[] = [
  {
    slug: "water", label: "Agua potable", icon: "droplets",
    subtypes: [
      { slug: "no_water", label: "Falta de agua", scpl: true },
      { slug: "low_pressure", label: "Falta presión de agua", scpl: true },
      { slug: "leak", label: "Pérdida de agua en la red", scpl: true },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "sewage", label: "Cloacas y saneamiento", icon: "waves",
    subtypes: [
      { slug: "blocked", label: "Cloacas tapadas", scpl: true },
      { slug: "internal_overflow", label: "Desborde interno", scpl: true },
      { slug: "manhole_overflow", label: "Desborde en boca de registro", scpl: true },
      { slug: "manhole_cover", label: "Tapa de registro en malas condiciones", scpl: true },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "electricity", label: "Electricidad y luminarias", icon: "zap",
    subtypes: [
      { slug: "voltage", label: "Problemas de tensión", scpl: true },
      { slug: "streetlight", label: "Falta de alumbrado público / luminaria quemada", scpl: true },
      { slug: "pole", label: "Poste dañado / peligro en vía pública", scpl: true },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "waste", label: "Residuos", icon: "trash-2",
    subtypes: [
      { slug: "general", label: "Residuos generales" },
      { slug: "vacant_lot", label: "Residuos en terrenos / baldíos" },
      { slug: "dump", label: "Basural a cielo abierto / microbasural" },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "streets", label: "Calles y vía pública", icon: "traffic-cone",
    subtypes: [
      { slug: "pothole", label: "Baches / pozos en calzada" },
      { slug: "dirt_road", label: "Calle de tierra en mal estado" },
      { slug: "sidewalk", label: "Veredas rotas" },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "trees", label: "Árboles y espacios verdes", icon: "tree-deciduous",
    subtypes: [
      { slug: "pruning", label: "Poda de árboles" },
      { slug: "fall_risk", label: "Árbol en riesgo de caída" },
      { slug: "roots", label: "Raíces levantando veredas / viviendas" },
      { slug: "green_space", label: "Falta de mantenimiento de espacios verdes" },
    ],
  },
  {
    slug: "transport", label: "Transporte público", icon: "bus-front",
    subtypes: [
      { slug: "no_shelter", label: "Falta de garitas / refugios" },
      { slug: "no_signage", label: "Falta de señalización de paradas" },
      { slug: "shelter_damaged", label: "Garitas / refugios en mal estado" },
      { slug: "other", label: "Otro" },
    ],
  },
  { slug: "other", label: "Otro reporte", icon: "message-square-warning", subtypes: [] },
];

export const INITIATIVE_CATEGORIES: readonly InitiativeCategory[] = [
  { slug: "social", label: "Social", icon: "users" },
  { slug: "cultural", label: "Cultural", icon: "palette" },
  { slug: "sports", label: "Deportiva", icon: "trophy" },
  { slug: "works", label: "Obras e infraestructura", icon: "hard-hat" },
  { slug: "safety", label: "Seguridad", icon: "shield" },
  { slug: "other", label: "Otra", icon: "lightbulb" },
];

export const AGENCIES: readonly { slug: AgencySlug; label: string }[] = [
  { slug: "mcr", label: "Municipalidad de Comodoro Rivadavia (MCR)" },
  { slug: "scpl", label: "SCPL" },
  { slug: "council", label: "Concejo Deliberante" },
  { slug: "province", label: "Provincia del Chubut" },
  { slug: "camuzzi", label: "Camuzzi" },
  { slug: "other", label: "Otro" },
];

export const AGENCY_LABELS: Record<AgencySlug, string> = Object.fromEntries(
  AGENCIES.map((a) => [a.slug, a.label]),
) as Record<AgencySlug, string>;

export const KIND_LABELS: Record<ReportKindSlug, string> = {
  claim: "Reclamo",
  initiative: "Iniciativa",
};

export const STATUS_LABELS: Record<ReportStatusSlug, string> = {
  draft: "Borrador",
  received: "Recibido",
  filed: "Presentado",
  dismissed: "Desestimado",
};

/** El segundo estado se LEE distinto según el tipo (spec §2): un reclamo se
 *  presenta ante un organismo; una iniciativa la trata la Comisión (Art. 6.2). */
export function filedVerb(kind: ReportKindSlug): "Presentado" | "Tratada" {
  return kind === "claim" ? "Presentado" : "Tratada";
}

export function findClaimCategory(slug: string | null | undefined): ClaimCategory | null {
  return CLAIM_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

export function findInitiativeCategory(slug: string | null | undefined): InitiativeCategory | null {
  return INITIATIVE_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

export function findSubtype(
  categorySlug: string | null | undefined,
  subtypeSlug: string | null | undefined,
): ClaimSubtype | null {
  const category = findClaimCategory(categorySlug);
  if (!category) return null;
  return category.subtypes.find((s) => s.slug === subtypeSlug) ?? null;
}

export function isScplSubtype(categorySlug: string | null, subtypeSlug: string | null): boolean {
  return findSubtype(categorySlug, subtypeSlug)?.scpl === true;
}

/** El organismo con el que arranca el formulario de "presentado" (spec §2,
 *  "sugerido y visible"): SCPL cuando el tipo es SCPL, MCR para cualquier otro
 *  reclamo, y ninguno para una iniciativa (la trata la Comisión). */
export function suggestedAgency(input: {
  kind: ReportKindSlug;
  category: string | null;
  subtype: string | null;
}): AgencySlug | null {
  if (input.kind === "initiative") return null;
  return isScplSubtype(input.category, input.subtype) ? "scpl" : "mcr";
}

const NO_CATEGORY = "Sin categoría";

export function categoryLabel(kind: ReportKindSlug, slug: string | null | undefined): string {
  const hit = kind === "claim" ? findClaimCategory(slug) : findInitiativeCategory(slug);
  return hit?.label ?? NO_CATEGORY;
}

export function subtypeLabel(
  categorySlug: string | null | undefined,
  subtypeSlug: string | null | undefined,
): string {
  return findSubtype(categorySlug, subtypeSlug)?.label ?? "";
}

/** El bot de reclamos de la SCPL por WhatsApp (operador, 01/09/2026). */
export const SCPL_WHATSAPP = {
  display: "+54 9 2975 26-0760",
  href: "https://wa.me/5492975260760",
} as const;
