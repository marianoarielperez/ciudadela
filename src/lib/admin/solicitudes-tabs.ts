// Pestañas de la sección Solicitudes: Altas (el wizard web, bandeja histórica
// que hoy vive en producción) y De socios (bajas y cambios de categoría que
// presentan los socios desde `/mi/solicitudes`, REG-19 — la construye la
// tarea 8). Cada una es una RUTA, mismo patrón que `TreasuryTabs`.
export type SolicitudesTab = { href: string; label: string; count?: number };

export const SOLICITUDES_TABS_BASE: SolicitudesTab[] = [
  { href: "/admin/solicitudes", label: "Altas" },
  { href: "/admin/solicitudes/socios", label: "De socios" },
];

const SOCIOS_HREF = "/admin/solicitudes/socios";

// El matcheo NO puede ser un simple prefijo compartido, a diferencia de
// `isNavItemActive`/`isTreasuryTabActive`: acá "/admin/solicitudes" es
// PREFIJO de "/admin/solicitudes/socios", así que si Altas matcheara por
// prefijo puro las dos pestañas se encenderían juntas en esa ruta —
// exactamente el motivo por el que `isNavItemActive` compara contra
// `href + "/"` para no confundir prefijos hermanos, salvo que acá los
// "hermanos" son en realidad uno adentro del otro.
//
// La regla que evita la ambigüedad es "socios gana por prefijo, todo lo
// demás bajo /admin/solicitudes es Altas": la pestaña Altas está activa en
// `/admin/solicitudes`, en cualquier subruta de detalle
// (`/admin/solicitudes/{id}`) y en `/admin/solicitudes/resumen`, pero se
// APAGA en cuanto la ruta entra a `/admin/solicitudes/socios` (esa subruta
// no podía vivir en otro lado, como `/admin/socios/solicitudes`: la lateral
// marca `/admin/socios` por prefijo y prendería el ítem equivocado).
export function isSolicitudesTabActive(pathname: string, href: string): boolean {
  const underSocios = pathname === SOCIOS_HREF || pathname.startsWith(`${SOCIOS_HREF}/`);
  if (href === SOCIOS_HREF) return underSocios;
  if (underSocios) return false;
  return pathname === "/admin/solicitudes" || pathname.startsWith("/admin/solicitudes/");
}
