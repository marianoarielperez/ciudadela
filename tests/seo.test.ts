import { beforeEach, describe, expect, it, vi } from "vitest";

// Igual que en news-query.test.ts: el módulo de consultas arma el singleton
// contra el prisma real al importarse. Acá se le da un fake y de paso se
// inspecciona el `where` con el que el sitemap consulta.
const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { news: { findMany: (a: unknown) => findMany(a) } } }));

// siteBaseUrl() lee AUTH_URL al llamarse (no al importarse), así que alcanza
// con fijarla antes de invocar robots()/sitemap().
process.env.AUTH_URL = "https://sigev.redaccion.ar";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { SITEMAP_MAX_NEWS } from "@/lib/news/query";

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

describe("robots.txt", () => {
  // Estas rutas no son "poco interesantes para el SEO": son el panel con datos
  // personales de socios (Ley 25.326) y las URLs que LLEVAN un token adentro.
  const PRIVATE = ["/admin", "/mi", "/api", "/ingresar", "/verificar", "/acceso", "/redirigir"];

  it("bloquea el panel, el área de socio y las rutas con token", () => {
    const { disallow } = robots().rules as { disallow: string[] };
    for (const path of PRIVATE) expect(disallow).toContain(path);
  });

  it("mantiene abiertas las portadas de noticias, que son el og:image público", () => {
    const { allow } = robots().rules as { allow: string[] };
    expect(allow).toContain("/api/imagenes/");
  });

  it("apunta al sitemap con URL absoluta del entorno", () => {
    expect(robots().sitemap).toBe("https://sigev.redaccion.ar/sitemap.xml");
  });
});

describe("sitemap.xml", () => {
  it("lista las páginas públicas con URL absoluta y NO las privadas", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toEqual([
      "https://sigev.redaccion.ar/",
      "https://sigev.redaccion.ar/noticias",
      "https://sigev.redaccion.ar/actividades",
      "https://sigev.redaccion.ar/ubicacion",
    ]);
    for (const u of urls) expect(u).not.toMatch(/\/(admin|mi|api|ingresar|verificar|acceso)/);
  });

  it("pide a la base SOLO las publicadas con fecha: el borrador no llega ni a memoria", async () => {
    await sitemap();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { status: "published", publishedAt: { not: null } },
      take: SITEMAP_MAX_NEWS,
      select: { slug: true, publishedAt: true },
    });
  });

  it("agrega una entrada por noticia con su fecha de publicación", async () => {
    findMany.mockResolvedValue([
      { slug: "asamblea-2026", publishedAt: new Date("2026-08-10T15:00:00Z") },
    ]);
    const entry = (await sitemap()).at(-1);
    expect(entry?.url).toBe("https://sigev.redaccion.ar/noticias/asamblea-2026");
    expect(entry?.lastModified).toEqual(new Date("2026-08-10T15:00:00Z"));
  });
});
