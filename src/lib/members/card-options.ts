// Las tres listas de sugerencias de la ficha del socio: estado civil,
// nacionalidad y barrio.
//
// Viven acá porque las escriben TRES pantallas distintas y todas terminan en la
// MISMA columna del padrón: el modo carga (`/admin/socios/carga/[numero]`), el
// paso 2 del wizard público REEMPADRONATE y la carga presencial del panel. Con
// una copia por pantalla, la divergencia no se ve al revisar el código sino
// meses después en el padrón, con "Soltero/a" y "Soltero" conviviendo en la
// misma columna y ninguna forma de saber cuál es cuál.
//
// El estado civil es un `<select>` (lista cerrada); la nacionalidad y el barrio
// son `<datalist>` (sugerencias que no cierran el campo): el barrio de un socio
// puede ser uno que no está, y la nacionalidad también.
//
// Sólo strings: ningún import, para que lo puedan tomar por igual un componente
// de cliente y un módulo de servidor.

export const CIVIL_STATUS_OPTIONS = [
  "Soltero/a",
  "Casado/a",
  "Divorciado/a",
  "Viudo/a",
  "Separado/a",
  "Unión convivencial",
] as const;

export const NATIONALITY_OPTIONS = [
  "Argentina",
  "Boliviana",
  "Chilena",
  "Paraguaya",
  "Peruana",
  "Uruguaya",
  "Brasileña",
  "Venezolana",
] as const;

// Los barrios que rodean a Ciudadela, en el orden en que aparecen en el padrón.
export const NEIGHBOURHOOD_OPTIONS = [
  "Ciudadela",
  "Pueyrredón",
  "Standard",
  "Roca",
  "General Mosconi",
  "Laprida",
] as const;

/** Las opciones de un `<select>` de estado civil, con el valor GUARDADO
 *  adelante si no está en la lista.
 *
 *  Sin eso, abrir una ficha que trae un estado civil viejo del padrón de papel
 *  y guardarla sin tocar ese campo se lo cambiaría por la primera opción, en
 *  silencio. */
export function civilStatusOptions(current: string | null): Array<[string, string]> {
  const values: string[] = [...CIVIL_STATUS_OPTIONS];
  if (current && !values.includes(current)) values.unshift(current);
  return [["", "—"], ...values.map((v) => [v, v] as [string, string])];
}
