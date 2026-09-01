"use client";

// Leaflet pelado, sin react-leaflet: el mapa se crea UNA vez en el useEffect y
// se destruye en el cleanup. Decisión de la spec §3: para un mapa estático de
// sede, el wrapper declarativo no paga su dependencia.
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import { PIN_ANCHOR, PIN_SIZE, PIN_SVG } from "@/components/map/brand-pin";
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
      // de dos dedos (touchZoom) y los botones de zoom. Se decide con
      // `(pointer: coarse)`: pregunta si el puntero PRIMARIO del dispositivo
      // es un dedo, que es justo la distinción que separa "pancea" de
      // "scrollea la página". Ninguno de los atajos obvios sirve acá:
      // `L.Browser.mobile` es un sniff de user-agent/orientación y Safari de
      // iPadOS (y muchas tablets Android) manda un UA de escritorio, así que
      // da `false` en un iPad y deja el drag prendido, matando el scroll
      // nativo de un dedo. `L.Browser.touch` tampoco: da `true` apenas existe
      // `window.PointerEvent`, que es una capacidad del motor presente en
      // TODO desktop moderno (Chrome, Firefox, Edge, Safari reciente) aunque
      // no haya ni un dedo cerca, así que apaga el drag en escritorios
      // comunes con mouse. Si el entorno no tiene `matchMedia`, se asume
      // desktop (drag prendido): un mapa de escritorio roto es peor que una
      // tablet que panea.
      dragging: (() => {
        if (typeof window === "undefined" || !window.matchMedia) return true;
        return !window.matchMedia("(pointer: coarse)").matches;
      })(),
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
      iconSize: PIN_SIZE,
      iconAnchor: PIN_ANCHOR,
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
    // Leaflet actualiza solo la atribución. El flag evita re-entrar. El
    // contador se resetea en `load` (Leaflet lo emite cuando terminan de
    // cargar los tiles visibles de una vista): sin el reset, tres fallos
    // sueltos a lo largo de una sesión —el mapa de escritorio es arrastrable
    // y sin límites, así que un usuario paneando lejos de Comodoro puede
    // acumularlos sin que sea una ráfaga real— bastaban para cambiar de capa
    // y perder la cartografía del IGN en silencio.
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
        // Leaflet le pone tabIndex=0 al contenedor (navegación por teclado), así
        // que queda un elemento enfocable con role implícito "generic" — ARIA
        // prohíbe nombre accesible ahí y el navegador puede descartar el
        // aria-label. role="group" sí admite nombre. NO "img": los controles de
        // zoom viven ADENTRO de este div y "img" vuelve presentacionales a los
        // descendientes, escondiendo "Acercar"/"Alejar" del lector de pantalla.
        // Tampoco "region": sumaría un landmark más a la página pública.
        role="group"
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
        <MapPin aria-hidden className="size-4 shrink-0 text-primary" />
        Volver a la sede
      </button>
    </div>
  );
}
