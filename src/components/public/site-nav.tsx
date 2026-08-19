"use client";
// Nav pública con menú colapsable en mobile. Sin dependencias nuevas: un
// botón que togglea, aria-expanded para lectores de pantalla.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  ["/", "Inicio"],
  ["/noticias", "Noticias"],
  ["/actividades", "Actividades"],
  ["/ubicacion", "Ubicación"],
] as const;

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones del sitio">
      <button
        type="button"
        // min-h-11: el vecino entra desde el celular y este es el único control
        // de navegación en esa pantalla — 44px es el mínimo táctil usable.
        className="min-h-11 rounded-md border px-3 py-1.5 text-sm font-medium sm:hidden"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((o) => !o)}
      >
        Menú
      </button>
      <ul
        id="site-menu"
        className={`${open ? "flex" : "hidden"} absolute inset-x-0 top-full z-10 flex-col gap-1 border-b bg-background p-4 shadow-sm sm:static sm:flex sm:flex-row sm:gap-6 sm:border-0 sm:p-0 sm:shadow-none`}
      >
        {LINKS.map(([href, label]) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              // py-2.5 sobre text-base (24px de línea) = 44px de alto, el mismo
              // mínimo táctil que el botón "Menú". En sm+ vuelve a py-1.
              className={`block py-2.5 text-base font-medium hover:text-primary sm:py-1 sm:text-sm ${pathname === href ? "text-primary" : ""}`}
              onClick={() => setOpen(false)}
            >
              {label}
            </Link>
          </li>
        ))}
        <li className="sm:hidden">
          <Link
            href="/ingresar"
            className="block py-2.5 text-base font-medium text-primary underline"
            onClick={() => setOpen(false)}
          >
            Ingresar
          </Link>
        </li>
      </ul>
    </nav>
  );
}
