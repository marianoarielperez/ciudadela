import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { formatDateAR } from "@/lib/format";
import { newsImageUrl } from "@/lib/news/image-url";
import { getNewsBySlug } from "@/lib/news/query";
import { siteBaseUrl } from "@/lib/site";

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
      title: news.title,
      description: news.excerpt,
      type: "article",
      publishedTime: news.publishedAtIso,
      // Absoluta a mano: el layout raíz no define metadataBase y las redes
      // sociales no resuelven una ruta relativa.
      ...(news.coverImagePath
        ? { images: [{ url: new URL(newsImageUrl(news.coverImagePath), base).toString() }] }
        : {}),
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
