// Placeholder de la pestaña Suscripciones. La pantalla real (vincular un
// preapproval a un socio, pausar, cancelar) es la Task 9; esto existe para que
// la pestaña no lleve a un 404 y para que el detalle de la bandeja pueda
// apuntar acá desde ya.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería. La guarda
// tampoco se hereda del layout (Next lo renderiza en paralelo con la página).
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { requireAdmin } from "@/lib/auth/require-admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suscripciones — SIGeV" };

export default async function SuscripcionesPage() {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  return <EmptyState description="Suscripciones de Mercado Pago: en construcción." />;
}
