"use client";
// Barra de pestañas por URL. Links, no botones: navegan. Scroll horizontal en
// móvil, targets ≥44px, foco visible.
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isTreasuryTabActive, type TreasuryTab } from "@/lib/admin/treasury-tabs";
import { cn } from "@/lib/utils";

export function TreasuryTabs({ tabs }: { tabs: TreasuryTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de tesorería" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex min-w-max gap-1 border-b">
        {tabs.map((tab) => {
          const active = isTreasuryTabActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center border-b-2 px-3 text-sm outline-hidden transition-colors",
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
