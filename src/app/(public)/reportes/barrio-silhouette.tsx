// La pieza firma de Reportes (spec §6.1): el contorno real del barrio, sacado
// del KML del catastro, como SVG inline. Decorativo por defecto (`aria-hidden`);
// con `title` se vuelve una imagen nombrada.
import { boundaryToSvgPath } from "@/lib/reports/boundary";
import { cn } from "@/lib/utils";

const W = 240;
const H = 150;

export function BarrioSilhouette({ className, title }: { className?: string; title?: string }) {
  const d = boundaryToSvgPath(W, H, 6);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("h-auto w-full", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path
        d={d}
        fill="currentColor"
        fillOpacity="0.08"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
