// La tarjeta de un reporte en el panel de socio (M7, spec §5.2). Sirve de
// molde para el vocabulario de la bandeja admin (Parte 3), que lo va a repetir
// por su cuenta: acá se decide CÓMO se le cuenta al vecino qué pasó con lo que
// mandó, y ese vocabulario es kind-aware —un reclamo se presenta ante un
// organismo, una iniciativa la trata la Comisión (spec §2, `filedVerb`)—.
import { Lightbulb, MessageSquareWarning } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { reportStatusBadgeVariant } from "@/lib/admin/status-badges";
import { formatDateAR } from "@/lib/format";
import {
  AGENCY_LABELS, categoryLabel, KIND_LABELS, statusLabel, subtypeLabel,
} from "@/lib/reports/catalog";
import type { Report } from "@/generated/prisma/client";

/** Ante quién quedó presentado un reclamo. `other` lleva el nombre que escribió
 *  el operador; sin organismo cargado (no debería: el formulario lo exige) se
 *  dice "el organismo" antes que dejar la frase coja. */
function agencyName(report: Report): string {
  if (report.filedAgency === "other") return report.filedAgencyOther ?? "el organismo";
  return report.filedAgency ? AGENCY_LABELS[report.filedAgency] : "el organismo";
}

export function ReportCard({ report }: { report: Report }) {
  const Icon = report.kind === "claim" ? MessageSquareWarning : Lightbulb;
  const what =
    report.kind === "claim" && report.subtype
      ? `${categoryLabel("claim", report.category)} › ${subtypeLabel(report.category, report.subtype)}`
      : categoryLabel(report.kind, report.category);
  const where = [report.streetName, report.addressDetail].filter(Boolean).join(" ");
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="flex items-center gap-2">
            <Icon aria-hidden className="size-4 text-primary" />
            <span className="font-mono tabular-nums text-muted-foreground">N° {report.id}</span>
            {KIND_LABELS[report.kind]}
          </span>
          {/* `statusLabel` y no `STATUS_LABELS[status]`: la pastilla de una
              iniciativa presentada dice "Tratada" y la de una desestimada,
              "Desestimada" (spec §2; `filedVerb`/`dismissedLabel`). */}
          <Badge variant={reportStatusBadgeVariant(report.status)}>
            {statusLabel(report.kind, report.status)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p className="font-medium">{what}</p>
        <p className="text-muted-foreground">
          {where && <>{where} · </>}
          {report.submittedAt ? `Enviado el ${formatDateAR(report.submittedAt)}` : ""}
          {report.anonymous && " · Reservado"}
        </p>
        {report.status === "filed" && report.filedAt && (
          <p className="text-success">
            {report.kind === "claim"
              ? `Presentado ante ${agencyName(report)} el ${formatDateAR(report.filedAt)}${
                  report.filedReference ? ` (exp. ${report.filedReference})` : ""
                }.`
              : `Tratada por la Comisión Directiva el ${formatDateAR(report.filedAt)}.`}
          </p>
        )}
        {/* El motivo de la desestimación NO se muestra acá: la pantalla
            terminal del wizard tampoco lo hace (`report-done.tsx`), y qué se le
            devuelve al vecino de una decisión de la Comisión es una decisión de
            producto que la spec no tomó. */}
      </CardContent>
    </Card>
  );
}
