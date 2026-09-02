// El mini-mapa del PDF: la aritmética slippy-map (pura) y la composición con
// sharp usando un `fetch` FALSO que devuelve tiles de color. Nada de red.
//
// Lo que estos casos sostienen, y que se verificó BORRÁNDOLO y viendo el test en
// rojo antes de restaurarlo:
//  - la inversión TMS de la `y` del IGN (sin ella la URL pide otro tile del
//    mundo, que existe: el error sería un mapa plausible y equivocado);
//  - el `if (!res.ok) throw` (sin él un 503 se compone como si fuera un PNG);
//  - el fallback a OSM (sin él, IGN caído = sin mapa);
//  - la carrera contra el temporizador (sin ella, el caso del `fetch` colgado
//    no vuelve nunca y el test se cuelga en vez de fallar).
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { pixelInTile, renderStaticMap, tileFor } from "@/lib/reports/static-map";

// Coordenadas de la sede (`SITE.lat/lng`). Los números esperados NO se copian
// de ningún visor: se recalcularon a mano con la fórmula estándar
// (`x = floor((lng+180)/360 · 2^z)`, `y` por la Mercator inversa) porque el
// borrador de la tarea traía otro par. Verificación independiente al pie.
const SEDE_LAT = -45.79713687;
const SEDE_LNG = -67.494067;

describe("tileFor / pixelInTile", () => {
  it("la sede a zoom 16 cae en el tile 20481/42167", () => {
    expect(tileFor(SEDE_LAT, SEDE_LNG, 16)).toEqual({ x: 20481, y: 42167 });
    const p = pixelInTile(SEDE_LAT, SEDE_LNG, 16);
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThan(256);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThan(256);
  });

  // Anclas independientes de la fórmula: a zoom 0 todo el planeta es un tile, y
  // a zoom 1 el hemisferio y el meridiano parten el mundo en cuatro cuadrantes.
  // Si alguien invierte un signo, esto se cae antes que el caso de la sede.
  it("zoom 0 es un solo tile y zoom 1 parte el mundo en cuadrantes", () => {
    expect(tileFor(0, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(tileFor(10, -10, 1)).toEqual({ x: 0, y: 0 }); // NO
    expect(tileFor(10, 10, 1)).toEqual({ x: 1, y: 0 }); // NE
    expect(tileFor(-10, -10, 1)).toEqual({ x: 0, y: 1 }); // SO
    expect(tileFor(-10, 10, 1)).toEqual({ x: 1, y: 1 }); // SE
  });

  it("el píxel dentro del tile es coherente con el tile: mundo = tile·256 + píxel", () => {
    // A zoom 3 el mundo mide 2048 px: se reconstruye la coordenada absoluta
    // desde las dos funciones y se compara con la fórmula escrita acá.
    const lat = -45.797;
    const lng = -67.494;
    const t = tileFor(lat, lng, 3);
    const p = pixelInTile(lat, lng, 3);
    const n = 2 ** 3 * 256;
    const worldX = ((lng + 180) / 360) * n;
    const rad = (lat * Math.PI) / 180;
    const worldY = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
    expect(t.x * 256 + p.px).toBe(Math.floor(worldX));
    expect(t.y * 256 + p.py).toBe(Math.floor(worldY));
  });
});

const tile = async () =>
  sharp({ create: { width: 256, height: 256, channels: 3, background: "#dde" } })
    .png()
    .toBuffer();

describe("renderStaticMap", () => {
  it("compone 3×3 tiles del IGN, recorta a 600×400 y dibuja el pin", async () => {
    const fetchFn = vi.fn(async (_url: string) => new Response(new Uint8Array(await tile()), { status: 200 }));
    const png = await renderStaticMap({
      lat: SEDE_LAT,
      lng: SEDE_LNG,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(png).not.toBeNull();
    const meta = await sharp(png!).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(400);
    expect(meta.format).toBe("png");
    expect(fetchFn).toHaveBeenCalledTimes(9);

    // El primer pedido es la esquina noroeste (dx=-1, dy=-1) del tile 20481/42167,
    // con la `y` INVERTIDA porque el IGN es TMS: 2^16 - 1 - 42166 = 23369.
    const first = String(fetchFn.mock.calls[0][0]);
    expect(first).toContain("wms.ign.gob.ar");
    expect(first.endsWith("/16/20480/23369.png")).toBe(true);
    // Y las nueve son tiles distintos: un mosaico de nueve copias del mismo
    // tile pasaría todas las aserciones de tamaño.
    expect(new Set(fetchFn.mock.calls.map((c) => String(c[0]))).size).toBe(9);
  });

  it("con el IGN caído prueba OSM; con los dos caídos devuelve null", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.includes("ign")
        ? new Response("", { status: 503 })
        : new Response(new Uint8Array(await tile()), { status: 200 }),
    );
    const png = await renderStaticMap({
      lat: SEDE_LAT,
      lng: SEDE_LNG,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(png).not.toBeNull();
    expect(fetchFn.mock.calls.some((c) => String(c[0]).includes("openstreetmap"))).toBe(true);

    const dead = vi.fn(async () => new Response("", { status: 503 }));
    expect(
      await renderStaticMap({
        lat: SEDE_LAT,
        lng: SEDE_LNG,
        fetchFn: dead as unknown as typeof fetch,
      }),
    ).toBeNull();
  });

  it("un tile que no es una imagen no tira: devuelve null", async () => {
    const junk = vi.fn(async () => new Response("no soy un png", { status: 200 }));
    expect(
      await renderStaticMap({
        lat: SEDE_LAT,
        lng: SEDE_LNG,
        fetchFn: junk as unknown as typeof fetch,
      }),
    ).toBeNull();
  });

  it("un fetch que cuelga vence por timeout y devuelve null", async () => {
    // El fake IGNORA el `AbortSignal` a propósito: es el servidor que acepta la
    // conexión y no contesta. Sin la carrera contra el temporizador, esto no
    // vuelve nunca.
    const hang = vi.fn(() => new Promise<Response>(() => {}));
    expect(
      await renderStaticMap({
        lat: SEDE_LAT,
        lng: SEDE_LNG,
        fetchFn: hang as unknown as typeof fetch,
        timeoutMs: 50,
      }),
    ).toBeNull();
  });

  it("un recorte más grande que el mosaico se acota en vez de romper sharp", async () => {
    const fetchFn = vi.fn(async (_url: string) => new Response(new Uint8Array(await tile()), { status: 200 }));
    const png = await renderStaticMap({
      lat: SEDE_LAT,
      lng: SEDE_LNG,
      width: 2000,
      height: 2000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const meta = await sharp(png!).metadata();
    expect(meta.width).toBe(768);
    expect(meta.height).toBe(768);
  });
});
