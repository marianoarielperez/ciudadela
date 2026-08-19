import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NewsCard } from "@/components/public/news-card";
import { Button } from "@/components/ui/button";
import { getPublishedNewsPage } from "@/lib/news/query";

export const metadata: Metadata = {
  title: "Noticias — Vecinal Ciudadela",
  description: "Novedades y comunicados de la Asociación Vecinal del Barrio Ciudadela.",
};

function pageHref(n: number): string {
  // La página 1 es /noticias a secas: es la URL que se comparte y la que
  // linkea el menú, y tener dos direcciones para el mismo contenido no suma.
  return n <= 1 ? "/noticias" : `/noticias?pagina=${n}`;
}

export default async function NoticiasPage({ searchParams }: PageProps<"/noticias">) {
  const sp = await searchParams;
  // `pagina` puede venir repetida (?pagina=1&pagina=9 → array) o con basura.
  // getPublishedNewsPage ya normaliza y recorta al rango real; acá sólo se
  // evita mandarle NaN, que ensuciaría la clave de caché sin necesidad.
  const raw = typeof sp.pagina === "string" ? Number(sp.pagina) : 1;
  const requested = Number.isInteger(raw) && raw > 0 ? raw : 1;
  const { items, page, pages, total } = await getPublishedNewsPage(requested);

  // Si se pidió una página que no existe (?pagina=999), la consulta devolvió
  // la última válida. Redirigir deja la URL diciendo la verdad: sin esto el
  // "Anterior" de esa pantalla llevaría a la 998, que tampoco existe.
  if (page !== requested) redirect(pageHref(page));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Noticias</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Novedades y comunicados de la Asociación Vecinal del Barrio Ciudadela.
      </p>

      {total === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          Todavía no hay noticias publicadas. Volvé pronto.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((n) => (
              <NewsCard key={n.id} news={n} />
            ))}
          </div>

          {pages > 1 && (
            // Mismo patrón que /admin/socios: en los extremos va un <button>
            // deshabilitado de verdad, no un Link con `disabled` — `asChild`
            // delega en el Link y ahí `disabled` no es más que un atributo
            // decorativo que no frena el click.
            <nav
              aria-label="Paginación de noticias"
              className="mt-8 flex items-center justify-center gap-3"
            >
              {page > 1 ? (
                <Button asChild variant="outline" className="min-h-11">
                  <Link href={pageHref(page - 1)}>← Anterior</Link>
                </Button>
              ) : (
                <Button variant="outline" className="min-h-11" disabled>
                  ← Anterior
                </Button>
              )}
              <span className="text-sm text-muted-foreground">
                Página {page} de {pages}
              </span>
              {page < pages ? (
                <Button asChild variant="outline" className="min-h-11">
                  <Link href={pageHref(page + 1)}>Siguiente →</Link>
                </Button>
              ) : (
                <Button variant="outline" className="min-h-11" disabled>
                  Siguiente →
                </Button>
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
