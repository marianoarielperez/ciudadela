// Pantalla terminal del wizard (spec §5.1 paso 5): la línea de tiempo del
// trámite con el N°. Server-safe (no tiene "use client"): la usa el marco, que
// sí es cliente, y podría usarla una página del server sin arrastrar nada.
//
// El segundo hito se LEE distinto según el tipo (spec §2, `filedVerb`): un
// reclamo se PRESENTA ante un organismo; una iniciativa la TRATA la Comisión
// (Art. 6). Por eso el texto del cuerpo también es por tipo: una iniciativa NO
// se presenta ante ningún organismo, y prometerlo es prometer lo que no pasa.
//
// Y el estado terminal no es uno solo: un reporte DESESTIMADO no está "en
// camino". Recibe el `status` entero y no un `filed: boolean` justamente para
// poder decirlo (spec §5.3).
import { Landmark, Send, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { Ref } from "react";
import { statusLabel, type ReportKindSlug, type ReportStatusSlug } from "@/lib/reports/catalog";
import { TramiteTimeline, type TimelineItem } from "../asociate/tramite-timeline";

/** Lo que el vecino puede llegar a ver acá: un borrador no tiene pantalla
 *  terminal (sigue siendo el wizard). */
export type DoneStatus = Exclude<ReportStatusSlug, "draft">;

export function ReportDone({
  number,
  kind,
  mode,
  status,
  headingRef,
}: {
  number: number;
  kind: ReportKindSlug;
  mode: "public" | "member";
  /** `received` recién enviado, o el estado real cuando se retoma un reporte
   *  que ya avanzó. */
  status: DoneStatus;
  /** El marco mueve el foco acá al reemplazar el wizard por esta pantalla. */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const word = kind === "claim" ? "reporte" : "iniciativa";
  const dismissed = status === "dismissed";
  const closed = status !== "received";

  // `STATUS_LABELS.dismissed` no tiene género (el panel lo lee siempre en
  // masculino, sobre la palabra "reporte"); acá el sujeto puede ser la
  // iniciativa. `statusLabel` sí resuelve el de `filed` (Presentado/Tratada).
  const secondTitle = dismissed
    ? kind === "claim"
      ? "Desestimado por la Comisión"
      : "Desestimada por la Comisión"
    : `${statusLabel(kind, "filed")} ${kind === "claim" ? "ante el organismo" : "por la Comisión"}`;
  const secondIcon: LucideIcon = dismissed ? X : Send;

  const items: TimelineItem[] = [
    { state: "done", title: "Recibido", children: "Ya está en manos de la Comisión Directiva." },
  ];
  // La desestimación reemplaza a los dos hitos que quedaban: no hay canalización
  // que esperar, y dejarlos en gris diría que todavía puede pasar.
  if (!dismissed) {
    items.push({
      state: closed ? "done" : "now",
      icon: Landmark,
      title: kind === "claim" ? "La Comisión lo canaliza" : "La Comisión la evalúa",
    });
  }
  items.push({
    state: dismissed ? "now" : closed ? "done" : "next",
    icon: secondIcon,
    title: secondTitle,
  });

  return (
    <div>
      <p className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase">
        {kind === "claim" ? "Reclamo" : "Iniciativa"}
      </p>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-1 text-2xl font-bold tracking-tight outline-hidden sm:text-3xl"
      >
        Recibimos tu {word} <span className="font-mono tabular-nums text-primary">N° {number}</span>
      </h1>
      <p className="mt-3 text-muted-foreground">{bodyCopy(kind, status)}</p>
      <div className="mt-6">
        <TramiteTimeline items={items} />
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

function bodyCopy(kind: ReportKindSlug, status: DoneStatus): string {
  if (status === "dismissed") {
    return kind === "claim"
      ? "La Comisión Directiva lo revisó y resolvió no canalizarlo. Si querés saber por qué, consultanos en la sede vecinal."
      : "La Comisión Directiva la trató y resolvió no darle curso. Si querés saber por qué, consultanos en la sede vecinal.";
  }
  if (kind === "claim") {
    return status === "filed"
      ? "La Comisión Directiva ya lo presentó ante el organismo que corresponde. Cuando haya novedades, te avisamos por email."
      : "La Comisión Directiva lo revisa y, si corresponde, lo presenta ante el organismo. Te avisamos por email cuando eso pase.";
  }
  return status === "filed"
    ? "La Comisión Directiva ya la trató en su reunión (Art. 6 del estatuto). Cuando haya novedades, te avisamos por email."
    : "La Comisión Directiva la evalúa y la trata en su reunión (Art. 6 del estatuto). Te avisamos por email cuando eso pase.";
}
