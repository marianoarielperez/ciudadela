// Configuración declarativa de la navegación del panel. Vive separada de los
// componentes para poder testearla en node sin DOM (patrón del proyecto) y para
// que M3-M6 agreguen secciones tocando SOLO este array (spec 2026-08-20 §3.1).
import { isSuperadmin } from "@/lib/auth/roles";

export type AdminNavIcon =
  | "home" | "inbox" | "users" | "wallet" | "scroll-text" | "newspaper" | "calendar-days" | "settings"
  | "activity" | "vote" | "clipboard-check" | "user-cog";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: AdminNavIcon;
  /** Oculta el ítem para admins comunes. La guarda real sigue en el servidor. */
  superadminOnly?: boolean;
};

export type AdminNavGroup = { label: string | null; items: AdminNavItem[] };

// Solo secciones vivas: el roadmap ("Próximamente") queda en las tarjetas de /admin.
export const ADMIN_NAV: AdminNavGroup[] = [
  { label: null, items: [{ href: "/admin", label: "Inicio", icon: "home" }] },
  {
    label: "Gestión",
    items: [
      // Primero la bandeja: es el trabajo diario del panel (lo que entró y hay
      // que resolver), y el padrón es la consulta.
      { href: "/admin/solicitudes", label: "Solicitudes", icon: "inbox" },
      // El re-empadronamiento va entre la bandeja y el padrón porque mientras
      // el proceso corre ES el trabajo diario: la cola de presentaciones se
      // atiende como se atiende la de altas. NO lleva `superadminOnly` —
      // validar presentaciones es tarea del admin común—; convocar y abrir la
      // 2ª instancia cortan solas en la ruta y en cada action.
      { href: "/admin/reempadronamiento", label: "Reempadronamiento", icon: "clipboard-check" },
      { href: "/admin/socios", label: "Socios", icon: "users" },
      // Tesorería va pegada al padrón: se entra desde la ficha del socio y se
      // vuelve a ella. Las actas quedan al final del grupo, que es donde se
      // asienta lo que ya se decidió.
      { href: "/admin/tesoreria", label: "Tesorería", icon: "wallet" },
      { href: "/admin/actas", label: "Actas", icon: "scroll-text" },
    ],
  },
  {
    label: "Contenido",
    items: [
      { href: "/admin/noticias", label: "Noticias", icon: "newspaper" },
      { href: "/admin/actividades", label: "Actividades", icon: "calendar-days" },
    ],
  },
  {
    label: "Sistema",
    items: [
      // Salud va primero: es la pantalla que se abre cuando algo anda mal, y
      // Configuración es la que se abre cuando hay que cambiar algo. Lo urgente
      // arriba.
      { href: "/admin/salud", label: "Salud", icon: "activity", superadminOnly: true },
      // El padrón electoral se usa dos veces cada dos años, así que va después
      // de Salud; pero antes de Configuración, que es la pantalla-cajón.
      { href: "/admin/padron-electoral", label: "Padrón electoral", icon: "vote", superadminOnly: true },
      // Usuarios se usa poco (el recambio de la Comisión Directiva): más que el
      // padrón bianual no, pero sí antes que Configuración, que es la
      // pantalla-cajón. `superadminOnly` es display: la guarda real es
      // `requireSuperadminUsers` en la ruta y en cada action.
      { href: "/admin/usuarios", label: "Usuarios", icon: "user-cog", superadminOnly: true },
      { href: "/admin/configuracion", label: "Configuración", icon: "settings", superadminOnly: true },
    ],
  },
];

export function navForRoles(roles: string[]): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.superadminOnly || isSuperadmin(roles)),
  })).filter((group) => group.items.length > 0);
}

// `/admin` es prefijo de TODAS las rutas del panel: Inicio solo matchea exacto.
// El resto marca también sus subrutas (`/admin/socios/carga/45` → Socios),
// comparando contra `href + "/"` para no confundir prefijos hermanos.
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

export type SidebarState = "expanded" | "collapsed";

export const SIDEBAR_COOKIE = "sigev_sidebar";

// La escribe el cliente (toggle) y la lee el layout del servidor para renderizar
// el estado correcto de entrada, sin flash. Basura o ausencia caen a "expanded".
export function parseSidebarState(value: string | undefined): SidebarState {
  return value === "collapsed" ? "collapsed" : "expanded";
}
