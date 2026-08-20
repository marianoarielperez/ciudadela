"use client";
import { useEffect } from "react";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";

// OJO: esto es `error.tsx`, no `global-error.tsx` — reemplaza el contenido por
// debajo del layout raíz (incluido el layout de `(public)`), así que monta el
// header y el footer por su cuenta para no dejar la pantalla sin navegación.
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-3xl font-bold">Algo salió mal</h1>
        <p className="mt-2 text-muted-foreground">
          Ocurrió un error inesperado. Probá de nuevo en un momento.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Reintentar
        </button>
      </main>
      <SiteFooter />
    </div>
  );
}
