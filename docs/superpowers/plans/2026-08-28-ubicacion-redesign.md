# /ubicacion Redesign ("La sede" + ArgenMap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la página pública `/ubicacion` con ArgenMap (IGN) vía Leaflet, mapa protagonista con tarjeta superpuesta y cards de contacto/salones/historia.

**Architecture:** La página sigue siendo un Server Component; solo el mapa es cliente (Leaflet pelado montado con `dynamic(..., { ssr: false })` desde un wrapper `"use client"`). Un módulo puro `map-config.ts` concentra URLs, zooms, atribuciones y funciones testeables. La CSP suma los hosts de tiles a `img-src` y pierde el `frame-src` de OSM.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, Leaflet 1.9 (nuevo), lucide-react, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-ubicacion-redesign-design.md` — leerla entera antes de empezar.

## Global Constraints

- UI en español es-AR ("vos"); código, variables y commits en inglés.
- NO tocar `src/lib/treasury/*`, `src/lib/mp/*`, rutas de pagos, panel ni wizards. Los únicos archivos permitidos son los listados en las tasks.
- Tokens del sistema: `--primary` `#0079BC` para controles interactivos; nunca verde/ámbar crudo de Tailwind.
- Targets táctiles ≥ 44px (`min-h-11`); foco SIEMPRE `outline-hidden` + `focus-visible:ring-*` (nunca `outline-none`).
- Íconos lucide: `aria-hidden` cuando hay texto al lado, `shrink-0` junto a texto envolvible, sin tocar `strokeWidth`.
- El texto del estado vacío de contacto se conserva byte a byte (ver Task 3).
- Tests existentes deben pasar SIN modificarse.
- Commits terminan con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- El operador (Mariano) corre `git push`; el ejecutor NO pushea.

---

### Task 1: Módulo puro `map-config.ts` (TDD)

**Files:**
- Create: `src/app/(public)/ubicacion/map-config.ts`
- Test: `tests/ubicacion-map-config.test.ts`

**Interfaces:**
- Consumes: `SITE` de `@/lib/site` (constantes puras, sin Prisma — seguro para tests).
- Produces (Tasks 2 y 3 dependen de estos nombres exactos):
  - `IGN_TILE_URL: string`, `IGN_TILE_OPTIONS: { tms: true; minZoom: 3; maxZoom: 19 }`, `IGN_ATTRIBUTION: string`
  - `OSM_TILE_URL: string`, `OSM_ATTRIBUTION: string`
  - `INITIAL_ZOOM: number` (16), `TILE_ERROR_THRESHOLD: number` (3)
  - `googleMapsDirectionsUrl(lat: number, lng: number): string`
  - `formatDMS(lat: number, lng: number): string`

- [ ] **Step 1: Write the failing test**

Crear `tests/ubicacion-map-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SITE } from "@/lib/site";
import {
  formatDMS,
  googleMapsDirectionsUrl,
  IGN_TILE_OPTIONS,
  IGN_TILE_URL,
  INITIAL_ZOOM,
  OSM_TILE_URL,
  TILE_ERROR_THRESHOLD,
} from "@/app/(public)/ubicacion/map-config";

describe("map-config", () => {
  it("IGN tile URL uses Leaflet placeholders, not raw TMS {-y}", () => {
    // La URL oficial del IGN trae `{-y}` (sintaxis TMS). Leaflet no la
    // interpola: se escribe {y} y se compensa con `tms: true`.
    expect(IGN_TILE_URL).toContain("https://wms.ign.gob.ar/");
    expect(IGN_TILE_URL).toContain("capabaseargenmap");
    expect(IGN_TILE_URL).toContain("/{z}/{x}/{y}.png");
    expect(IGN_TILE_URL).not.toContain("{-y}");
    expect(IGN_TILE_OPTIONS.tms).toBe(true);
  });

  it("zoom bounds match what the IGN actually serves over Comodoro", () => {
    expect(IGN_TILE_OPTIONS.minZoom).toBe(3);
    expect(IGN_TILE_OPTIONS.maxZoom).toBe(19);
    expect(INITIAL_ZOOM).toBe(16);
  });

  it("OSM fallback URL is the standard XYZ endpoint", () => {
    expect(OSM_TILE_URL).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(TILE_ERROR_THRESHOLD).toBe(3);
  });

  it("builds the Google Maps directions URL from the SITE coordinates", () => {
    expect(googleMapsDirectionsUrl(SITE.lat, SITE.lng)).toBe(
      "https://maps.google.com/?daddr=-45.79713687,-67.494067",
    );
  });

  it("formats the sede coordinates as the DMS eyebrow", () => {
    expect(formatDMS(SITE.lat, SITE.lng)).toBe("45°47′S · 67°29′O");
  });

  it("formats northern/eastern hemispheres and avoids float truncation", () => {
    expect(formatDMS(45.5, 67.25)).toBe("45°30′N · 67°15′E");
    // -58.4: (0.4 * 60) da 23.999… en punto flotante; redondear por segundos
    // totales evita que el piso lo convierta en 23′.
    expect(formatDMS(-34.6, -58.4)).toBe("34°36′S · 58°24′O");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ubicacion-map-config.test.ts`
Expected: FAIL — "Failed to resolve import \"@/app/(public)/ubicacion/map-config\"".

- [ ] **Step 3: Write the implementation**

Crear `src/app/(public)/ubicacion/map-config.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ubicacion-map-config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite to prove nothing broke**

Run: `npm test`
Expected: todo verde (los tests existentes no se tocaron).

- [ ] **Step 6: Commit**

```bash
git add src/app/(public)/ubicacion/map-config.ts tests/ubicacion-map-config.test.ts
git commit -m "feat(ubicacion): pure map-config module for the ArgenMap redesign"
```

---

### Task 2: Componente cliente del mapa (Leaflet + fallback)

**Files:**
- Modify: `package.json` (vía `npm install`)
- Create: `src/app/(public)/ubicacion/sede-map.tsx`
- Create: `src/app/(public)/ubicacion/sede-map-loader.tsx`

**Interfaces:**
- Consumes: todo lo exportado por `./map-config` (Task 1) y `SITE` de `@/lib/site`.
- Produces: `SedeMap` (default export de `sede-map-loader.tsx`), componente sin props que llena el 100% del alto/ancho de su contenedor. Task 3 lo monta dentro de un bloque con altura explícita.

No hay test unitario razonable (Leaflet exige DOM real); esta task se verifica con `lint` + `tsc` acá y con el navegador en la Task 5.

- [ ] **Step 1: Install Leaflet**

```bash
npm install leaflet
npm install -D @types/leaflet
```

Expected: `leaflet@^1.9.4` en `dependencies`, `@types/leaflet` en `devDependencies`. Ninguna otra dependencia nueva (NO instalar react-leaflet).

- [ ] **Step 2: Create the map component**

Crear `src/app/(public)/ubicacion/sede-map.tsx`:

```tsx
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
      // de dos dedos (touchZoom) y los botones de zoom.
      dragging: !L.Browser.mobile,
      touchZoom: true,
      zoomControl: false,
    });
    mapRef.current = map;

    // topright: la tarjeta de dirección de la página vive en topleft.
    L.control.zoom({ position: "topright" }).addTo(map);

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
```

- [ ] **Step 3: Create the loader wrapper**

Crear `src/app/(public)/ubicacion/sede-map-loader.tsx`:

```tsx
"use client";

// `dynamic(..., { ssr: false })` está PROHIBIDO dentro de un Server Component
// en Next 15/16: este wrapper cliente existe solo para eso. El chunk de
// Leaflet (~47 KB gzip) se baja recién al montar; el bundle inicial del sitio
// no cambia.
import dynamic from "next/dynamic";

const SedeMap = dynamic(() => import("./sede-map"), {
  ssr: false,
  loading: () => (
    <div aria-hidden className="h-full w-full animate-pulse bg-muted motion-reduce:animate-none" />
  ),
});

export default SedeMap;
```

- [ ] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores. (La página vieja aún no usa estos archivos; no importa.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app/(public)/ubicacion/sede-map.tsx src/app/(public)/ubicacion/sede-map-loader.tsx
git commit -m "feat(ubicacion): Leaflet client component with ArgenMap tiles and OSM fallback"
```

---

### Task 3: Reescritura de `page.tsx` ("La sede")

**Files:**
- Modify: `src/app/(public)/ubicacion/page.tsx` (reemplazo completo del archivo)

**Interfaces:**
- Consumes: `SedeMap` (default de `./sede-map-loader`), `formatDMS` y `googleMapsDirectionsUrl` de `./map-config`, `getContactInfo` de `@/lib/config`, `SITE` de `@/lib/site`, `ROOM_META` de `@/lib/activities/room-meta`, `Card/CardHeader/CardTitle/CardContent` de `@/components/ui/card`.
- Produces: nada que consuman otras tasks.

- [ ] **Step 1: Replace the page**

Contenido completo nuevo de `src/app/(public)/ubicacion/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Landmark, Mail, Navigation, Phone, ScrollText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROOM_META } from "@/lib/activities/room-meta";
import { getContactInfo } from "@/lib/config";
import { SITE } from "@/lib/site";
import { formatDMS, googleMapsDirectionsUrl } from "./map-config";
import SedeMap from "./sede-map-loader";

export const metadata: Metadata = {
  title: "La sede — Vecinal Ciudadela",
  description: `Dónde queda la sede de la ${SITE.name}, cómo llegar y cómo contactarnos.`,
  alternates: { canonical: "/ubicacion" },
};

// JSON-LD de la sede con GeoCoordinates — previsto en el diseño del Módulo 2 y
// pendiente desde entonces. Mismo criterio que el Organization de la home:
// todo sale de constantes propias, así que dangerouslySetInnerHTML es seguro,
// y depende del script-src 'unsafe-inline' ya documentado en next.config.ts.
const placeJsonLd = {
  "@context": "https://schema.org",
  "@type": "Place",
  name: `Sede de la ${SITE.name}`,
  address: {
    "@type": "PostalAddress",
    streetAddress: SITE.address,
    addressLocality: "Comodoro Rivadavia",
    addressRegion: "Chubut",
    addressCountry: "AR",
  },
  geo: { "@type": "GeoCoordinates", latitude: SITE.lat, longitude: SITE.lng },
};

// Los salones ya tienen identidad visual en Actividades (room-meta.ts): acá se
// REUTILIZAN los mismos íconos — no se copia el mapa, se importa.
const ROOMS = [
  { icon: ROOM_META.historic.icon, label: SITE.rooms.historic },
  { icon: ROOM_META.glass.icon, label: SITE.rooms.glass },
  { icon: ROOM_META.kitchen.icon, label: SITE.rooms.kitchen },
  { icon: ROOM_META.classroom.icon, label: SITE.rooms.classroom },
] as const;

const HISTORY = [
  { year: "1964", text: `Fundación de la asociación: ${SITE.founded}.` },
  { year: "2015", text: `Fundación legal: ${SITE.legallyFounded}.` },
  { year: "2015", text: `${SITE.legalStatus}.` },
] as const;

// Chip de ícono tintado — el patrón del tablero /admin (27/08).
const ICON_CHIP =
  "flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary";

// La dirección + "Cómo llegar" se renderiza DOS veces: superpuesta al mapa en
// sm+ y como bloque a lo ancho debajo del mapa en mobile. Es el mismo markup;
// cambia solo el posicionamiento del contenedor.
function SedeCard() {
  return (
    <>
      <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
        Sede vecinal
      </p>
      <address className="mt-1 not-italic">
        <span className="block text-base font-semibold">{SITE.address}</span>
        <span className="block text-sm text-muted-foreground">{SITE.city}</span>
      </address>
      {/* target="_blank" + rel: la ruta se abre afuera para no perder la
          página; rel="noopener" es obligatorio con _blank. */}
      <a
        href={googleMapsDirectionsUrl(SITE.lat, SITE.lng)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-hidden transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Navigation aria-hidden className="size-4" />
        Cómo llegar
      </a>
    </>
  );
}

export default async function UbicacionPage() {
  const contact = await getContactInfo();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(placeJsonLd) }}
      />

      {/* Eyebrow de coordenadas: la firma de la página. Derivadas de
          SITE.lat/lng por formatDMS, nunca hardcodeadas. */}
      <p className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase">
        {formatDMS(SITE.lat, SITE.lng)}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">La sede</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Dónde queda la sede de la {SITE.name}, cómo llegar y cómo comunicarte con la Comisión
        Directiva.
      </p>

      {/* El mapa protagonista. El alto es del CONTENEDOR: Leaflet no infiere
          altura (con height 0 no se ve nada y no hay error). */}
      <div className="relative mt-8 h-[26rem] overflow-hidden rounded-2xl ring-1 ring-foreground/10 sm:h-[30rem]">
        <SedeMap />
        {/* Tarjeta superpuesta (solo sm+): z-[1000] para quedar sobre los
            panes de Leaflet. En mobile NO se superpone: taparía medio mapa. */}
        <div className="absolute top-4 left-4 z-[1000] hidden w-64 rounded-xl bg-card p-4 shadow-lg ring-1 ring-foreground/10 sm:block">
          <SedeCard />
        </div>
      </div>
      <div className="mt-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:hidden">
        <SedeCard />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="gap-2">
            <span className={ICON_CHIP}>
              <Phone aria-hidden className="size-5" />
            </span>
            <CardTitle as="h2">Contacto</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Teléfono y email viven en la tabla `configuration` y hoy están
                vacíos: mientras nadie los cargue, el bloque explica el hueco
                en vez de dejarlo. No es un borde raro, es el estado inicial. */}
            {contact.phone || contact.email ? (
              <ul className="space-y-1 text-sm">
                {contact.phone && (
                  <li className="flex items-center gap-2">
                    <Phone aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <a
                      className="inline-flex min-h-11 items-center text-primary underline underline-offset-2"
                      href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                    >
                      {contact.phone}
                    </a>
                  </li>
                )}
                {contact.email && (
                  <li className="flex items-center gap-2 [overflow-wrap:anywhere]">
                    <Mail aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <a
                      className="inline-flex min-h-11 items-center text-primary underline underline-offset-2"
                      href={`mailto:${contact.email}`}
                    >
                      {contact.email}
                    </a>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Todavía no hay un teléfono ni un email de contacto publicados. Podés acercarte a
                la sede, en la dirección de acá arriba.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-2">
            <span className={ICON_CHIP}>
              <Landmark aria-hidden className="size-5" />
            </span>
            <CardTitle as="h2">La sede por dentro</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {ROOMS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  {label}
                </li>
              ))}
            </ul>
            <Link
              href="/actividades"
              className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
            >
              Ver qué pasa en cada salón
            </Link>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2 lg:col-span-1">
          <CardHeader className="gap-2">
            <span className={ICON_CHIP}>
              <ScrollText aria-hidden className="size-5" />
            </span>
            <CardTitle as="h2">Historia</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 border-l pl-4">
              {HISTORY.map(({ year, text }) => (
                <li key={text} className="relative">
                  <span
                    aria-hidden
                    className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-primary"
                  />
                  <p className="font-mono text-sm font-semibold tabular-nums">{year}</p>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
```

Notas para el implementador:
- El texto del estado vacío de contacto es **byte-idéntico** al actual (regla del proyecto: `OfficeCard` del wizard de reempadronamiento replica ese texto; si acá cambiara, quedarían desincronizados).
- Desaparecen: el iframe, `D`, `bbox`, `OSM_EMBED`, `OSM_LINK` y el enlace "Ver el mapa completo en OpenStreetMap". El párrafo de fundación legal queda absorbido por la card Historia.
- `CardTitle` acepta `as` (documentado en `src/components/ui/card.tsx:36-45`): los títulos de card son `h2` bajo el `h1` "La sede".

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: todo verde. En particular `tests/seo.test.ts` pasa sin tocarse (el sitemap no cambió).

- [ ] **Step 4: Commit**

```bash
git add src/app/(public)/ubicacion/page.tsx
git commit -m "feat(ubicacion): redesign the page as 'La sede' with map-first layout"
```

---

### Task 4: CSP para los tiles (`next.config.ts`)

**Files:**
- Modify: `next.config.ts:25-28` (comentario), `next.config.ts:73` (nuevo array tras `TURNSTILE`), `next.config.ts:90` (`img-src`), `next.config.ts:93` (`frame-src`)

**Interfaces:**
- Consumes: nada de otras tasks (pero sin esta task el mapa de la Task 3 queda gris en dev y prod).
- Produces: la CSP que la verificación de la Task 5 debe ver limpia.

- [ ] **Step 1: Update the frame-src comment (lines 25-28)**

Reemplazar el texto del comentario:

```
// - frame-src: el embed de OpenStreetMap de /ubicacion, el widget de Turnstile
//   y los iframes de Checkout Pro / Bricks (MP_FRAME). Ojo: un iframe bloqueado
//   por CSP no rompe nada visible, deja un recuadro vacío en silencio — si se
//   cambia el proveedor de mapa o el de captcha hay que tocar acá.
```

por:

```
// - frame-src: el widget de Turnstile y los iframes de Checkout Pro / Bricks
//   (MP_FRAME). Ojo: un iframe bloqueado por CSP no rompe nada visible, deja
//   un recuadro vacío en silencio — si se cambia el proveedor de captcha hay
//   que tocar acá. El mapa de /ubicacion ya no es un iframe: desde el rediseño
//   de 08/2026 es Leaflet, y sus tiles entran por img-src (MAP_TILES).
```

- [ ] **Step 2: Add the MAP_TILES array after TURNSTILE (line 73)**

Debajo de `const TURNSTILE: string[] = [...]` agregar:

```ts
// Tiles del mapa de /ubicacion (rediseño "La sede", 28/08/2026). Leaflet los
// carga como <img>: sin estos orígenes en img-src el mapa queda gris EN
// SILENCIO — misma trampa que el iframe viejo, ahora en otra directiva. El
// primero es ArgenMap (IGN); el segundo, el fallback automático si el IGN no
// responde (spec 2026-08-28-ubicacion-redesign-design.md §4.2).
const MAP_TILES: string[] = ["https://wms.ign.gob.ar", "https://tile.openstreetmap.org"];
```

- [ ] **Step 3: Edit the two CSP directives**

En el array `csp`:

```ts
// antes:
"img-src 'self' data: blob:",
// después:
`img-src ${["'self'", "data:", "blob:", ...MAP_TILES].join(" ")}`,
```

```ts
// antes:
`frame-src ${["'self'", "https://www.openstreetmap.org", ...MP_FRAME, ...TURNSTILE].join(" ")}`,
// después:
`frame-src ${["'self'", ...MP_FRAME, ...TURNSTILE].join(" ")}`,
```

- [ ] **Step 4: Verify types, lint and suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: todo verde (nada testea el string de la CSP).

- [ ] **Step 5: Commit**

```bash
git add next.config.ts
git commit -m "feat(csp): allow IGN and OSM tile hosts in img-src, drop the OSM iframe origin"
```

---

### Task 5: Verificación integral en el navegador

**Files:**
- Ninguno nuevo (solo arreglos si la verificación encuentra problemas).

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la evidencia de los criterios de aceptación de la spec (§8).

- [ ] **Step 1: Full suite + build**

Run: `npm test && npm run build`
Expected: suite verde y build sin errores. En la salida del build, la ruta `/ubicacion` NO debe engordar el First Load JS compartido (el chunk de Leaflet es propio de la ruta y diferido).

- [ ] **Step 2: Start the dev server and open /ubicacion**

Levantar el dev server con la herramienta de preview del entorno (no con Bash suelto) y navegar a `http://localhost:3000/ubicacion`.

Verificar en desktop:
- El mapa ArgenMap se ve con el pin celeste en la sede; consola SIN errores de CSP.
- Tarjeta "Sede vecinal" superpuesta arriba a la izquierda; controles de zoom arriba a la derecha; "Volver a la sede" abajo a la izquierda; atribución "Instituto Geográfico Nacional + OpenStreetMap" abajo a la derecha.
- La rueda del mouse sobre el mapa scrollea la página (no hace zoom).
- "Cómo llegar" abre `https://maps.google.com/?daddr=-45.79713687,-67.494067` en pestaña nueva.
- Mover el mapa y apretar "Volver a la sede" lo recentra al zoom 16.
- El eyebrow dice `45°47′S · 67°29′O`.
- Las tres cards (Contacto con su estado vacío, La sede por dentro con los 4 salones, Historia con los 3 hitos) se ven con el chip de ícono tintado.

- [ ] **Step 3: Verify mobile (375px)**

Emular viewport mobile (375px):
- La tarjeta de dirección NO tapa el mapa: aparece como bloque debajo.
- Un dedo sobre el mapa scrollea la página (dragging apagado en touch).
- Las cards apilan en una columna; nada desborda horizontalmente.
- Volver el viewport a desktop al terminar.

- [ ] **Step 4: Verify the OSM fallback**

En las devtools del navegador, bloquear las requests a `wms.ign.gob.ar` (Network request blocking) y recargar `/ubicacion`:
- Tras los primeros errores de tile, el mapa muestra tiles de OpenStreetMap y la atribución cambia a "© Colaboradores de OpenStreetMap".
- Sin errores de CSP en consola (tile.openstreetmap.org ya está en img-src).
- Quitar el bloqueo al terminar.

- [ ] **Step 5: Screenshot evidence**

Sacar captura de desktop y de mobile y compartirlas con el operador en la conversación.

- [ ] **Step 6: Commit (only if fixes were needed)**

Si la verificación obligó a retocar algo, commitear los arreglos:

```bash
git add -A
git commit -m "fix(ubicacion): adjustments found during browser verification"
```

- [ ] **Step 7: Final gate**

Invocar la skill `superpowers:verification-before-completion` antes de declarar el trabajo terminado, y después `superpowers:finishing-a-development-branch` si se trabajó en branch. Recordatorio: el push lo corre Mariano.
