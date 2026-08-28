// Config del mapa de /ubicacion. Módulo PURO: sin "use client" y sin importar
// Leaflet, para que la página (Server Component), el componente cliente del
// mapa y los tests consuman UNA sola fuente de URLs, zooms y atribuciones.

// URL TMS oficial del IGN. Ojo: el IGN la publica con `{-y}` (sintaxis TMS);
// Leaflet no interpola `{-y}` — se escribe `{y}` y se compensa con `tms: true`
// en las opciones. Verificado contra el servicio vivo el 28/08/2026
// (HTTPS, CORS abierto, sin API key; ver spec §2).
export const IGN_TILE_URL =
  "https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/capabaseargenmap@EPSG:3857@png/{z}/{x}/{y}.png";

// maxZoom 19: hay tiles hasta z=21 pero desde z=20 es sobre-zoom (geometría
// estirada); 19 es donde corta el visor oficial del IGN.
export const IGN_TILE_OPTIONS = { tms: true, minZoom: 3, maxZoom: 19 } as const;

// Atribución OBLIGATORIA: la capa base del IGN integra datos de OSM bajo ODbL,
// así que el crédito es doble (texto del visor oficial del IGN).
export const IGN_ATTRIBUTION =
  '<a href="https://www.ign.gob.ar/AreaServicios/Argenmap/Introduccion" target="_blank" rel="noopener noreferrer">Instituto Geográfico Nacional</a>' +
  ' + <a href="https://www.osm.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

// Fallback si el IGN no responde (99,3% de disponibilidad medida: pasa poco,
// pero pasa). OSM era el proveedor anterior de esta página.
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION =
  '<a href="https://www.osm.org/copyright" target="_blank" rel="noopener noreferrer">© Colaboradores de OpenStreetMap</a>';

export const INITIAL_ZOOM = 16;

// Tres tiles fallidos = el servicio está caído, no un tile suelto perdido.
export const TILE_ERROR_THRESHOLD = 3;

export function googleMapsDirectionsUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?daddr=${lat},${lng}`;
}

// Coordenadas en grados y minutos para el eyebrow del encabezado
// ("45°47′S · 67°29′O"). Se redondea por SEGUNDOS totales y recién después se
// trunca a minutos: piso directo sobre (fracción × 60) convierte 0.4° en 23′
// por punto flotante (23.999…).
export function formatDMS(lat: number, lng: number): string {
  const part = (value: number, positive: string, negative: string) => {
    const totalMinutes = Math.floor(Math.round(Math.abs(value) * 3600) / 60);
    const degrees = Math.floor(totalMinutes / 60);
    const minutes = String(totalMinutes % 60).padStart(2, "0");
    return `${degrees}°${minutes}′${value < 0 ? negative : positive}`;
  };
  return `${part(lat, "N", "S")} · ${part(lng, "E", "O")}`;
}
