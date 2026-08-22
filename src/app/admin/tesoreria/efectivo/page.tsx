import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { requireAdmin } from "@/lib/auth/require-admin";

// Provisoria: la pestaña existe desde ahora para que la barra navegue completa
// (y para que el test de rutas de `TREASURY_TABS` no quede rojo entre commits).
// La reemplaza la tarea del plan que implementa esta lista.
export const dynamic = "force-dynamic";
export const metadata = { title: "Efectivo — SIGeV" };

export default async function Page() {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  return <EmptyState description="Esta sección se habilita en la próxima tarea del plan." />;
}
