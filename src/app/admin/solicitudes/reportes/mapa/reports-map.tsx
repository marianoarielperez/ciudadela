"use client";

// El mapa de la cola de reportes: un pin por reporte con punto, teñido por
// estado. Leaflet pelado, como las otras tres superficies de mapa del proyecto
// (`/ubicacion`, el picker del wizard y el mini-mapa de la ficha), y con el
// MISMO fallback a OSM: el IGN mide 99,3% de disponibilidad y sin fallback ese
// 0,7% deja un rectángulo gris del alto de la pantalla sin explicación.
//
// Dos efectos, no uno. El del MAPA corre una sola vez (`[]`): crear y destruir
// el mapa en cada cambio de props haría parpadear los tiles y perdería el zoom
// que el operador acababa de hacer —y `points` es un array nuevo en cada
// render, así que con `[points]` cualquier re-render lo recrearía—. El de los
// PINES corre cuando cambian los puntos y vacía un `LayerGroup`: filtrar por
// estado repinta los pines sobre el mismo mapa.
//
// Los colores son LITERALES a propósito. Los tiles del IGN son una foto clara
// en los dos modos, así que el pin no puede seguir al tema: el celeste y el
// verde son los valores de modo claro de `--primary` y `--success`
// (`globals.css`), no un tono elegido acá.
//
// Este componente NO es la alternativa accesible: los marcadores de Leaflet son
// punteros. La lista de los reportes dibujados la renderiza la página, en el
// servidor, debajo del mapa (`sr-only`), y el rótulo de acá la nombra para que
// quien no ve la pantalla se entere antes de entrar.
import type { ReportStatus } from "@/generated/prisma/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

import {
  IGN_ATTRIBUTION,
  IGN_TILE_OPTIONS,
  IGN_TILE_URL,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  TILE_ERROR_THRESHOLD,
} from "@/app/(public)/ubicacion/map-config";
import { PIN_ANCHOR, PIN_SIZE, pinSvg } from "@/components/map/brand-pin";
import { BARRIO_BOUNDARY, BARRIO_BOUNDS } from "@/lib/reports/boundary";

/** Lo que viaja al cliente por cada pin, y NADA más: ni el nombre de quien
 *  reportó, ni su contacto, ni el escrito (Ley 25.326, mismo criterio que
 *  `REPORT_LIST_SELECT`). El rótulo y el estado llegan ya redactados desde el
 *  servidor —`statusLabel` sabe que una iniciativa se "trata"— y `href` es la
 *  ficha, que es donde vive la persona. */
export type MapPoint = {
  id: number;
  lat: number;
  lng: number;
  status: "received" | "filed" | "dismissed";
  /** "N° 14 · Reclamo · Agua potable" */
  title: string;
  /** Ya pasado por `statusLabel(kind, status)`. */
  state: string;
  href: string;
};

// Tipado sobre el enum ENTERO y no sobre `MapPoint["status"]`: hoy ninguna
// vista incluye borradores, pero si mañana una los trajera, un `COLOR[status]`
// sin entrada pintaría `fill="undefined"` —un pin negro o invisible— sin error.
// Con el enum completo, sumar un estado es un error de compilación acá.
const COLOR: Record<ReportStatus, string> = {
  draft: "#6b7280", // no se dibuja nunca (ninguna vista trae borradores); cierra el tipo
  received: "#0079BC", // --primary (modo claro)
  filed: "#15803D", // --success (modo claro)
  dismissed: "#6b7280", // gris neutro: cerrado, sin trabajo pendiente
};

/** El popup se arma como HTML (Leaflet no acepta JSX), así que todo lo que
 *  viene de la base pasa por acá. Hoy `title` sale de catálogos fijos y de un
 *  entero, pero eso es una propiedad del llamador de hoy, no de este código. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function ReportsMap({ points }: { points: MapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinsRef = useRef<L.LayerGroup | null>(null);

  // Sólo al montar: el mapa, los tiles y el contorno del barrio.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      scrollWheelZoom: true,
      dragging: true,
      zoomControl: false,
    });
    map.fitBounds(
      L.latLngBounds(
        [BARRIO_BOUNDS.south, BARRIO_BOUNDS.west],
        [BARRIO_BOUNDS.north, BARRIO_BOUNDS.east],
      ),
      { padding: [16, 16] },
    );
    mapRef.current = map;

    L.control
      .zoom({ position: "topright", zoomInTitle: "Acercar", zoomOutTitle: "Alejar" })
      .addTo(map);

    const ignLayer = L.tileLayer(IGN_TILE_URL, {
      ...IGN_TILE_OPTIONS,
      attribution: IGN_ATTRIBUTION,
    }).addTo(map);

    // Mismo fallback que /ubicacion, el picker y el mini-mapa: superado el
    // umbral de tiles fallidos se cambia a OSM y Leaflet actualiza solo la
    // atribución. El contador se resetea en `load` para que fallos sueltos no
    // cuenten como ráfaga.
    let tileErrors = 0;
    let fellBack = false;
    ignLayer.on("tileerror", () => {
      tileErrors += 1;
      if (fellBack || tileErrors < TILE_ERROR_THRESHOLD) return;
      fellBack = true;
      map.removeLayer(ignLayer);
      L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
    });
    ignLayer.on("load", () => {
      tileErrors = 0;
    });

    // `interactive: false`: el contorno es referencia visual, no un objetivo.
    // Si capturara el clic, taparía los pines que caen adentro del barrio.
    L.polygon(
      BARRIO_BOUNDARY.map(([lat, lng]) => [lat, lng] as [number, number]),
      { color: "#0079BC", weight: 2, fillOpacity: 0.03, interactive: false },
    ).addTo(map);

    pinsRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      pinsRef.current = null;
    };
  }, []);

  // Los pines: se vacía el grupo y se vuelve a llenar. Cambiar de filtro no
  // recrea el mapa ni pierde el encuadre.
  useEffect(() => {
    const group = pinsRef.current;
    if (!group) return;
    group.clearLayers();
    for (const p of points) {
      const icon = L.divIcon({
        html: pinSvg(COLOR[p.status]),
        className: "", // sin la clase default (fondo blanco cuadrado)
        iconSize: PIN_SIZE,
        iconAnchor: PIN_ANCHOR,
        popupAnchor: [0, -40],
      });
      // `keyboard: false`: con el default, cada pin es una parada de tabulación
      // cuyo nombre accesible es un SVG `aria-hidden`. Con 300 reportes eso son
      // 300 paradas mudas antes de llegar al contenido siguiente. La ruta de
      // teclado es la lista de abajo, donde cada reporte es un link con nombre.
      L.marker([p.lat, p.lng], { icon, title: `${p.title} · ${p.state}`, keyboard: false })
        .addTo(group)
        .bindPopup(
          `<strong>${escapeHtml(p.title)}</strong><br>${escapeHtml(p.state)}<br>` +
            `<a href="${escapeHtml(p.href)}">Ver reporte</a>`,
        );
    }
  }, [points]);

  // `role="group"` y no "img": los controles de zoom y los enlaces de la
  // atribución viven ADENTRO de este div, y "img" volvería presentacionales a
  // todos los descendientes.
  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Mapa de reportes del barrio Ciudadela. Los pines se abren con el mouse; la lista completa de los reportes dibujados está debajo del mapa."
      className="h-[70vh] min-h-[24rem] w-full"
    />
  );
}
