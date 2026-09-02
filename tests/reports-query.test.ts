// El `where` de la cola de reportes (spec §5.3): la vista aporta los estados,
// los filtros el tipo, la categoría y el texto; y los contadores de los chips
// se calculan con LOS MISMOS filtros y el MISMO `where` que la lista (cada chip
// cuenta exactamente lo que filtra).
//
// El doble de base HONRA el `where` que recibe —lo evalúa contra un puñado de
// filas, no re-implementa el filtro— porque un fake que sintetiza el resultado
// deja cláusulas del `where` real sin ejercitar y el test pasa igual (lección
// del M6). Y no hay `vi.mock("@/lib/prisma")`: el módulo NO lo importa, así que
// este archivo corre sin `DATABASE_URL` ni `.env`; si alguien le metiera el
// import, el test se caería acá y no en producción.
import { describe, expect, it, vi } from "vitest";

import {
  countByView, REPORT_LIST_SELECT, REPORT_THUMBS, reportPhotos, reportPlaceLabel, reportWhere,
} from "@/lib/admin/reports-query";
import { REPORT_VIEWS, type ReportFilters } from "@/lib/admin/reports-queue";

const filters = (over: Partial<ReportFilters> = {}): ReportFilters => ({
  kind: null,
  category: null,
  q: null,
  ...over,
});

describe("reportWhere", () => {
  it("vista + filtros", () => {
    expect(reportWhere("pendientes", filters())).toEqual({ status: { in: ["received"] } });
    const w = reportWhere("todos", filters({ kind: "claim", category: "water", q: "pozo" }));
    expect(w).toMatchObject({
      status: { in: ["received", "filed", "dismissed"] },
      kind: "claim",
      category: "water",
    });
    expect(w.OR).toHaveLength(3);
  });

  it("un texto numérico también busca por N°", () => {
    const w = reportWhere("todos", filters({ q: "14" }));
    expect(w.OR).toContainEqual({ id: 14 });
    // Y uno que no es un id no ensucia el OR con un `id: NaN`.
    expect(reportWhere("todos", filters({ q: "pozo" })).OR).not.toContainEqual(
      expect.objectContaining({ id: expect.anything() }),
    );
    expect(reportWhere("todos", filters({ q: "0" })).OR).toHaveLength(3);
  });

  it("un número más grande que un INT no se busca como N°", () => {
    // `Report.id` es un INT con signo: 19 dígitos pasan `Number.isInteger`
    // (es un float redondo) y llegarían a MariaDB como un literal fuera de
    // rango. El texto sigue buscándose, que es lo que el operador tipeó.
    const w = reportWhere("todos", filters({ q: "1234567890123456789" }));
    expect(w.OR).toHaveLength(3);
    expect(w.OR).not.toContainEqual(expect.objectContaining({ id: expect.anything() }));
    // Y el borde de arriba sí entra.
    expect(reportWhere("todos", filters({ q: "2147483647" })).OR).toContainEqual({ id: 2147483647 });
    expect(reportWhere("todos", filters({ q: "2147483648" })).OR).toHaveLength(3);
  });

  it("sin filtros de texto no hay OR (un `where` con OR vacío no filtra nada)", () => {
    expect(reportWhere("presentados", filters())).not.toHaveProperty("OR");
  });
});

// Filas de mentira con lo que el `where` mira. El doble las filtra APLICANDO el
// `where` recibido, cláusula por cláusula.
type Row = { id: number; status: string; kind: string; category: string; description: string; streetName: string; reporterName: string };
const ROWS: Row[] = [
  { id: 1, status: "received", kind: "claim", category: "water", description: "no hay agua", streetName: "Pizarro", reporterName: "Ana" },
  { id: 2, status: "received", kind: "initiative", category: "social", description: "una plaza", streetName: "Rivadavia", reporterName: "Beto" },
  { id: 3, status: "filed", kind: "initiative", category: "social", description: "un taller", streetName: "Pizarro", reporterName: "Cora" },
  { id: 4, status: "dismissed", kind: "initiative", category: "sports", description: "una cancha", streetName: "Mitre", reporterName: "Dora" },
  { id: 5, status: "draft", kind: "initiative", category: "social", description: "sin enviar", streetName: "Mitre", reporterName: "Eva" },
];

type TextFilter = { contains: string };
type Where = {
  status: { in: string[] };
  kind?: string;
  category?: string;
  OR?: Array<Partial<Record<"description" | "streetName" | "reporterName", TextFilter>> & { id?: number }>;
};

function matches(row: Row, where: Where): boolean {
  if (!where.status.in.includes(row.status)) return false;
  if (where.kind !== undefined && where.kind !== row.kind) return false;
  if (where.category !== undefined && where.category !== row.category) return false;
  if (where.OR) {
    const hit = where.OR.some((clause) => {
      if (clause.id !== undefined) return clause.id === row.id;
      const [[field, filter]] = Object.entries(clause) as [["description" | "streetName" | "reporterName", TextFilter]];
      return row[field].includes(filter.contains);
    });
    if (!hit) return false;
  }
  return true;
}

const fakeDb = () => {
  const count = vi.fn(async ({ where }: { where: Where }) => ROWS.filter((r) => matches(r, where)).length);
  const findMany = vi.fn(async ({ where }: { where: Where }) => ROWS.filter((r) => matches(r, where)));
  return { db: { report: { count, findMany } } as never, count, findMany };
};

describe("countByView", () => {
  it("cuenta las cuatro vistas con los mismos filtros", async () => {
    const { db, count } = fakeDb();
    const r = await countByView(db, filters({ kind: "initiative" }));
    // 3 iniciativas enviadas (2 received, 3 filed, 4 dismissed): la 5 es
    // `draft` y no la cuenta NINGUNA vista.
    expect(r).toEqual({ pendientes: 1, presentados: 1, desestimados: 1, todos: 3 });
    expect(count).toHaveBeenCalledTimes(4);
    for (const c of count.mock.calls) expect(c[0].where).toMatchObject({ kind: "initiative" });
  });

  it("el contador de cada chip es EXACTAMENTE el `where` de su lista", async () => {
    // La invariante de `FilterChips`: el número del chip y las filas que
    // aparecen al clickearlo son la misma consulta. Se prueba de las dos
    // maneras que pueden divergir: el `where` con el que se contó es idéntico
    // al que lista, y el número coincide con la cantidad de filas.
    const f = filters({ q: "Pizarro" });
    const { db, count, findMany } = fakeDb();
    const counts = await countByView(db, f);

    for (const [i, view] of REPORT_VIEWS.entries()) {
      const listWhere = reportWhere(view.key, f);
      expect(count.mock.calls[i][0].where).toEqual(listWhere);
      const rows = await findMany({ where: listWhere as Where });
      expect(counts[view.key]).toBe(rows.length);
    }
    // Y el filtro de texto realmente recortó: "Pizarro" son las filas 1 y 3.
    expect(counts).toEqual({ pendientes: 1, presentados: 1, desestimados: 0, todos: 2 });
  });
});

describe("REPORT_LIST_SELECT", () => {
  it("la tarjeta no se lleva el escrito ni la identidad del que reporta", () => {
    // Ley 25.326: la cola es una lista de trabajo. Buscar por `reporterName`
    // no obliga a traerlo, y el escrito completo vive en la ficha.
    for (const field of ["description", "reporterName", "reporterDni", "reporterPhone", "reporterEmail", "ip"]) {
      expect(REPORT_LIST_SELECT).not.toHaveProperty(field);
    }
    // Sólo las fotos, y de cada una su id y su tipo: el `where` es la guarda
    // que impide que la cara del DNI salga de la base y el `kind` es el que
    // deja a `reportPhotos` volver a filtrar en la tarjeta.
    expect(REPORT_LIST_SELECT.files).toEqual({
      where: { kind: "photo" },
      select: { id: true, kind: true },
      orderBy: { id: "asc" },
    });
  });
});

describe("reportPhotos", () => {
  it("una miniatura NUNCA puede ser la cara de un DNI", () => {
    const files = [
      { id: 1, kind: "photo" },
      { id: 2, kind: "dni_front" },
      { id: 3, kind: "photo" },
      { id: 4, kind: "dni_back" },
      { id: 5, kind: "photo" },
    ];
    expect(reportPhotos(files).map((f) => f.id)).toEqual([1, 3, 5]);
    // La tira de la tarjeta corta en dos (spec §6.3) y el badge sigue diciendo
    // el total: 3 fotos, 2 miniaturas.
    expect(reportPhotos(files).slice(0, REPORT_THUMBS).map((f) => f.id)).toEqual([1, 3]);
  });
});

describe("reportPlaceLabel", () => {
  const place = (over: Partial<Parameters<typeof reportPlaceLabel>[0]>) =>
    reportPlaceLabel({ streetName: null, addressDetail: null, lat: null, lng: null, ...over });

  it("la calle manda cuando está", () => {
    expect(place({ streetName: "Pizarro", addressDetail: "al 1200" })).toBe("Pizarro al 1200");
    expect(place({ streetName: "Pizarro" })).toBe("Pizarro");
    // Y la calle gana aunque además haya punto: el vecino escribió una
    // dirección y ésa es la que el operador busca en la vereda.
    expect(place({ streetName: "Pizarro", lat: -45.86, lng: -67.49 })).toBe("Pizarro");
  });

  it("sin calle pero con punto dice que hay un punto en el mapa", () => {
    // El caso vivo: el reporte N° 2 se cargó desde el mapa del wizard, no tiene
    // calle, y la tarjeta decía "Sin ubicación" teniendo coordenadas.
    expect(place({ lat: 0, lng: 0 })).toBe("Punto en el mapa");
    expect(place({ lat: -45.86, lng: -67.49 })).toBe("Punto en el mapa");
    // Media coordenada no es un punto.
    expect(place({ lat: -45.86 })).toBe("Sin ubicación");
    expect(place({ lng: -67.49 })).toBe("Sin ubicación");
  });

  it("sin nada dice que no hay ubicación", () => {
    expect(place({})).toBe("Sin ubicación");
    // Una calle vacía no es una calle (el `join` de dos nulos da "").
    expect(place({ streetName: "", addressDetail: "" })).toBe("Sin ubicación");
  });
});
