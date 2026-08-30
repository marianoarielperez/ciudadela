// Cómo se CARGA un PDF institucional: del id de la URL a los bytes del disco.
// Lo comparten las dos rutas que lo sirven —`/api/mi/documentos/[id]` y
// `/api/admin/documentos/[id]`— y vive acá, y no en uno de los dos `route.ts`,
// por el mismo motivo que `receipt-response.ts`: un route handler de App Router
// está para exportar métodos HTTP, y hacer que una ruta importe a la otra ata
// dos endpoints que no tienen nada que ver salvo el formato de la respuesta.
//
// Las cuatro decisiones de la carga (parseo del id, consulta, revalidación del
// fileName y lectura del disco) viven en UNA función: con una copia por
// handler, alcanza con que alguien toque una para que las dos rutas diverjan en
// silencio — ya pasó, y una mutación que borraba la revalidación del fileName
// en la ruta del panel era invisible para la suite. Es la lección de
// `coverageFloor`: compartir la función, no reimplementarla.
//
// Separado de `response.ts` a propósito: éste arrastra Prisma y `node:fs`, y el
// cliente de Prisma tira al evaluarse si falta `DATABASE_URL`. `response.ts`
// queda puro y se puede importar sin `.env` — mismo criterio que `doc-name.ts`
// frente a `storage.ts`.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { isValidInstitutionalDocFileName } from "@/lib/institutional-documents/doc-name";
import { institutionalDocsDir } from "@/lib/institutional-documents/storage";
import { prisma } from "@/lib/prisma";

/** Lo que las dos rutas leen de la fila, y nada más: un `select` único para que
 *  el panel y el socio no se desincronicen (molde: `RECEIPT_FILE_SELECT`). */
export const INSTITUTIONAL_DOC_FILE_SELECT = { title: true, fileName: true } as const;

/** El id llega como texto de la URL. `Number.isInteger` NO alcanza: para
 *  "999999999999999999999" da `1e21`, que es entero y se colaba al `where` de
 *  Prisma, que tira `PrismaClientValidationError` sin atrapar (500 medido contra
 *  la base real). `isSafeInteger` corta ahí. */
function parseDocId(id: string): number | null {
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Sólo el CÓDIGO del fallo, nunca el `message`: el error de `node:fs` trae la
 *  ruta absoluta de `UPLOADS_DIR` en claro, y eso no va al log (docs/08). */
function codeOf(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && c !== "" ? c : "unknown";
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
  } catch (err) {
    // La respuesta al cliente es el mismo 404 opaco que el de una fila que no
    // existe, y así tiene que ser. Pero "la fila está y el PDF no" es otra cosa:
    // el archivo subido es la ÚNICA copia (la fila no guarda bytes), así que
    // esto es restore parcial o backup incompleto, y es irrecuperable. Este log
    // es el único rastro —el módulo no audita por vista, a propósito—, y al
    // vivir en la carga compartida cubre las dos rutas de una. Sólo el id
    // numérico y el código: ni el fileName ni el `message`, que lleva la ruta
    // absoluta de UPLOADS_DIR. Mismo criterio que `receipt-response.ts`.
    console.error(
      "[documentos] falta en el disco el PDF del documento institucional",
      numericId,
      "code:",
      codeOf(err),
    );
    return null;
  }
}
