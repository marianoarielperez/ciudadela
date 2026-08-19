import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";

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
      <SiteHeader />
      {/* No es un <main>: varias páginas del grupo (ingresar, verificar,
          acceso) ya traen el suyo y anidarlos duplicaría el landmark.
          tabIndex={-1}: sin esto el destino del skip link no es enfocable y el
          salto queda a criterio del navegador en vez de mover el foco. */}
      <div id="contenido" tabIndex={-1} className="flex-1">
        {children}
      </div>
      <SiteFooter />
    </div>
  );
}
