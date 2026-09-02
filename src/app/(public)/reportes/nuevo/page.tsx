import type { Metadata } from "next";
import { getLegalTexts } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import type { ReportKindSlug } from "@/lib/reports/catalog";
import { startReportAction } from "../actions";
import { ReportWizard } from "../report-wizard";

export const metadata: Metadata = {
  title: "Nuevo reporte — Vecinal Ciudadela",
  // El paso 1 estampa la llave del borrador en esta misma URL
  // (`history.replaceState`), así que el prefijo entero está cerrado también en
  // `robots.ts`. Mismo criterio que /asociate/retomar.
  robots: { index: false, follow: true },
};

// El wizard crea el borrador con la primera interacción y nada de lo que hay
// acá se puede prerenderizar ni cachear.
export const dynamic = "force-dynamic";

export default async function NuevoReportePage(props: {
  searchParams: Promise<{ tipo?: string | string[] }>;
}) {
  const sp = await props.searchParams;
  // La landing enlaza `?tipo=reclamo` y `?tipo=iniciativa`. Sólo PROPONE: el
  // paso 1 sigue siendo una elección del vecino, y cualquier otro valor (o una
  // repetición del parámetro, que llega como array) simplemente no propone nada.
  const tipo = typeof sp.tipo === "string" ? sp.tipo : undefined;
  const initialKind: ReportKindSlug | undefined =
    tipo === "iniciativa" ? "initiative" : tipo === "reclamo" ? "claim" : undefined;

  // `loadOrder` viaja junto al nombre porque el buscador de calles reusa
  // `searchStreets`, que matchea también el código catastral y ordena los
  // empates por ese número (ver /asociate).
  const [legal, streets] = await Promise.all([
    getLegalTexts(),
    prisma.street.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, loadOrder: true },
    }),
  ]);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
      <ReportWizard
        mode="public"
        streets={streets}
        consentText={legal.privacyConsent}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
        initialKind={initialKind}
        startAction={startReportAction}
      />
    </main>
  );
}
