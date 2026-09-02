// La cola de reportes del panel (spec §5.3/§6.3), renderizada.
//
// Lo que este archivo sostiene y no se ve en `reports-query.test.ts` —que
// prueba las funciones puras— es lo que la TARJETA hace con ellas:
//
// 1. Las miniaturas apuntan a la ruta AUTENTICADA y son sólo fotos: si una
//    cara de DNI llegara a la fila (por ejemplo si alguien le sacara el `where`
//    a `REPORT_LIST_SELECT`), no puede terminar en un `<img>` de una lista.
// 2. La línea de ubicación de un reporte cargado desde el mapa dice que hay un
//    punto y no "Sin ubicación".
// 3. El total de la paginación sale del contador de la vista: CUATRO `count` y
//    no cinco.
// 4. La barra de filtros es el componente COMPARTIDO con el mapa
//    (`ReportFilterForm`), y el año elegido llega a la consulta, al desplegable
//    y a los links de página.
//
// El reloj se congela: el desplegable de años va del año en curso hacia atrás
// (`availableYears`) y el rango que `parseReportFilters` acepta también se mueve
// solo. Sin esto, el archivo se pondría en rojo el 1° de enero.
//
// La base se mockea con un doble que HONRA el `where` que recibe (lección del
// M6): el `count` de cada chip filtra por los estados que le pasan, así que el
// número de la línea "1–N de N" es el de esa vista y no un total inventado.
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
  aggregate: vi.fn(),
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: { report: { count: h.count, findMany: h.findMany, aggregate: h.aggregate } },
}));

import ReportesPage from "@/app/admin/solicitudes/reportes/page";

type File = { id: number; kind: string };
type Row = {
  id: number; kind: "claim" | "initiative"; status: string; anonymous: boolean;
  memberId: number | null; category: string; subtype: string | null;
  streetName: string | null; addressDetail: string | null; submittedAt: Date | null;
  outsideBoundary: boolean; scplTicket: string | null;
  lat: number | null; lng: number | null; files: File[];
  member: { memberships: { memberNumber: number; book: { status: string } }[] } | null;
};

const BASE: Omit<Row, "id"> = {
  kind: "claim", status: "received", anonymous: false, memberId: null, category: "water",
  subtype: null, streetName: null, addressDetail: null,
  submittedAt: new Date(Date.UTC(2026, 8, 1, 12)),
  outsideBoundary: false, scplTicket: null, lat: null, lng: null, files: [], member: null,
};

type Where = { status: { in: string[] }; submittedAt?: { gte?: Date; lt?: Date } };

/** El doble aplica el `where`: los estados de la vista y el rango del año. Con
 *  un fake que devolviera siempre todo, el "1–N de N" daría bien por
 *  casualidad; y con uno que ignorara `submittedAt` en silencio, el filtro de
 *  año se probaría solo por su marcado (lección del M6). */
function seed(rows: Row[]) {
  const match = (r: Row, where: Where) => {
    if (!where.status.in.includes(r.status)) return false;
    if (where.submittedAt) {
      if (r.submittedAt === null) return false;
      const { gte, lt } = where.submittedAt;
      if (gte !== undefined && r.submittedAt.getTime() < gte.getTime()) return false;
      if (lt !== undefined && r.submittedAt.getTime() >= lt.getTime()) return false;
    }
    return true;
  };
  h.count.mockImplementation(async ({ where }) => rows.filter((r) => match(r, where)).length);
  h.findMany.mockImplementation(async ({ where }) => rows.filter((r) => match(r, where)));
  // `availableYears` pide el mínimo de los enviados: el desplegable de años
  // sale de acá y no de una lista inventada por la pantalla.
  h.aggregate.mockImplementation(async () => {
    const times = rows.map((r) => r.submittedAt).filter((d): d is Date => d !== null).map((d) => d.getTime());
    return { _min: { submittedAt: times.length ? new Date(Math.min(...times)) : null } };
  });
}

const HOY = new Date(Date.UTC(2026, 8, 2, 15)); // 02/09/2026, 12:00 en Comodoro

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(HOY);
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAdmin.mockResolvedValue({ ok: true, actorId: 1 });
});

/** Un instante ARGENTINO como el UTC que guarda la base (UTC-3, sin DST). */
const arg = (y: number, m: number, d: number, hh = 12) => new Date(Date.UTC(y, m - 1, d, hh + 3));

const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(
    (await ReportesPage({ searchParams: Promise.resolve(sp) })) as React.ReactElement,
  );

describe("/admin/solicitudes/reportes", () => {
  it("sin sesión de admin no renderiza la cola ni consulta la base", async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, reason: "unauthorized", error: "No autorizado." });
    seed([{ ...BASE, id: 1 }]);
    const html = await render();
    expect(html).toContain("No autorizado.");
    expect(h.count).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("la tira de miniaturas trae hasta dos FOTOS por la ruta autenticada", async () => {
    seed([{
      ...BASE, id: 7,
      files: [
        { id: 91, kind: "photo" }, { id: 92, kind: "dni_front" },
        { id: 93, kind: "photo" }, { id: 94, kind: "photo" },
      ],
    }]);
    const html = await render();
    expect(html).toContain('src="/api/admin/reportes/7/archivos/91"');
    expect(html).toContain('src="/api/admin/reportes/7/archivos/93"');
    // La tercera foto no entra (tope de 2) y la cara del DNI no entra NUNCA.
    expect(html).not.toContain("/archivos/94");
    expect(html).not.toContain("/archivos/92");
    // El conteo accesible es el badge, y cuenta las TRES fotos.
    expect(html).toContain("3 fotos");
    // Decorativas y perezosas: la cuenta ya la dice el badge.
    expect(html).toContain('alt=""');
    expect(html).toContain('loading="lazy"');
  });

  it("sin fotos no hay tira ni badge", async () => {
    seed([{ ...BASE, id: 8 }]);
    const html = await render();
    expect(html).not.toContain("/archivos/");
    expect(html).not.toContain("foto");
  });

  it("un reporte con punto y sin calle no dice Sin ubicación", async () => {
    seed([{ ...BASE, id: 2, lat: -45.8664, lng: -67.4966 }]);
    const html = await render();
    expect(html).toContain("Punto en el mapa");
    expect(html).not.toContain("Sin ubicación");
  });

  it("la calle manda cuando está, y sin calle ni punto no hay ubicación", async () => {
    seed([{ ...BASE, id: 3, streetName: "Pizarro", addressDetail: "al 1200", lat: -45.8, lng: -67.4 }]);
    expect(await render()).toContain("Pizarro al 1200");
    seed([{ ...BASE, id: 4 }]);
    expect(await render()).toContain("Sin ubicación");
  });

  it("el total de la paginación es el contador de la vista: cuatro count, no cinco", async () => {
    seed([
      { ...BASE, id: 10, status: "received" },
      { ...BASE, id: 11, status: "received" },
      { ...BASE, id: 12, status: "filed" },
      { ...BASE, id: 13, status: "dismissed" },
    ]);
    const html = await render();
    // Vista por defecto (Sin presentar): dos filas de cuatro reportes.
    expect(html).toContain("1–2 de 2");
    expect(h.count).toHaveBeenCalledTimes(4);

    vi.clearAllMocks();
    h.requireAdmin.mockResolvedValue({ ok: true, actorId: 1 });
    seed([
      { ...BASE, id: 10, status: "received" },
      { ...BASE, id: 11, status: "received" },
      { ...BASE, id: 12, status: "filed" },
      { ...BASE, id: 13, status: "dismissed" },
    ]);
    expect(await render({ estado: "todos" })).toContain("1–4 de 4");
    expect(h.count).toHaveBeenCalledTimes(4);
  });

  it("el asunto entra en el encabezado de la tarjeta para navegar por títulos", async () => {
    seed([{ ...BASE, id: 14, category: "water", subtype: "no_water" }]);
    const html = await render();
    // Dentro del <h2>, antes de que se cierre: el link del cuerpo viene después.
    const head = html.slice(0, html.indexOf("</h2>"));
    expect(head).toContain("Agua potable › Falta de agua");
  });
});

describe("la barra de filtros de la cola", () => {
  it("ofrece los años que tienen reportes, del actual hacia atrás", async () => {
    seed([
      { ...BASE, id: 1, submittedAt: arg(2026, 3, 10) },
      { ...BASE, id: 2, submittedAt: arg(2024, 11, 5) },
    ]);
    const html = await render();
    expect(html).toContain('name="anio"');
    expect(html).toContain("Todos los años");
    // Del año en curso al del primer envío, SIN huecos: 2025 no tiene reportes
    // pero está, porque un desplegable con huecos le hace creer al operador que
    // ese año no existe.
    for (const y of [2026, 2025, 2024]) expect(html).toContain(`value="${y}"`);
    expect(html).not.toContain('value="2023"');
    // Sin año elegido, el marcado queda en "Todos los años" y no aparece
    // "Limpiar" (no hay ningún filtro puesto).
    expect(html).toContain('<option value="" selected="">Todos los años</option>');
    for (const y of [2026, 2025, 2024]) expect(html).not.toContain(`value="${y}" selected`);
    expect(html).not.toContain(">Limpiar<");
  });

  it("el año elegido queda seleccionado, recorta la lista y ofrece limpiar", async () => {
    seed([
      { ...BASE, id: 1, submittedAt: arg(2026, 3, 10) },
      { ...BASE, id: 2, submittedAt: arg(2025, 7, 1) },
      { ...BASE, id: 3, submittedAt: arg(2025, 12, 31, 23) }, // 23:00 de acá: sigue siendo 2025
    ]);
    const html = await render({ anio: "2025" });
    expect(html).toContain('value="2025" selected');
    // Dos de los tres: el del 31/12 a las 23:00 argentinas es de 2025 aunque en
    // UTC ya diga 1/1/2026.
    expect(html).toContain("1–2 de 2");
    expect(html).toContain(">Limpiar<");
    // Y los cuatro chips se contaron con el mismo rango.
    for (const c of h.count.mock.calls) expect(c[0].where).toHaveProperty("submittedAt");
  });

  it("el año viaja en los links de página junto con el resto de los filtros", async () => {
    // 51 reportes para que haya una página 2 (el tope es 50).
    seed(Array.from({ length: 51 }, (_, i) => ({ ...BASE, id: i + 1, submittedAt: arg(2026, 3, 10) })));
    const html = await render({ anio: "2026", tipo: "reclamo", categoria: "water" });
    expect(html).toContain(
      'href="/admin/solicitudes/reportes?anio=2026&amp;tipo=reclamo&amp;categoria=water&amp;page=2"',
    );
  });

  it("un año pedido por URL que no está en el catálogo igual aparece marcado", async () => {
    // `?anio=2001` tipeado a mano, o un año que se quedó sin reportes. Sin la
    // opción, el navegador cae en "Todos los años" y la barra dice que no hay
    // filtro mientras la lista sigue filtrada: cero reportes y ningún control
    // que lo explique.
    seed([{ ...BASE, id: 1, submittedAt: arg(2026, 3, 10) }]);
    const html = await render({ anio: "2001" });
    expect(html).toContain('value="2001" selected');
    expect(html).toContain("Ningún reporte coincide con esos filtros.");
    // Y uno fuera de rango no se cuela ni como opción ni como filtro.
    const fuera = await render({ anio: "1999" });
    expect(fuera).not.toContain('value="1999"');
    expect(fuera).not.toContain(">Limpiar<");
  });
});
