import type { ComponentType, ReactNode } from "react";

// Encabezado de panel compartido por Configuración y Salud: chip de ícono
// tintado (el mismo gesto que las tarjetas del tablero /admin) + título +
// descripción. `titleId` existe para las secciones que se nombran por
// `aria-labelledby` (los paneles anclados de /admin/salud).
// Sin "use client": lo importan paneles server y componentes cliente, y en cada grafo compila como corresponde — agregarle la directiva des-optimizaría a los dos.
export function PanelHeader({ icon: Icon, title, description, titleId }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  titleId?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0">
        <h2 id={titleId} className="font-heading text-base font-medium leading-snug">{title}</h2>
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
