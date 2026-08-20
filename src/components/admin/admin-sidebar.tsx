"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import logoNegativo from "../../../assets/logo-negativo.png";
import { AdminNavList } from "@/components/admin/admin-nav-list";
import { SIDEBAR_COOKIE, type AdminNavGroup } from "@/lib/admin/nav";
import { cn } from "@/lib/utils";

// Lateral fija de escritorio (≥lg), colapsable a íconos. El estado inicial
// viene del servidor (cookie leída en el layout): sin flash de hidratación.
// signOutExpanded/signOutCollapsed son dos nodos porque SignOutButton es un
// server component y el cliente solo elige cuál mostrar.
export function AdminSidebar({ groups, initialCollapsed, user, signOutExpanded, signOutCollapsed }: {
  groups: AdminNavGroup[];
  initialCollapsed: boolean;
  user: { name: string; roleLabel: string };
  signOutExpanded: React.ReactNode;
  signOutCollapsed: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // Un año: preferencia de UI del operador, no un dato sensible.
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex",
        collapsed ? "w-14" : "w-[230px]",
      )}
    >
      <Link
        href="/admin"
        className={cn(
          "m-2 flex items-center gap-2.5 rounded-md px-2 py-3 outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          collapsed && "justify-center px-0",
        )}
      >
        <Image src={logoNegativo} alt="" className="h-8 w-auto" priority />
        <span className={cn("leading-tight", collapsed && "sr-only")}>
          <span className="block text-sm font-semibold text-white">SIGeV</span>
          <span className="block text-[10.5px] text-sidebar-foreground/70">Panel de administración</span>
        </span>
      </Link>
      <AdminNavList groups={groups} collapsed={collapsed} />
      <div className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <p className="mb-2 text-xs">
            {user.name}
            <span className="block text-[10.5px] text-sidebar-foreground/70">{user.roleLabel}</span>
          </p>
        )}
        <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between gap-2")}>
          {collapsed ? signOutCollapsed : signOutExpanded}
          <button
            onClick={toggle}
            title={collapsed ? "Expandir navegación" : "Colapsar navegación"}
            className="flex size-8 items-center justify-center rounded-md outline-hidden hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            {collapsed ? <ChevronsRight aria-hidden className="size-4" /> : <ChevronsLeft aria-hidden className="size-4" />}
            <span className="sr-only">{collapsed ? "Expandir navegación" : "Colapsar navegación"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
