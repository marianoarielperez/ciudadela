"use client";
// Pestañas por URL del panel de socio (mismo criterio que TreasuryTabs: links,
// no botones — deep-link, botón atrás y aria-current gratis). Targets de 48px:
// acá se navega con el pulgar. El -my-1/py-1 evita que overflow-x-auto recorte
// el anillo de foco (la trampa documentada en treasury-tabs.tsx).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Home, Library, RefreshCw, User, Wallet } from "lucide-react";

import { isMiTabActive, type MiTab, type MiTabIcon } from "@/lib/mi/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<MiTabIcon, React.ComponentType<{ className?: string }>> = {
  home: Home,
  wallet: Wallet,
  user: User,
  "file-text": FileText,
  library: Library,
  "refresh-cw": RefreshCw,
};

export function MiTabs({ tabs }: { tabs: MiTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones del panel" className="-mx-4 -my-1 overflow-x-auto px-4 py-1">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = isMiTabActive(pathname, tab.href);
          const Icon = ICONS[tab.icon];
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
                <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
