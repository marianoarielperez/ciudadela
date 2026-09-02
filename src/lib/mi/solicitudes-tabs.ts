// Sub-pestañas de /mi/solicitudes (M7): Institucional (bajas y cambios de
// categoría, lo de siempre) y Reportes. Por URL, como `solicitudes-tabs.ts` del
// admin, y con su misma trampa: /mi/solicitudes es PREFIJO de la otra.
export type MiSolicitudesTab = { href: string; label: string };

const REPORTES = "/mi/solicitudes/reportes";

export const MI_SOLICITUDES_TABS: MiSolicitudesTab[] = [
  { href: "/mi/solicitudes", label: "Institucional" },
  { href: REPORTES, label: "Reportes" },
];

// La regla que evita la ambigüedad es "reportes gana por prefijo; todo lo demás
// bajo /mi/solicitudes es Institucional": con un prefijo puro las dos pestañas
// se encenderían juntas en /mi/solicitudes/reportes. Mismo criterio (y mismo
// motivo) que `isSolicitudesTabActive` del panel.
export function isMiSolicitudesTabActive(pathname: string, href: string): boolean {
  const underReportes = pathname === REPORTES || pathname.startsWith(`${REPORTES}/`);
  if (href === REPORTES) return underReportes;
  if (underReportes) return false;
  return pathname === "/mi/solicitudes" || pathname.startsWith("/mi/solicitudes/");
}
