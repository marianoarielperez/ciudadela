"use client";
// Frontera de error propia de /mi: sin ella un fallo de render cae al chrome
// global, fuera del shell del socio (hueco anotado en el análisis del M5).
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";

export default function MiError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4 rounded-xl border bg-background p-4">
      <h1 className="text-xl font-bold">Algo salió mal</h1>
      <FormMessage kind="error">
        No pudimos mostrar esta sección. Probá de nuevo; si sigue pasando, avisanos en la sede.
      </FormMessage>
      <Button className="min-h-12" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
