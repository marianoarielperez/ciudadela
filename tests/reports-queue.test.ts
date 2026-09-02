// Las vistas de la cola de reportes (spec §5.3): cada chip cuenta y filtra
// EXACTAMENTE lo mismo (la lista de estados ES el where), "Todos" nunca incluye
// borradores, y los filtros parseados sobreviven al href.
import { describe, expect, it } from "vitest";
import {
  parseReportFilters, parseReportView, reportFiltersHref, reportFiltersQuery, reportHref,
  reportKindParam, REPORT_VIEWS, reportView,
} from "@/lib/admin/reports-queue";

describe("REPORT_VIEWS", () => {
  it("Sin presentar · Presentados · Desestimados · Todos, sin draft en ninguna", () => {
    expect(REPORT_VIEWS.map((v) => v.key)).toEqual(["pendientes", "presentados", "desestimados", "todos"]);
    for (const v of REPORT_VIEWS) expect(v.statuses).not.toContain("draft");
    expect(reportView("todos").statuses).toEqual(["received", "filed", "dismissed"]);
  });
  it("la vista por defecto cuenta lo MISMO que reports.pendingCount()", () => {
    // `reports.pendingCount()` (`src/lib/reports/service.ts`) es
    // `count({ where: { status: "received" } })`, y es el número de la pestaña
    // de Solicitudes y del tablero. La lista por defecto tiene que ser esa
    // misma cola: si acá se le suma un estado y allá no, la pestaña dice 7 y
    // la lista muestra 9. Este test es la mitad de esa pinza; la otra es el
    // `where` del servicio.
    expect(reportView("pendientes").statuses).toEqual(["received"]);
  });
  it("parseReportView cae a pendientes", () => {
    expect(parseReportView(undefined)).toBe("pendientes");
    expect(parseReportView("zzz")).toBe("pendientes");
    expect(parseReportView(["presentados"])).toBe("presentados");
  });
  it("reportHref omite el parámetro en la vista por defecto", () => {
    expect(reportHref("pendientes")).toBe("/admin/solicitudes/reportes");
    expect(reportHref("todos")).toBe("/admin/solicitudes/reportes?estado=todos");
  });
});

describe("filtros", () => {
  it("parsea tipo, categoría y texto, y descarta lo que no existe", () => {
    expect(parseReportFilters({ tipo: "reclamo", categoria: "water", q: " pozo " })).toEqual({ kind: "claim", category: "water", q: "pozo" });
    expect(parseReportFilters({ tipo: "queja", categoria: "zzz" })).toEqual({ kind: null, category: null, q: null });
    expect(parseReportFilters({ tipo: "iniciativa", categoria: "social" })).toEqual({ kind: "initiative", category: "social", q: null });
  });
  it("la categoría se valida contra el catálogo del TIPO elegido", () => {
    // `water` es de reclamos y `social` de iniciativas: cruzadas no sobreviven
    // al parseo. Sin esto, `?tipo=iniciativa&categoria=water` —una URL que el
    // propio formulario produce, porque el `<select>` de categorías no se
    // entera de que el de tipo cambió— lista cero filas sin decir por qué.
    expect(parseReportFilters({ tipo: "iniciativa", categoria: "water" }).category).toBeNull();
    expect(parseReportFilters({ tipo: "reclamo", categoria: "social" }).category).toBeNull();
    expect(parseReportFilters({ tipo: "reclamo", categoria: "water" }).category).toBe("water");
    expect(parseReportFilters({ tipo: "iniciativa", categoria: "social" }).category).toBe("social");
    // Sin tipo, vale la unión de los dos catálogos.
    expect(parseReportFilters({ categoria: "water" }).category).toBe("water");
    expect(parseReportFilters({ categoria: "social" }).category).toBe("social");
    // `other` existe en LOS DOS catálogos: es válido con cualquier tipo y sin
    // ninguno (y sin tipo matchea reclamos e iniciativas a la vez).
    for (const sp of [{ categoria: "other" }, { tipo: "reclamo", categoria: "other" }, { tipo: "iniciativa", categoria: "other" }]) {
      expect(parseReportFilters(sp).category).toBe("other");
    }
  });
  it("el texto se recorta a 80 y recién después se trimea", () => {
    // El orden importa: cortar en 80 puede dejar el texto terminando en un
    // espacio, y ese espacio viaja al `contains` y no matchea nada.
    const raw = `${"a".repeat(79)} bcd`;
    expect(parseReportFilters({ q: raw }).q).toBe("a".repeat(79));
    expect(parseReportFilters({ q: "  pozo  " }).q).toBe("pozo");
    expect(parseReportFilters({ q: "   " }).q).toBeNull();
    expect(parseReportFilters({ q: "x".repeat(200) }).q).toHaveLength(80);
  });
  it("el href de un chip conserva los filtros y cambia sólo la vista", () => {
    const f = parseReportFilters({ tipo: "reclamo", q: "pozo" });
    expect(reportFiltersHref(f, "presentados")).toBe("/admin/solicitudes/reportes?estado=presentados&tipo=reclamo&q=pozo");
    expect(reportFiltersHref(f, "pendientes")).toBe("/admin/solicitudes/reportes?tipo=reclamo&q=pozo");
  });
  it("el querystring es el href sin la base (lo usa la vista de mapa)", () => {
    // El mapa es OTRA ruta con los mismos filtros: arma su link con
    // `${REPORTS_BASE}/mapa${reportFiltersQuery(f, view)}` en vez de deshacer
    // un href a mano con un `.replace`.
    const f = parseReportFilters({ tipo: "reclamo", q: "pozo" });
    expect(reportFiltersQuery(f, "presentados")).toBe("?estado=presentados&tipo=reclamo&q=pozo");
    expect(reportFiltersHref(f, "presentados")).toBe(`/admin/solicitudes/reportes${reportFiltersQuery(f, "presentados")}`);
    // La vista por defecto y sin filtros no deja `?` colgando.
    expect(reportFiltersQuery({ kind: null, category: null, q: null }, "pendientes")).toBe("");
  });
  it("reportKindParam es la única traducción kind → `tipo`", () => {
    expect(reportKindParam("claim")).toBe("reclamo");
    expect(reportKindParam("initiative")).toBe("iniciativa");
    // `undefined` y no `""`: es lo que `pageHref` omite del querystring.
    expect(reportKindParam(null)).toBeUndefined();
  });
});
