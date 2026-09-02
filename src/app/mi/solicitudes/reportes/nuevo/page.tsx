// Wizard de reporte en modo SOCIO (M7, spec §5.2). El mismo marco que el
// público, sin Turnstile y sin el paso de identidad: la ficha ya la tiene. La
// pantalla no lleva encabezado propio —el <h1> de cada paso lo pone el wizard—,
// pero sí queda debajo del <h1> "Solicitudes" del layout de la sección.
import type { Metadata } from "next";

import { ReportWizard } from "@/app/(public)/reportes/report-wizard";
import { requireMember } from "@/lib/auth/require-member";
import { getLegalTexts } from "@/lib/config";
import { prisma } from "@/lib/prisma";

import { startMemberReportAction } from "../actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Nuevo reporte — Vecinal Ciudadela",
  // El paso 1 estampa la llave del borrador en esta misma URL
  // (`history.replaceState`). Todo /mi ya está en el `disallow` de robots.ts;
  // esto lo dice también en la página, como su gemela pública.
  robots: { index: false, follow: false },
};

export default async function MiNuevoReportePage() {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null; // el layout ya explica por qué
  // `loadOrder` viaja junto al nombre porque el buscador de calles reusa
  // `searchStreets`, que matchea también el código catastral (ver /asociate).
  const [legal, streets] = await Promise.all([
    getLegalTexts(),
    prisma.street.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, loadOrder: true },
    }),
  ]);

  return (
    <ReportWizard
      mode="member"
      streets={streets}
      consentText={legal.privacyConsent}
      startAction={startMemberReportAction}
    />
  );
}
