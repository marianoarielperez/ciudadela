import { describe, expect, it, vi } from "vitest";

// El módulo construye el singleton cacheado contra el prisma real al importarse,
// y sin DATABASE_URL eso revienta antes de correr un solo test. Acá se ejercita
// la FACTORY con un fake, así que el cliente real no hace falta.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeNewsQueries, NEWS_PAGE_SIZE } from "@/lib/news/query";

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

function fakeDb(rows: ReturnType<typeof row>[], total = rows.length) {
  const calls: Record<string, unknown>[] = [];
  const db = {
    news: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push(args);
        return rows;
      },
      count: async () => total,
      findFirst: async (args: Record<string, unknown>) => {
        calls.push(args);
        return rows[0] ?? null;
      },
    },
  } as never;
  return { db, calls };
}

describe("makeNewsQueries", () => {
  it("latest: solo publicadas, orden desc, fechas como ISO string", async () => {
    const { db, calls } = fakeDb([row()]);
    const q = makeNewsQueries(db);
    const items = await q.latest(3);
    expect(items[0].publishedAtIso).toBe("2026-08-10T15:00:00.000Z");
    expect(items[0].excerpt).toContain("Se convoca");
    expect((items[0] as Record<string, unknown>).body).toBeUndefined();
    const where = (calls[0] as { where: { status: string } }).where;
    expect(where.status).toBe("published");
  });

  it("publishedPage: pagina y clampa fuera de rango", async () => {
    const { db } = fakeDb([row()], 25);
    const q = makeNewsQueries(db);
    const page = await q.publishedPage(99);
    expect(page.pages).toBe(Math.ceil(25 / NEWS_PAGE_SIZE));
    expect(page.page).toBe(page.pages);
  });

  it("bySlug: null para borradores o inexistentes", async () => {
    const { db, calls } = fakeDb([]);
    const q = makeNewsQueries(db);
    expect(await q.bySlug("nada")).toBeNull();
    const where = (calls[0] as { where: { status: string; slug: string } }).where;
    expect(where).toEqual({ slug: "nada", status: "published" });
  });

  it("allForAdmin: incluye borradores y el nombre del autor", async () => {
    const { db } = fakeDb([row({ status: "draft", publishedAt: null })]);
    const q = makeNewsQueries(db);
    const rows = await q.allForAdmin();
    expect(rows[0].status).toBe("draft");
    expect(rows[0].publishedAtIso).toBeNull();
    expect(rows[0].authorName).toBe("Mariano");
  });
});
