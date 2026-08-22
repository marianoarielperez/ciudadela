import Link from "next/link";

import { Button } from "@/components/ui/button";

// Paginación anterior/siguiente de las listas de tesorería. `href` la arma quien
// la usa (con `pageHref`), porque cada lista tiene sus propios filtros que
// conservar. Con una sola página no se renderiza nada: dos botones muertos no
// informan nada.
export function PaginationNav({ page, pageCount, href, label }: {
  page: number;
  pageCount: number;
  href: (n: number) => string;
  label: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="flex items-center gap-2" aria-label={label}>
      {page > 1 ? (
        <Button asChild variant="outline"><Link href={href(page - 1)}>← Anterior</Link></Button>
      ) : (
        <Button variant="outline" disabled>← Anterior</Button>
      )}
      <span className="text-sm text-muted-foreground">Página {page} de {pageCount}</span>
      {page < pageCount ? (
        <Button asChild variant="outline"><Link href={href(page + 1)}>Siguiente →</Link></Button>
      ) : (
        <Button variant="outline" disabled>Siguiente →</Button>
      )}
    </nav>
  );
}
