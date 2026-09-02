"use client";

// Picker de ubicación del wizard de Reportes (spec §6.1). Leaflet pelado, como
// /ubicacion, con tres diferencias deliberadas: `dragging` ENCENDIDO también en
// touch (acá el usuario tiene que mover el mapa con un dedo; el scroll-trap se
// evita con la altura acotada del contenedor y `scrollWheelZoom: false`), un
// marcador que se coloca tocando y se arrastra, y el contorno del barrio.
//
// El dato viaja hacia arriba como `{lat, lng}`; la calle en texto es la
// alternativa accesible al mapa y vive en el paso, no acá. `geolocation` está
// apagada globalmente por Permissions-Policy y reabierta para esta ruta en
// next.config.ts (Parte 2, Task 2): sin eso el botón falla en silencio.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LocateFixed } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PIN_ANCHOR, PIN_SIZE, PIN_SVG } from "@/components/map/brand-pin";
import { BARRIO_BOUNDARY, BARRIO_BOUNDS } from "@/lib/reports/boundary";
import {
  IGN_ATTRIBUTION,
  IGN_TILE_OPTIONS,
  IGN_TILE_URL,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  TILE_ERROR_THRESHOLD,
} from "../ubicacion/map-config";

export type LatLng = { lat: number; lng: number };

export default function LocationPicker({
  value,
  onChange,
}: {
  value: LatLng | null;
  onChange: (v: LatLng | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // `onChange` se lee por ref para que el efecto del mapa corra UNA vez: si
  // fuera dependencia, cada render del paso destruiría y recrearía el mapa.
  const onChangeRef = useRef(onChange);
  // `place` vive adentro del efecto (necesita el `map` y el `icon` locales);
  // el botón de geolocalización lo alcanza por esta ref, que es el mismo
  // camino que el clic y evita disparar un evento sintético en Leaflet.
  const placeRef = useRef<((latlng: L.LatLng) => void) | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Sin deps a propósito: sincroniza la ref DESPUÉS de cada render. Escribirla
  // durante el render es lo intuitivo, pero `react-hooks/refs` lo prohíbe (y
  // rompe en modo concurrente); esto es el mismo efecto, en el lugar legal.
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const bounds = L.latLngBounds(
      [BARRIO_BOUNDS.south, BARRIO_BOUNDS.west],
      [BARRIO_BOUNDS.north, BARRIO_BOUNDS.east],
    );
    const map = L.map(containerRef.current, {
      // La rueda del mouse scrollea la PÁGINA, no el mapa (scroll-trap).
      scrollWheelZoom: false,
      // A diferencia de /ubicacion: acá el drag va prendido SIEMPRE. El paso
      // pide mover el mapa con un dedo para marcar un punto, y el scroll-trap
      // se evita con la altura acotada del contenedor.
      dragging: true,
      touchZoom: true,
      zoomControl: false,
    });
    map.fitBounds(bounds, { padding: [12, 12] });
    mapRef.current = map;

    L.control
      .zoom({ position: "topright", zoomInTitle: "Acercar", zoomOutTitle: "Alejar" })
      .addTo(map);

    const ignLayer = L.tileLayer(IGN_TILE_URL, {
      ...IGN_TILE_OPTIONS,
      attribution: IGN_ATTRIBUTION,
    }).addTo(map);

    // Mismo fallback que /ubicacion: superado el umbral de tiles fallidos se
    // cambia a OSM y Leaflet actualiza solo la atribución. El contador se
    // resetea en `load` para que fallos sueltos no cuenten como ráfaga.
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

    // `interactive: false`: el contorno es una referencia visual, no un
    // objetivo. Si capturara el clic, tocar adentro del barrio —justo donde
    // hay que marcar— no colocaría el punto.
    L.polygon(
      BARRIO_BOUNDARY.map(([lat, lng]) => [lat, lng] as [number, number]),
      { color: "#0079BC", weight: 2, fillOpacity: 0.04, interactive: false },
    ).addTo(map);

    const icon = L.divIcon({
      html: PIN_SVG,
      className: "", // sin la clase default (fondo blanco cuadrado)
      iconSize: PIN_SIZE,
      iconAnchor: PIN_ANCHOR,
    });
    // El marcador se crea UNA vez y después se mueve: recrearlo perdería el
    // handler de arrastre y haría parpadear el pin en cada toque.
    function place(latlng: L.LatLng) {
      if (!markerRef.current) {
        markerRef.current = L.marker(latlng, {
          icon,
          draggable: true,
          keyboard: true,
          title: "Punto del reporte",
        }).addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current!.getLatLng();
          onChangeRef.current({ lat: p.lat, lng: p.lng });
        });
      } else {
        markerRef.current.setLatLng(latlng);
      }
      onChangeRef.current({ lat: latlng.lat, lng: latlng.lng });
    }
    placeRef.current = place;
    map.on("click", (e: L.LeafletMouseEvent) => place(e.latlng));
    if (value) place(L.latLng(value.lat, value.lng));

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      placeRef.current = null;
    };
    // Sólo al montar: el valor inicial se coloca una vez; después manda el marcador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function locate() {
    // Un navegador sin la API (o con el permiso bloqueado por política) no
    // tira una excepción: avisa y deja el camino del toque, que siempre está.
    if (!navigator.geolocation) {
      setGeoError("Tu navegador no permite usar la ubicación. Tocá el mapa para marcar el punto.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
        mapRef.current?.setView(latlng, 17);
        // Mismo camino que el clic: crea el marcador o lo mueve.
        placeRef.current?.(latlng);
      },
      () => {
        setLocating(false);
        setGeoError("No pudimos leer tu ubicación. Tocá el mapa para marcar el punto.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div>
      <div className="relative h-[22rem] overflow-hidden rounded-2xl ring-1 ring-foreground/10">
        <div
          ref={containerRef}
          className="h-full w-full"
          // role="group" y no "img": los controles de zoom viven ADENTRO de
          // este div y "img" volvería presentacionales a los descendientes.
          role="group"
          // El rótulo nombra también la ALTERNATIVA: quien navega con teclado o
          // lector de pantalla tiene que enterarse acá —no descubriéndolo al
          // llegar— de que el lugar se puede indicar sin el mapa.
          aria-label="Mapa del barrio Ciudadela para marcar dónde está el problema. Tocá el mapa para colocar el punto y arrastralo para ajustarlo. Si preferís no usar el mapa, indicá el lugar en los campos Calle y Altura o referencia, más abajo."
        />
        {/* z-[1000]: los panes de Leaflet llegan hasta z 700 y sus controles a
            1000; el botón convive con ellos. bottom-left queda libre (la
            atribución va bottom-right y el zoom topright). */}
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className="absolute bottom-3 left-3 z-[1000] inline-flex min-h-11 items-center gap-2 rounded-md bg-card px-3 text-sm font-medium text-foreground shadow-md ring-1 ring-foreground/10 outline-hidden transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <LocateFixed aria-hidden className="size-4 shrink-0 text-primary" />
          {locating ? "Buscando…" : "Usar mi ubicación"}
        </button>
      </div>
      {/* `role="status"`: el fallo de la geolocalización es la respuesta a un
          botón que se acaba de apretar. Sin anuncio, quien no ve la pantalla
          aprieta "Usar mi ubicación" y no se entera de nada.
          El párrafo se monta SIEMPRE —vacío no ocupa nada (`empty:mt-0` sobre
          una caja de altura cero)— porque una región viva que aparece junto con
          su texto no se anuncia de manera confiable: lo que los lectores de
          pantalla siguen es el texto que entra en una región que ya existía. */}
      <p role="status" className="mt-2 text-xs text-warning empty:mt-0">
        {geoError}
      </p>
    </div>
  );
}
