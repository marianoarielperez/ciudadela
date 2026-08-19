// Lowercase, accent-stripped form used for autocomplete matching.
// Corre también en el navegador: no puede depender de APIs de Node.
export function normalizeStreetName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}
