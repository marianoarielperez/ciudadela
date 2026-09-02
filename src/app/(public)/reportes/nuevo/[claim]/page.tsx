import { notFound } from "next/navigation";
import { getLegalTexts } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { reports } from "@/lib/reports/service";
import { startReportAction } from "../../actions";
import { ReportWizard } from "../../report-wizard";
import { snapshotOf } from "../../snapshot";

// La llave viene en la URL: nada de esto se puede cachear ni prerenderizar.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tu reporte — Vecinal Ciudadela",
  // La URL LLEVA la llave adentro: indexada, quedaría publicada. Mismo criterio
  // que /asociate/retomar, /verificar y /acceso (y el prefijo /reportes/nuevo
  // está también en robots.ts).
  robots: { index: false, follow: false },
};

// GET sin efectos: la llave NO se consume —es la llave del borrador mientras
// viva, no un vale de un solo uso—, así que el escáner de enlaces de un cliente
// de correo que abra la URL antes que la persona no rompe nada.
export default async function RetomarReportePage({
  params,
}: {
  params: Promise<{ claim: string }>;
}) {
  const { claim } = await params;
  const report = await reports.findByClaim(claim);

  // Un 404 y nada más. La llave es la ÚNICA credencial de este trámite, así que
  // la pantalla no puede distinguir "no existe" de "se venció" ni de "es de
  // otro": cualquier respuesta distinta le contaría a quien prueba llaves si
  // acertó a medias. El borrador de un socio cae en el mismo 404: ése se retoma
  // desde /mi, donde la barrera es la sesión.
  if (!report || report.memberId !== null) notFound();

  // Con el reporte ya enviado el wizard muestra la pantalla terminal, que no
  // tiene paso 3: el catálogo catastral (40 filas) no tiene por qué viajar al
  // navegador. Mismo criterio que /asociate/retomar.
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
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
      <ReportWizard
        mode="public"
        streets={streets}
        consentText={legal.privacyConsent}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
        initial={{ claim, snapshot: snapshotOf(report) }}
        startAction={startReportAction}
      />
    </main>
  );
}
