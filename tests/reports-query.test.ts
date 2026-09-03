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
  availableYears, countByView, REPORT_LIST_SELECT, REPORT_THUMBS, reportPhotos, reportPlaceLabel,
  reportWhere,
} from "@/lib/admin/reports-query";
import { REPORT_VIEWS, type ReportFilters } from "@/lib/admin/reports-queue";

const filters = (over: Partial<ReportFilters> = {}): ReportFilters => ({
  kind: null,
  category: null,
  q: null,
  year: null,
  ...over,
});

/** Un instante ARGENTINO como el UTC que guarda la base: las 22:00 del 31/12
 *  de acá son las 01:00 UTC del 1/1 siguiente. Escribirlo así —y no como un
 *  `Date.UTC` a ojo— es lo que hace legibles los bordes del filtro de año. */
const arg = (y: number, m: number, d: number, hh = 12, mm = 0) =>
  new Date(Date.UTC(y, m - 1, d, hh + 3, mm));

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

  // El operador busca por lo que VE, y lo que ve es el N° PÚBLICO: desde que la
  // serie se asigna al enviar, el id y el número ya no coinciden.
  //
  // MUTACIÓN que lo prueba: volver el `or.push({ number: n })` de
  // `reports-query.ts` a `{ id: n }` pone en rojo las dos aserciones de abajo.
  it("un texto numérico también busca por el N° PÚBLICO, no por el id", () => {
    const w = reportWhere("todos", filters({ q: "14" }));
    expect(w.OR).toContainEqual({ number: 14 });
    expect(w.OR).not.toContainEqual(expect.objectContaining({ id: expect.anything() }));
    // Y uno que no es un número no ensucia el OR con un `number: NaN`.
    expect(reportWhere("todos", filters({ q: "pozo" })).OR).not.toContainEqual(
      expect.objectContaining({ number: expect.anything() }),
    );
    expect(reportWhere("todos", filters({ q: "0" })).OR).toHaveLength(3);
  });

  it("un número más grande que un INT no se busca como N°", () => {
    // `Report.number` es un INT con signo: 19 dígitos pasan `Number.isInteger`
    // (es un float redondo) y llegarían a MariaDB como un literal fuera de
    // rango. El texto sigue buscándose, que es lo que el operador tipeó.
    const w = reportWhere("todos", filters({ q: "1234567890123456789" }));
    expect(w.OR).toHaveLength(3);
    expect(w.OR).not.toContainEqual(expect.objectContaining({ number: expect.anything() }));
    // Y el borde de arriba sí entra.
    expect(reportWhere("todos", filters({ q: "2147483647" })).OR).toContainEqual({ number: 2147483647 });
    expect(reportWhere("todos", filters({ q: "2147483648" })).OR).toHaveLength(3);
  });

  it("sin filtros de texto no hay OR (un `where` con OR vacío no filtra nada)", () => {
    expect(reportWhere("presentados", filters())).not.toHaveProperty("OR");
  });
});

// Filas de mentira con lo que el `where` mira. El doble las filtra APLICANDO el
// `where` recibido, cláusula por cláusula.
// El `number` NO coincide con el `id` en ninguna fila, a propósito: los
// borradores del medio se llevaron ids sin llevarse número, que es exactamente
// lo que pasa en la base real. Así una búsqueda que siguiera mirando el id
// devolvería otra fila y el test lo ve.
type Row = { id: number; number: number | null; status: string; kind: string; category: string; description: string; streetName: string; reporterName: string; submittedAt: Date | null };
const ROWS: Row[] = [
  { id: 1, number: 7, status: "received", kind: "claim", category: "water", description: "no hay agua", streetName: "Pizarro", reporterName: "Ana", submittedAt: arg(2026, 3, 10) },
  { id: 2, number: 8, status: "received", kind: "initiative", category: "social", description: "una plaza", streetName: "Rivadavia", reporterName: "Beto", submittedAt: arg(2026, 5, 4) },
  { id: 3, number: 9, status: "filed", kind: "initiative", category: "social", description: "un taller", streetName: "Pizarro", reporterName: "Cora", submittedAt: arg(2025, 7, 1) },
  { id: 4, number: 10, status: "dismissed", kind: "initiative", category: "sports", description: "una cancha", streetName: "Mitre", reporterName: "Dora", submittedAt: arg(2024, 2, 20) },
  // El borrador no fue enviado: no tiene fecha, no tiene N° y no lo lista
  // ninguna vista.
  { id: 5, number: null, status: "draft", kind: "initiative", category: "social", description: "sin enviar", streetName: "Mitre", reporterName: "Eva", submittedAt: null },
];

type TextFilter = { contains: string };
type Where = {
  status: { in: string[] };
  kind?: string;
  category?: string;
  submittedAt?: { gte?: Date; lt?: Date };
  OR?: Array<Partial<Record<"description" | "streetName" | "reporterName", TextFilter>> & { number?: number }>;
};

/** El doble APLICA el `where`, y TIRA ante una cláusula que no conoce (misma
 *  regla que el de `reports-map-screen.test.ts`): un fake que ignora en silencio
 *  lo que no entiende deja pasar cualquier condición nueva de `reportWhere` con
 *  todos los tests en verde, que es exactamente el modo en que el M6 se comió
 *  un `processId` sin probar. */
const KNOWN = new Set(["status", "kind", "category", "submittedAt", "OR"]);

function matches(row: Row, where: Where): boolean {
  for (const key of Object.keys(where)) {
    if (!KNOWN.has(key)) throw new Error(`cláusula no soportada por el doble: ${key}`);
  }
  if (!where.status.in.includes(row.status)) return false;
  if (where.kind !== undefined && where.kind !== row.kind) return false;
  if (where.category !== undefined && where.category !== row.category) return false;
  if (where.submittedAt) {
    // `gte`/`lt` tal como los emite `reportWhere`: incluido el piso, excluido
    // el techo. Comparar por `getTime()` y no por identidad de `Date`.
    const at = row.submittedAt;
    if (at === null) return false;
    const { gte, lt } = where.submittedAt;
    if (gte !== undefined && at.getTime() < gte.getTime()) return false;
    if (lt !== undefined && at.getTime() >= lt.getTime()) return false;
  }
  if (where.OR) {
    const hit = where.OR.some((clause) => {
      if (clause.number !== undefined) return clause.number === row.number;
      const [[field, filter]] = Object.entries(clause) as [["description" | "streetName" | "reporterName", TextFilter]];
      return row[field].includes(filter.contains);
    });
    if (!hit) return false;
  }
  return true;
}

const fakeDb = (rows: Row[] = ROWS) => {
  const count = vi.fn(async ({ where }: { where: Where }) => rows.filter((r) => matches(r, where)).length);
  const findMany = vi.fn(async ({ where }: { where: Where }) => rows.filter((r) => matches(r, where)));
  // El `aggregate` también HONRA su `where`: `availableYears` pide el mínimo de
  // los ENVIADOS, y un doble que devolviera el mínimo de todas las filas dejaría
  // esa cláusula sin probar (y el borrador sin fecha rompería el `_min`).
  const aggregate = vi.fn(async ({ where }: { where: { submittedAt?: { not: null } } }) => {
    const sent = where.submittedAt?.not === null ? rows.filter((r) => r.submittedAt !== null) : rows;
    const times = sent.map((r) => r.submittedAt).filter((d): d is Date => d !== null).map((d) => d.getTime());
    return { _min: { submittedAt: times.length ? new Date(Math.min(...times)) : null } };
  });
  return { db: { report: { count, findMany, aggregate } } as never, count, findMany, aggregate };
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

describe("filtro de año", () => {
  it("el rango es el AÑO CIVIL ARGENTINO, no el del UTC guardado", () => {
    const w = reportWhere("todos", filters({ year: 2025 }));
    // Medianoche civil argentina del 1/1 = 03:00 UTC del 1/1 (UTC-3 sin DST).
    expect(w.submittedAt).toEqual({
      gte: new Date(Date.UTC(2025, 0, 1, 3)),
      lt: new Date(Date.UTC(2026, 0, 1, 3)),
    });
    // Sin año no hay cláusula de fecha: un `submittedAt: {}` dejaría fuera a
    // los borradores por otro camino y sería una segunda definición de vista.
    expect(reportWhere("todos", filters())).not.toHaveProperty("submittedAt");
  });

  it("el 31/12 a las 23:30 de acá es de ESE año, y el 1/1 a las 00:30 del siguiente", async () => {
    // Los dos bordes, escritos en hora argentina. En UTC el primero ya dice
    // 1/1/2026 02:30: con el corte en `Date.UTC(y, 0, 1)` este reporte —hecho
    // la noche del 31 de diciembre— desaparecería del informe de 2025 y
    // aparecería en el de 2026.
    const rows: Row[] = [
      { ...ROWS[0], id: 100, submittedAt: arg(2025, 12, 31, 23, 30) },
      { ...ROWS[0], id: 101, submittedAt: arg(2026, 1, 1, 0, 30) },
      // El primer y el último instante exactos del año: el piso entra (`gte`) y
      // el techo no (`lt`).
      { ...ROWS[0], id: 102, submittedAt: arg(2025, 1, 1, 0, 0) },
      { ...ROWS[0], id: 103, submittedAt: arg(2026, 1, 1, 0, 0) },
    ];
    const { db, findMany } = fakeDb(rows);
    const list = async (year: number) =>
      (await findMany({ where: reportWhere("todos", filters({ year })) as Where })).map((r) => r.id);
    expect(await list(2025)).toEqual([100, 102]);
    expect(await list(2026)).toEqual([101, 103]);
    // Y los chips cuentan con ese MISMO rango: el número y la lista no pueden
    // discrepar por un borde de horario.
    expect((await countByView(db, filters({ year: 2025 }))).todos).toBe(2);
  });

  it("el año recorta la lista y los cuatro chips a la vez", async () => {
    const { db, count } = fakeDb();
    // ROWS: dos de 2026 (received), uno de 2025 (filed) y uno de 2024
    // (dismissed); el borrador no lo cuenta ninguna vista.
    expect(await countByView(db, filters({ year: 2026 }))).toEqual({
      pendientes: 2, presentados: 0, desestimados: 0, todos: 2,
    });
    expect(await countByView(db, filters({ year: 2025 }))).toEqual({
      pendientes: 0, presentados: 1, desestimados: 0, todos: 1,
    });
    expect(await countByView(db, filters({ year: 2023 }))).toEqual({
      pendientes: 0, presentados: 0, desestimados: 0, todos: 0,
    });
    for (const c of count.mock.calls) expect(c[0].where).toHaveProperty("submittedAt");
  });

  it("el año se combina con el resto de los filtros y no los reemplaza", async () => {
    const { db } = fakeDb();
    // 2026 tiene un reclamo (id 1) y una iniciativa (id 2).
    expect((await countByView(db, filters({ year: 2026, kind: "claim" }))).todos).toBe(1);
    expect((await countByView(db, filters({ year: 2026, q: "Pizarro" }))).todos).toBe(1);
    // Y la iniciativa de 2025 no entra en 2026 aunque el texto matchee.
    expect((await countByView(db, filters({ year: 2026, q: "taller" }))).todos).toBe(0);
  });
});

describe("availableYears", () => {
  it("del año en curso hacia atrás hasta el primer envío, sin huecos", async () => {
    const { db, aggregate } = fakeDb();
    // El primero de ROWS es de febrero de 2024; el "ahora" es 2026.
    expect(await availableYears(db, arg(2026, 9, 2))).toEqual([2026, 2025, 2024]);
    // 2023 no está en ROWS y tampoco tiene por qué estar en la lista, pero los
    // años intermedios SÍ: un desplegable con huecos ("2026, 2024") le hace
    // creer al operador que 2025 no existe.
    expect(aggregate.mock.calls[0][0]).toEqual({
      where: { submittedAt: { not: null } },
      _min: { submittedAt: true },
    });
  });

  it("sin ningún reporte enviado ofrece el año en curso y nada más", async () => {
    // Sólo el borrador: no fue enviado, no tiene fecha y no aporta un año.
    const { db } = fakeDb([ROWS[4]]);
    expect(await availableYears(db, arg(2026, 9, 2))).toEqual([2026]);
    const empty = fakeDb([]);
    expect(await availableYears(empty.db, arg(2026, 9, 2))).toEqual([2026]);
  });

  it("el año en curso es el CIVIL argentino", async () => {
    const { db } = fakeDb([{ ...ROWS[0], submittedAt: arg(2026, 3, 10) }]);
    // 1/1/2027 00:30 UTC son las 21:30 del 31/12/2026 en Comodoro: el
    // desplegable todavía encabeza con 2026. Con el año leído del UTC, la
    // noche del 31 el operador vería un 2027 que acá todavía no empezó.
    expect(await availableYears(db, new Date(Date.UTC(2027, 0, 1, 0, 30)))).toEqual([2026]);
    expect(await availableYears(db, new Date(Date.UTC(2027, 0, 1, 3)))).toEqual([2027, 2026]);
  });

  it("una fecha futura cargada a mano no deja el desplegable vacío", async () => {
    // El piso se acota al año en curso: si no, el `for` no daría una vuelta y
    // el <select> quedaría con "Todos los años" y nada más.
    const { db } = fakeDb([{ ...ROWS[0], submittedAt: arg(2030, 1, 5) }]);
    expect(await availableYears(db, arg(2026, 9, 2))).toEqual([2026]);
  });
});
