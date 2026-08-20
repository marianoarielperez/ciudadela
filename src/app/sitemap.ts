import type { MetadataRoute } from "next";
import { newsQueries } from "@/lib/news/query";
import { siteBaseUrl } from "@/lib/site";

// Solo las páginas que un buscador debería conocer. Todo lo que robots.ts
// bloquea (panel, /mi, tokens) queda afuera por definición: un sitemap que
// lista lo que el robots prohíbe es una contradicción que además publica las
// URLs privadas en un XML abierto.
// Sin esto Next lo PRERENDERIZA en el build (aparece como ○ Static en la
// salida de `next build`): el XML quedaría congelado con las noticias que
// existían al desplegar y una nota publicada después no entraría al sitemap
// hasta el próximo deploy — que acá es manual. El costo es una consulta por
// request, y a este archivo lo pide un crawler cada tanto, no un vecino.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteBaseUrl();
  const abs = (path: string) => new URL(path, base).toString();
  const fixed: MetadataRoute.Sitemap = [
    { url: abs("/"), changeFrequency: "weekly", priority: 1 },
    { url: abs("/noticias"), changeFrequency: "weekly", priority: 0.8 },
    { url: abs("/actividades"), changeFrequency: "monthly", priority: 0.7 },
    { url: abs("/ubicacion"), changeFrequency: "yearly", priority: 0.5 },
  ];
  // Directo, sin unstable_cache: el sitemap se pide poco y conviene fresco.
  // La consulta ya devuelve únicamente publicadas con fecha (filtro en SQL).
  const published = await newsQueries.publishedForSitemap();
  return [
    ...fixed,
    ...published.map((n) => ({
      url: abs(`/noticias/${n.slug}`),
      lastModified: new Date(n.publishedAtIso),
      changeFrequency: "yearly" as const,
      priority: 0.6,
    })),
  ];
}
