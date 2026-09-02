// La vista MAPA de la cola de reportes (spec §5.3), renderizada.
//
// Lo que sostiene y no se ve en `reports-query.test.ts` —que prueba el `where`
// puro— es lo que la PANTALLA hace con él:
//
// 1. Al cliente no viaja un solo dato de identidad ni el escrito del vecino
//    (Ley 25.326). Se verifica DOS veces y a propósito: el `select` que la
//    página le pide a Prisma no nombra esos campos, y el payload que recibe el
//    componente del mapa no contiene sus VALORES.
// 2. Un reporte sin coordenadas se CUENTA y se dice ("N sin ubicación"), pero
//    no se dibuja.
// 3. Los chips y el botón "Lista" llevan los filtros vigentes: la ida y la
//    vuelta lista ↔ mapa no pierde `estado/tipo/categoria/q`.
// 4. El `where` de la ubicación se compone con `AND`: `reportWhere` ya usa `OR`
//    cuando hay texto de búsqueda, y un spread se lo comería.
//
// El doble de base HONRA el `where` que recibe (lección del M6): es un matcher
// recursivo, no un filtro re-implementado, y TIRA ante una condición que no
// entiende — así, una cláusula nueva en `reportWhere` rompe el test en vez de
// pasar de largo. Lo que el doble NO honra, también a propósito, es el
// `select`: devuelve la fila entera, así que si algún día la página dejara
// pasar una fila cruda al mapa, la aserción de PII lo vería.
//
// El componente del mapa se stubea: arrastraría Leaflet a un test de node, y lo
// que acá se verifica es el árbol del Server Component y el payload que le pasa.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: number;
  kind: "claim" | "initiative";
  status: string;
  category: string;
  lat: number | null;
  lng: number | null;
  description: string;
  streetName: string | null;
  reporterName: string | null;
};

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
  captured: [] as unknown[][],
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: { report: { count: h.count, findMany: h.findMany } } }));
vi.mock("@/app/admin/solicitudes/reportes/mapa/reports-map-loader", () => ({
  default: ({ points }: { points: unknown[] }) => {
    h.captured.push(points);
    return "MAPA";
  },
}));

import ReportesMapaPage from "@/app/admin/solicitudes/reportes/mapa/page";

/** Aplica el `where` de Prisma tal como llega. Tira ante lo que no conoce: un
 *  fake que devuelve `true` por descuido convierte cualquier aserción de filtro
 *  en un adorno. */
function matches(row: Row, where: unknown): boolean {
  if (where == null) return true;
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (key === "AND") {
      if (!(cond as unknown[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(cond as unknown[]).some((w) => matches(row, w))) return false;
      continue;
    }
    const value = (row as unknown as Record<string, unknown>)[key];
    if (cond !== null && typeof cond === "object") {
      const c = cond as Record<string, unknown>;
      if ("in" in c) {
        if (!(c.in as unknown[]).includes(value)) return false;
      } else if ("not" in c) {
        if (c.not === null ? value == null : value === c.not) return false;
      } else if ("contains" in c) {
        const needle = String(c.contains).toLowerCase();
        if (typeof value !== "string" || !value.toLowerCase().includes(needle)) return false;
      } else {
        throw new Error(`condición no soportada por el doble: ${key} ${JSON.stringify(cond)}`);
      }
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function seed(rows: Row[]) {
  h.count.mockImplementation(async ({ where }: { where: unknown }) =>
    rows.filter((r) => matches(r, where)).length);
  h.findMany.mockImplementation(async ({ where, take }: { where: unknown; take?: number }) =>
    rows
      .filter((r) => matches(r, where))
      .sort((a, b) => b.id - a.id) // el `orderBy` de la página: id desc
      .slice(0, take ?? rows.length));
}

const BASE: Omit<Row, "id"> = {
  kind: "claim",
  status: "received",
  category: "water",
  lat: -45.7966,
  lng: -67.5,
  description: "PIERDE_AGUA_EN_LA_VEREDA",
  streetName: "Pizarro",
  reporterName: "JUANA_PEREZ",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.captured.length = 0;
  h.requireAdmin.mockResolvedValue({ ok: true, actorId: 1 });
});

const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(
    (await ReportesMapaPage({ searchParams: Promise.resolve(sp) })) as React.ReactElement,
  );

const lastPoints = () => h.captured.at(-1) as Array<Record<string, unknown>>;

describe("/admin/solicitudes/reportes/mapa", () => {
  it("sin sesión de admin no dibuja el mapa ni consulta la base", async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, reason: "unauthorized", error: "No autorizado." });
    seed([{ ...BASE, id: 1 }]);
    const html = await render();
    expect(html).toContain("No autorizado.");
    expect(html).not.toContain("MAPA");
    expect(h.count).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("el select que se le pide a la base no nombra el escrito ni a quien reportó", async () => {
    seed([{ ...BASE, id: 1 }]);
    await render();
    const select = h.findMany.mock.calls[0][0].select as Record<string, unknown>;
    expect(Object.keys(select).sort()).toEqual(["category", "id", "kind", "lat", "lng", "status"]);
  });

  it("el payload del mapa no lleva un solo dato de identidad ni la descripción", async () => {
    seed([{ ...BASE, id: 14 }]);
    await render();
    const serialized = JSON.stringify(lastPoints());
    expect(serialized).not.toContain("PIERDE_AGUA_EN_LA_VEREDA");
    expect(serialized).not.toContain("JUANA_PEREZ");
    expect(serialized).not.toContain("description");
    expect(serialized).not.toContain("reporterName");
    // Lo que sí lleva: el rótulo ya redactado y el link a la ficha.
    expect(lastPoints()[0]).toMatchObject({
      id: 14,
      status: "received",
      title: "N° 14 · Reclamo · Agua potable",
      state: "Recibido",
      href: "/admin/solicitudes/reportes/14",
      lat: -45.7966,
      lng: -67.5,
    });
  });

  it("los reportes sin coordenadas se cuentan y se dicen, pero no se dibujan", async () => {
    seed([
      { ...BASE, id: 1 },
      { ...BASE, id: 2 },
      { ...BASE, id: 3 },
      { ...BASE, id: 4, lat: null, lng: null },
      // Media coordenada no es una coordenada: sin `lng` no hay dónde poner el pin.
      { ...BASE, id: 5, lng: null },
    ]);
    const html = await render();
    expect(lastPoints()).toHaveLength(3);
    expect(lastPoints().map((p) => p.id).sort()).toEqual([1, 2, 3]);
    expect(html).toContain("3 reportes en el mapa");
    expect(html).toContain("2 sin ubicación");
  });

  it("el texto de la búsqueda sigue filtrando junto con la ubicación", async () => {
    // `reportWhere` mete un `OR` cuando hay `q`; si el `where` de la ubicación
    // se compusiera con spread en vez de `AND`, se lo comería y este reporte
    // de otra calle se dibujaría igual.
    seed([
      { ...BASE, id: 1, streetName: "Pizarro", description: "x", reporterName: null },
      { ...BASE, id: 2, streetName: "Rivadavia", description: "y", reporterName: null },
      // Y el conteo de "sin ubicación" también respeta el texto: sólo uno de
      // estos dos es de Pizarro. Con `{ ...base, OR: [...] }` el `OR` de la
      // búsqueda se perdería y la pantalla diría "2 sin ubicación".
      { ...BASE, id: 3, streetName: "Pizarro", description: "x", reporterName: null, lat: null, lng: null },
      { ...BASE, id: 4, streetName: "Rivadavia", description: "y", reporterName: null, lat: null, lng: null },
    ]);
    const html = await render({ q: "pizarro" });
    expect(lastPoints().map((p) => p.id)).toEqual([1]);
    expect(html).toContain("1 sin ubicación");
  });

  it("el estado se nombra según el tipo: una iniciativa se desestima en femenino", async () => {
    seed([{ ...BASE, id: 9, kind: "initiative", status: "dismissed", category: "cultural" }]);
    await render({ estado: "desestimados" });
    expect(lastPoints()[0]).toMatchObject({
      status: "dismissed",
      title: "N° 9 · Iniciativa · Cultural",
      state: "Desestimada",
    });
  });

  it("los chips y el botón Lista llevan los filtros vigentes", async () => {
    seed([{ ...BASE, id: 1 }]);
    const html = await render({ estado: "todos", tipo: "reclamo", categoria: "water", q: "pizarro" });
    // El chip de otra vista se queda en el MAPA y conserva tipo/categoría/texto.
    expect(html).toContain(
      'href="/admin/solicitudes/reportes/mapa?estado=presentados&amp;tipo=reclamo&amp;categoria=water&amp;q=pizarro"',
    );
    // La vista por defecto no escribe `estado` (lo omite `reportFiltersQuery`).
    expect(html).toContain(
      'href="/admin/solicitudes/reportes/mapa?tipo=reclamo&amp;categoria=water&amp;q=pizarro"',
    );
    // Y la vuelta a la lista conserva la vista y los filtros.
    expect(html).toContain(
      'href="/admin/solicitudes/reportes?estado=todos&amp;tipo=reclamo&amp;categoria=water&amp;q=pizarro"',
    );
  });

  it("la lista sr-only es la ruta de teclado: un link por reporte dibujado", async () => {
    seed([{ ...BASE, id: 1 }, { ...BASE, id: 2, kind: "initiative", category: "social" }]);
    const html = await render();
    expect(html).toContain("Reportes dibujados en el mapa");
    expect(html).toContain('href="/admin/solicitudes/reportes/1"');
    expect(html).toContain('href="/admin/solicitudes/reportes/2"');
    expect(html).toContain("N° 2 · Iniciativa · Social · Recibido");
  });

  it("con reportes pero ninguno ubicado, el vacío manda a la lista y no al mapa", async () => {
    seed([{ ...BASE, id: 1, lat: null, lng: null }, { ...BASE, id: 2, lat: null, lng: null }]);
    const html = await render();
    expect(html).not.toContain("MAPA");
    expect(html).toContain("Ninguno de los 2 reportes de esta vista tiene punto en el mapa.");
    expect(html).toContain("Ver la lista");
  });

  it("sin nada que dibujar por los filtros, el vacío ofrece limpiarlos SIN salir del mapa", async () => {
    seed([{ ...BASE, id: 1, category: "lighting" }]);
    const html = await render({ categoria: "water" });
    expect(html).toContain("Ningún reporte coincide con esos filtros.");
    expect(html).toContain('href="/admin/solicitudes/reportes/mapa"');
    expect(html).toContain("Limpiar filtros");
  });

  it("sin reportes en la vista, el vacío es el de la vista", async () => {
    seed([]);
    const html = await render({ estado: "desestimados" });
    expect(html).toContain("Ningún reporte fue desestimado.");
  });
});
