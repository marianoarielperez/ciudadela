import Link from "next/link";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";

// 404 del sitio entero. Vive en la raíz (no dentro de `(public)`) porque una
// URL que no matchea ninguna ruta no entra en ningún grupo y por lo tanto no
// hereda el layout público: el header y el footer se montan explícitamente
// desde acá para que el vecino perdido conserve la navegación del sitio.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-3xl font-bold">Página no encontrada</h1>
        <p className="mt-2 text-muted-foreground">La dirección que buscás no existe o fue movida.</p>
        <Link href="/" className="mt-6 text-sm text-primary underline">
          Ir al inicio
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
