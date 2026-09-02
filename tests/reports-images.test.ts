// Toda imagen de un reporte pasa por sharp (spec §5): orientación aplicada,
// JPEG sin metadatos (adiós al GPS del celular), lado mayor acotado. Lo que
// docs/08 prometía y no existía. Se prueba con sharp real sobre imágenes
// generadas acá mismo.
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { DNI_MAX_SIDE, PHOTO_MAX_SIDE, processImage, sniffImage } from "@/lib/reports/images";

async function jpegWithExif(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: "vecino", ImageDescription: "gps-like" } } })
    .toBuffer();
}

describe("sniffImage", () => {
  it("reconoce jpg, png y webp por magic bytes y rechaza el resto", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } })
      .webp()
      .toBuffer();
    expect(sniffImage(await jpegWithExif(2, 2))).toBe("jpg");
    expect(sniffImage(png)).toBe("png");
    expect(sniffImage(webp)).toBe("webp");
    expect(sniffImage(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(sniffImage(Buffer.from("<html>"))).toBeNull();
  });
});

describe("processImage", () => {
  it("devuelve JPEG sin EXIF y con las medidas finales", async () => {
    const out = await processImage(await jpegWithExif(400, 300), { maxSide: PHOTO_MAX_SIDE });
    expect(sniffImage(out.data)).toBe("jpg");
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(out.width).toBe(400);
    expect(out.height).toBe(300);
  });

  it("acota el lado mayor sin agrandar las chicas", async () => {
    const big = await sharp({
      create: { width: 4000, height: 2000, channels: 3, background: "#ccc" },
    })
      .png()
      .toBuffer();
    const out = await processImage(big, { maxSide: PHOTO_MAX_SIDE });
    expect(out.width).toBe(1600);
    expect(out.height).toBe(800);
    const small = await processImage(await jpegWithExif(100, 50), { maxSide: DNI_MAX_SIDE });
    expect(small.width).toBe(100);
  });

  it("convierte webp a JPEG (pdf-lib sólo embebe PNG y JPEG)", async () => {
    const webp = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#123" } })
      .webp()
      .toBuffer();
    const out = await processImage(webp, { maxSide: PHOTO_MAX_SIDE });
    expect(sniffImage(out.data)).toBe("jpg");
  });

  it("aplica la orientación EXIF: una foto marcada como rotada 90° sale con los lados invertidos", async () => {
    const rotated = await sharp({
      create: { width: 200, height: 100, channels: 3, background: "#f00" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await processImage(rotated, { maxSide: PHOTO_MAX_SIDE });
    expect(out.width).toBe(100);
    expect(out.height).toBe(200);
  });

  it("un archivo que no es imagen tira", async () => {
    await expect(
      processImage(Buffer.from("no soy una imagen"), { maxSide: 100 }),
    ).rejects.toThrow();
  });
});
