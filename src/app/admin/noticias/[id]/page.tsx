import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { NewsForm, NewsStateButtons } from "../news-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar noticia — SIGeV" };

// Firma explícita, como el resto de las páginas dinámicas del panel: el tipo
// global `PageProps<"...">` solo existe después de que Next genera los tipos de
// rutas, así que `tsc --noEmit` en frío no lo encuentra.
export default async function EditNewsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();
  const news = await prisma.news.findUnique({ where: { id: numericId } });
  if (!news) notFound();
  const editable = {
    id: news.id, title: news.title, slug: news.slug, body: news.body,
    coverImagePath: news.coverImagePath, status: news.status as "draft" | "published",
  };
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Editar noticia</h1>
        {news.status === "published" && (
          <Link className="text-sm text-primary hover:underline" href={`/noticias/${news.slug}`}>
            Ver en el sitio
          </Link>
        )}
      </div>
      <NewsStateButtons news={editable} />
      <NewsForm mode="edit" news={editable} />
    </div>
  );
}
