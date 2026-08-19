// Búsqueda del catálogo de calles para el autocompletado del modo carga.
// Corre también en el navegador (las 40 calles viajan enteras al cliente): no
// puede depender de APIs de Node.
import { normalizeStreetName } from "./normalize";

export type StreetLike = { name: string; loadOrder: number };

// `normalizeStreetName` NO se toca: su salida está persistida en
// `streets.normalized_name` para las 40 calles del barrio, así que cambiarla
// sería una migración. Pero para buscar hace falta una clave más laxa, por dos
// particularidades del catálogo catastral:
//
//   - El ordinal queda intacto ("1º de mayo"), así que quien tipea "1 de mayo"
//     —que es lo natural— no encontraría nada. Acá lo sacamos.
//   - Cinco calles están en formato "apellido, nombre" ("Hernandez , Jose").
//     Convertimos la coma en separador de palabras para que el nombre de pila
//     sea un token buscable por sí mismo.
export function streetSearchKey(name: string): string {
  return normalizeStreetName(name)
    .replace(/[º°ª]/g, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ONLY_DIGITS = /^\d+$/;

// Menor es mejor. `null` = no coincide.
export function streetMatchScore(street: StreetLike, query: string): number | null {
  const q = streetSearchKey(query);
  if (!q) return null;
  const key = streetSearchKey(street.name);
  const code = String(street.loadOrder);

  // El código catastral es lo que figura en muchas fichas viejas.
  if (ONLY_DIGITS.test(q)) {
    if (code === q) return 0;
    if (code.startsWith(q)) return 1;
  }
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;

  // Por tokens y NUNCA sólo por prefijo del nombre completo: con "Hernandez ,
  // Jose" en el catálogo, buscar "jose" tiene que encontrarlo igual. Cada
  // palabra tipeada tiene que abrir alguna palabra del nombre, en cualquier
  // orden ("jose hernandez" y "hernandez jose" valen las dos).
  //
  // A propósito no caemos a substring suelto: "carlos" contiene "los", así que
  // buscar "los" traería "Burgueño , Juan Carlos" junto a "Los Andes" y el
  // primer resultado dejaría de ser el que se busca.
  const keyTokens = key.split(" ");
  const qTokens = q.split(" ");
  if (qTokens.every((t) => keyTokens.some((k) => k.startsWith(t)))) return 2;
  return null;
}

export function searchStreets<T extends StreetLike>(streets: T[], query: string, limit = 8): T[] {
  if (!query.trim()) return streets.slice(0, limit);
  const scored: Array<{ street: T; score: number }> = [];
  for (const street of streets) {
    const score = streetMatchScore(street, query);
    if (score !== null) scored.push({ street, score });
  }
  scored.sort((a, b) => a.score - b.score || a.street.loadOrder - b.street.loadOrder);
  return scored.slice(0, limit).map((s) => s.street);
}
