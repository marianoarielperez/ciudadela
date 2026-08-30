// Escritura y borrado de los PDFs institucionales. Viven en
// UPLOADS_DIR/institucional (fuera de public/ y del repo; backup.sh ya cubre
// UPLOADS_DIR entero) y se sirven SOLO por rutas autenticadas — el socio por
// /api/mi/documentos/[id], el admin por /api/admin/documentos/[id].
//
// Este módulo importa node:fs — NO importarlo desde un client component (para
// eso está ./doc-name, que es puro).
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { uploadsDir } from "@/lib/news/images";
import { isValidInstitutionalDocFileName } from "@/lib/institutional-documents/doc-name";

export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export function institutionalDocsDir(): string {
  return path.join(uploadsDir(), "institucional");
}

// Magic bytes, no extensión ni Content-Type del cliente. La allowlist es PDF y
// nada más: un documento institucional publicado a socios se abre inline en el
// navegador, y cualquier otro formato es un error de carga, no una variante.
export function sniffPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d //    -
  );
}

export async function saveInstitutionalDocument(
  file: File,
): Promise<{ ok: true; fileName: string; size: number } | { ok: false; error: string }> {
  if (file.size === 0) return { ok: false, error: "El archivo llegó vacío." };
  if (file.size > MAX_DOC_BYTES) {
    return { ok: false, error: "El PDF no puede superar los 10 MB." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Dos veces a propósito: `file.size` lo declara el caller y un File sintético
  // puede mentir; el límite real se aplica sobre los bytes que van al disco.
  if (bytes.length > MAX_DOC_BYTES) {
    return { ok: false, error: "El PDF no puede superar los 10 MB." };
  }
  if (!sniffPdf(bytes)) {
    return { ok: false, error: "Formato no soportado: subí el documento en PDF." };
  }
  const fileName = `${crypto.randomUUID()}.pdf`;
  await mkdir(institutionalDocsDir(), { recursive: true });
  await writeFile(path.join(institutionalDocsDir(), fileName), bytes);
  return { ok: true, fileName, size: bytes.length };
}

// ENOENT no es error: si el archivo ya no está, el estado final es el buscado.
export async function deleteInstitutionalDocument(fileName: string): Promise<void> {
  if (!isValidInstitutionalDocFileName(fileName)) return;
  try {
    await unlink(path.join(institutionalDocsDir(), fileName));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
