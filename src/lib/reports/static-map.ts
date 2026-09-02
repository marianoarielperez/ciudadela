// El mini-mapa que va adentro del PDF de un reporte (spec §5 y §7): 3×3 tiles
// del IGN alrededor del punto, compuestos con sharp, recortados a 600×400, con
// el contorno del barrio y el pin de marca encima. Sin dependencia nueva: sharp
// ya estaba (`images.ts`) y los tiles se piden con `fetch`.
//
// Tres decisiones que no se ven en la imagen:
//
//  1. **El `fetch` se INYECTA.** Los tests componen el mosaico con tiles de
//     color y no tocan la red — misma regla que `makeMpGateway()` con el SDK de
//     Mercado Pago: el dominio no ve el transporte.
//  2. **Falla SUAVE y con presupuesto de tiempo.** Un `null` acá no es un error:
//     el PDF sale sin mapa y con una línea que lo dice. Un reclamo que no se
//     puede imprimir porque el IGN está caído es peor que un reclamo sin foto
//     aérea. El timeout es del PEDIDO ENTERO (los dos proveedores comparten el
//     presupuesto) y NO se delega sólo al `AbortSignal`: un servidor que acepta
//     la conexión y después no contesta nada deja el `fetch` colgado sin que el
//     abort lo despierte en todos los runtimes, así que la carrera contra el
//     temporizador es la que corta de verdad.
//  3. **Sin `withMetadata()`**, igual que `images.ts`: lo que sale es un PNG
//     pelado, sin EXIF ni perfil de color heredado del tile.
import sharp from "sharp";
import { IGN_TILE_URL, INITIAL_ZOOM, OSM_TILE_URL } from "@/app/(public)/ubicacion/map-config";
import { pinSvg, PIN_ANCHOR, PIN_SIZE } from "@/components/map/brand-pin";
import { BARRIO_BOUNDARY } from "./boundary";

const TILE = 256;
/** 3×3 tiles: 768×768 px de lienzo, que es lo que acota el recorte máximo. */
const GRID = 3;
const MOSAIC = TILE * GRID;

export const STATIC_MAP_WIDTH = 600;
export const STATIC_MAP_HEIGHT = 400;
export const STATIC_MAP_TIMEOUT_MS = 4000;

/** Color de marca (`--primary`), el mismo del pin y de la silueta del PDF. */
const PRIMARY = "#0079BC";

/** Punto en píxeles ABSOLUTOS del mundo en ese zoom (Web Mercator / slippy map).
 *  Es la primitiva de la que salen `tileFor`, `pixelInTile` y la proyección del
 *  contorno: escribir la fórmula una sola vez es lo que garantiza que el pin y
 *  el polígono caigan en el mismo lugar. */
function worldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom * TILE;
  const rad = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/** El tile que contiene al punto (`x = floor((lng+180)/360 · 2^z)`, `y` por la
 *  Mercator inversa). Es la numeración XYZ estándar, la misma de Leaflet. */
export function tileFor(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const p = worldPixel(lat, lng, zoom);
  return { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
}

/** Dónde cae el punto DENTRO de su tile, en píxeles (0-255). */
export function pixelInTile(lat: number, lng: number, zoom: number): { px: number; py: number } {
  const p = worldPixel(lat, lng, zoom);
  return { px: Math.floor(p.x) % TILE, py: Math.floor(p.y) % TILE };
}

/** El IGN publica su capa como TMS: la `y` va invertida respecto de XYZ (en el
 *  mapa del navegador lo compensa `tms: true` de `IGN_TILE_OPTIONS`; acá, que no
 *  hay Leaflet, se compensa a mano). Pedirla sin invertir devuelve un tile
 *  válido de otro lugar del mundo, no un 404: el error sería un mapa plausible
 *  y equivocado. */
function ignUrl(z: number, x: number, y: number): string {
  const tmsY = 2 ** z - 1 - y;
  return IGN_TILE_URL.replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(tmsY));
}

function osmUrl(z: number, x: number, y: number): string {
  return OSM_TILE_URL.replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/** El contorno del barrio proyectado al recorte. Se dibuja SIN relleno: a zoom
 *  16 el barrio es mucho más ancho que 600 px, así que lo que se ve es el tramo
 *  de límite que pasa cerca del punto — que es justo el dato útil cuando el
 *  reporte está marcado como `outsideBoundary`. */
function boundarySvg(
  width: number,
  height: number,
  project: (lat: number, lng: number) => { x: number; y: number },
): string {
  const d =
    BARRIO_BOUNDARY.map(([lat, lng], i) => {
      const p = project(lat, lng);
      return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }).join(" ") + " Z";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<path d="${d}" fill="none" stroke="${PRIMARY}" stroke-width="3" stroke-opacity="0.8" stroke-linejoin="round"/>` +
    "</svg>"
  );
}

export type StaticMapOptions = {
  lat: number;
  lng: number;
  zoom?: number;
  width?: number;
  height?: number;
  /** Inyectable: los tests componen sin red. */
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

/** PNG del mini-mapa, o `null` si no se pudo. NUNCA tira: el llamador (la ruta
 *  del PDF) trata el `null` como "sale sin mapa". */
export async function renderStaticMap(opts: StaticMapOptions): Promise<Buffer | null> {
  const zoom = opts.zoom ?? INITIAL_ZOOM;
  // El recorte no puede ser más grande que el mosaico: pedir 900 px de ancho
  // haría fallar el `extract` de sharp con un error de sharp, no con un `null`.
  const width = Math.min(opts.width ?? STATIC_MAP_WIDTH, MOSAIC);
  const height = Math.min(opts.height ?? STATIC_MAP_HEIGHT, MOSAIC);
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? STATIC_MAP_TIMEOUT_MS;

  const center = tileFor(opts.lat, opts.lng, zoom);
  const offset = pixelInTile(opts.lat, opts.lng, zoom);

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // La carrera es el corte REAL (ver la nota 2 de la cabecera); el `abort()`
  // está igual para que el `fetch` de verdad suelte la conexión.
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  /** Los nueve tiles de un proveedor, o `null` si alguno falla. Un tile suelto
   *  perdido deja un agujero en el mosaico: se prefiere probar el otro
   *  proveedor entero antes que imprimir un mapa con parches grises. */
  async function grab(urlFor: (z: number, x: number, y: number) => string) {
    try {
      return await Promise.all(
        [-1, 0, 1].flatMap((dy) =>
          [-1, 0, 1].map(async (dx) => {
            const res = await fetchFn(urlFor(zoom, center.x + dx, center.y + dy), {
              signal: controller.signal,
              // La política de uso de los tiles de OSM exige identificar al
              // cliente; el IGN no lo pide y no le molesta.
              headers: { "User-Agent": "SIGeV/1.0 (vecinalciudadela.ar)" },
            });
            if (!res.ok) throw new Error(`tile ${res.status}`);
            return Buffer.from(await res.arrayBuffer());
          }),
        ),
      );
    } catch {
      return null;
    }
  }

  try {
    const tiles = await Promise.race([
      (async () => (await grab(ignUrl)) ?? (await grab(osmUrl)))(),
      expired,
    ]);
    if (!tiles) return null;

    const mosaic = await sharp({
      create: { width: MOSAIC, height: MOSAIC, channels: 3, background: "#e5e7eb" },
    })
      .composite(
        tiles.map((input, i) => ({
          input,
          left: (i % GRID) * TILE,
          top: Math.floor(i / GRID) * TILE,
        })),
      )
      .png()
      .toBuffer();

    // El punto, en píxeles del mosaico: el tile del centro arranca en (256,256).
    const cx = TILE + offset.px;
    const cy = TILE + offset.py;
    // Recorte centrado en el punto, sin salirse del mosaico (cerca del borde de
    // un tile el punto queda descentrado, que es preferible a una franja gris).
    const left = Math.round(Math.max(0, Math.min(MOSAIC - width, cx - width / 2)));
    const top = Math.round(Math.max(0, Math.min(MOSAIC - height, cy - height / 2)));

    // Origen del recorte en píxeles del mundo: con eso el contorno y el pin se
    // proyectan con la MISMA fórmula que ubicó al centro.
    const originX = (center.x - 1) * TILE + left;
    const originY = (center.y - 1) * TILE + top;
    const project = (lat: number, lng: number) => {
      const p = worldPixel(lat, lng, zoom);
      return { x: p.x - originX, y: p.y - originY };
    };

    const pinX = clamp(cx - left - PIN_ANCHOR[0], 0, width - PIN_SIZE[0]);
    const pinY = clamp(cy - top - PIN_ANCHOR[1], 0, height - PIN_SIZE[1]);

    return await sharp(mosaic)
      .extract({ left, top, width, height })
      .composite([
        { input: Buffer.from(boundarySvg(width, height, project)), left: 0, top: 0 },
        { input: Buffer.from(pinSvg(PRIMARY)), left: pinX, top: pinY },
      ])
      .png()
      .toBuffer();
  } catch {
    // Un tile que no es una imagen, un sharp que no puede componer: el PDF sale
    // sin mapa. Acá no se loguea la URL (no aporta y ensucia el log del cron).
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** `left`/`top` de un composite de sharp tienen que caer dentro del lienzo: un
 *  valor negativo tira. Sólo pasa con el punto pegado al borde del recorte. */
function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}
