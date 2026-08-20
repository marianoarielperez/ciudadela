"use client";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// Boundary de error del panel. Mismo motivo que admin/not-found.tsx: sin esto
// una excepción en una pantalla de admin caía en el error.tsx de la raíz, que
// monta el header y el footer del sitio público. Se renderiza dentro del Shell
// de admin/layout.tsx (las excepciones del layout mismo, en cambio, siguen
// subiendo a la raíz: ahí ya no hay panel donde encuadrarlas).
export default function AdminError({
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
    <div className="space-y-3 rounded border bg-background p-4">
      <h1 className="text-xl font-bold">Algo salió mal</h1>
      <p className="text-sm text-muted-foreground">
        Ocurrió un error inesperado. Probá de nuevo; si se repite, avisá antes de volver a cargar
        datos para no duplicarlos.
      </p>
      <Button onClick={reset}>Reintentar</Button>
    </div>
  );
}
