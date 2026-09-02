// Retome del borrador de un SOCIO (M7, spec §5.2). Acá hay DOS credenciales y
// las dos tienen que dar: la sesión (`requireMember`) y la llave del borrador.
// Por eso el `memberId` del reporte se compara contra el del actor: sin esa
// línea, un socio con la llave de otro —la llave viaja en una URL, y una URL se
// reenvía— retomaría un borrador ajeno.
import type { Metadata } from "next";
import Link from "next/link";

import { ReportWizard } from "@/app/(public)/reportes/report-wizard";
import { snapshotOf } from "@/app/(public)/reportes/snapshot";
import { LINK_TARGET } from "@/app/(public)/reportes/wizard-shared";
import { requireMember } from "@/lib/auth/require-member";
import { getLegalTexts } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { reports } from "@/lib/reports/service";

import { startMemberReportAction } from "../../actions";

// La llave viene en la URL: nada de esto se puede cachear ni prerenderizar.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu reporte — Vecinal Ciudadela",
  robots: { index: false, follow: false },
};

export default async function MiRetomarReportePage({
  params,
}: {
  params: Promise<{ claim: string }>;
}) {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null; // el layout ya explica por qué
  const { claim } = await params;
  const report = await reports.findByClaim(claim);

  // UNA sola pantalla para los tres casos —no existe, es de otro socio, es de
  // un vecino sin cuenta—, por el mismo motivo que su gemela pública: cualquier
  // respuesta distinta le contaría a quien prueba llaves si acertó a medias. Y
  // se dice con texto propio y no con la 404 genérica porque el motivo frecuente
  // es el vencimiento a los dos días, y el socio tiene que saber que empezar de
  // nuevo es lo que corresponde.
  if (!report || report.memberId !== actor.memberId) {
    return (
      <div className="space-y-3 rounded-xl border bg-background p-4">
        <h2 className="text-xl font-bold">No encontramos ese reporte</h2>
        <p className="text-sm text-muted-foreground">
          El enlace puede estar incompleto o el borrador ya se borró (los borradores duran dos
          días).
        </p>
        <p>
          <Link href="/mi/solicitudes/reportes" className={LINK_TARGET}>
            Volver a mis reportes
          </Link>
        </p>
      </div>
    );
  }

  // Con el reporte ya enviado el wizard muestra la pantalla terminal, que no
  // tiene paso 3: el catálogo catastral (40 filas) no tiene por qué viajar al
  // navegador. Mismo criterio que el retome público.
  const isDraft = report.status === "draft";
  const [legal, streets] = await Promise.all([
    getLegalTexts(),
    isDraft
      ? prisma.street.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, loadOrder: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <ReportWizard
      mode="member"
      streets={streets}
      consentText={legal.privacyConsent}
      initial={{ claim, snapshot: snapshotOf(report) }}
      startAction={startMemberReportAction}
    />
  );
}
