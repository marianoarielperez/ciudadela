import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { FormMessage } from "@/components/admin/form-message";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { navForRoles, parseSidebarState, SIDEBAR_COOKIE } from "@/lib/admin/nav";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSuperadmin } from "@/lib/auth/roles";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Los roles del token NO alcanzan: la sesión es un JWT de 8 horas sin estado en
  // la base, así que el "admin" que se emitió al entrar sobrevive a la revocación
  // del rol y al cambio de contraseña que vienen después. `requireAdmin` resuelve
  // contra la fila viva de `User` (rol, `active` y `passwordChangedAt`) — la
  // misma guarda que ya usa cada server action del panel.
  const actor = await requireAdmin();

  if (!actor.ok) {
    // Sin sesión: al login. Con sesión pero sin habilitación NO se puede redirigir
    // ahí, y es el mismo rebote que documenta /mi: /ingresar manda a /redirigir
    // cuando hay sesión, /redirigir manda a /admin por el rol del TOKEN —que sigue
    // diciendo admin, justamente— y el ciclo no termina nunca. Se explica el motivo
    // y se ofrece cerrar la sesión, que es lo que hace falta en los tres casos.
    if (actor.reason === "anonymous") redirect("/ingresar");
    // Bloqueado con sesión: barra mínima SIN navegación (no se muestra el mapa
    // del panel a quien no está habilitado) + motivo + salida. Antes esta
    // pantalla no ofrecía ninguna acción.
    return (
      <div className="min-h-screen">
        <header className="flex items-center justify-between bg-sidebar px-4 py-3">
          <span className="text-sm font-semibold text-white">SIGeV — Panel de administración</span>
          <SignOutButton className="text-white/85 outline-hidden hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring" />
        </header>
        <main className="mx-auto w-full max-w-2xl p-4">
          <div className="space-y-3 rounded-xl border p-4">
            <h1 className="text-xl font-semibold">El panel no está disponible</h1>
            <FormMessage kind="error">{actor.error}</FormMessage>
          </div>
        </main>
      </div>
    );
  }

  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const roles = session?.user.roles ?? [];
  // La lateral y el cajón móvil comen los mismos datos: se calculan una sola vez.
  const groups = navForRoles(roles);
  const user = {
    name: session?.user.name ?? "—",
    // El rol se muestra en castellano: los slugs `superadmin`/`admin` son
    // identificadores internos y el resto del panel está en es-AR.
    roleLabel: isSuperadmin(roles) ? "Superadministrador/a" : "Administrador/a",
  };

  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Saltar al contenido
      </a>
      <AdminSidebar
        groups={groups}
        initialCollapsed={parseSidebarState(cookieStore.get(SIDEBAR_COOKIE)?.value) === "collapsed"}
        user={user}
        signOutExpanded={
          <SignOutButton className="text-xs text-sidebar-foreground/80 outline-hidden hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring" />
        }
        signOutCollapsed={
          <SignOutButton
            iconOnly
            className="flex size-8 items-center justify-center rounded-md no-underline outline-hidden hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          />
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminMobileNav
          groups={groups}
          user={user}
          signOut={
            <SignOutButton className="text-xs text-sidebar-foreground/80 outline-hidden hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring" />
          }
        />
        <main id="contenido" tabIndex={-1} className="flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
