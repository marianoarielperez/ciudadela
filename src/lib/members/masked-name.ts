/** "Castillo Nestor" (formato del padrón: Apellido Nombre) → "N***** C."
 *
 *  Para qué: que quien tipeó un DNI confirme que es él, SIN que el sistema le
 *  revele el nombre completo de un tercero. Alcanza con que el propio socio se
 *  reconozca; a un desconocido el resultado no le dice quién es.
 *
 *  REGLA FIJADA (y fijada también en el test, que es donde se lee la tabla de
 *  casos): la PRIMERA palabra es el apellido y viaja sólo como inicial + punto;
 *  todas las demás son nombres, y cada uno conserva su inicial y enmascara el
 *  resto con un asterisco por letra. Un nombre de una sola palabra da "C." solo.
 *
 *  Por qué "primera palabra = apellido" y no una heurística de apellido
 *  compuesto: el padrón viene en formato "Apellido Nombre" y no marca dónde
 *  termina el apellido. "Perez Gomez Maria Ana" es indistinguible de un
 *  apellido compuesto con dos nombres o de un apellido simple con tres
 *  nombres, y adivinar mal cambia el cartel que ve el vecino. La regla
 *  mecánica siempre da lo mismo para el mismo dato, que es lo que se necesita
 *  para confirmar.
 *
 *  Los acentos y la ñ cuentan como UNA letra: el padrón los tiene (hay un socio
 *  "Coñuecar") y a veces llegan en forma descompuesta (la ñ como "n" + tilde
 *  combinante), que contada cruda mostraría un asterisco de más. Por eso se
 *  normaliza a NFC y se recorre por code points.
 *
 *  Nació en el paso 1 de REEMPADRONATE (M6) y desde el paso "Tu DNI" de
 *  ASOCIATE la comparten los dos wizards: por eso vive acá y no en
 *  `reregistration/rules.ts`, que la re-exporta para sus call-sites. */
export function maskedName(fullName: string): string {
  const words = fullName.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  // `split(/\s+/)` + `filter(Boolean)` garantiza que ninguna palabra esté vacía,
  // así que el primer code point siempre existe.
  const initial = (word: string) => [...word][0].toLocaleUpperCase("es-AR");
  const surname = `${initial(words[0])}.`;
  const given = words.slice(1).map((word) => initial(word) + "*".repeat([...word].length - 1));
  return given.length === 0 ? surname : `${given.join(" ")} ${surname}`;
}
