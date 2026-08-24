"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, CalendarDays, Home, Inbox, Newspaper, ScrollText, Settings, Users, Wallet,
} from "lucide-react";

import { isNavItemActive, type AdminNavGroup, type AdminNavIcon } from "@/lib/admin/nav";
import { cn } from "@/lib/utils";

// El mapa nombre→componente vive acá y no en nav.ts para que la config sea
// serializable y testeable en node (lucide no carga fuera del bundle cliente).
const ICONS: Record<AdminNavIcon, typeof Home> = {
  home: Home,
  inbox: Inbox,
  users: Users,
  wallet: Wallet,
  "scroll-text": ScrollText,
  newspaper: Newspaper,
  "calendar-days": CalendarDays,
  activity: Activity,
  settings: Settings,
};

// La misma lista sirve a la lateral (colapsable) y al cajón móvil (siempre
// expandido). Ítems con min-h-11 en el cajón vía padding: targets ≥44px.
export function AdminNavList({ groups, collapsed = false }: {
  groups: AdminNavGroup[];
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones del panel" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
      {groups.map((group, i) => (
        <div key={group.label ?? `top-${i}`} className="flex flex-col gap-0.5">
          {group.label && (collapsed ? (
            <hr className="mx-2 my-2 border-sidebar-border" />
          ) : (
            <p className="px-3 pt-4 pb-1 text-[10px] font-bold tracking-widest uppercase text-sidebar-foreground/70">
              {group.label}
            </p>
          ))}
          {group.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-sm outline-hidden",
                  "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active
                    ? "bg-sidebar-accent font-semibold text-sidebar-primary-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]"
                    : "hover:bg-sidebar-accent/60",
                  collapsed && "justify-center px-0",
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0 opacity-80" />
                <span className={cn(collapsed && "sr-only")}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
