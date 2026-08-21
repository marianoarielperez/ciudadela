// El `reason` de la suscripción es texto de cara al vecino: aparece en el
// checkout de MP y, después, en el RESUMEN DE SU TARJETA. Por eso lleva el
// nombre de la asociación adelante —"SOCIO ACTIVO" a secas, en un resumen
// bancario, no le dice nada a nadie— y el `reason` del plan atrás, que es el
// que la CD gobierna desde el panel de MP.
//
// Vive en su propio módulo, y no dentro de `asociate/actions.ts`, por lo que
// dice CLAUDE.md: una regla que se puede probar sin base de datos se prueba sin
// base de datos. `actions.ts` arrastra Prisma al importarse.
import { SITE } from "@/lib/site";

// MEDIDO contra la API real el 21/08/2026, no deducido: un `reason` de 64
// caracteres devuelve `{"message":"reason has more than 60 characters",
// "status":400}` y el pedido se rechaza ENTERO — el vecino no llega al
// checkout y ve "no pudimos iniciar el pago". El código decía 255, que era
// falso, y ese número de más costó una tarde de diagnóstico a ciegas.
//
// Por qué importa el margen: el texto de atrás lo escribe la CD desde el panel
// de MP, así que puede crecer sin que nadie toque este repo. El límite tiene
// que aplicarlo el código, no la disciplina del que carga el plan.
export const MAX_SUBSCRIPTION_REASON = 60;

// Recorta respetando el tope TANTO en caracteres como en bytes. No sabemos cuál
// de los dos cuenta MP: el mensaje dice "characters", pero el texto que lo
// disparó tenía una raya larga —3 bytes en UTF-8—, así que las dos medidas se
// pasaban y el error no distingue. Cumplir la más estricta sale gratis y saca
// la duda; si la CD escribe un plan con tildes, tampoco nos sorprende.
export function clampReason(raw: string): string {
  let out = raw.trim();
  while (
    out.length > MAX_SUBSCRIPTION_REASON ||
    Buffer.byteLength(out, "utf8") > MAX_SUBSCRIPTION_REASON
  ) {
    out = out.slice(0, -1).trimEnd();
  }
  // Un recorte a mitad de camino puede dejar el separador colgado
  // ("Cuota Vecinal Ciudadela -"), que en el resumen de la tarjeta se lee como
  // un texto roto. Sólo puede acortar, así que no reabre el límite.
  return out.replace(/[\s\-–—/,;:]+$/u, "");
}

export function subscriptionReason(planReason: string): string {
  const suffix = planReason.trim();
  // Separador ASCII a propósito: la raya larga se comía 3 bytes del presupuesto
  // de 60 a cambio de nada que el vecino note en el resumen de su tarjeta.
  const base = `Cuota ${SITE.shortName}`;
  return clampReason(suffix ? `${base} - ${suffix}` : base);
}
