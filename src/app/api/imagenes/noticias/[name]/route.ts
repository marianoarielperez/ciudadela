// Sirve las portadas de noticias. PÚBLICO a propósito (ver images.ts). La
// validación estricta del nombre es la defensa contra path traversal: nada
// que no sea `uuid.ext` de la allowlist toca el filesystem.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isValidNewsImageName, newsImagesDir } from "@/lib/news/images";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(_req: Request, ctx: RouteContext<"/api/imagenes/noticias/[name]">) {
  const { name } = await ctx.params;
  if (!isValidNewsImageName(name)) {
    return new Response("Not found", { status: 404 });
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(newsImagesDir(), name));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const ext = name.slice(name.lastIndexOf(".") + 1);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      // El nombre es un UUID: el contenido de una URL dada no cambia nunca.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
