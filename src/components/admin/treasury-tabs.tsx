"use client";
// Barra de pestañas por URL. Links, no botones: navegan. Scroll horizontal en
// móvil, targets ≥44px, foco visible. Las clases viven en
// src/lib/ui/section-tabs.ts (solapa "Carpeta"), no acá.
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isTreasuryTabActive, type TreasuryTab } from "@/lib/admin/treasury-tabs";
import {
  SECTION_TAB,
  SECTION_TAB_ACTIVE,
  SECTION_TAB_INACTIVE,
  SECTION_TABS_LIST,
  SECTION_TABS_NAV_ADMIN,
} from "@/lib/ui/section-tabs";
import { cn } from "@/lib/utils";

export function TreasuryTabs({ tabs }: { tabs: TreasuryTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de tesorería" className={SECTION_TABS_NAV_ADMIN}>
      <ul className={SECTION_TABS_LIST}>
        {tabs.map((tab) => {
          const active = isTreasuryTabActive(pathname, tab.href);
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
