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
