# Rediseño de /ubicacion — "La sede" (ArgenMap + rediseño visual)

**Fecha:** 2026-08-28
**Estado:** aprobado por el operador (tres rondas de preguntas + diseño presentado)
**Alcance:** solo cambios visuales y de presentación. Cero cambios en pagos,
tesorería, Mercado Pago, panel o wizards.

## 1. Objetivo

Rediseñar por completo la página pública `/ubicacion`:

- Reemplazar el iframe de OpenStreetMap por **ArgenMap del IGN** (cartografía
  oficial argentina, Ley 22.963) renderizado con **Leaflet pelado** en un client
  component.
- Pasar de "formulario de datos" a una página que **presenta el lugar**: mapa
  protagonista, tarjeta superpuesta con la dirección y "Cómo llegar", y una
  franja de cards con contacto, salones e historia institucional.
- La URL no cambia (`/ubicacion`), la nav pública sigue diciendo "Ubicación",
  y los enlaces entrantes existentes siguen funcionando.

## 2. Contexto verificado (28/08/2026)

- La página actual es un único Server Component:
  `src/app/(public)/ubicacion/page.tsx` (h1 "Ubicación y contacto" + grid de
  3 bloques: sede / iframe OSM / contacto). Sin dependencias de mapas en el
  repo. Sin tests directos (solo `tests/seo.test.ts` verifica el sitemap).
- Tiles de ArgenMap verificados contra el servicio vivo:
  `https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/capabaseargenmap@EPSG:3857@png/{z}/{x}/{-y}.png`
  — HTTPS, CORS abierto (`Access-Control-Allow-Origin: *`), sin API key,
  `Cache-Control: max-age=1296000`, uso libre (Ley 27.275, `Fees: none`),
  99,33 % de disponibilidad medida en 30 días (GeoHealthCheck IDEBA), más
  rápido que OSM desde Argentina. Nombres de calle legibles en el barrio
  Ciudadela hasta z=19.
- En Leaflet la URL TMS se escribe con `{y}` y `tms: true` (el `{-y}` es
  sintaxis TMS que Leaflet no interpola).
- Atribución **obligatoria** (la capa integra datos de OSM bajo ODbL):
  "Instituto Geográfico Nacional + OpenStreetMap", con los enlaces oficiales.
- CSP actual (`next.config.ts:86-99`): `img-src 'self' data: blob:` bloquearía
  los tiles; `frame-src` incluye `https://www.openstreetmap.org` que quedará
  muerto al eliminar el iframe.
- Coordenadas de la sede: `SITE.lat = -45.79713687`, `SITE.lng = -67.494067`
  (`src/lib/site.ts`), consumidas hoy SOLO por esta página.

## 3. Decisiones tomadas (rondas con el operador)

| Tema | Decisión |
|---|---|
| Integración | Leaflet pelado (sin react-leaflet), client component + `dynamic(..., { ssr: false })` |
| Protagonismo | Mapa protagonista dentro del contenedor `max-w-5xl` (no full-bleed) |
| Contenido nuevo | "Cómo llegar" + salones de la sede + datos institucionales ampliados |
| Capa base | `capabaseargenmap` (estándar). Sin variante oscura por ahora: el sitio público solo renderiza en claro |
| Marcador | Pin propio: divIcon SVG celeste `#0079BC` con halo blanco, sin PNGs de Leaflet |
| Interacción | Cuidada: sin rueda, un dedo scrollea la página, pinch con dos dedos, botones de zoom, "Volver a la sede" |
| Fallback | Automático a `tile.openstreetmap.org` tras N `tileerror`, con atribución actualizada |
| SEO | `alternates.canonical` + JSON-LD `Place` con `GeoCoordinates`; title "La sede — Vecinal Ciudadela" |
| Composición | Tarjeta de dirección superpuesta al mapa en desktop; debajo del mapa en mobile |
| Cómo llegar | Un solo destino: Google Maps con la ruta a la sede |
| Título | h1 "La sede" (la nav sigue diciendo "Ubicación") |

## 4. Diseño de la página

Contenedor: `<main class="mx-auto w-full max-w-5xl px-4 py-10">` (molde
estándar de las páginas públicas informativas).

### 4.1 Encabezado

- **Eyebrow de coordenadas** (firma visual de la página): las coordenadas
  reales de la sede en Geist Mono, versalitas celestes —
  `45°47′S · 67°29′O` — `font-mono text-xs font-semibold tracking-[0.14em]
  text-primary uppercase` (la voz del eyebrow de los wizards, en mono).
  Derivadas de `SITE.lat/lng` por una función pura (no hardcodeadas).
- `h1` "La sede" — `text-2xl font-semibold` (patrón de páginas de sección).
- Bajada `mt-2 text-sm text-muted-foreground`: dónde queda la sede de la
  Asociación y cómo comunicarse con la Comisión Directiva.

### 4.2 Mapa protagonista

Bloque `mt-8 overflow-hidden rounded-2xl ring-1 ring-foreground/10` con alto
`h-[26rem] sm:h-[30rem]`, `position: relative`.

- **Tiles**: ArgenMap estándar, `tms: true`, `minZoom: 3`, `maxZoom: 19`,
  centro `SITE.lat/lng`, zoom inicial 16.
- **Pin**: `L.divIcon` con SVG inline — gota rellena `#0079BC`, borde/halo
  blanco, punto interior blanco, sombra suave. Tamaño ~40×48, anclado a la
  punta.
- **Tarjeta superpuesta** (desktop, `sm:` para arriba): `absolute` esquina
  superior izquierda, `bg-card` opaca, `rounded-xl ring-1 ring-foreground/10
  shadow-lg`, `z` sobre el mapa. Contenido: eyebrow "Sede vecinal"
  (`COLUMN_HEADING`-style), `SITE.address`, `SITE.city`, y el botón primario
  **"Cómo llegar"** (`bg-primary`, `min-h-11`, ícono Lucide `Navigation`)
  → `https://maps.google.com/?daddr={lat},{lng}` en pestaña nueva
  (`rel="noopener noreferrer"`). En mobile (`< sm`) la tarjeta NO se superpone:
  se renderiza como bloque a lo ancho inmediatamente debajo del mapa.
- **Botón "Volver a la sede"**: control flotante propio (esquina inferior
  derecha, `size ≥ 44px`, `bg-card ring-1`, ícono `MapPin` o `Locate`,
  `aria-label`), recentra y restaura el zoom inicial.
- **Controles de zoom** de Leaflet visibles (posición que no choque con la
  tarjeta).
- **Atribución**: la de Leaflet, con el HTML oficial
  IGN (+ enlace a la introducción de Argenmap) + OpenStreetMap
  (+ enlace a osm.org/copyright).
- **Interacción**: `scrollWheelZoom: false`; `dragging` desactivado en
  dispositivos táctiles (`!L.Browser.mobile`), `touchZoom: true` (pinch con
  dos dedos sigue andando); `doubleClickZoom` activo. Un dedo siempre
  scrollea la página.
- **Fallback**: listener de `tileerror` en la capa IGN; superado un umbral
  (≥ 3 errores), se remueve la capa y se agrega
  `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (maxZoom 19, atribución
  OSM estándar). Un flag evita re-entrar. El umbral y las URLs viven en una
  función/constantes puras testeables.
- **Accesibilidad**: el contenedor del mapa lleva `aria-label` descriptivo;
  el contenido informativo (dirección, botón) NUNCA vive solo dentro del
  canvas del mapa — la tarjeta es HTML normal. `motion-reduce:` no aplica
  (Leaflet no anima nada propio relevante); focos con
  `outline-hidden focus-visible:ring-2 focus-visible:ring-ring` en los
  controles propios.

### 4.3 Franja de información (debajo del mapa)

`mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3` con cards del sistema
(`Card` de shadcn: `rounded-xl ring-1 ring-foreground/10`), cada una con el
chip de ícono tintado del tablero
(`flex size-9 items-center justify-center rounded-lg bg-primary/10
text-primary` + ícono `size-5` `aria-hidden`):

1. **Contacto** (`Phone`/`Mail`): teléfono (link `tel:` sanitizado con el
   `replace(/[^\d+]/g, "")` actual) y email (`mailto:`) desde
   `getContactInfo()`. Si no hay ninguno, el mismo texto de estado vacío
   actual ("Los datos de contacto se están actualizando…" — conservar el
   texto vigente de la página, byte a byte).
2. **La sede por dentro** (`Landmark`): lista de los cuatro salones de
   `SITE.rooms` con los íconos de `src/lib/activities/room-meta.ts`
   (reutilizados, no copiados), y un enlace "Ver qué pasa en cada salón" →
   `/actividades` (patrón `LINK_TARGET`-style, `min-h-11`).
3. **Historia** (`ScrollText`): línea de tiempo vertical de tres hitos —
   1964 (fundación, `SITE.founded`), 2015 (fundación legal,
   `SITE.legallyFounded`), personería (`SITE.legalStatus`). Marcadores de
   punto celeste + borde izquierdo, años en `font-mono tabular-nums`.

Targets ≥ 44px en todo control; `[overflow-wrap:anywhere]` donde haya texto
que pueda desbordar en 375px.

### 4.4 Lo que desaparece

- El iframe de OSM y sus constantes (`D`, `bbox`, `OSM_EMBED`, `OSM_LINK`).
- El enlace "Ver el mapa completo en OpenStreetMap" (reemplazado por
  "Cómo llegar" → Google Maps).
- El párrafo suelto de "Fundación legal" (absorbido por la card Historia).

## 5. Arquitectura de componentes

```
src/app/(public)/ubicacion/
├── page.tsx              Server Component. Metadata + JSON-LD + encabezado,
│                         monta <SedeMap/> y la franja de cards.
│                         Sigue leyendo getContactInfo().
├── sede-map-loader.tsx   "use client". dynamic(() => import("./sede-map"),
│                         { ssr: false, loading: placeholder del mismo alto }).
├── sede-map.tsx          "use client". Leaflet: mapa, tiles IGN, pin divIcon,
│                         botón recentrar, fallback tileerror. useEffect con
│                         cleanup (map.remove()).
└── map-config.ts         Módulo PURO sin "use client": URLs de tiles (IGN y
                          OSM), atribuciones, zooms, umbral de fallback,
                          formatDMS(lat, lng) para el eyebrow, y la URL de
                          Google Maps. Es lo que se testea.
```

- `page.tsx` sigue siendo Server Component; solo el mapa es cliente.
- `import "leaflet/dist/leaflet.css"` desde `sede-map.tsx` (Next lo hoistea
  al CSS global; ~4 KB gzip, aceptado).
- Dependencias nuevas: `leaflet` (^1.9.4) y `@types/leaflet` (dev). Nada más.

## 6. Cambios fuera de la ruta

### 6.1 CSP — `next.config.ts`

- `img-src`: agregar `https://wms.ign.gob.ar` y
  `https://tile.openstreetmap.org` (tiles IGN + fallback).
- `frame-src`: quitar `https://www.openstreetmap.org` (ya no hay iframe).
  Quedan MP y Turnstile intactos.
- Actualizar el comentario de `next.config.ts:25-28` que documenta el
  proveedor de mapa.
- NADA más cambia: Leaflet entra por npm (`script-src 'self'` ya lo cubre),
  no hay fetch/XHR nuevos (`connect-src` intacto).

### 6.2 SEO — dentro de `page.tsx`

- `alternates: { canonical: "/ubicacion" }` (mismo patrón que
  `/actividades`).
- `title: "La sede — Vecinal Ciudadela"`, description actualizada.
- JSON-LD `Place` con `GeoCoordinates` (`SITE.lat/lng`), `address` (mismo
  `PostalAddress` que la home) y `name`. Inyectado con
  `dangerouslySetInnerHTML` desde constantes propias (mismo criterio
  documentado en la home).

### 6.3 Qué NO se toca

- `src/lib/treasury/*`, `src/lib/mp/*`, rutas de pagos, panel, wizards: nada.
- `src/lib/site.ts`: nada (todos los datos necesarios ya existen).
- `src/lib/public-nav.ts`, header, footer: nada.
- `tests/` existentes: deben pasar sin modificar (el sitemap no cambia).

## 7. Tests

- `tests/ubicacion-map-config.test.ts` (nuevo, Vitest puro, sin Prisma ni
  red): URLs de tiles bien formadas ({z}/{x}/{y}, host correcto), URL de
  Google Maps con las coordenadas de `SITE`, `formatDMS` produce
  `45°47′S · 67°29′O` para las coordenadas reales, umbral de fallback.
- Suite completa verde (`npm test`) como criterio de cierre.
- Verificación visual con dev server + navegador: desktop, mobile 375px
  (tarjeta debajo del mapa, sin scroll-trap), estado sin contacto cargado,
  fallback simulado (bloquear wms.ign.gob.ar en devtools) y atribución
  visible.

## 8. Criterios de aceptación

1. `/ubicacion` muestra ArgenMap con el pin celeste en la sede, sin iframe
   de OSM en el DOM.
2. La rueda del mouse sobre el mapa scrollea la página; en touch, un dedo
   scrollea y dos hacen zoom.
3. "Cómo llegar" abre Google Maps con destino a la sede.
4. Con `wms.ign.gob.ar` bloqueado, el mapa muestra tiles de OSM solo
   (fallback) y la atribución cambia.
5. Sin teléfono ni email cargados, la card Contacto muestra el estado vacío
   actual.
6. La CSP no bloquea ningún recurso (consola limpia) y el resto del sitio
   sigue sirviendo MP y Turnstile igual.
7. `npm test` entero verde sin tocar tests existentes; los nuevos tests de
   `map-config` pasan.
8. Lighthouse/bundle: el chunk de Leaflet NO entra en el JS inicial de las
   demás páginas.
