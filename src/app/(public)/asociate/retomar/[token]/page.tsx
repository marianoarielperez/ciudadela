import Link from "next/link";
import { applicationService } from "@/lib/applications/service";
import { getLegalTexts } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { feeAmountsForWizard, feeValueReader } from "@/lib/treasury/fee-values";
import { AsociateWizard } from "../../asociate-wizard";

// El token viene en la URL: nada de esto se puede cachear ni prerenderizar.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Retomá tu solicitud — Vecinal Ciudadela",
  // La URL LLEVA el token adentro: indexada, quedaría publicado. Mismo criterio
  // que /verificar y /acceso (y el prefijo está también en robots.ts).
  robots: { index: false, follow: false },
};

// GET sin efectos: sólo lee. El token de retome NO se consume —es la llave de la
// solicitud mientras viva, no un vale de un solo uso—, así que el escáner de
// enlaces de un cliente de correo que abra la URL antes que la persona no rompe
// nada. Es también la `back_url` que recibe Mercado Pago al terminar el checkout.
export default async function RetomarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const app = await applicationService.findByResumeToken(token);

  // Sólo el token que no matchea nada cae acá. Los estados terminales
  // (`expired`, `rejected`, `completed`) SÍ entran al wizard: los atiende
  // `ApplicationStatusScreen`, que puede decir qué pasó de verdad. Contestarle
  // "el enlace no corresponde a una solicitud en trámite" a quien la tuvo y se
  // le venció es a la vez falso y un callejón sin salida.
  if (!app) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <h1 className="text-2xl font-bold tracking-tight">No encontramos esa solicitud</h1>
        <p className="mt-3 text-muted-foreground">
          El enlace puede estar incompleto o haber sido reemplazado por uno más nuevo. Revisá el
          último correo que te mandamos.
        </p>
        <p className="mt-6">
          <Link href="/asociate" className="text-primary underline underline-offset-2">
            Empezar una solicitud
          </Link>
        </p>
      </main>
    );
  }

  const [docs, legal, fees] = await Promise.all([
    prisma.document.findMany({
      where: { ownerType: "application", ownerId: app.id },
      select: { type: true },
    }),
    getLegalTexts(),
    feeValueReader.current().then(feeAmountsForWizard),
  ]);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
      {/* `streets` vacío a propósito: con la solicitud creada, los pasos 1-3 no
          son alcanzables (ver `asociate-wizard`), así que el catálogo catastral
          —40 filas— no tiene por qué viajar al navegador en esta pantalla. */}
      <AsociateWizard
        streets={[]}
        legal={legal}
        fees={fees}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
        initial={{
          resumeToken: token,
          application: {
            status: app.status,
            requestedCategory: app.requestedCategory,
            wantsDebit: app.wantsDebit,
            preapprovalId: app.preapprovalId,
            uploadedTypes: docs.map((d) => d.type),
            fullName: app.fullName,
          },
        }}
      />
    </main>
  );
}
