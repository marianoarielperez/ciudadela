// Pestañas de la sección Solicitudes: Altas (el wizard web, bandeja histórica
// que hoy vive en producción), De socios (bajas y cambios de categoría que
// presentan los socios desde `/mi/solicitudes`, REG-19) y Reportes (la cola de
// reclamos e iniciativas del M7). Cada una es una RUTA, mismo patrón que
// `TreasuryTabs`.
export type SolicitudesTab = { href: string; label: string; count?: number };

export const SOLICITUDES_TABS_BASE: SolicitudesTab[] = [
  { href: "/admin/solicitudes", label: "Altas" },
  { href: "/admin/solicitudes/socios", label: "De socios" },
  { href: "/admin/solicitudes/reportes", label: "Reportes" },
];

// El matcheo NO puede ser un simple prefijo compartido, a diferencia de
// `isNavItemActive`/`isTreasuryTabActive`: acá "/admin/solicitudes" es
// PREFIJO de "/admin/solicitudes/socios", así que si Altas matcheara por
// prefijo puro las dos pestañas se encenderían juntas en esa ruta —
// exactamente el motivo por el que `isNavItemActive` compara contra
// `href + "/"` para no confundir prefijos hermanos, salvo que acá los
// "hermanos" son en realidad uno adentro del otro.
//
// La regla que evita la ambigüedad es "una rama hermana gana por prefijo, todo
// lo demás bajo /admin/solicitudes es Altas": la pestaña Altas está activa en
// `/admin/solicitudes`, en cualquier subruta de detalle
// (`/admin/solicitudes/{id}`) y en `/admin/solicitudes/resumen`, pero se
// APAGA en cuanto la ruta entra a `/admin/solicitudes/socios` (esa subruta
// no podía vivir en otro lado, como `/admin/socios/solicitudes`: la lateral
// marca `/admin/socios` por prefijo y prendería el ítem equivocado) o a
// `/admin/solicitudes/reportes`.
//
// `SIBLINGS` es la lista de esas ramas: agregar una cuarta pestaña anidada es
// sumarla acá, no reescribir la condición. Los hermanos se apagan entre sí
// (cada uno se prende sólo en SU rama) y Altas queda de "resto".
const SIBLINGS = ["/admin/solicitudes/socios", "/admin/solicitudes/reportes"] as const;

export function isSolicitudesTabActive(pathname: string, href: string): boolean {
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  const activeSibling = SIBLINGS.find(under) ?? null;
  if ((SIBLINGS as readonly string[]).includes(href)) return activeSibling === href;
  if (activeSibling !== null) return false;
  return pathname === "/admin/solicitudes" || pathname.startsWith("/admin/solicitudes/");
}
