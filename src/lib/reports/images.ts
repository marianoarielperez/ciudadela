// Re-codificación de TODA imagen de un reporte con sharp (spec §5, docs/08):
// se aplica la orientación EXIF, se acota el lado mayor y se escribe un JPEG
// sin metadatos — o sea sin el GPS que el celular graba en cada foto, que en un
// reclamo suele ser la casa del vecino. sharp ya es dependencia de runtime
// (`scripts/generate-assets.ts`); acá es la primera vez que corre en un request.
//
// Sin `.withMetadata()`: es lo que conserva el EXIF, y no llamarlo es lo que lo
// borra. Un test verifica que `metadata().exif` sale undefined.
//
// Este módulo importa sharp (binario nativo): NO importarlo desde un client
// component ni desde un módulo que un test puro quiera cargar sin él.
import sharp from "sharp";

export const PHOTO_MAX_SIDE = 1600;
export const DNI_MAX_SIDE = 2000;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Magic bytes, nunca extensión ni Content-Type del cliente. Sólo imágenes: a
 *  diferencia de `sniffDocument`, acá un PDF no es un formato admitido. */
export function sniffImage(buf: Buffer): "jpg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export async function processImage(
  input: Buffer,
  opts: { maxSide: number; quality?: number },
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input, { failOn: "error" })
    // `rotate()` sin argumento aplica la orientación EXIF y la descarta: la
    // foto queda derecha "de verdad" y no por un tag que el PDF no lee.
    .rotate()
    .resize({ width: opts.maxSide, height: opts.maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: opts.quality ?? 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
