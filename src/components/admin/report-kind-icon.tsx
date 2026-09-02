// El ícono del TIPO de reporte, para las pantallas del panel que listan la cola
// (M7, spec §6.3). Los dos íconos son los MISMOS que ya usa el vecino en el
// catálogo público (`(public)/reportes/report-icons.tsx`, entradas
// `message-square-warning` y `lightbulb`) y en el wizard: si acá se elige otro,
// el mismo hecho se dibuja de dos maneras según quién lo mire.
//
// Vive en `components/` y no en `@/lib/reports/*` por el mismo motivo que
// `request-type-icon.tsx`: los módulos de `lib` son puros y testeables en node,
// y meterles un `import` de lucide les arrastra el bundle del cliente sin que
// ninguna lo necesite. Las ETIQUETAS y la variante del badge siguen siendo
// strings y viven en `lib`.
import { Lightbulb, MessageSquareWarning } from "lucide-react";

import type { ReportKind } from "@/generated/prisma/client";

// Tipado como `Record<ReportKind, …>` y no un ternario: si el enum suma un tipo
// y acá no se agrega, el build falla en vez de dibujar el ícono del otro.
const ICONS: Record<ReportKind, React.ComponentType<{ className?: string }>> = {
  claim: MessageSquareWarning,
  initiative: Lightbulb,
};

export function ReportKindIcon({ kind, className }: { kind: ReportKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon className={className} aria-hidden />;
}
