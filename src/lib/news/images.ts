// Portadas de noticias. Viven en UPLOADS_DIR/news (fuera de public/ y del
// repo: sobreviven deploys y no se versionan), pero a diferencia de los
// documentos personales del M3 se sirven SIN autenticación: una portada de
// noticia es contenido público por definición (excepción documentada en
// CLAUDE.md, spec §5). El nombre UUID hace al contenido inmutable → el route
// handler puede cachear a un año.
//
// La excepción vale SOLO para portadas de noticias. Los DNIs y facturas del
// Módulo 3 mantienen la regla original: API route autenticada.
//
// Este módulo importa node:fs — NO lo importes desde un client component (para
// eso está @/lib/news/image-url, que es puro).
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidNewsImageName } from "@/lib/news/image-url";

export { isValidNewsImageName, newsImageUrl } from "@/lib/news/image-url";

export const MAX_COVER_BYTES = 5 * 1024 * 1024;

export function uploadsDir(): string {
  return process.env.UPLOADS_DIR ?? "./uploads";
}

export function newsImagesDir(): string {
  return path.join(uploadsDir(), "news");
}

// Magic bytes, no extensión ni Content-Type del cliente: los dos los elige
// el atacante.
export function sniffImageExt(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "webp";
  return null;
}

export async function saveNewsCover(
  file: File,
): Promise<{ ok: true; fileName: string } | { ok: false; error: string }> {
  if (file.size === 0) return { ok: false, error: "El archivo de imagen llegó vacío." };
  if (file.size > MAX_COVER_BYTES) {
    return { ok: false, error: "La imagen no puede superar los 5 MB." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImageExt(bytes);
  if (!ext) return { ok: false, error: "Formato no soportado: subí una imagen JPG, PNG o WebP." };
  const fileName = `${crypto.randomUUID()}.${ext}`;
  await mkdir(newsImagesDir(), { recursive: true });
  await writeFile(path.join(newsImagesDir(), fileName), bytes);
  return { ok: true, fileName };
}

// Borra la portada al reemplazarla o eliminar la noticia. ENOENT no es error:
// si el archivo ya no está, el estado final es el buscado.
export async function deleteNewsCover(fileName: string): Promise<void> {
  if (!isValidNewsImageName(fileName)) return;
  try {
    await unlink(path.join(newsImagesDir(), fileName));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
