// Paginación por querystring compartida por las listas de tesorería. El padrón
// y la bandeja conservan su implementación propia (no se tocan en esta fase).
export function parsePage(sp: Record<string, string | string[] | undefined>): number {
  const raw = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Acota la página pedida al rango real: una URL con `?page=999` muestra la
 *  última, no una tabla vacía. Nunca devuelve 0 páginas (la lista vacía es la
 *  página 1 de 1). */
export function paginate(total: number, page: number, size: number) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pageCount);
  return { page: current, pageCount, skip: (current - 1) * size, take: size };
}

/** Link de página que CONSERVA los filtros vigentes: sin esto, pasar a la
 *  página 2 de una búsqueda devuelve la página 2 de la lista entera. `page=1`
 *  se omite para que la primera página tenga una sola URL. */
export function pageHref(basePath: string, params: Record<string, string | undefined>, n: number): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  if (n > 1) qs.set("page", String(n));
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}
