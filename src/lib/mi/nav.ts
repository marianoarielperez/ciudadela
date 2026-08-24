// Secciones del panel de socio. Puro y sin JSX a propósito (mismo criterio que
// src/lib/admin/nav.ts): la barra de pestañas, el marcado de sección activa y
// el test salen de esta única fuente. El mapa ícono→componente vive en el
// componente cliente (lucide no carga fuera del bundle).
//
// La fase 5A lista SOLO secciones que funcionan (la regla del shell admin:
// nada de "Próximamente" en la navegación). Débito automático y Solicitudes se
// agregan acá cuando la 5B les dé páginas reales.
export type MiTabIcon = "home" | "wallet" | "user" | "scroll-text";

export type MiTab = { href: string; label: string; icon: MiTabIcon };

export const MI_TABS: MiTab[] = [
  { href: "/mi", label: "Inicio", icon: "home" },
  { href: "/mi/cuenta", label: "Mi cuenta", icon: "wallet" },
  { href: "/mi/datos", label: "Mis datos", icon: "user" },
  { href: "/mi/estatuto", label: "Estatuto", icon: "scroll-text" },
];

// Mismo criterio que isTreasuryTabActive, con una excepción: "/mi" es prefijo
// de TODO el panel, así que Inicio sólo se marca en el match exacto.
export function isMiTabActive(pathname: string, href: string): boolean {
  if (href === "/mi") return pathname === "/mi";
  return pathname === href || pathname.startsWith(href + "/");
}
