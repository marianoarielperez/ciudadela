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

export function suggestMember(
  sub: { payerEmail: string | null; reason: string | null },
  members: SuggestMember[],
): SuggestMember | null {
  if (sub.payerEmail) {
    const email = sub.payerEmail.trim().toLowerCase();
    const byEmail = members.find((m) => m.email?.trim().toLowerCase() === email);
    if (byEmail) return byEmail;
    // Sin `return null` acá: que el pagador tenga un email que no está en el
    // padrón no invalida la pista del `reason` (el vecino puede haber pagado
    // con la cuenta de MP de un familiar).
  }
  if (sub.reason) {
    const reason = norm(sub.reason);
    const hits = members.filter((m) => {
      const surname = surnameOf(m.fullName);
      // Menos de tres letras matchea cualquier texto: no es una pista, es ruido.
      return surname.length >= 3 && reason.includes(surname);
    });
    // Exactamente uno o ninguno. Dos socios con el mismo apellido —"Perez,
    // Mariano" y "Perez, Ana"— es el caso que más se da en un padrón de barrio,
    // y elegir uno sería adivinar con la cara de una certeza.
    if (hits.length === 1) return hits[0];
  }
  return null;
}
