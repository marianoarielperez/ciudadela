import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NewsCard } from "@/components/public/news-card";
import { Button } from "@/components/ui/button";
import { getPublishedNewsPage } from "@/lib/news/query";
import { siteBaseUrl } from "@/lib/site";

const DESCRIPTION = "Novedades y comunicados de la Asociación Vecinal del Barrio Ciudadela.";

function pageHref(n: number): string {
  // La página 1 es /noticias a secas: es la URL que se comparte y la que
  // linkea el menú, y tener dos direcciones para el mismo contenido no suma.
  return n <= 1 ? "/noticias" : `/noticias?pagina=${n}`;
}

// Valor canónico del query param para una página ya resuelta: ausente en la 1,
// el número tal cual en el resto. Es contra ESTO que se compara lo recibido.
function canonicalParam(page: number): string | undefined {
  return page <= 1 ? undefined : String(page);
}

// `pagina` puede venir repetida (?pagina=1&pagina=9 → array), decimal o con
// basura. Cualquier cosa que no sea una tira de dígitos cae en 1; el redirect
// de abajo se encarga de que la URL no siga contradiciendo lo que se muestra.
function requestedPage(param: string | string[] | undefined): number {
  return typeof param === "string" && /^\d+$/.test(param) ? Number(param) : 1;
}

export async function generateMetadata({
  searchParams,
}: PageProps<"/noticias">): Promise<Metadata> {
  const sp = await searchParams;
  // Misma consulta (y misma clave de unstable_cache) que el render: la página
  // resuelta es la que manda, así el canonical de ?pagina=999 apunta a la real.
  const { page } = await getPublishedNewsPage(requestedPage(sp.pagina));
  const suffix = page > 1 ? ` — página ${page}` : "";
  return {
    title: `Noticias${suffix} — Vecinal Ciudadela`,
    description: page > 1 ? `${DESCRIPTION} Página ${page}.` : DESCRIPTION,
    alternates: { canonical: new URL(pageHref(page), siteBaseUrl()).toString() },
  };
}

export default async function NoticiasPage({ searchParams }: PageProps<"/noticias">) {
  const sp = await searchParams;
  const param = sp.pagina;
  const { items, page, pages, total } = await getPublishedNewsPage(requestedPage(param));

  // Redirigir cuando la URL pedida NO es la canónica de la página que se va a
  // mostrar. Comparar contra el número ya normalizado no alcanza: ?pagina=abc,
  // ?pagina=1 y ?pagina=2.5 colapsan todos a 1 y coincidirían, dejando tres
  // direcciones vivas para el mismo contenido. Además, sin esto el "Anterior"
  // de ?pagina=999 llevaría a la 998, que tampoco existe.
  if (param !== canonicalParam(page)) redirect(pageHref(page));

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
