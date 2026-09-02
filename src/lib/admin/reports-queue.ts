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

export type ReportFilters = {
  kind: "claim" | "initiative" | null;
  category: string | null;
  q: string | null;
  year: number | null;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** El año CIVIL ARGENTINO de un instante. Argentina es UTC-3 sin horario de
 *  verano (CLAUDE.md), así que restar tres horas y leer el año en UTC ES el
 *  calendario de acá: un reporte enviado el 31/12 a las 23:00 hora argentina
 *  llega a la base como el 1/1 a las 02:00 UTC, y en UTC diría el año que
 *  viene. Sin esto, "los reportes de 2026" se comería los últimos tres días
 *  del año y le adjudicaría al año siguiente reportes que nadie hizo ahí.
 *
 *  Misma convención que `civilDayOf` (`src/lib/treasury/periods.ts`), escrita
 *  aparte a propósito: aquel módulo es el de las cuotas y no se toca desde acá. */
export function civilYearOf(at: Date): number {
  return new Date(at.getTime() - 3 * 60 * 60 * 1000).getUTCFullYear();
}

/** La MEDIANOCHE CIVIL ARGENTINA del 1° de enero de `year`, en UTC: las 03:00
 *  de ese mismo día. Es la otra mitad de `civilYearOf` y vive al lado para que
 *  las dos digan lo mismo — con el corte en `Date.UTC(year, 0, 1)` a secas, las
 *  tres primeras horas del 1/1 UTC (o sea el 31/12 de 21:00 a 23:59 argentinas)
 *  caerían del lado equivocado del filtro. */
export function civilYearStartUtc(year: number): Date {
  return new Date(Date.UTC(year, 0, 1, 3));
}

/** El primer año que el filtro acepta. No es una regla de negocio: es el piso
 *  de un desplegable, y descarta el `?anio=1` que no le sirve a nadie. */
export const MIN_REPORT_YEAR = 2000;

/** El `anio` del querystring, o null. Cuatro dígitos —`Number("2026abc")` da
 *  NaN pero `Number(" 2026 ")` da 2026, y el `<option>` nunca emite eso— y
 *  dentro del rango. El techo es el año en curso + 1 y no el año en curso:
 *  entre el 31/12 21:00 y la medianoche argentinas, "el año que viene" ya tiene
 *  reportes posibles, y de todas formas un año sin filas devuelve una lista
 *  vacía, no un error. */
function parseYear(raw: string | undefined, currentYear: number): number | null {
  if (raw === undefined || !/^\d{4}$/.test(raw)) return null;
  const y = Number(raw);
  return y >= MIN_REPORT_YEAR && y <= currentYear + 1 ? y : null;
}

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

export function parseReportFilters(
  sp: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): ReportFilters {
  const tipo = one(sp.tipo);
  const kind = tipo === "reclamo" ? "claim" : tipo === "iniciativa" ? "initiative" : null;
  const cat = one(sp.categoria) ?? null;
  const known = categoryCatalog(kind).some((c) => c.slug === cat);
  // El recorte va ANTES del `trim` final: cortar en 80 puede dejar el texto
  // terminando en un espacio, y ese espacio viaja al `contains` y no matchea
  // nada. Trimear primero y recortar después dejaría justo ese caso adentro.
  const q = (one(sp.q) ?? "").slice(0, 80).trim();
  const year = parseYear(one(sp.anio), civilYearOf(now));
  return { kind, category: known ? cat : null, q: q === "" ? null : q, year };
}

/** ¿Hay algún filtro puesto? Lo preguntan las DOS pantallas (para el vacío y
 *  para mostrar "Limpiar") y el formulario compartido. Una función y no tres
 *  condiciones copiadas: sumar un filtro y olvidarse de una copia deja al
 *  operador con una lista vacía y sin el botón que la destraba (la lección de
 *  `coverageFloor`). */
export function hasReportFilters(f: ReportFilters): boolean {
  return f.kind !== null || f.category !== null || f.q !== null || f.year !== null;
}

/** El querystring de los filtros, con el `?` incluido o vacío. Existe aparte
 *  del href porque la vista de MAPA es otra ruta con los mismos filtros: sin
 *  esto, el link se armaba con `reportFiltersHref(...).replace(REPORTS_BASE, "")`,
 *  que es un href construido para deshacerlo a mano en el llamador. */
export function reportFiltersQuery(f: ReportFilters, view: ReportViewKey): string {
  const qs = new URLSearchParams();
  if (view !== DEFAULT_REPORT_VIEW) qs.set("estado", view);
  // El orden es el del formulario (año, tipo, categoría, texto): la URL que el
  // operador copia se lee igual que la barra que tiene arriba.
  if (f.year) qs.set("anio", String(f.year));
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
