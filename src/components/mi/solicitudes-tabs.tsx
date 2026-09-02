"use client";
// Barra de sub-pestañas de Solicitudes en el panel de socio. Calca
// `SolicitudesTabs` del admin (links y no botones: deep-link, botón atrás y
// `aria-current` gratis) con los targets de 48px de `MiTabs`: acá se navega con
// el pulgar. El `-my-1 py-1` evita que `overflow-x-auto` recorte el anillo de
// foco (la trampa documentada en `treasury-tabs.tsx`).
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isMiSolicitudesTabActive, type MiSolicitudesTab } from "@/lib/mi/solicitudes-tabs";
import { cn } from "@/lib/utils";

export function MiSolicitudesTabs({ tabs }: { tabs: MiSolicitudesTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Tipos de solicitud" className="-mx-4 -my-1 overflow-x-auto px-4 py-1">
      <ul className="flex min-w-max gap-1 border-b">
        {tabs.map((tab) => {
          const active = isMiSolicitudesTabActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-12 items-center gap-1.5 border-b-2 px-3 text-sm outline-hidden transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
