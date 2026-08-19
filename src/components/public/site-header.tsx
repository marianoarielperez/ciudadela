import Image from "next/image";
import Link from "next/link";
import { SiteNav } from "@/components/public/site-nav";

// Header del sitio público. Vive acá y no dentro de `(public)/layout.tsx`
// porque `app/not-found.tsx` y `app/error.tsx` están por encima de ese grupo
// (una URL que no matchea ninguna ruta nunca entra al grupo) y sin esto se
// renderizarían sin navegación. Solo usa client-safe imports: `error.tsx` es
// client component y lo monta desde ahí.
export function SiteHeader() {
  return (
    // relative: el menú mobile de SiteNav se despliega con `top-full`
    // anclado a este header.
    <header className="relative border-b">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-3">
          {/* alt vacío: el nombre de la asociación va como texto acá al lado,
              un alt lo repetiría en el lector de pantalla. */}
          <Image
            src="/logo.png"
            alt=""
            width={674}
            height={669}
            // Se muestra a 40px de alto (y ancho casi igual, es cuadrado).
            // Sin `sizes` next/image sirve la variante de 1920px del PNG.
            sizes="40px"
            className="h-10 w-auto"
            priority
          />
          <span className="font-semibold leading-tight">
            Asociación Vecinal
            <br />
            del Barrio Ciudadela
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <SiteNav />
          <Link
            href="/ingresar"
            className="hidden text-sm font-medium text-primary underline sm:inline"
          >
            Ingresar
          </Link>
        </div>
      </div>
    </header>
  );
}
