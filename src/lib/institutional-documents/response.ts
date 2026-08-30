// Cómo se CARGA y cómo se ENTREGA un PDF institucional. Lo comparten las dos
// rutas que lo sirven —`/api/mi/documentos/[id]` y `/api/admin/documentos/[id]`—
// y vive acá, y no en uno de los dos `route.ts`, por el mismo motivo que
// `receipt-response.ts`: un route handler de App Router está para exportar
// métodos HTTP, y hacer que una ruta importe a la otra ata dos endpoints que no
// tienen nada que ver salvo el formato de la respuesta.
//
// Las cinco decisiones de la carga (parseo del id, consulta, revalidación del
// fileName, lectura del disco y el veredicto 404) viven en UNA función: con una
// copia por handler, alcanza con que alguien toque una para que las dos rutas
// diverjan en silencio — ya pasó, y una mutación que borraba la revalidación del
// fileName en la ruta del panel era invisible para la suite. Es la lección de
// `coverageFloor`: compartir la función, no reimplementarla.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { isValidInstitutionalDocFileName } from "@/lib/institutional-documents/doc-name";
import { institutionalDocsDir } from "@/lib/institutional-documents/storage";
import { prisma } from "@/lib/prisma";

/** Lo que las dos rutas leen de la fila, y nada más: un `select` único para que
 *  el panel y el socio no se desincronicen (molde: `RECEIPT_FILE_SELECT`). */
export const INSTITUTIONAL_DOC_FILE_SELECT = { title: true, fileName: true } as const;

/** El único texto de 404 del módulo. La invariante es que todo lo que no sea
 *  "no hay sesión" responda 404, y con un solo texto la respuesta tampoco
 *  distingue una fila que no existe de un archivo que no está en el disco. */
export const INSTITUTIONAL_DOC_NOT_FOUND = "El documento no existe";

/** El id llega como texto de la URL. `Number.isInteger` NO alcanza: para
 *  "999999999999999999999" da `1e21`, que es entero y se colaba al `where` de
 *  Prisma, que tira `PrismaClientValidationError` sin atrapar (500 medido contra
 *  la base real). `isSafeInteger` corta ahí. */
function parseDocId(id: string): number | null {
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export type InstitutionalDocFile = { bytes: Uint8Array; title: string };

/**
 * Los bytes y el título del documento, o `null` si no hay nada que servir: el
 * id de la URL no sirve, la fila no existe, el `fileName` de la base no valida
 * o el archivo no está en el disco. El llamador lo convierte en 404 — los
 * cuatro casos son el mismo 404 a propósito.
 *
 * La guarda de sesión NO va acá: corre en el handler, ANTES de esta llamada, y
 * por eso una request sin sesión no toca la base.
 */
export async function loadInstitutionalDocFile(id: string): Promise<InstitutionalDocFile | null> {
  const numericId = parseDocId(id);
  if (numericId === null) return null;
  const doc = await prisma.institutionalDocument.findUnique({
    where: { id: numericId },
    select: INSTITUTIONAL_DOC_FILE_SELECT,
  });
  if (!doc) return null;
  // Defensa en profundidad: el fileName viene de la base (lo escribió el
  // storage con un UUID), pero concatenar al filesystem exige revalidar.
  if (!isValidInstitutionalDocFileName(doc.fileName)) return null;
  try {
    const bytes = await readFile(path.join(institutionalDocsDir(), doc.fileName));
    return { bytes, title: doc.title };
  } catch {
    return null;
  }
}

// Respuesta HTTP de un PDF institucional. Cabeceras defensivas calcadas de la
// ruta del estatuto del M5 (que este módulo retira) y de receipt-response.ts:
// inline, sin caché compartida, sin sniffing, CSP con sandbox.
export function institutionalDocResponse(bytes: Uint8Array, downloadName: string): Response {
  // `new Uint8Array(bytes)` normaliza el Buffer de `readFile` a una vista sobre
  // su propio ArrayBuffer: el Buffer de Node comparte un pool, y ese tipo no es
  // el `BodyInit` que espera la Response (mismo motivo y misma línea que
  // `pdfResponse` en receipt-response.ts). Va acá, y no en cada handler, para
  // que las dos rutas no puedan divergir en la normalización ni en las cabeceras.
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${downloadName}"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
