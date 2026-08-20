// Consultas de noticias. Devuelven DTOs PLANOS con fechas ISO string: los
// singletons de abajo van envueltos en unstable_cache, que serializa a JSON
// — un Date volvería como string en el segundo hit y el tipo mentiría.
import { unstable_cache } from "next/cache";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { newsPlainText } from "@/lib/news/sanitize";
import { CACHE_TAGS } from "@/lib/cache-tags";

export const NEWS_PAGE_SIZE = 10;

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
export const SITEMAP_MAX_NEWS = 5000;

export function makeNewsQueries(db: Db) {
  const publishedInclude = { author: { select: { name: true } } };
  // Invariante del sitio público: una noticia publicada sin fecha no se puede
  // renderizar (Intl revienta con un Date inválido), así que no se muestra.
  const publishedWhere = { status: "published", publishedAt: { not: null } } as const;

  // Función local, no un método del objeto: `publishedPage` la llama, y con
  // `this.publishedMeta()` bastaría con que alguien desestructurara las queries
  // para que `this` quedara indefinido en runtime.
  async function publishedMeta(): Promise<{ total: number; pages: number }> {
    const total = await db.news.count({ where: publishedWhere });
    return { total, pages: Math.max(1, Math.ceil(total / NEWS_PAGE_SIZE)) };
  }

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

    // Cuántas páginas hay. Se expone aparte para poder acotar la página pedida
    // ANTES de entrar a la caché paginada (ver resolvePublishedNewsPage).
    publishedMeta,

    // `page` tiene que llegar ya acotada. El clamp de abajo queda igual como
    // defensa en profundidad, pero no alcanza para proteger la CLAVE de caché:
    // esa se deriva del argumento, así que acotar acá adentro sería tarde.
    async publishedPage(page: number) {
      const { total, pages } = await publishedMeta();
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

    // Existencia sin cachear: consulta barata por el índice único de `slug`,
    // que devuelve sólo el id. Filtra por `publishedWhere` igual que el resto —
    // un borrador NO "existe" para el sitio público.
    async publishedSlugExists(slug: string): Promise<boolean> {
      const row = await db.news.findFirst({
        where: { slug, ...publishedWhere },
        select: { id: true },
      });
      return row !== null;
    },

    async bySlug(slug: string): Promise<PublicNewsDetail | null> {
      const n = (await db.news.findFirst({
        where: { slug, ...publishedWhere },
        include: publishedInclude,
      })) as NewsRow | null;
      if (!n) return null;
      return { ...toCard(n), body: n.body };
    },

    // Para el sitemap: SOLO publicadas, filtradas en SQL. No se filtra en JS
    // sobre allForAdmin() porque eso traería los borradores a la memoria del
    // proceso que arma un XML público — un descuido ahí y el título o el slug
    // de un borrador salen listados.
    async publishedForSitemap(): Promise<{ slug: string; publishedAtIso: string }[]> {
      const rows = await db.news.findMany({
        where: publishedWhere,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        // El protocolo del sitemap corta en 50.000 URLs por archivo; con este
        // tope no hay forma de pasarse ni de que la consulta crezca sin techo.
        take: SITEMAP_MAX_NEWS,
        select: { slug: true, publishedAt: true },
      });
      // publishedWhere ya exige publishedAt no nulo; el `?? ""` es solo para
      // el tipo y no puede darse en la práctica.
      return rows.map((n) => ({ slug: n.slug, publishedAtIso: n.publishedAt?.toISOString() ?? "" }));
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

// Sin argumentos: UNA sola entrada de caché para todo el sitio.
const getPublishedNewsMeta = unstable_cache(() => queries.publishedMeta(), ["news-meta"], {
  tags: [CACHE_TAGS.news],
});

// Acota la página pedida contra el total real ANTES de llamar a la versión
// cacheada. Es el punto del arreglo: `unstable_cache` deriva su clave de los
// argumentos, así que `getPublishedNewsPage(999999)` creaba una entrada en
// disco —con revalidate de un año— por cada número que alguien inventara,
// aunque el contenido devuelto fuera el de la página 1. Pasando por acá, las
// claves posibles son exactamente las páginas que existen.
// Mismo patrón que `resolveActivitiesYear` en @/lib/activities/year-param.
export async function resolvePublishedNewsPage(requested: number): Promise<number> {
  const { pages } = await getPublishedNewsMeta();
  const wanted = Number.isFinite(requested) ? Math.trunc(requested) : 1;
  return Math.min(Math.max(1, wanted), pages);
}
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

// La clave de unstable_cache incluye el argumento, así que cada slug distinto
// que llegue hasta `bySlugCached` deja una entrada permanente en disco. El
// filtro de forma descarta lo groseramente inválido, pero NO alcanza: "aaaa",
// "aaab", "aaac"… lo pasan y son infinitos, así que un crawler podía llenar
// .next/cache pidiendo slugs inventados. Por eso antes va un chequeo de
// existencia SIN cachear —un SELECT del id por el índice único de `slug`— y
// sólo los slugs que de verdad existen llegan a la caché, que queda acotada
// por el contenido real. Lo caro (fila completa + join del autor) se sigue
// cacheando.
export async function getNewsBySlug(slug: string): Promise<PublicNewsDetail | null> {
  if (!isValidNewsSlug(slug)) return null;
  if (!(await queries.publishedSlugExists(slug))) return null;
  return bySlugCached(slug);
}

export const newsQueries = queries;
