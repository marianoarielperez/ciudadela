import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { formatDateAR } from "@/lib/format";
import { newsImageUrl } from "@/lib/news/image-url";
import { getNewsBySlug } from "@/lib/news/query";
import { SITE, siteBaseUrl } from "@/lib/site";

// Portada del sitio (src/app/opengraph-image.jpg, servida en /opengraph-image.jpg)
// para las noticias que no cargaron una propia. Sin esto la nota queda SIN
// og:image y el link compartido por WhatsApp aparece pelado.
const FALLBACK_OG_IMAGE = "/opengraph-image.jpg";

// getNewsBySlug filtra por status published + publishedAt no nulo: un borrador
// no existe para el sitio público y cae en el mismo 404 que un slug inventado.

export async function generateMetadata({
  params,
}: PageProps<"/noticias/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const news = await getNewsBySlug(slug);
  if (!news) return { title: "Noticia no encontrada — Vecinal Ciudadela" };
  const base = siteBaseUrl();
  return {
    title: `${news.title} — Vecinal Ciudadela`,
    description: news.excerpt,
    alternates: { canonical: new URL(`/noticias/${news.slug}`, base).toString() },
    openGraph: {
      // OJO: el `openGraph` de un segmento REEMPLAZA al del layout raíz, no se
      // fusiona con él. Todo lo que no se repita acá desaparece del <head> de
      // la noticia — justo la página que más se comparte. Por eso `siteName` y
      // `locale` se repiten, y por eso la imagen tiene que estar SIEMPRE: la
      // `opengraph-image` por convención de archivo viaja con el openGraph del
      // padre y tampoco se hereda.
      siteName: SITE.shortName,
      locale: "es_AR",
      title: news.title,
      description: news.excerpt,
      type: "article",
      publishedTime: news.publishedAtIso,
      // Absolutas a mano aunque el layout raíz ya define `metadataBase`: es una
      // sola llamada y deja la URL a la vista de quien lee el <head>.
      images: [
        {
          url: new URL(
            news.coverImagePath ? newsImageUrl(news.coverImagePath) : FALLBACK_OG_IMAGE,
            base,
          ).toString(),
        },
      ],
    },
  };
}

export default async function NoticiaPage({ params }: PageProps<"/noticias/[slug]">) {
  const { slug } = await params;
  const news = await getNewsBySlug(slug);
  if (!news) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <article>
        <h1 className="text-2xl font-bold sm:text-3xl">{news.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <time dateTime={news.publishedAtIso}>
            {formatDateAR(new Date(news.publishedAtIso))}
          </time>
        </p>

        {news.coverImagePath && (
          // alt vacío a propósito, igual que en la tarjeta del listado: la
          // portada está pegada al <h1> que ya nombra la noticia y no hay
          // ningún texto alternativo cargado por el redactor, así que lo único
          // que se podría poner es el título de nuevo — y el lector de pantalla
          // lo anunciaría dos veces. Si algún día la ficha gana un campo de
          // texto alternativo, este es el lugar donde va.
          <Image
            src={newsImageUrl(news.coverImagePath)}
            alt=""
            width={1280}
            height={720}
            className="mt-6 w-full rounded-lg object-cover"
            // La portada se sirve por /api/imagenes/noticias/[name], que ya
            // responde con Cache-Control immutable: pasarla además por el
            // optimizador de Next sería hacer el mismo trabajo dos veces.
            unoptimized
            priority
          />
        )}

        {/* El body sale de la base ya sanitizado: se guarda pasando por
            sanitizeNewsBody (src/lib/news/sanitize.ts), con allowlist estricta
            —p, br, strong, em, u, a, ul, ol, li, h2, h3—, sólo href/rel en los
            links, esquemas http/https y rel="noopener noreferrer" forzado. Por
            eso acá se inyecta tal cual y NO se vuelve a sanitizar. Los h2/h3
            que puede traer cuelgan del <h1> de arriba: la jerarquía cierra. */}
        <div className="prose-news mt-6" dangerouslySetInnerHTML={{ __html: news.body }} />
      </article>

      <p className="mt-10 border-t pt-6">
        <Link href="/noticias" className="text-sm text-primary underline">
          ← Volver a Noticias
        </Link>
      </p>
    </main>
  );
}
