// Secciones del panel de socio. Puro y sin JSX a propósito (mismo criterio que
// src/lib/admin/nav.ts): la barra de pestañas, el marcado de sección activa y
// el test salen de esta única fuente. El mapa ícono→componente vive en el
// componente cliente (lucide no carga fuera del bundle).
//
// La fase 5A lista SOLO secciones que funcionan (la regla del shell admin:
// nada de "Próximamente" en la navegación). Solicitudes y Débito automático
// (5B) ya tienen su página real.
export type MiTabIcon = "home" | "wallet" | "user" | "file-text" | "scroll-text" | "refresh-cw";

export type MiTab = {
  href: string;
  label: string;
  icon: MiTabIcon;
  /** Sólo para categorías que pagan cuota (`categoryPaysFee`). Es DISPLAY: la
   *  autorización real de /mi/debito y sus actions vive en `requireMember` +
   *  `memberDebit`, no acá — un vitalicio que fuerce la URL igual se topa con
   *  el veredicto de adhesión ("category"), esta bandera sólo evita mostrarle
   *  una pestaña que no le sirve. */
  paysFeeOnly?: boolean;
};

export const MI_TABS: MiTab[] = [
  { href: "/mi", label: "Inicio", icon: "home" },
  { href: "/mi/cuenta", label: "Mi cuenta", icon: "wallet" },
  { href: "/mi/debito", label: "Débito automático", icon: "refresh-cw", paysFeeOnly: true },
  { href: "/mi/datos", label: "Mis datos", icon: "user" },
  { href: "/mi/solicitudes", label: "Solicitudes", icon: "file-text" },
  { href: "/mi/estatuto", label: "Estatuto", icon: "scroll-text" },
];

/** El subconjunto de `MI_TABS` que le corresponde a esta categoría. Puro: el
 *  layout es el único llamador, con `categoryPaysFee(member.category)`. */
export function miTabsFor(paysFee: boolean): MiTab[] {
  return MI_TABS.filter((t) => !t.paysFeeOnly || paysFee);
}

// Mismo criterio que isTreasuryTabActive, con una excepción: "/mi" es prefijo
// de TODO el panel, así que Inicio sólo se marca en el match exacto.
export function isMiTabActive(pathname: string, href: string): boolean {
  if (href === "/mi") return pathname === "/mi";
  return pathname === href || pathname.startsWith(href + "/");
}
