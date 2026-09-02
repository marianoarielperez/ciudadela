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

// La vista por defecto es la COLA, y sus estados son los mismos que cuenta
// `reports.pendingCount()` (`src/lib/reports/service.ts`), que es el número de
// la pestaña de Solicitudes y el del tablero. Si alguien le suma un estado a
// "pendientes" y no lo suma allá, la pestaña dice 7 y la lista muestra 9 — la
// misma clase de divergencia que ya corrigió `coverageFloor`. Un test lo fija
// de los dos lados.
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

/** El valor del parámetro `tipo` para un `kind` del dominio. Lo comparten el
 *  querystring que arma esta misma unidad y los `<select>`/links de página que
 *  no pasan por él (la paginación): con un ternario copiado, alcanza con que
 *  alguien escriba "reclamos" en uno para que el filtro se pierda al cambiar de
 *  página. `undefined` —y no `""`— porque es lo que `pageHref` omite. */
export function reportKindParam(kind: ReportFilters["kind"]): "reclamo" | "iniciativa" | undefined {
  if (kind === "claim") return "reclamo";
  if (kind === "initiative") return "iniciativa";
  return undefined;
}

/** El catálogo contra el que se valida `categoria`: el del TIPO elegido, o la
 *  unión si no hay tipo. Sin esto, `?tipo=iniciativa&categoria=water` sobrevive
 *  al parseo y la lista queda vacía sin decir por qué (ninguna iniciativa tiene
 *  la categoría de un reclamo) — y es una URL que el propio formulario produce:
 *  el `<select>` de categorías es un GET plano y no se entera de que el de tipo
 *  cambió. Ojo con `other`: existe en los DOS catálogos, así que sin tipo es una
 *  categoría válida que matchea reclamos e iniciativas a la vez. */
function categoryCatalog(kind: ReportFilters["kind"]): readonly { slug: string }[] {
  if (kind === "claim") return CLAIM_CATEGORIES;
  if (kind === "initiative") return INITIATIVE_CATEGORIES;
  return [...CLAIM_CATEGORIES, ...INITIATIVE_CATEGORIES];
}

export function parseReportFilters(sp: Record<string, string | string[] | undefined>): ReportFilters {
  const tipo = one(sp.tipo);
  const kind = tipo === "reclamo" ? "claim" : tipo === "iniciativa" ? "initiative" : null;
  const cat = one(sp.categoria) ?? null;
  const known = categoryCatalog(kind).some((c) => c.slug === cat);
  // El recorte va ANTES del `trim` final: cortar en 80 puede dejar el texto
  // terminando en un espacio, y ese espacio viaja al `contains` y no matchea
  // nada. Trimear primero y recortar después dejaría justo ese caso adentro.
  const q = (one(sp.q) ?? "").slice(0, 80).trim();
  return { kind, category: known ? cat : null, q: q === "" ? null : q };
}

/** El querystring de los filtros, con el `?` incluido o vacío. Existe aparte
 *  del href porque la vista de MAPA es otra ruta con los mismos filtros: sin
 *  esto, el link se armaba con `reportFiltersHref(...).replace(REPORTS_BASE, "")`,
 *  que es un href construido para deshacerlo a mano en el llamador. */
export function reportFiltersQuery(f: ReportFilters, view: ReportViewKey): string {
  const qs = new URLSearchParams();
  if (view !== DEFAULT_REPORT_VIEW) qs.set("estado", view);
  const tipo = reportKindParam(f.kind);
  if (tipo) qs.set("tipo", tipo);
  if (f.category) qs.set("categoria", f.category);
  if (f.q) qs.set("q", f.q);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function reportFiltersHref(f: ReportFilters, view: ReportViewKey): string {
  return `${REPORTS_BASE}${reportFiltersQuery(f, view)}`;
}
