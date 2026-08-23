// Sugerencia de socio para una suscripción sin vincular (spec 4B §8). Es una
// AYUDA, no una decisión: el operador siempre elige y confirma, y el paso 2
// vuelve a resolver todo contra la base y contra Mercado Pago.
//
// Módulo puro: sin Prisma, sin red. El padrón entra por parámetro.
export type SuggestMember = { id: number; fullName: string; email: string | null };

/** Sin tildes y en minúsculas: el padrón las escribe ("Gómez") y el `reason`
 *  que llega de Mercado Pago casi nunca las lleva. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Apellido = lo que va antes de la coma en "Apellido, Nombre" (formato del padrón). */
function surnameOf(fullName: string): string {
  return norm(fullName.split(",")[0] ?? fullName).trim();
}

/** El apellido tiene que aparecer como PALABRA, no como subcadena. Sin esto,
 *  un `reason` "Cuota Romanelli" sugiere a "Roman, Juan" —y se autocancela sólo
 *  si los dos apellidos están en el padrón, que es una casualidad y no una
 *  garantía—. Los dos textos ya pasaron por `norm`, así que lo único que queda
 *  es `a-z`, dígitos y separadores: el límite se define contra eso. */
function containsWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(haystack);
}

export function suggestMember(
  sub: { payerEmail: string | null; reason: string | null },
  members: SuggestMember[],
): SuggestMember | null {
  if (sub.payerEmail) {
    const email = sub.payerEmail.trim().toLowerCase();
    // Exactamente uno, igual que la rama del apellido. `Member.email` NO es
    // único en el schema: un matrimonio, o un padre y su hijo, se cargan con la
    // misma casilla todo el tiempo. Un `.find` devolvía el primero por clave
    // primaria —en silencio y con cara de certeza— y esa sugerencia termina en
    // un botón primario que preselecciona al socio equivocado.
    const byEmail = members.filter((m) => m.email?.trim().toLowerCase() === email);
    if (byEmail.length === 1) return byEmail[0];
    // Dos o más con ese email: la pista más fuerte es ambigua, así que no hay
    // sugerencia. Bajar al `reason` sería resolver con la pista débil algo que
    // la fuerte no pudo, y el operador tiene el buscador al lado.
    if (byEmail.length > 1) return null;
    // Ninguno: que el pagador tenga un email que no está en el padrón no
    // invalida la pista del `reason` (el vecino puede haber pagado con la
    // cuenta de MP de un familiar).
  }
  if (sub.reason) {
    const reason = norm(sub.reason);
    const hits = members.filter((m) => {
      const surname = surnameOf(m.fullName);
      // Menos de tres letras matchea cualquier texto: no es una pista, es ruido.
      return surname.length >= 3 && containsWord(reason, surname);
    });
    // Exactamente uno o ninguno. Dos socios con el mismo apellido —"Perez,
    // Mariano" y "Perez, Ana"— es el caso que más se da en un padrón de barrio,
    // y elegir uno sería adivinar con la cara de una certeza.
    if (hits.length === 1) return hits[0];
  }
  return null;
}
