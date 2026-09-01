// El límite del barrio Ciudadela, transcripto de `datos/limites-barrio.kml`
// (Placemark "Ciudadela", zona 14, circ. 5, sector 2; 20 vértices). Módulo PURO.
//
// Lo usan: el picker de ubicación del wizard (dibuja el contorno y encuadra el
// mapa), el mapa del admin, la silueta de la landing y del PDF, y
// `isInsideBoundary`, que marca `outsideBoundary` al enviar (spec §2: avisa y
// deja enviar; el admin ve la marca).
//
// Un test coteja esta constante contra el KML del repo, así que si el catastro
// cambia el archivo hay que tocar los dos.

/** Anillo cerrado en `[lat, lng]` (el KML viene como `lng,lat,0`). */
export const BARRIO_BOUNDARY: ReadonlyArray<readonly [number, number]> = [
  [-45.7966490548311, -67.5203381725855],
  [-45.7966335782021, -67.5203280279532],
  [-45.7928430848157, -67.5188696590574],
  [-45.7940202415481, -67.51334411454209],
  [-45.794915604367, -67.5089586426202],
  [-45.7953025975264, -67.5066823686993],
  [-45.7949679125177, -67.4990625336321],
  [-45.7947383310676, -67.49232330385411],
  [-45.796607286277, -67.4911369235349],
  [-45.7969768316563, -67.4908421414154],
  [-45.7973467462658, -67.4904607117541],
  [-45.7984235741003, -67.491202922399],
  [-45.7988017803042, -67.49389473238961],
  [-45.7987891434985, -67.4989238432735],
  [-45.8004740087592, -67.4990030629226],
  [-45.8008571551678, -67.4998220744812],
  [-45.8000257329911, -67.50169155484549],
  [-45.7985520854542, -67.5080535847346],
  [-45.79863034344049, -67.5139613348763],
  [-45.7966490548311, -67.5203381725855],
];

const lats = BARRIO_BOUNDARY.map((p) => p[0]);
const lngs = BARRIO_BOUNDARY.map((p) => p[1]);

export const BARRIO_BOUNDS = {
  south: Math.min(...lats),
  north: Math.max(...lats),
  west: Math.min(...lngs),
  east: Math.max(...lngs),
} as const;

export const BARRIO_CENTER: readonly [number, number] = [
  (BARRIO_BOUNDS.south + BARRIO_BOUNDS.north) / 2,
  (BARRIO_BOUNDS.west + BARRIO_BOUNDS.east) / 2,
];

/** Ray casting clásico (par-impar). Un punto sobre el borde puede caer de
 *  cualquiera de los dos lados: no importa, la marca es un aviso, no una guarda. */
export function isInsideBoundary(lat: number, lng: number): boolean {
  if (lat < BARRIO_BOUNDS.south || lat > BARRIO_BOUNDS.north) return false;
  if (lng < BARRIO_BOUNDS.west || lng > BARRIO_BOUNDS.east) return false;
  let inside = false;
  const n = BARRIO_BOUNDARY.length - 1; // el último repite al primero
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = BARRIO_BOUNDARY[i];
    const [yj, xj] = BARRIO_BOUNDARY[j];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** La silueta del barrio como `d` de un `<path>` SVG que entra en `width`×`height`
 *  con `padding` de margen, conservando la proporción (proyección equirrectangular
 *  corregida por la latitud media: a 45° S un grado de longitud mide ~0,7 de uno
 *  de latitud, y sin la corrección el barrio sale aplastado). */
export function boundaryToSvgPath(width: number, height: number, padding = 4): string {
  const cos = Math.cos((BARRIO_CENTER[0] * Math.PI) / 180);
  const pts = BARRIO_BOUNDARY.slice(0, -1).map(([lat, lng]) => ({ x: lng * cos, y: -lat }));
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const fmt = (n: number) => n.toFixed(2);
  return (
    pts
      .map((p, i) => {
        const x = fmt(offsetX + (p.x - minX) * scale);
        const y = fmt(offsetY + (p.y - minY) * scale);
        return `${i === 0 ? "M" : "L"}${x} ${y}`;
      })
      .join(" ") + " Z"
  );
}
