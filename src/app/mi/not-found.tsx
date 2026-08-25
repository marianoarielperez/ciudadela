import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";

// Frontera preparada para la 5B (/mi/solicitudes/[id] y /mi/debito llaman
// notFound() sobre ids ajenos). Una URL sin ruta la atiende el not-found RAÍZ,
// no éste: esta frontera solo se activa con un notFound() explícito del segmento.
export default function MiNotFound() {
  return (
    <EmptyState
      description="Esa página no existe en tu panel."
      action={
        <Button asChild className="min-h-12">
          <Link href="/mi">Volver al inicio</Link>
        </Button>
      }
    />
  );
}
