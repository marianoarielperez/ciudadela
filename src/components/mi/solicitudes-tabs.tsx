"use client";
// Barra de sub-pestañas de Solicitudes en el panel de socio. Calca
// `SolicitudesTabs` del admin (links y no botones: deep-link, botón atrás y
// `aria-current` gratis) con los targets de 44 px del canon del shell
// (`min-h-11`, en `SECTION_TAB`): acá se navega con el pulgar. El `-my-1 py-1`
// evita que `overflow-x-auto` recorte el anillo de foco (la trampa documentada
// en `src/lib/ui/section-tabs.ts`).
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isMiSolicitudesTabActive, type MiSolicitudesTab } from "@/lib/mi/solicitudes-tabs";
import {
  SECTION_TAB,
  SECTION_TAB_ACTIVE,
  SECTION_TAB_INACTIVE,
  SECTION_TABS_LIST,
  SECTION_TABS_NAV,
} from "@/lib/ui/section-tabs";
import { cn } from "@/lib/utils";

export function MiSolicitudesTabs({ tabs }: { tabs: MiSolicitudesTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Tipos de solicitud" className={SECTION_TABS_NAV}>
      <ul className={SECTION_TABS_LIST}>
        {tabs.map((tab) => {
          const active = isMiSolicitudesTabActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(SECTION_TAB, active ? SECTION_TAB_ACTIVE : SECTION_TAB_INACTIVE)}
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
