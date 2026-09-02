// Lista de reportes del socio (M7, spec §5.2): lo que mandó y qué hizo la
// asociación con cada uno. El suspendido la VE y además puede reportar (a
// diferencia de la baja y del cambio de categoría, que son trámites
// societarios): es la misma decisión que toma `startMemberReportAction`.
import Link from "next/link";
import { Plus } from "lucide-react";

import { EmptyState } from "@/components/admin/empty-state";
import { ReportCard } from "@/components/mi/report-card";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/require-member";
import { reports } from "@/lib/reports/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reportes — Vecinal Ciudadela" };

export default async function MiReportesPage() {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null; // el layout ya explica por qué
  const list = await reports.listForMember(actor.memberId);
  const cta = (
    <Button asChild className="min-h-12 w-full sm:w-auto">
      <Link href="/mi/solicitudes/reportes/nuevo">
        <Plus aria-hidden className="size-4" /> Nuevo reporte
      </Link>
    </Button>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Reclamos e iniciativas que mandaste, y qué hizo la asociación con cada uno.
        </p>
        {cta}
      </div>
      {list.length === 0 ? (
        <EmptyState description="Todavía no mandaste ningún reporte." action={cta} />
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}
