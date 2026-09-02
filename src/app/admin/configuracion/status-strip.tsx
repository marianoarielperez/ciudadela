import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { CalendarOff, Globe, Handshake, Mail, Wallet } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatARS, formatDateAR } from "@/lib/format";
import type { CurrentFeeValue } from "@/lib/treasury/fee-values";

// La tira de estado: cinco lecturas en vivo del sistema, cada una clickeable
// hacia su pestaña. Todo sale de datos que la página YA consulta; acá no hay
// ninguna query. El patrón de card es el del tablero /admin: chip tintado,
// link semántico estirado con pseudo-elemento y anillo de foco inset (la Card
// recorta con overflow-hidden).
// `titleText` es el mismo valor en texto plano: el div del valor trunca, y el
// de la cuota y el de los feriados son los dos que se cortan de verdad (dos
// montos con su fecha, y un año por cada uno cargado). Sin esto, lo recortado
// no se puede leer de ninguna manera.
type Item = {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  titleText?: string;
  warning: boolean;
};

export function StatusStrip({ current, asociateActivo, collaboratorEnabled, coverage, digestCount }: {
  current: CurrentFeeValue | null;
  asociateActivo: boolean;
  collaboratorEnabled: boolean;
  coverage: Array<[number, number]>;
  digestCount: number;
}) {
  const coverageText = coverage.map(([year, count]) => `${year} (${count})`).join(" · ");
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
      titleText: current
        ? `${formatARS(current.activeAmount)} / ${formatARS(current.sharedAmount)} · desde ${formatDateAR(current.validFrom)}`
        : undefined,
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
      href: "?tab=sitio",
      icon: Handshake,
      label: "Socio colaborador",
      value: collaboratorEnabled ? "Habilitado" : "Deshabilitado",
      // Nunca en warning: apagada es el estado esperado hasta que la IGJ
      // oficialice el estatuto reformado (spec 2026-09-02), y ninguna pantalla
      // nace en rojo.
      warning: false,
    },
    {
      href: "?tab=feriados",
      icon: CalendarOff,
      label: "Feriados cargados",
      value: coverage.length > 0 ? coverageText : "Ninguno cargado",
      titleText: coverage.length > 0 ? coverageText : undefined,
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
    <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
                <div
                  title={item.titleText}
                  className={cn("truncate text-sm font-medium", item.warning && "text-warning")}
                >
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
