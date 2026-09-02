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
//
// La base se mockea con un doble que HONRA el `where` que recibe (lección del
// M6): el `count` de cada chip filtra por los estados que le pasan, así que el
// número de la línea "1–N de N" es el de esa vista y no un total inventado.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: { report: { count: h.count, findMany: h.findMany } } }));

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

/** El doble aplica el `where`: los estados de la vista y nada más (estos tests
 *  no pasan filtros). Con un fake que devolviera siempre todo, el "1–N de N"
 *  daría bien por casualidad. */
function seed(rows: Row[]) {
  const match = (r: Row, where: { status: { in: string[] } }) => where.status.in.includes(r.status);
  h.count.mockImplementation(async ({ where }) => rows.filter((r) => match(r, where)).length);
  h.findMany.mockImplementation(async ({ where }) => rows.filter((r) => match(r, where)));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAdmin.mockResolvedValue({ ok: true, actorId: 1 });
});

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
