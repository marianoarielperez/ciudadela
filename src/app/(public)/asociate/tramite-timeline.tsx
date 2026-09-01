// La línea de tiempo del trámite (spec 2026-09-01 §4.4): el mismo camino del
// ProcessRail, vertical y con estado. La usan las pantallas de estado de la
// solicitud (post-pago, sin débito, y el sondeo del pago). El patrón del
// conector viene de /ubicacion (ol con línea y punto absoluto); el disco verde
// con tilde, de las ranuras del paso 5. El estado viaja también en texto (el
// chip "Estás acá" y el copy de cada hito): los discos son decorativos.
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TimelineItem = {
  state: "done" | "now" | "next";
  icon?: LucideIcon;
  title: React.ReactNode;
  children?: React.ReactNode;
};

export function TramiteTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="list-none p-0">
      {items.map((item, i) => (
        <li key={i} className="relative pb-5 pl-9 last:pb-0">
          {i < items.length - 1 && (
            <span aria-hidden className="absolute top-7 bottom-0 left-3 w-0.5 bg-border" />
          )}
          <Dot state={item.state} icon={item.icon} />
          <p
            className={cn(
              "text-sm font-semibold",
              item.state === "done" && "text-success",
              item.state === "now" && "text-foreground",
              item.state === "next" && "text-muted-foreground",
            )}
          >
            {item.title}
            {item.state === "now" && (
              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 align-[2px] font-mono text-[10px] font-bold tracking-wide text-primary uppercase">
                Estás acá
              </span>
            )}
          </p>
          {item.children && (
            <div className={cn("mt-0.5 text-sm", item.state === "now" ? "text-foreground/80" : "text-muted-foreground")}>
              {item.children}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function Dot({ state, icon: Icon }: { state: TimelineItem["state"]; icon?: LucideIcon }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-0 left-0 flex size-6 items-center justify-center rounded-full",
        state === "done" && "bg-success text-background",
        state === "now" && "border-2 border-primary bg-background text-primary",
        state === "next" && "border-2 border-border bg-background text-muted-foreground",
      )}
    >
      {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : Icon ? <Icon className="size-3" /> : null}
    </span>
  );
}
