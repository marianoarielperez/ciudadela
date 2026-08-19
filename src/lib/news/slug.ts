// Slug de la URL pública /noticias/[slug]. Determinístico y sin estado: la
// unicidad la garantiza el UNIQUE de la base (P2002 → mensaje en castellano).
export function slugify(title: string): string {
  const slug = title
    .normalize("NFD")
    // NFD separa la letra de su marca diacrítica; acá borramos las marcas
    // (rango combining diacritical marks) y queda la letra ASCII: "ñ" → "n".
    // El rango va con escapes \u: son caracteres invisibles y escritos crudos
    // se rompen con cualquier reencodeo del archivo.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180)
    // El slice puede dejar un guion colgante al cortar en el medio de una
    // palabra: lo sacamos DESPUÉS de recortar, no antes.
    .replace(/-+$/g, "");
  return slug === "" ? "noticia" : slug;
}
