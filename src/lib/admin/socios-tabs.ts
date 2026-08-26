// Pestañas de la sección Socios: Padrón (lo que ya vive hoy en
// `/admin/socios`), Libros (la task 3, apertura y cierre de los libros del
// re-empadronamiento: REG-28, cerrar el libro vigente abre el siguiente) e
// Histórico (la task 4, los socios que quedaron en los libros cerrados —
// REG-29: la antigüedad no se reinicia, es la misma persona con un número
// distinto por libro). Esta task sólo pone el marco — Libros e Histórico dan
// 404 hasta que esas tasks agreguen sus páginas, y está bien así. Mismo patrón que
// `SolicitudesTab`/`TreasuryTab`: cada pestaña es una RUTA propia, no un
// `?tab=` de la misma pantalla.
export type SociosTab = { href: string; label: string; icon: "users" | "book-marked" | "history" };

export const SOCIOS_TABS: SociosTab[] = [
  { href: "/admin/socios", label: "Padrón", icon: "users" },
  { href: "/admin/socios/libros", label: "Libros", icon: "book-marked" },
  { href: "/admin/socios/historico", label: "Histórico", icon: "history" },
];

const LIBROS_HREF = "/admin/socios/libros";
const HISTORICO_HREF = "/admin/socios/historico";

// Misma trampa que `isSolicitudesTabActive`: "/admin/socios" es PREFIJO de
// "/admin/socios/libros" y de "/admin/socios/historico", así que Padrón no
// puede matchear por prefijo puro o se prendería con esas dos pestañas
// encima. La regla es "el prefijo más específico gana": Libros e Histórico
// se prenden en sí mismas y en sus subrutas; todo lo demás bajo
// /admin/socios —el padrón, el detalle de un socio, su baja, la carga y el
// alta— es Padrón.
export function isSociosTabActive(pathname: string, href: string): boolean {
  const underLibros = pathname === LIBROS_HREF || pathname.startsWith(`${LIBROS_HREF}/`);
  const underHistorico = pathname === HISTORICO_HREF || pathname.startsWith(`${HISTORICO_HREF}/`);

  if (href === LIBROS_HREF) return underLibros;
  if (href === HISTORICO_HREF) return underHistorico;
  if (underLibros || underHistorico) return false;
  return pathname === "/admin/socios" || pathname.startsWith("/admin/socios/");
}
