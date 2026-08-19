import { describe, expect, it, vi } from "vitest";

// El módulo construye el singleton cacheado contra el prisma real al importarse,
// y sin DATABASE_URL eso revienta antes de correr un solo test. Acá se ejercita
// la FACTORY con un fake, así que el cliente real no hace falta.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeNewsQueries, NEWS_PAGE_SIZE } from "@/lib/news/query";

// Las tres consultas públicas filtran por esto: publicada Y con fecha. Una
// noticia publicada sin fecha rompía el formateo con Intl en el render.
const PUBLIC_WHERE = { status: "published", publishedAt: { not: null } };
const PUBLIC_ORDER = [{ publishedAt: "desc" }, { id: "desc" }];

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: "Asamblea",
  slug: "asamblea",
  body: "<p>Se convoca a todos los socios del barrio</p>",
  coverImagePath: null,
  status: "published",
  publishedAt: new Date("2026-08-10T15:00:00Z"),
  author: { name: "Mariano" },
  ...over,
});

type Call = { method: string; args: Record<string, unknown> };

function fakeDb(rows: ReturnType<typeof row>[], total = rows.length) {
  // Registra el NOMBRE del método: sin eso no se puede distinguir el where del
  // findMany del where del count, que es justo la mutación peligrosa.
  const calls: Call[] = [];
  const db = {
    news: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ method: "findMany", args });
        return rows;
      },
      count: async (args: Record<string, unknown>) => {
        calls.push({ method: "count", args });
        return total;
      },
      findFirst: async (args: Record<string, unknown>) => {
        calls.push({ method: "findFirst", args });
        return rows[0] ?? null;
      },
    },
  } as never;
  const argsFor = (method: string) => {
    const call = calls.find((c) => c.method === method);
    if (!call) throw new Error(`no hubo ningún llamado a ${method}`);
    return call.args;
  };
  return { db, calls, argsFor };
}

describe("makeNewsQueries", () => {
  it("latest: solo publicadas con fecha, orden desc con desempate, fechas como ISO string", async () => {
    const { db, argsFor } = fakeDb([row()]);
    const q = makeNewsQueries(db);
    const items = await q.latest(3);
    expect(items[0].publishedAtIso).toBe("2026-08-10T15:00:00.000Z");
    expect(items[0].excerpt).toContain("Se convoca");
    expect((items[0] as Record<string, unknown>).body).toBeUndefined();
    const args = argsFor("findMany");
    expect(args.where).toEqual(PUBLIC_WHERE);
    expect(args.orderBy).toEqual(PUBLIC_ORDER);
    expect(args.take).toBe(3);
  });

  it("latest: clampa el count (negativo NO devuelve las más viejas)", async () => {
    const cases: [number, number][] = [
      [-3, 1],
      [0, 1],
      [2.7, 2],
      [999, 50],
    ];
    for (const [count, expected] of cases) {
      const { db, argsFor } = fakeDb([row()]);
      await makeNewsQueries(db).latest(count);
      expect(argsFor("findMany").take).toBe(expected);
    }
  });

  it("publishedPage: filtra en el findMany (no solo en el count) y pagina bien", async () => {
    const { db, argsFor } = fakeDb([row()], 25);
    const q = makeNewsQueries(db);
    const page = await q.publishedPage(2);
    expect(page.pages).toBe(Math.ceil(25 / NEWS_PAGE_SIZE));
    expect(page.page).toBe(2);
    expect(page.total).toBe(25);
    expect(argsFor("count").where).toEqual(PUBLIC_WHERE);
    const args = argsFor("findMany");
    expect(args.where).toEqual(PUBLIC_WHERE);
    expect(args.orderBy).toEqual(PUBLIC_ORDER);
    expect(args.skip).toBe(NEWS_PAGE_SIZE);
    expect(args.take).toBe(NEWS_PAGE_SIZE);
  });

  it("publishedPage: clampa fuera de rango por arriba", async () => {
    const { db, argsFor } = fakeDb([row()], 25);
    const page = await makeNewsQueries(db).publishedPage(99);
    expect(page.page).toBe(page.pages);
    expect(argsFor("findMany").skip).toBe((page.pages - 1) * NEWS_PAGE_SIZE);
  });

  it("publishedPage: normaliza NaN, decimales y negativos (skip nunca es NaN)", async () => {
    const cases: [number, number][] = [
      [Number.NaN, 1],
      [Number.POSITIVE_INFINITY, 1],
      [2.5, 2],
      [-7, 1],
      [0, 1],
    ];
    for (const [input, expected] of cases) {
      const { db, argsFor } = fakeDb([row()], 25);
      const page = await makeNewsQueries(db).publishedPage(input);
      expect(page.page).toBe(expected);
      const skip = argsFor("findMany").skip as number;
      expect(Number.isInteger(skip)).toBe(true);
      expect(skip).toBe((expected - 1) * NEWS_PAGE_SIZE);
    }
  });

  it("bySlug: null para borradores o inexistentes, y exige fecha de publicación", async () => {
    const { db, argsFor } = fakeDb([]);
    const q = makeNewsQueries(db);
    expect(await q.bySlug("nada")).toBeNull();
    expect(argsFor("findFirst").where).toEqual({ slug: "nada", ...PUBLIC_WHERE });
  });

  it("allForAdmin: consulta SIN where (borradores de verdad) y con select acotado", async () => {
    const { db, argsFor } = fakeDb([row({ status: "draft", publishedAt: null })]);
    const q = makeNewsQueries(db);
    const rows = await q.allForAdmin();
    expect(rows[0].status).toBe("draft");
    expect(rows[0].publishedAtIso).toBeNull();
    expect(rows[0].authorName).toBe("Mariano");
    const args = argsFor("findMany");
    expect(args).not.toHaveProperty("where");
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    // Sin body: el listado no lo usa y traerlo entero es puro peso.
    expect(args.select).toEqual({
      id: true,
      title: true,
      slug: true,
      status: true,
      publishedAt: true,
      author: { select: { name: true } },
    });
  });
});
