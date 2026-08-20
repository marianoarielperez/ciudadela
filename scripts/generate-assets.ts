// Genera los derivados de assets/logo.png y assets/hero.jpg. Se corre UNA
// vez (npx tsx scripts/generate-assets.ts) y los resultados se commitean:
// no es parte del build.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

async function main() {
  await mkdir("public", { recursive: true });
  // Logo del header: se renderiza a 40px de alto; 160px de fuente alcanza
  // para pantallas 4x. De 363 KB a unos pocos KB.
  await sharp("assets/logo.png")
    .resize({ height: 160 })
    .png({ compressionLevel: 9 })
    .toFile("public/logo-header.png");
  // Favicons PNG (Next los sirve por convención de nombre en src/app/).
  await sharp("assets/logo.png")
    .resize(512, 512, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile("src/app/icon.png");
  await sharp("assets/logo.png")
    .resize(180, 180, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile("src/app/apple-icon.png");
  // Open Graph por defecto: el hero recortado a 1200x630. La extensión es .jpg
  // y no .png porque el contenido es JPEG: Next deriva el Content-Type del
  // nombre del archivo, así que un JPEG llamado .png se anunciaría como
  // image/png y quedaría a merced de que cada scraper adivine bien.
  await sharp("assets/hero.jpg")
    .resize(1200, 630, { fit: "cover" })
    .jpeg({ quality: 80 })
    .toFile("src/app/opengraph-image.jpg");
  console.log("assets generados");
}

main();
