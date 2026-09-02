"use client";
// Barra de pestañas de Solicitudes. Calca `TreasuryTabs` (mismo `-my-1 py-1`
// para no recortar el anillo de foco, `aria-current`, `min-h-11`) y le suma
// el contador de cada bandeja: un `<span>` aparte y no texto plano dentro del
// label, para que el link siga anunciándose como "Altas" y no "Altas 3" en
// cada lectura de foco.
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isSolicitudesTabActive, type SolicitudesTab } from "@/lib/admin/solicitudes-tabs";
import {
  SECTION_TAB,
  SECTION_TAB_ACTIVE,
  SECTION_TAB_COUNT,
  SECTION_TAB_COUNT_ACTIVE,
  SECTION_TAB_INACTIVE,
  SECTION_TABS_LIST,
  SECTION_TABS_NAV_ADMIN,
} from "@/lib/ui/section-tabs";
import { cn } from "@/lib/utils";

export function SolicitudesTabs({ tabs }: { tabs: SolicitudesTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de solicitudes" className={SECTION_TABS_NAV_ADMIN}>
      <ul className={SECTION_TABS_LIST}>
        {tabs.map((tab) => {
          const active = isSolicitudesTabActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(SECTION_TAB, active ? SECTION_TAB_ACTIVE : SECTION_TAB_INACTIVE)}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  // Un span aparte, a propósito: el link se anuncia "Altas", no "Altas 3".
                  <span className={active ? SECTION_TAB_COUNT_ACTIVE : SECTION_TAB_COUNT}>{tab.count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
