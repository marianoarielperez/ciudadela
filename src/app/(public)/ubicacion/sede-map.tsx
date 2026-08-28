"use client";

// Leaflet pelado, sin react-leaflet: el mapa se crea UNA vez en el useEffect y
// se destruye en el cleanup. Decisión de la spec §3: para un mapa estático de
// sede, el wrapper declarativo no paga su dependencia.
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import { SITE } from "@/lib/site";
import {
  IGN_ATTRIBUTION,
  IGN_TILE_OPTIONS,
  IGN_TILE_URL,
  INITIAL_ZOOM,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  TILE_ERROR_THRESHOLD,
} from "./map-config";

const CENTER: [number, number] = [SITE.lat, SITE.lng];

// Pin propio: gota celeste --primary (#0079BC) con halo blanco. Un divIcon
// SVG evita los PNG del default de Leaflet, que llegan con rutas rotas por el
// bundler, y queda 100% de marca.
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48" aria-hidden="true">' +
  '<path d="M20 2C11.2 2 4 9.2 4 18c0 11.5 13.3 25.6 14.9 27.2a1.6 1.6 0 0 0 2.2 0C22.7 43.6 36 29.5 36 18 36 9.2 28.8 2 20 2Z" fill="#0079BC" stroke="#FFFFFF" stroke-width="3"/>' +
  '<circle cx="20" cy="18" r="6" fill="#FFFFFF"/>' +
  "</svg>";

export default function SedeMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: CENTER,
      zoom: INITIAL_ZOOM,
      // La rueda del mouse scrollea la PÁGINA, no el mapa (scroll-trap).
      scrollWheelZoom: false,
      // En touch, un dedo scrollea la página; el mapa se explora con el pinch
      // de dos dedos (touchZoom) y los botones de zoom. Ojo: `L.Browser.mobile`
      // es un sniff de user-agent/orientación, NO de capacidad táctil — Safari
      // de iPadOS (y muchas tablets Android) manda un UA de escritorio, así que
      // ese chequeo da `false` ahí y Leaflet deja el drag prendido, matando el
      // scroll nativo de un dedo. Se usa `L.Browser.touch` (capacidad táctil
      // real) para que TODO dispositivo táctil se comporte igual. No
      // "simplificar" esto de vuelta al sniff de UA.
      dragging: !L.Browser.touch,
      touchZoom: true,
      zoomControl: false,
    });
    mapRef.current = map;

    // topright: la tarjeta de dirección de la página vive en topleft.
    L.control
      .zoom({ position: "topright", zoomInTitle: "Acercar", zoomOutTitle: "Alejar" })
      .addTo(map);

    const icon = L.divIcon({
      html: PIN_SVG,
      className: "", // sin la clase default (fondo blanco cuadrado)
      iconSize: [40, 48],
      iconAnchor: [20, 46],
    });
    // Decorativo a propósito: la información (dirección, botón) vive en la
    // tarjeta HTML de la página, nunca solo dentro del canvas del mapa.
    L.marker(CENTER, { icon, interactive: false, keyboard: false }).addTo(map);

    const ignLayer = L.tileLayer(IGN_TILE_URL, {
      ...IGN_TILE_OPTIONS,
      attribution: IGN_ATTRIBUTION,
    }).addTo(map);

    // Fallback: con el IGN caído los tiles fallan en ráfaga; superado el
    // umbral se cambia la capa a OSM (el proveedor anterior de esta página) y
    // Leaflet actualiza solo la atribución. El flag evita re-entrar.
    let tileErrors = 0;
    let fellBack = false;
    ignLayer.on("tileerror", () => {
      tileErrors += 1;
      if (fellBack || tileErrors < TILE_ERROR_THRESHOLD) return;
      fellBack = true;
      map.removeLayer(ignLayer);
      L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        aria-label={`Mapa con la sede vecinal marcada en ${SITE.address}, ${SITE.city}`}
      />
      {/* z-[1000]: los panes de Leaflet llegan hasta z 700 y sus controles a
          1000; el botón convive con ellos. bottom-left queda libre (la
          atribución va bottom-right y el zoom topright). */}
      <button
        type="button"
        onClick={() => mapRef.current?.setView(CENTER, INITIAL_ZOOM)}
        className="absolute bottom-3 left-3 z-[1000] inline-flex min-h-11 items-center gap-2 rounded-md bg-card px-3 text-sm font-medium text-foreground shadow-md ring-1 ring-foreground/10 outline-hidden transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MapPin aria-hidden className="size-4 text-primary" />
        Volver a la sede
      </button>
    </div>
  );
}
