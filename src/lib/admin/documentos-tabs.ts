// Pestañas de /admin/documentos. Client-side (`?tab=`, calco de config-tabs) y
// NO subrutas: una sola URL conserva los redirects de actions.ts y el deep-link
// de los chips de año (`?tab=memorias&anio=2025`). El mapa ícono→componente
// vive en el componente cliente: lib/ es puro y testeable en node sin lucide.
import type { InstitutionalDocumentType } from "@/generated/prisma/client";

export type DocumentosTabId = "normas" | "memorias" | "balances" | "otros";

export type DocumentosTab = {
  value: DocumentosTabId;
  label: string;
  icon: "scale" | "book-open" | "chart-column" | "files";
  type: InstitutionalDocumentType;
};

export const DOCUMENTOS_TABS: DocumentosTab[] = [
  { value: "normas", label: "Normas", icon: "scale", type: "norm" },
  { value: "memorias", label: "Memorias", icon: "book-open", type: "annual_report" },
  { value: "balances", label: "Balances", icon: "chart-column", type: "balance" },
  { value: "otros", label: "Otros", icon: "files", type: "other" },
];

// Acepta el union crudo de searchParams: un param repetido o inventado cae en
// la primera pestaña, que es lo inofensivo.
export function initialDocumentosTab(sp: { tab?: string | string[] }): DocumentosTabId {
  const found = DOCUMENTOS_TABS.find((t) => t.value === sp.tab);
  return found ? found.value : "normas";
}

// A qué pestaña vuelve el redirect después de crear/editar/borrar un documento.
export function tabForType(type: InstitutionalDocumentType): DocumentosTabId {
  return DOCUMENTOS_TABS.find((t) => t.type === type)?.value ?? "normas";
}
