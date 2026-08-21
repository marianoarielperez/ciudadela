"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Dialog } from "radix-ui";
import { Menu, X } from "lucide-react";

import { AdminNavList } from "@/components/admin/admin-nav-list";
import type { AdminNavGroup } from "@/lib/admin/nav";

// Barra superior (<lg) + cajón sobre las primitivas de Dialog de radix: foco
// atrapado, Escape y scroll-lock vienen gratis. Se cierra al navegar (al cambiar
// pathname) y al tocar el overlay. Animación anulada con motion-reduce.
export function AdminMobileNav({ groups, user, signOut }: {
  groups: AdminNavGroup[];
  user: { name: string; roleLabel: string };
  signOut: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [shownFor, setShownFor] = useState(pathname);

  // Cerrar al navegar se ajusta en render y no en un efecto: el compilador de
  // React rechaza setState dentro de useEffect (react-hooks/set-state-in-effect)
  // y éste es el patrón que documenta react.dev para derivar estado de un cambio
  // de prop. Re-renderiza en el acto, sin el parpadeo del cajón abierto que deja
  // el efecto.
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 flex items-center gap-2 bg-sidebar px-2 py-1.5 lg:hidden print:hidden">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger
          className="flex size-11 items-center justify-center rounded-md text-white outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Menu aria-hidden className="size-5" />
          <span className="sr-only">Abrir la navegación</span>
        </Dialog.Trigger>
        <Link href="/admin" className="flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-white outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          SIGeV — Panel
        </Link>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar py-2 text-sidebar-foreground data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none"
          >
            <div className="flex items-center justify-between px-3 pb-2">
              <Dialog.Title className="text-sm font-semibold text-white">
                SIGeV — Panel de administración
              </Dialog.Title>
              <Dialog.Close className="flex size-11 items-center justify-center rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                <X aria-hidden className="size-5" />
                <span className="sr-only">Cerrar la navegación</span>
              </Dialog.Close>
            </div>
            {/* Los dos mecanismos se cubren los puntos ciegos: la delegación cierra
                cuando se toca la sección en la que ya se está (el pathname no cambia)
                y el ajuste por pathname cierra en atrás/adelante del navegador. */}
            <div className="contents" onClick={() => setOpen(false)}>
              <AdminNavList groups={groups} />
            </div>
            <div className="border-t border-sidebar-border p-3">
              <p className="mb-2 text-xs">
                {user.name}
                <span className="block text-[10.5px] text-sidebar-foreground/70">{user.roleLabel}</span>
              </p>
              {signOut}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </header>
  );
}
