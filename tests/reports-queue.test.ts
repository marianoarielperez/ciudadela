// Las vistas de la cola de reportes (spec §5.3): cada chip cuenta y filtra
// EXACTAMENTE lo mismo (la lista de estados ES el where), "Todos" nunca incluye
// borradores, y los filtros parseados sobreviven al href.
import { describe, expect, it } from "vitest";
import {
  civilYearOf, hasReportFilters, parseReportFilters, parseReportView, reportFiltersHref,
  reportFiltersQuery, reportHref, reportKindParam, REPORT_VIEWS, reportView,
} from "@/lib/admin/reports-queue";

/** Un instante fijo para todo lo que mira "el año en curso": el rango que
 *  `parseReportFilters` acepta se mueve con el reloj, y un test atado a
 *  `new Date()` se pondría en rojo solo el 1° de enero. */
const NOW = new Date(Date.UTC(2026, 8, 2, 15));

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
    expect(parseReportFilters({ tipo: "reclamo", categoria: "water", q: " pozo " })).toEqual({ kind: "claim", category: "water", q: "pozo", year: null });
    expect(parseReportFilters({ tipo: "queja", categoria: "zzz" })).toEqual({ kind: null, category: null, q: null, year: null });
    expect(parseReportFilters({ tipo: "iniciativa", categoria: "social" })).toEqual({ kind: "initiative", category: "social", q: null, year: null });
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
    expect(reportFiltersQuery({ kind: null, category: null, q: null, year: null }, "pendientes")).toBe("");
  });
  it("reportKindParam es la única traducción kind → `tipo`", () => {
    expect(reportKindParam("claim")).toBe("reclamo");
    expect(reportKindParam("initiative")).toBe("iniciativa");
    // `undefined` y no `""`: es lo que `pageHref` omite del querystring.
    expect(reportKindParam(null)).toBeUndefined();
  });
});

describe("filtro de año", () => {
  it("acepta cuatro dígitos dentro del rango y descarta todo lo demás", () => {
    expect(parseReportFilters({ anio: "2025" }, NOW).year).toBe(2025);
    expect(parseReportFilters({ anio: "2000" }, NOW).year).toBe(2000);
    // El techo es el año en curso + 1: entre las 21:00 del 31/12 y la
    // medianoche argentinas, el año que viene ya puede tener reportes.
    expect(parseReportFilters({ anio: "2027" }, NOW).year).toBe(2027);
    // Fuera de rango: no es un año del padrón de reportes.
    expect(parseReportFilters({ anio: "1999" }, NOW).year).toBeNull();
    expect(parseReportFilters({ anio: "2028" }, NOW).year).toBeNull();
    // Y lo que no es un año de cuatro dígitos tampoco lo es. `Number(" 2026 ")`
    // da 2026 y `Number("")` da 0: por eso el filtro es la expresión regular y
    // no un `Number.isInteger`.
    for (const anio of ["", " 2026 ", "26", "20260", "2026a", "abcd", "-2026", "2026.0"]) {
      expect(parseReportFilters({ anio }, NOW).year).toBeNull();
    }
    expect(parseReportFilters({}, NOW).year).toBeNull();
    // Un array (un `?anio=` repetido) toma el primero, como el resto.
    expect(parseReportFilters({ anio: ["2024", "2023"] }, NOW).year).toBe(2024);
  });

  it("el año en curso es el CIVIL argentino, no el del UTC", () => {
    // 1/1/2027 00:30 UTC es el 31/12/2026 a las 21:30 en Comodoro: el año en
    // curso todavía es 2026, así que el techo sigue siendo 2027 y 2028 no
    // entra. Con el año leído del UTC, ese 31 de diciembre a la noche el
    // desplegable habría aceptado un año más de lo debido.
    const nocheVieja = new Date(Date.UTC(2027, 0, 1, 0, 30));
    expect(civilYearOf(nocheVieja)).toBe(2026);
    expect(parseReportFilters({ anio: "2027" }, nocheVieja).year).toBe(2027);
    expect(parseReportFilters({ anio: "2028" }, nocheVieja).year).toBeNull();
    // Y tres horas después ya es 2027 de este lado.
    expect(civilYearOf(new Date(Date.UTC(2027, 0, 1, 3)))).toBe(2027);
  });

  it("el año sobrevive al querystring y vuelve intacto (round-trip)", () => {
    const f = parseReportFilters({ anio: "2025", tipo: "reclamo", categoria: "water", q: "pozo" }, NOW);
    const qs = reportFiltersQuery(f, "todos");
    expect(qs).toBe("?estado=todos&anio=2025&tipo=reclamo&categoria=water&q=pozo");
    // De vuelta por donde vino: lo que el chip escribe es lo que la próxima
    // pantalla parsea, y el año no se pierde en el camino.
    const back = Object.fromEntries(new URLSearchParams(qs));
    expect(parseReportFilters(back, NOW)).toEqual(f);
    expect(parseReportView(back.estado)).toBe("todos");
    // Y sin año no queda un `anio=` colgando.
    expect(reportFiltersQuery(parseReportFilters({ tipo: "reclamo" }, NOW), "pendientes")).toBe("?tipo=reclamo");
  });

  it("hasReportFilters cuenta el año como filtro", () => {
    // Es la función que decide si aparece "Limpiar" y si el vacío dice "ningún
    // reporte coincide con esos filtros": con el año afuera, el operador que
    // filtra por 2019 y no ve nada se queda sin el botón que lo destraba.
    expect(hasReportFilters(parseReportFilters({}, NOW))).toBe(false);
    expect(hasReportFilters(parseReportFilters({ anio: "2025" }, NOW))).toBe(true);
    expect(hasReportFilters(parseReportFilters({ anio: "1999" }, NOW))).toBe(false);
    expect(hasReportFilters(parseReportFilters({ tipo: "reclamo" }, NOW))).toBe(true);
    expect(hasReportFilters(parseReportFilters({ categoria: "water" }, NOW))).toBe(true);
    expect(hasReportFilters(parseReportFilters({ q: "pozo" }, NOW))).toBe(true);
  });
});
