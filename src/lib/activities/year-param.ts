// Resolución del parámetro `?anio=` de /actividades y su URL canónica.
//
// Vive acá y no dentro de la página por el mismo motivo que en /noticias hay
// que resolver la página antes de emitir el canonical: `generateMetadata` y el
// render tienen que llegar EXACTAMENTE al mismo año, o el <title> y el
// canonical describen un contenido distinto del que se muestra.

// `currentYearAR` y `fallbackYear` se mudaron a `@/lib/dates`: el ejercicio
// anual de Tesorería necesita exactamente el mismo par y no tiene por qué
// importar un módulo de /actividades. Se re-exportan desde acá para que esta
// página —y sus tests— sigan teniendo un solo lugar del que traer todo lo del
// `?anio=`.
export { currentYearAR, fallbackYear } from "@/lib/dates";
import { fallbackYear } from "@/lib/dates";

// El año por defecto se sirve en /actividades a secas: es la URL que linkea el
// menú y la que se comparte, y tener dos direcciones para el mismo contenido
// no suma. Igual que /noticias con la página 1.
export function activitiesYearHref(year: number, fallback: number): string {
  return year === fallback ? "/actividades" : `/actividades?anio=${year}`;
}

export type ActivitiesYearResolution = {
  year: number;
  fallback: number;
  canonicalHref: string;
  /** false ⇒ la URL pedida no es la canónica del año que se va a mostrar. */
  isCanonical: boolean;
};

export function resolveActivitiesYear(
  param: string | string[] | undefined,
  years: number[],
  current: number,
): ActivitiesYearResolution {
  const fallback = fallbackYear(years, current);
  // `anio` puede venir repetido (?anio=2025&anio=2024 → array), decimal, con
  // espacios ("%202025") o con basura. Todo lo que no resuelva a un año con
  // actividades cargadas cae en el fallback.
  //
  // El criterio es el mismo `^\d+$` estricto que usa /noticias con `?pagina=`:
  // son páginas hermanas y no tiene sentido que una acepte `0x7e9` y `2025e0`
  // como año y la otra no. Number() los aceptaba; el redirect a la canónica
  // tapaba el efecto, pero eran dos varas distintas para el mismo problema.
  const requested = typeof param === "string" && /^\d+$/.test(param) ? Number(param) : NaN;
  const year = Number.isInteger(requested) && years.includes(requested) ? requested : fallback;
  // Valor canónico del query param para un año ya resuelto: ausente en el
  // fallback, el número tal cual en el resto. Es contra ESTO que se compara lo
  // recibido — comparar contra el año ya normalizado no alcanza, porque
  // ?anio=abc, ?anio= 2025 y ?anio=2025.0 colapsan al mismo número y dejarían
  // varias direcciones vivas para el mismo contenido.
  const canonicalParam = year === fallback ? undefined : String(year);
  return {
    year,
    fallback,
    canonicalHref: activitiesYearHref(year, fallback),
    isCanonical: param === canonicalParam,
  };
}
