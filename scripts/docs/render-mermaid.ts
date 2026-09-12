// Renderiza a PNG los diagramas Mermaid de la documentación. Uso:
//   npm run docs:mermaid                                  (todos los de img/r1)
//   npm run docs:mermaid docs/manuales/img/r1/01-padron.mmd
// Usa playwright-core sobre el Chrome instalado (igual que las capturas: no
// descarga navegadores) y carga Mermaid desde cdnjs, así que necesita internet.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";

// Versión fijada a propósito: con `latest` un cambio del CDN cambiaría los
// diagramas sin que nadie toque un `.mmd`.
const MERMAID_URL = "https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.6.0/mermaid.min.js";
const DEFAULT_DIR = join(process.cwd(), "docs", "manuales", "img", "r1");
const USAGE = "uso: npm run docs:mermaid [archivo.mmd …]";
// El SVG se pinta a su tamaño natural y la foto se saca al doble: el diagrama
// entra en el Word a 12-16 cm y a escala 1 el texto sale borroso al imprimir.
const DEVICE_SCALE = 2;

/** La parte de la API de Mermaid que se usa acá. */
type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, definition: string): Promise<{ svg: string }>;
};

/** Un error previsto: se informa con su mensaje pelado, sin stack. */
class DiagramError extends Error {}

/** Corta la corrida. NO llama a `process.exit`: el error sube hasta `main`, que
 *  cierra el navegador en su `finally` antes de salir con 1. */
function fail(message: string): never {
  throw new DiagramError(message);
}

/** Lo mismo, para un error de invocación: agrega la línea de uso. */
function usageError(message: string): never {
  throw new DiagramError(`${message}
${USAGE}`);
}

/** Los `.mmd` pedidos, o todos los de `docs/manuales/img/r1` si no se pidió ninguno. */
function targets(argv: string[]): string[] {
  if (argv.length) {
    return argv.map((arg) => {
      const path = resolve(arg);
      if (!path.endsWith(".mmd")) usageError(`no es un diagrama Mermaid: ${arg}`);
      if (!existsSync(path)) usageError(`no existe: ${arg}`);
      return path;
    });
  }
  if (!existsSync(DEFAULT_DIR)) usageError(`no existe la carpeta de diagramas: ${DEFAULT_DIR}`);
  const found = readdirSync(DEFAULT_DIR)
    .filter((f) => f.endsWith(".mmd"))
    .sort()
    .map((f) => join(DEFAULT_DIR, f));
  if (!found.length) usageError(`no hay ningún .mmd en ${DEFAULT_DIR}`);
  return found;
}

/** Página en blanco con Mermaid cargado y listo para renderizar. */
async function prepare(page: Page): Promise<void> {
  await page.setContent(
    `<style>body{margin:0;background:#fff}#out{display:inline-block;background:#fff}</style>` +
      `<div id="out"></div><script src="${MERMAID_URL}"></script>`,
    { waitUntil: "load" },
  );
  const ready = await page
    .waitForFunction(() => Boolean((window as unknown as { mermaid?: MermaidApi }).mermaid), undefined, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!ready) fail(`no se pudo cargar Mermaid desde ${MERMAID_URL} (¿hay internet?)`);
  await page.evaluate(() => {
    (window as unknown as { mermaid: MermaidApi }).mermaid.initialize({
      startOnLoad: false,
      theme: "neutral",
      fontFamily: "Calibri, Segoe UI, sans-serif",
      // `useMaxWidth: false` es lo que deja al SVG con su tamaño natural: con el
      // default, el ancho sale en porcentaje y la foto dependería del viewport.
      er: { useMaxWidth: false },
    });
  });
}

/** Renderiza un `.mmd` y deja el PNG al lado, con el mismo nombre. */
async function renderOne(page: Page, file: string): Promise<void> {
  const source = readFileSync(file, "utf8");
  const out = join(dirname(file), `${basename(file, extname(file))}.png`);

  // Un error de sintaxis de Mermaid viaja como excepción del `render`: se
  // devuelve el mensaje en vez de tirarlo para poder nombrar el archivo.
  const error = await page.evaluate(async (definition) => {
    const mermaid = (window as unknown as { mermaid: MermaidApi }).mermaid;
    const host = document.getElementById("out");
    if (!host) return "falta el contenedor de la página";
    host.innerHTML = "";
    try {
      const { svg } = await mermaid.render(`d${Date.now()}`, definition);
      host.innerHTML = svg;
    } catch (err) {
      // Mermaid deja su propio cartel de error en el body cuando falla.
      document.querySelectorAll("[id^=d]").forEach((el) => el.remove());
      return err instanceof Error ? err.message : String(err);
    }
    // El SVG sale con `width` relativo: se lo fija a su tamaño natural para que
    // la foto no dependa del viewport.
    const svgEl = host.querySelector("svg");
    if (!svgEl) return "Mermaid no devolvió ningún SVG";
    const box = svgEl.viewBox.baseVal;
    if (box.width > 0 && box.height > 0) {
      svgEl.setAttribute("width", String(Math.ceil(box.width)));
      svgEl.setAttribute("height", String(Math.ceil(box.height)));
      svgEl.style.maxWidth = "none";
    }
    return null;
  }, source);

  if (error) fail(`error de Mermaid en ${file}:
${error}`);

  // El viewport se agranda hasta el diagrama: una foto de elemento más grande
  // que la ventana sale recortada.
  const size = await page.evaluate(() => {
    const el = document.querySelector("#out svg");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  });
  if (!size) fail(`no quedó ningún SVG después de renderizar ${file}`);
  await page.setViewportSize({ width: Math.max(size.width + 40, 400), height: Math.max(size.height + 40, 300) });

  const element = await page.$("#out svg");
  if (!element) fail(`no quedó ningún SVG después de renderizar ${file}`);
  await element.screenshot({ path: out, omitBackground: false });
  console.log(`ok  ${basename(out)}  ${size.width}×${size.height}`);
}

async function main() {
  const files = targets(process.argv.slice(2));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: DEVICE_SCALE });
    const page = await ctx.newPage();
    await prepare(page);
    for (const file of files) await renderOne(page, file);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof DiagramError ? err.message : err);
  process.exit(1);
});
