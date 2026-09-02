// Las vistas y los filtros de la cola de reportes (spec §5.3), en un solo lugar
// y PURO: la lista de estados de cada vista es también el `where`, y los chips
// del panel llevan siempre a la vista que efectivamente lista ese estado.
//
// Que `statuses` sirva a la vez de rótulo, de contador y de filtro es lo que
// impide la clase de bug que ya corrigió `coverageFloor`: con una lista para
// contar y otra para listar, alcanza con que alguien toque una para que el chip
// diga 7 y la tabla muestre 6. `draft` no aparece en NINGUNA vista —un borrador
// no fue enviado y no es trabajo de nadie— y el test lo verifica vista por
// vista, no sólo en "Todos".
import type { ReportStatus } from "@/generated/prisma/client";
import { CLAIM_CATEGORIES, INITIATIVE_CATEGORIES } from "@/lib/reports/catalog";

export const REPORTS_BASE = "/admin/solicitudes/reportes";

export type ReportViewKey = "pendientes" | "presentados" | "desestimados" | "todos";

export const REPORT_VIEWS: Array<{ key: ReportViewKey; label: string; statuses: ReportStatus[]; empty: string }> = [
  { key: "pendientes", label: "Sin presentar", statuses: ["received"], empty: "No hay reportes esperando. Los nuevos aparecen acá solos." },
  { key: "presentados", label: "Presentados", statuses: ["filed"], empty: "Todavía no se presentó ningún reporte." },
  { key: "desestimados", label: "Desestimados", statuses: ["dismissed"], empty: "Ningún reporte fue desestimado." },
  { key: "todos", label: "Todos", statuses: ["received", "filed", "dismissed"], empty: "Todavía no entró ningún reporte." },
];

export const DEFAULT_REPORT_VIEW: ReportViewKey = "pendientes";

export function parseReportView(raw: string | string[] | undefined): ReportViewKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return REPORT_VIEWS.find((v) => v.key === value)?.key ?? DEFAULT_REPORT_VIEW;
}

export function reportView(key: ReportViewKey) {
  return REPORT_VIEWS.find((v) => v.key === key) ?? REPORT_VIEWS[0];
}

export function reportHref(key: ReportViewKey): string {
  return key === DEFAULT_REPORT_VIEW ? REPORTS_BASE : `${REPORTS_BASE}?estado=${key}`;
}

export type ReportFilters = { kind: "claim" | "initiative" | null; category: string | null; q: string | null };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseReportFilters(sp: Record<string, string | string[] | undefined>): ReportFilters {
  const tipo = one(sp.tipo);
  const kind = tipo === "reclamo" ? "claim" : tipo === "iniciativa" ? "initiative" : null;
  const cat = one(sp.categoria) ?? null;
  const known = [...CLAIM_CATEGORIES, ...INITIATIVE_CATEGORIES].some((c) => c.slug === cat);
  const q = (one(sp.q) ?? "").trim();
  return { kind, category: known ? cat : null, q: q === "" ? null : q.slice(0, 80) };
}

export function reportFiltersHref(f: ReportFilters, view: ReportViewKey): string {
  const qs = new URLSearchParams();
  if (view !== DEFAULT_REPORT_VIEW) qs.set("estado", view);
  if (f.kind) qs.set("tipo", f.kind === "claim" ? "reclamo" : "iniciativa");
  if (f.category) qs.set("categoria", f.category);
  if (f.q) qs.set("q", f.q);
  const s = qs.toString();
  return s ? `${REPORTS_BASE}?${s}` : REPORTS_BASE;
}
