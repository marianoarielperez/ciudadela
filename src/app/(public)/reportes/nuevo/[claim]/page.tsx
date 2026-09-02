import Link from "next/link";
import { getLegalTexts } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { reports } from "@/lib/reports/service";
import { startReportAction } from "../../actions";
import { ReportWizard } from "../../report-wizard";
import { snapshotOf } from "../../snapshot";
import { LINK_TARGET } from "../../wizard-shared";

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

  // UNA sola pantalla para los tres casos. La llave es la ÚNICA credencial de
  // este trámite, así que no puede distinguir "no existe" de "se venció" ni de
  // "es de otro": cualquier respuesta distinta le contaría a quien prueba llaves
  // si acertó a medias. El borrador de un socio cae acá también: ése se retoma
  // desde /mi, donde la barrera es la sesión. Y se dice con texto propio, no con
  // la 404 genérica, porque el motivo frecuente es el vencimiento a los dos días
  // y el vecino tiene que saber que empezar de nuevo es lo que corresponde.
  if (!report || report.memberId !== null) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <h1 className="text-2xl font-bold tracking-tight">No encontramos ese reporte</h1>
        <p className="mt-3 text-muted-foreground">
          El enlace puede estar incompleto o el borrador ya se borró (los borradores duran dos días).
        </p>
        <p className="mt-6">
          <Link href="/reportes" className={LINK_TARGET}>
            Empezar un reporte
          </Link>
        </p>
      </main>
    );
  }

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
