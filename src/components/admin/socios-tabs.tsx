"use client";
// Barra de pestañas de Socios. Calca `SolicitudesTabs` (links, `aria-current`,
// `min-h-11`, el `-mx-4 -my-1 … px-4 py-1` que evita que `overflow-x-auto`
// recorte el anillo de foco) y le suma un ícono Lucide por pestaña, como
// `MiTabs`. El mapa ícono→componente va ACÁ y no en `lib/admin/socios-tabs.ts`
// por el motivo escrito en `request-type-icon.tsx`: `lib/` es puro y
// testeable en node sin arrastrar el bundle de lucide a nada que no lo
// necesite.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookMarked, History, Users } from "lucide-react";

import { isSociosTabActive, type SociosTab } from "@/lib/admin/socios-tabs";
import { cn } from "@/lib/utils";

const ICONS: Record<SociosTab["icon"], React.ComponentType<{ className?: string }>> = {
  users: Users,
  "book-marked": BookMarked,
  history: History,
};

export function SociosTabs({ tabs }: { tabs: SociosTab[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Secciones de socios"
      className="-mx-4 -my-1 overflow-x-auto px-4 py-1 lg:mx-0 lg:px-0"
    >
      <ul className="flex min-w-max gap-1 border-b">
        {tabs.map((tab) => {
          const active = isSociosTabActive(pathname, tab.href);
          const Icon = ICONS[tab.icon];
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
                <Icon className="size-4 shrink-0" aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
