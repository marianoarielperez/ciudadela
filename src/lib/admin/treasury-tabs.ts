// Pestañas de Tesorería: cada una es una RUTA (deep-link, botón atrás y
// aria-current salen solos). Radix `Tabs` queda para paneles que NO navegan.
export type TreasuryTab = { href: string; label: string };

export const TREASURY_TABS: TreasuryTab[] = [
  { href: "/admin/tesoreria/deudores", label: "Deudores" },
  { href: "/admin/tesoreria/efectivo", label: "Efectivo" },
  { href: "/admin/tesoreria/recibos", label: "Recibos" },
  { href: "/admin/tesoreria/sin-conciliar", label: "Sin conciliar" },
  { href: "/admin/tesoreria/suscripciones", label: "Suscripciones" },
  // No toda la plata que entra es de cuotas: el alquiler del salón, las rifas y
  // los eventos se registran acá. Va antes de "Valores de cuota" porque es
  // trabajo diario y aquélla es de consulta.
  { href: "/admin/tesoreria/otros-ingresos", label: "Otros ingresos" },
  { href: "/admin/tesoreria/valores", label: "Valores de cuota" },
];

/** Adónde manda `/admin/tesoreria`: la lista de deudores es el trabajo diario. */
export const TREASURY_HOME = TREASURY_TABS[0].href;

// Mismo criterio que `isNavItemActive`: la pestaña se marca también en sus
// subrutas (`/admin/tesoreria/recibos/12` → Recibos), comparando contra
// `href + "/"` para no confundir prefijos hermanos.
export function isTreasuryTabActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
