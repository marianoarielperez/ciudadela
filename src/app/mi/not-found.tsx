import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";

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
