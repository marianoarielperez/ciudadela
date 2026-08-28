import type { ComponentType } from "react";

// Encabezado de cada panel de Configuración: chip de ícono tintado (el mismo
// gesto que las tarjetas del tablero /admin) + título + una línea de contexto.
// Reemplaza los h2 uppercase que esta pantalla duplicaba a mano en tres lugares.
// Sin "use client": lo importan paneles server (Task 3) y el form cliente
// (Task 4), y en cada grafo compila como lo que corresponde.
export function PanelHeader({ icon: Icon, title, description }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0">
        <h2 className="font-heading text-base font-medium leading-snug">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
