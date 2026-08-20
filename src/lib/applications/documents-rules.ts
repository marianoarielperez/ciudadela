// Completitud documental del paso 4 (REG-03). PURA a propósito: la consumen la
// pantalla del paso 4 (para habilitar "Continuar" y para decir qué falta) y las
// dos actions de envío (que no pueden confiar en el cliente). Que sea la misma
// función en las dos puntas es lo que garantiza que el botón no habilite algo
// que el server va a rechazar, ni al revés.
//
// Devuelve UN pendiente por vez, en el orden en que la pantalla los pide: el
// mensaje va debajo del botón y tres reclamos juntos se leen como un muro.
import type { DocumentType, MemberCategory } from "@/generated/prisma/client";

/** Tope de anexos por solicitud (docs/05 §2). Lo APLICA `uploadDocumentAction`
 *  contando las filas ya guardadas; acá vive el número para que el paso 4 y la
 *  action citen el mismo. */
export const MAX_ANNEXES = 2;

export function requiredDocsComplete(
  docs: Array<{ type: DocumentType }>,
  category: MemberCategory,
): { ok: true } | { ok: false; error: string } {
  const types = new Set(docs.map((d) => d.type));
  if (!types.has("dni_front")) return { ok: false, error: "Falta la foto del frente del DNI." };
  if (!types.has("dni_back")) return { ok: false, error: "Falta la foto del dorso del DNI." };
  // Sólo el colaborador vive fuera del barrio (REG-01), así que es el único que
  // tiene que acreditar la vinculación. Para el resto el anexo es opcional.
  if (category === "collaborator" && !types.has("annex")) {
    return {
      ok: false,
      error:
        "Como colaborador/a tenés que adjuntar al menos un comprobante de vinculación con el barrio (título, factura, etc.).",
    };
  }
  return { ok: true };
}
