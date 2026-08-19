import Image from "next/image";
import Link from "next/link";
import { SiteNav } from "@/components/public/site-nav";
import { SITE } from "@/lib/site";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Salto al contenido: primer tabulable de la página, visible solo con
          foco de teclado. El header repite los mismos 5 links en todas las
          páginas y sin esto hay que atravesarlos siempre. */}
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Saltar al contenido
      </a>
      {/* relative: el menú mobile de SiteNav se despliega con `top-full`
          anclado a este header. */}
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
      {/* No es un <main>: varias páginas del grupo (ingresar, verificar,
          acceso) ya traen el suyo y anidarlos duplicaría el landmark. */}
      <div id="contenido" className="flex-1">
        {children}
      </div>
      <footer className="border-t">
        <div className="mx-auto w-full max-w-5xl space-y-1 px-4 py-6 text-sm text-muted-foreground">
          <p>
            {SITE.name} — {SITE.city}
          </p>
          <p>{SITE.address}</p>
          <p>
            {SITE.legalStatus} · Fundada el {SITE.founded}
          </p>
          <p>
            Sistema SIGeV ·{" "}
            <Link href="/ingresar" className="underline hover:text-primary">
              Acceso de socios y administración
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
