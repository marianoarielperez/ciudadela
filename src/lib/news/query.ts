// Consultas de noticias. Devuelven DTOs PLANOS con fechas ISO string: los
// singletons de abajo van envueltos en unstable_cache, que serializa a JSON
// — un Date volvería como string en el segundo hit y el tipo mentiría.
import { unstable_cache } from "next/cache";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { newsPlainText } from "@/lib/news/sanitize";

export const NEWS_PAGE_SIZE = 10;

// Tags de caché del sitio público. Las actions del ABM invalidan con
// revalidateTag(CACHE_TAGS.news) etc.
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

export function makeNewsQueries(db: Db) {
  const publishedInclude = { author: { select: { name: true } } };
  return {
    async latest(count: number): Promise<PublicNewsCard[]> {
      const rows = await db.news.findMany({
        where: { status: "published" },
        orderBy: { publishedAt: "desc" },
        take: count,
        include: publishedInclude,
      });
      return (rows as NewsRow[]).map(toCard);
    },

    async publishedPage(page: number) {
      const total = await db.news.count({ where: { status: "published" } });
      const pages = Math.max(1, Math.ceil(total / NEWS_PAGE_SIZE));
      const current = Math.min(Math.max(1, page), pages);
      const rows = await db.news.findMany({
        where: { status: "published" },
        orderBy: { publishedAt: "desc" },
        skip: (current - 1) * NEWS_PAGE_SIZE,
        take: NEWS_PAGE_SIZE,
        include: publishedInclude,
      });
      return { items: (rows as NewsRow[]).map(toCard), total, page: current, pages };
    },

    async bySlug(slug: string): Promise<PublicNewsDetail | null> {
      const n = (await db.news.findFirst({
        where: { slug, status: "published" },
        include: publishedInclude,
      })) as NewsRow | null;
      if (!n) return null;
      return { ...toCard(n), body: n.body };
    },

    async allForAdmin(): Promise<AdminNewsRow[]> {
      const rows = (await db.news.findMany({
        orderBy: { createdAt: "desc" },
        include: publishedInclude,
      })) as (NewsRow & { createdAt?: Date })[];
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
export const getNewsBySlug = unstable_cache((slug: string) => queries.bySlug(slug), ["news-by-slug"], {
  tags: [CACHE_TAGS.news],
});
export const newsQueries = queries;
