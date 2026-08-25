"use client";
// Barra de pestañas de Solicitudes. Calca `TreasuryTabs` (mismo `-my-1 py-1`
// para no recortar el anillo de foco, `aria-current`, `min-h-11`) y le suma
// el contador de cada bandeja: un `<span>` aparte y no texto plano dentro del
// label, para que el link siga anunciándose como "Altas" y no "Altas 3" en
// cada lectura de foco.
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isSolicitudesTabActive, type SolicitudesTab } from "@/lib/admin/solicitudes-tabs";
import { cn } from "@/lib/utils";

export function SolicitudesTabs({ tabs }: { tabs: SolicitudesTab[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Secciones de solicitudes"
      className="-mx-4 -my-1 overflow-x-auto px-4 py-1 lg:mx-0 lg:px-0"
    >
      <ul className="flex min-w-max gap-1 border-b">
        {tabs.map((tab) => {
          const active = isSolicitudesTabActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm outline-hidden transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {tab.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
