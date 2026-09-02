// Pantalla terminal del wizard (spec §5.1 paso 5): la línea de tiempo del
// trámite con el N°. Server-safe (no tiene "use client"): la usa el marco, que
// sí es cliente, y podría usarla una página del server sin arrastrar nada.
//
// El segundo hito se LEE distinto según el tipo (spec §2, `filedVerb`): un
// reclamo se PRESENTA ante un organismo; una iniciativa la TRATA la Comisión.
import { Landmark, Send } from "lucide-react";
import Link from "next/link";
import { TramiteTimeline } from "../asociate/tramite-timeline";

export function ReportDone({
  number,
  kind,
  mode,
  filed,
}: {
  number: number;
  kind: "claim" | "initiative";
  mode: "public" | "member";
  /** Ya presentado/tratado: el retome de un reporte que avanzó cae acá. */
  filed: boolean;
}) {
  const word = kind === "claim" ? "reporte" : "iniciativa";
  return (
    <div>
      <p className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase">
        {kind === "claim" ? "Reclamo" : "Iniciativa"}
      </p>
      <h1 tabIndex={-1} className="mt-1 text-2xl font-bold tracking-tight outline-hidden sm:text-3xl">
        Recibimos tu {word} <span className="font-mono tabular-nums text-primary">N° {number}</span>
      </h1>
      <p className="mt-3 text-muted-foreground">
        La Comisión Directiva lo revisa y, si corresponde, lo presenta ante el organismo. Te avisamos
        por email cuando eso pase.
      </p>
      <div className="mt-6">
        <TramiteTimeline
          items={[
            { state: "done", title: "Recibido", children: "Ya está en manos de la Comisión Directiva." },
            {
              state: filed ? "done" : "now",
              icon: Landmark,
              title: kind === "claim" ? "La Comisión lo canaliza" : "La Comisión lo evalúa",
            },
            {
              state: filed ? "done" : "next",
              icon: Send,
              title: kind === "claim" ? "Presentado ante el organismo" : "Tratado por la Comisión",
            },
          ]}
        />
      </div>
      <p className="mt-8">
        <Link
          href={mode === "member" ? "/mi/solicitudes/reportes" : "/"}
          className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
        >
          {mode === "member" ? "Ver mis reportes" : "Volver al inicio"}
        </Link>
      </p>
    </div>
  );
}
