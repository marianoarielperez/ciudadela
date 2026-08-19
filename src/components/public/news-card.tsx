import Image from "next/image";
import Link from "next/link";
import { formatDateAR } from "@/lib/format";
// Desde @/lib/news/image-url, no desde @/lib/news/images: este último importa
// node:fs y no tiene por qué entrar en el grafo de módulos de una tarjeta.
import { newsImageUrl } from "@/lib/news/image-url";
import type { PublicNewsCard } from "@/lib/news/query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// `titleAs`: el título de la tarjeta es un encabezado real para que se pueda
// recorrer el listado saltando de título en título. El nivel depende de dónde
// se monta la grilla — bajo el <h1> de /noticias es h2; bajo el <h2> "Noticias"
// de la home es h3 — y por eso lo decide quien la usa, no la tarjeta.
export function NewsCard({
  news,
  titleAs = "h2",
}: {
  news: PublicNewsCard;
  titleAs?: "h2" | "h3";
}) {
  return (
    <Link href={`/noticias/${news.slug}`} className="group block">
      <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
        {news.coverImagePath && (
          // alt vacío a propósito: la portada es decorativa, el título que va
          // justo abajo ya nombra la noticia. Describirla otra vez sería ruido.
          <Image
            src={newsImageUrl(news.coverImagePath)}
            alt=""
            width={640}
            height={360}
            className="aspect-video w-full object-cover"
            unoptimized
          />
        )}
        <CardHeader>
          <CardTitle as={titleAs} className="group-hover:text-primary">
            {news.title}
          </CardTitle>
          <CardDescription>{formatDateAR(new Date(news.publishedAtIso))}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{news.excerpt}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
