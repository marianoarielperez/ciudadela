"use client";
// El mini-mapa de la ficha: dónde cae el punto del reporte, con el contorno del
// barrio para leerlo de un vistazo. NO es interactivo —no se arrastra, no se
// hace zoom, el pin no se puede mover— porque la ubicación es un dato del
// vecino y esta pantalla la lee, no la corrige. De ahí `keyboard: false`: un
// contenedor enfocable que no responde a ninguna tecla es una parada muerta en
// el recorrido del teclado.
//
// Comparte pin, contorno y tiles con /ubicacion y con el picker del wizard
// (`brand-pin.ts`, `boundary.ts`, `map-config.ts`), incluido el fallback a OSM:
// el IGN mide 99,3% de disponibilidad, y sin fallback el 0,7% restante deja un
// rectángulo gris sin explicación en medio de la ficha.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { PIN_ANCHOR, PIN_SIZE, PIN_SVG } from "@/components/map/brand-pin";
import { BARRIO_BOUNDARY } from "@/lib/reports/boundary";
import {
  IGN_ATTRIBUTION, IGN_TILE_OPTIONS, IGN_TILE_URL, INITIAL_ZOOM,
  OSM_ATTRIBUTION, OSM_TILE_URL, TILE_ERROR_THRESHOLD,
} from "@/app/(public)/ubicacion/map-config";

export default function ReportMiniMap({ lat, lng }: { lat: number; lng: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current, {
      center: [lat, lng],
      zoom: INITIAL_ZOOM,
      scrollWheelZoom: false,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomControl: false,
      // La atribución del IGN y de OSM es OBLIGATORIA aunque el mapa sea chico.
      attributionControl: true,
    });

    const ignLayer = L.tileLayer(IGN_TILE_URL, {
      ...IGN_TILE_OPTIONS,
      attribution: IGN_ATTRIBUTION,
    }).addTo(map);
    // Mismo fallback que /ubicacion y que el picker: superado el umbral se
    // cambia a OSM y Leaflet actualiza solo la atribución. El contador se
    // resetea en `load` para que tiles sueltos perdidos no cuenten como ráfaga.
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

    L.polygon(
      BARRIO_BOUNDARY.map(([a, b]) => [a, b] as [number, number]),
      { color: "#0079BC", weight: 2, fillOpacity: 0.04, interactive: false },
    ).addTo(map);
    L.marker([lat, lng], {
      icon: L.divIcon({ html: PIN_SVG, className: "", iconSize: PIN_SIZE, iconAnchor: PIN_ANCHOR }),
      interactive: false,
      keyboard: false,
    }).addTo(map);

    return () => {
      map.remove();
    };
  }, [lat, lng]);

  // `role="group"` y no "img": los enlaces de la atribución viven adentro y
  // "img" volvería presentacionales a los descendientes. Las coordenadas y la
  // calle van en texto DEBAJO del mapa (la ficha), que es la alternativa real
  // para quien no lo ve.
  return <div ref={ref} role="group" aria-label="Mapa con el punto del reporte" className="h-56 w-full" />;
}
