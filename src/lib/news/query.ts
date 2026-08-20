// Consultas de noticias. Devuelven DTOs PLANOS con fechas ISO string: los
// singletons de abajo van envueltos en unstable_cache, que serializa a JSON
// — un Date volvería como string en el segundo hit y el tipo mentiría.
import { unstable_cache } from "next/cache";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { newsPlainText } from "@/lib/news/sanitize";

export const NEWS_PAGE_SIZE = 10;

// Tags de caché del sitio público. Las actions del ABM invalidan con
// updateTag(CACHE_TAGS.news) etc. — en Next 16.3.1 revalidateTag pide un
// segundo argumento de perfil y no se puede llamar desde una server action.
export const CACHE_TAGS = { news: "news", activities: "activities", config: "config" } as const;

export type PublicNewsCard = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  coverImagePath: string | null;
  publishedAtIso: string;
};

export type PublicNewsDetail = PublicNewsCard & { body: string };

export type AdminNewsRow = {
  id: number;
  title: string;
  slug: string;
  status: "draft" | "published";
  publishedAtIso: string | null;
  authorName: string | null;
};

type Db = Pick<PrismaClient, "news">;

type NewsRow = {
  id: number;
  title: string;
  slug: string;
  body: string;
  coverImagePath: string | null;
  status: string;
  publishedAt: Date | null;
  author: { name: string | null } | null;
};

function toCard(n: NewsRow): PublicNewsCard {
  return {
    id: n.id,
    title: n.title,
    slug: n.slug,
    excerpt: newsPlainText(n.body),
    coverImagePath: n.coverImagePath,
    publishedAtIso: n.publishedAt?.toISOString() ?? "",
  };
}

export const MAX_LATEST_NEWS = 50;

export function makeNewsQueries(db: Db) {
  const publishedInclude = { author: { select: { name: true } } };
  // Invariante del sitio público: una noticia publicada sin fecha no se puede
  // renderizar (Intl revienta con un Date inválido), así que no se muestra.
  const publishedWhere = { status: "published", publishedAt: { not: null } } as const;
  return {
    async latest(count: number): Promise<PublicNewsCard[]> {
      // take negativo no falla en Prisma: devuelve las MÁS VIEJAS en silencio.
      const n = Math.min(Math.max(1, Math.trunc(count)), MAX_LATEST_NEWS);
      const rows = await db.news.findMany({
        where: publishedWhere,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: n,
        include: publishedInclude,
      });
      return (rows as NewsRow[]).map(toCard);
    },

    async publishedPage(page: number) {
      const total = await db.news.count({ where: publishedWhere });
      const pages = Math.max(1, Math.ceil(total / NEWS_PAGE_SIZE));
      // page viene de un query param público (?pagina=abc): NaN daría skip: NaN.
      const wanted = Number.isFinite(page) ? Math.trunc(page) : 1;
      const current = Math.min(Math.max(1, wanted), pages);
      const rows = await db.news.findMany({
        where: publishedWhere,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        skip: (current - 1) * NEWS_PAGE_SIZE,
        take: NEWS_PAGE_SIZE,
        include: publishedInclude,
      });
      return { items: (rows as NewsRow[]).map(toCard), total, page: current, pages };
    },

    async bySlug(slug: string): Promise<PublicNewsDetail | null> {
      const n = (await db.news.findFirst({
        where: { slug, ...publishedWhere },
        include: publishedInclude,
      })) as NewsRow | null;
      if (!n) return null;
      return { ...toCard(n), body: n.body };
    },

    async allForAdmin(): Promise<AdminNewsRow[]> {
      // select explícito: el listado del panel no muestra el body y traerlo
      // entero para descartarlo es puro peso. Ordenar por createdAt sigue
      // siendo válido aunque el campo no esté seleccionado.
      const rows = await db.news.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          publishedAt: true,
          author: { select: { name: true } },
        },
      });
      return rows.map((n) => ({
        id: n.id,
        title: n.title,
        slug: n.slug,
        status: n.status as "draft" | "published",
        publishedAtIso: n.publishedAt?.toISOString() ?? null,
        authorName: n.author?.name ?? null,
      }));
    },
  };
}

const queries = makeNewsQueries(prisma);

// Versiones cacheadas para las páginas públicas. El panel admin NO las usa:
// lee directo (force-dynamic) para ver siempre el estado real.
export const getLatestNews = unstable_cache((count: number) => queries.latest(count), ["news-latest"], {
  tags: [CACHE_TAGS.news],
});
export const getPublishedNewsPage = unstable_cache(
  (page: number) => queries.publishedPage(page),
  ["news-page"],
  { tags: [CACHE_TAGS.news] },
);
// Forma que puede tener un slug persistido: `slugify` sólo produce minúsculas
// ASCII, dígitos y guiones, y el campo "URL" del panel valida exactamente
// `^[a-z0-9-]*$` con tope 180 (src/lib/news/schema.ts). Nada fuera de esto
// puede existir en la base, así que se descarta sin consultar.
const SLUG_SHAPE = /^[a-z0-9-]{1,180}$/;

export function isValidNewsSlug(slug: string): boolean {
  return SLUG_SHAPE.test(slug);
}

const bySlugCached = unstable_cache((slug: string) => queries.bySlug(slug), ["news-by-slug"], {
  tags: [CACHE_TAGS.news],
});

// La clave de unstable_cache incluye el argumento: sin este filtro, cada
// /noticias/<basura> de un crawler sumaba una entrada de caché permanente
// (y una consulta) por un slug que jamás va a existir.
export function getNewsBySlug(slug: string): Promise<PublicNewsDetail | null> {
  if (!isValidNewsSlug(slug)) return Promise.resolve(null);
  return bySlugCached(slug);
}

export const newsQueries = queries;
