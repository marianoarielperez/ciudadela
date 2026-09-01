import type { Metadata } from "next";
import Link from "next/link";
import { Lightbulb, MessageSquareWarning } from "lucide-react";
import { currentYearAR } from "@/lib/dates";
import { reports } from "@/lib/reports/service";
import { SITE, siteBaseUrl } from "@/lib/site";
import { cn } from "@/lib/utils";
import { BarrioSilhouette } from "./barrio-silhouette";

export const metadata: Metadata = {
  title: "Reportes — Vecinal Ciudadela",
  description: `Reclamos e iniciativas de los vecinos del barrio Ciudadela: la ${SITE.name} los recibe y los canaliza ante el municipio, la SCPL u otro organismo.`,
  // Absoluto a mano, como /ubicacion y /actividades: aunque el layout raíz ya
  // define `metadataBase`, así queda a la vista de quien lee el <head>.
  alternates: { canonical: new URL("/reportes", siteBaseUrl()).toString() },
};

// Una hora, como /asociate: los contadores cambian de a uno y nadie necesita
// verlos al segundo; una consulta por hora es barata.
export const revalidate = 3600;

const DOOR =
  "group flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-foreground/10 outline-hidden transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring";

export default async function ReportesPage() {
  const year = currentYearAR();
  const stats = await reports.yearStats();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="grid items-center gap-8 md:grid-cols-[1fr_260px]">
        <div>
          <p className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            Art. 2 inc. g del estatuto
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Reportes del barrio</h1>
          <p className="mt-3 max-w-prose text-muted-foreground">
            Un bache, una luminaria apagada, una pérdida de agua, o una idea para el barrio. La
            {" "}{SITE.shortName} recibe lo que planteás, lo revisa la Comisión Directiva y, si
            corresponde, lo presenta ante el municipio, la SCPL u otro organismo.
          </p>
          {/* Transparencia (spec §2): sólo números del año, nunca una lista. */}
          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
            <div>
              <dt className="text-xs text-muted-foreground">Recibidos en {year}</dt>
              <dd className="font-mono text-2xl font-bold tabular-nums text-primary">{stats.received}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Presentados ante organismos</dt>
              <dd className="font-mono text-2xl font-bold tabular-nums text-primary">{stats.filed}</dd>
            </div>
          </dl>
        </div>
        <BarrioSilhouette className="text-primary" title="Silueta del barrio Ciudadela" />
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link href="/reportes/nuevo?tipo=reclamo" className={cn(DOOR)}>
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MessageSquareWarning aria-hidden className="size-5" />
          </span>
          <span className="text-lg font-semibold">Hacer un reclamo</span>
          <span className="text-sm text-muted-foreground">
            Un problema en la vía pública: agua, cloacas, luz, residuos, calles, árboles o transporte.
          </span>
          <span aria-hidden className="text-sm font-medium text-primary group-hover:underline">Empezar →</span>
        </Link>
        <Link href="/reportes/nuevo?tipo=iniciativa" className={cn(DOOR)}>
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Lightbulb aria-hidden className="size-5" />
          </span>
          <span className="text-lg font-semibold">Proponer una iniciativa</span>
          <span className="text-sm text-muted-foreground">
            Una propuesta social, cultural, deportiva, de obras o de seguridad para el barrio.
          </span>
          <span aria-hidden className="text-sm font-medium text-primary group-hover:underline">Empezar →</span>
        </Link>
      </div>

      <p className="mt-8 max-w-prose text-sm text-muted-foreground">
        Te pedimos tus datos y una foto de tu DNI para que el reporte sea de una persona real del
        barrio. Podés elegir que tu nombre no figure ante el organismo. Este reporte no reemplaza
        el reclamo que podés hacer directamente ante el municipio o la SCPL.
      </p>
    </main>
  );
}
