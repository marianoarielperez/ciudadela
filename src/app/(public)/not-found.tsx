import Link from "next/link";

// 404 de las rutas del sitio público (por ejemplo el slug de una noticia que
// no existe, o que está en borrador). Es casi igual al de `src/app/not-found.tsx`
// pero SIN montar SiteHeader ni SiteFooter: este boundary se renderiza dentro
// del layout de `(public)`, que ya los pone. El de la raíz los monta a mano
// porque una URL que no matchea ninguna ruta no entra en ningún grupo y no
// hereda ese layout. Sin esta versión, el vecino veía el header dos veces.
export default function PublicNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-3xl font-bold">Página no encontrada</h1>
      <p className="mt-2 text-muted-foreground">La dirección que buscás no existe o fue movida.</p>
      <Link href="/" className="mt-6 text-sm text-primary underline">
        Ir al inicio
      </Link>
    </main>
  );
}
