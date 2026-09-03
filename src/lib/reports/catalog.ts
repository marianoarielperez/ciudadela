// Catálogo de Reportes (Módulo 7, spec §3). Módulo PURO: sin Prisma, sin React,
// sin lucide. Es la ÚNICA fuente de categorías, tipos, organismos y etiquetas:
// el wizard público, el panel del socio, la bandeja admin, el PDF y los correos
// leen de acá. Los íconos viajan como NOMBRE (`ReportIconName`); el mapa a
// componentes de lucide vive en un componente cliente, como `nav-icons.ts`.
//
// La lista de reclamos la dio el operador el 01/09/2026 (calcada de Comodoro
// Reporta, con "Semáforos" fuera y "Otro reporte" como salida libre). Los tipos
// con `direct` son los que el vecino puede y debe reclamar TAMBIÉN ante ese
// organismo (SCPL por WhatsApp, con número de reclamo; MCR por su formulario web,
// sin número); el wizard lo avisa en cada caso.

export type ReportKindSlug = "claim" | "initiative";
export type ReportStatusSlug = "draft" | "received" | "filed" | "dismissed";
export type AgencySlug = "mcr" | "scpl" | "council" | "province" | "camuzzi" | "other";

export type ReportIconName =
  | "droplets" | "waves" | "zap" | "trash-2" | "traffic-cone" | "tree-deciduous"
  | "bus-front" | "message-square-warning"
  | "users" | "palette" | "trophy" | "hard-hat" | "shield" | "lightbulb";

/** `direct`: el organismo ante el que el vecino puede y debe hacer TAMBIÉN el
 *  reclamo por su cuenta. La SCPL da número de reclamo (el wizard lo pide); el
 *  formulario "Reclamos mi calle" de la MCR no da ninguno (sólo la leyenda). */
export type DirectAgency = "scpl" | "mcr";
export type ClaimSubtype = { slug: string; label: string; direct?: DirectAgency };
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
      { slug: "no_water", label: "Falta de agua", direct: "scpl" },
      { slug: "low_pressure", label: "Falta presión de agua", direct: "scpl" },
      { slug: "leak", label: "Pérdida de agua en la red", direct: "scpl" },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "sewage", label: "Cloacas y saneamiento", icon: "waves",
    subtypes: [
      { slug: "blocked", label: "Cloacas tapadas", direct: "scpl" },
      { slug: "internal_overflow", label: "Desborde interno", direct: "scpl" },
      { slug: "manhole_overflow", label: "Desborde en boca de registro", direct: "scpl" },
      { slug: "manhole_cover", label: "Tapa de registro en malas condiciones", direct: "scpl" },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "electricity", label: "Electricidad y luminarias", icon: "zap",
    subtypes: [
      { slug: "voltage", label: "Problemas de tensión", direct: "scpl" },
      { slug: "streetlight", label: "Falta de alumbrado público / luminaria quemada", direct: "scpl" },
      { slug: "pole", label: "Poste dañado / peligro en vía pública", direct: "scpl" },
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
      { slug: "pothole", label: "Baches / pozos en calzada", direct: "mcr" },
      { slug: "dirt_road", label: "Calle de tierra en mal estado", direct: "mcr" },
      { slug: "sidewalk", label: "Veredas rotas", direct: "mcr" },
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

/** El estado terminal, con GÉNERO: el sujeto de un reclamo es "el reporte" y el
 *  de una iniciativa es "la iniciativa". `STATUS_LABELS.dismissed` está en
 *  masculino y a una iniciativa la deja diciendo "Desestimado". Vive acá —y no
 *  en la pantalla que lo descubrió— por lo mismo que `filedVerb`: la pastilla
 *  del socio, la terminal del wizard y la bandeja admin tienen que decir lo
 *  mismo. */
export function dismissedLabel(kind: ReportKindSlug): "Desestimado" | "Desestimada" {
  return kind === "claim" ? "Desestimado" : "Desestimada";
}

/** LA función que tienen que usar las pantallas para nombrar un estado: pasa
 *  `filed` por `filedVerb` (un reclamo se presenta, una iniciativa se trata),
 *  `dismissed` por `dismissedLabel` (el género) y el resto por `STATUS_LABELS`.
 *  Leer `STATUS_LABELS[status]` a mano le diría "Presentado" a una iniciativa,
 *  que es justo lo que la spec §2 no quiere. */
export function statusLabel(kind: ReportKindSlug, status: ReportStatusSlug): string {
  if (status === "filed") return filedVerb(kind);
  if (status === "dismissed") return dismissedLabel(kind);
  return STATUS_LABELS[status];
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

/** El organismo directo del tipo, o null si el reclamo no tiene uno. */
export function directAgency(
  categorySlug: string | null | undefined,
  subtypeSlug: string | null | undefined,
): DirectAgency | null {
  return findSubtype(categorySlug, subtypeSlug)?.direct ?? null;
}

export const DIRECT_AGENCY_LABELS: Record<DirectAgency, string> = { scpl: "SCPL", mcr: "MCR" };

/** Sólo la SCPL entrega número de reclamo: es el único organismo directo con
 *  campo de ticket en el wizard, en la ficha y en el PDF. */
export function isScplSubtype(categorySlug: string | null, subtypeSlug: string | null): boolean {
  return directAgency(categorySlug, subtypeSlug) === "scpl";
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

/** El formulario "Reclamos mi calle" de la Municipalidad (operador, 02/09/2026).
 *  No entrega número de reclamo: el wizard sólo muestra la leyenda con el enlace. */
export const MCR_RECLAMOS = {
  display: "comodoro.gov.ar/reclamosmicalle",
  href: "https://www.comodoro.gov.ar/reclamosmicalle/",
} as const;
