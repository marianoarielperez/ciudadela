import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { CalendarOff, Globe, Mail, Wallet } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatARS, formatDateAR } from "@/lib/format";
import type { CurrentFeeValue } from "@/lib/treasury/fee-values";

// La tira de estado: cuatro lecturas en vivo del sistema, cada una clickeable
// hacia su pestaña. Todo sale de datos que la página YA consulta; acá no hay
// ninguna query. El patrón de card es el del tablero /admin: chip tintado,
// link semántico estirado con pseudo-elemento y anillo de foco inset (la Card
// recorta con overflow-hidden).
type Item = {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  warning: boolean;
};

export function StatusStrip({ current, asociateActivo, coverage, digestCount }: {
  current: CurrentFeeValue | null;
  asociateActivo: boolean;
  coverage: Array<[number, number]>;
  digestCount: number;
}) {
  const items: Item[] = [
    {
      href: "?tab=tesoreria",
      icon: Wallet,
      label: "Valor de cuota",
      value: current ? (
        <>
          <span className="font-mono tabular-nums">{formatARS(current.activeAmount)}</span>
          {" / "}
          <span className="font-mono tabular-nums">{formatARS(current.sharedAmount)}</span>
          <span className="font-normal text-muted-foreground"> · desde {formatDateAR(current.validFrom)}</span>
        </>
      ) : (
        "Sin valor vigente"
      ),
      warning: !current,
    },
    {
      href: "?tab=sitio",
      icon: Globe,
      label: "Botón ASOCIATE",
      value: asociateActivo ? "Activado" : "Desactivado",
      warning: !asociateActivo,
    },
    {
      href: "?tab=feriados",
      icon: CalendarOff,
      label: "Feriados cargados",
      value: coverage.length > 0
        ? coverage.map(([year, count]) => `${year} (${count})`).join(" · ")
        : "Ninguno cargado",
      warning: coverage.length === 0,
    },
    {
      href: "?tab=avisos",
      icon: Mail,
      label: "Resumen diario",
      value: digestCount > 0
        ? `${digestCount} ${digestCount === 1 ? "destinatario" : "destinatarios"}`
        : "Sin destinatarios",
      warning: digestCount === 0,
    },
  ];
  return (
    <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.label}>
          <Card size="sm" className="relative h-full transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <item.icon aria-hidden className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">
                  <Link
                    href={item.href}
                    className="outline-hidden after:absolute after:inset-0 after:rounded-xl after:ring-ring after:ring-inset focus-visible:after:ring-2"
                  >
                    {item.label}
                  </Link>
                </div>
                <div className={cn("truncate text-sm font-medium", item.warning && "text-warning")}>
                  {item.value}
                </div>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
