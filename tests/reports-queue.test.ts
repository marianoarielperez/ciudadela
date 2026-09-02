// Las vistas de la cola de reportes (spec §5.3): cada chip cuenta y filtra
// EXACTAMENTE lo mismo (la lista de estados ES el where), "Todos" nunca incluye
// borradores, y los filtros parseados sobreviven al href.
import { describe, expect, it } from "vitest";
import {
  parseReportFilters, parseReportView, reportFiltersHref, reportHref, REPORT_VIEWS, reportView,
} from "@/lib/admin/reports-queue";

describe("REPORT_VIEWS", () => {
  it("Sin presentar · Presentados · Desestimados · Todos, sin draft en ninguna", () => {
    expect(REPORT_VIEWS.map((v) => v.key)).toEqual(["pendientes", "presentados", "desestimados", "todos"]);
    for (const v of REPORT_VIEWS) expect(v.statuses).not.toContain("draft");
    expect(reportView("todos").statuses).toEqual(["received", "filed", "dismissed"]);
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
  it("el href de un chip conserva los filtros y cambia sólo la vista", () => {
    const f = parseReportFilters({ tipo: "reclamo", q: "pozo" });
    expect(reportFiltersHref(f, "presentados")).toBe("/admin/solicitudes/reportes?estado=presentados&tipo=reclamo&q=pozo");
    expect(reportFiltersHref(f, "pendientes")).toBe("/admin/solicitudes/reportes?tipo=reclamo&q=pozo");
  });
});
