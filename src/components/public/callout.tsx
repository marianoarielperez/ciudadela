// Aviso institucional del sitio público: ícono + borde lateral + fondo tintado.
// Calcado del banner de veredicto de /admin/salud (health-panels.tsx), la única
// pieza de este tipo ya aprobada en el sistema; se replica en vez de importarse
// porque aquélla está acoplada a HealthAlerts. Spec 2026-09-01 §4.2.
//
// `inset`: la piel para vivir DENTRO de otro recuadro (la cabecera de la boleta
// del paso 6 de ASOCIATE) — sin borde propio ni redondeo, con la línea del tono
// abajo. El ícono es decorativo: el mensaje tiene que valer como texto solo.
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { border: "border-l-primary", inset: "border-b-primary/35", bg: "bg-primary/5", tone: "text-primary" },
  warning: { border: "border-l-warning", inset: "border-b-warning/40", bg: "bg-warning/10", tone: "text-warning" },
  success: { border: "border-l-success", inset: "border-b-success/40", bg: "bg-success/10", tone: "text-success" },
} as const;

export function Callout({
  tone, icon: Icon, inset = false, role, id, className, children,
}: {
  tone: keyof typeof TONES;
  icon: LucideIcon;
  inset?: boolean;
  role?: string;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div
      role={role}
      id={id}
      className={cn(
        "flex items-start gap-3 p-4 text-sm",
        inset ? cn("border-b-2", t.inset) : cn("rounded-xl border border-l-4", t.border),
        t.bg,
        className,
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", t.tone)} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
