// El polígono del barrio Ciudadela transcripto de `datos/limites-barrio.kml`
// (spec §3.4). Se fija: que la constante coincide vértice por vértice con el KML
// del repo (si alguien actualiza el archivo sin tocar la constante, esto lo
// dice), que la sede cae adentro, que el centro de la ciudad cae afuera, y que
// el path SVG de la silueta se arma dentro del viewBox pedido.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SITE } from "@/lib/site";
import {
  BARRIO_BOUNDARY, BARRIO_BOUNDS, BARRIO_CENTER, boundaryToSvgPath, isInsideBoundary,
} from "@/lib/reports/boundary";

function kmlRing(): Array<[number, number]> {
  const xml = readFileSync(path.resolve(import.meta.dirname, "..", "datos", "limites-barrio.kml"), "utf8");
  const raw = /<coordinates>([\s\S]*?)<\/coordinates>/.exec(xml)?.[1] ?? "";
  return raw.trim().split(/\s+/).map((triple) => {
    const [lng, lat] = triple.split(",").map(Number);
    return [lat, lng];
  });
}

describe("BARRIO_BOUNDARY", () => {
  it("coincide vértice por vértice con datos/limites-barrio.kml (lat, lng)", () => {
    const ring = kmlRing();
    expect(BARRIO_BOUNDARY.length).toBe(ring.length);
    ring.forEach(([lat, lng], i) => {
      expect(BARRIO_BOUNDARY[i][0]).toBeCloseTo(lat, 9);
      expect(BARRIO_BOUNDARY[i][1]).toBeCloseTo(lng, 9);
    });
  });

  it("es un anillo cerrado", () => {
    expect(BARRIO_BOUNDARY[0]).toEqual(BARRIO_BOUNDARY[BARRIO_BOUNDARY.length - 1]);
  });

  it("la caja envolvente y el centro salen del anillo", () => {
    expect(BARRIO_BOUNDS.south).toBeLessThan(BARRIO_BOUNDS.north);
    expect(BARRIO_BOUNDS.west).toBeLessThan(BARRIO_BOUNDS.east);
    expect(BARRIO_CENTER[0]).toBeGreaterThan(BARRIO_BOUNDS.south);
    expect(BARRIO_CENTER[0]).toBeLessThan(BARRIO_BOUNDS.north);
    expect(BARRIO_CENTER[1]).toBeGreaterThan(BARRIO_BOUNDS.west);
    expect(BARRIO_CENTER[1]).toBeLessThan(BARRIO_BOUNDS.east);
  });
});

describe("isInsideBoundary", () => {
  it("la sede vecinal está adentro", () => {
    expect(isInsideBoundary(SITE.lat, SITE.lng)).toBe(true);
  });
  it("el centro de Comodoro está afuera", () => {
    expect(isInsideBoundary(-45.8647, -67.4823)).toBe(false);
  });
  it("un punto justo fuera de la caja está afuera", () => {
    expect(isInsideBoundary(BARRIO_BOUNDS.north + 0.001, BARRIO_CENTER[1])).toBe(false);
  });
  it("una esquina de la caja está adentro de la caja pero afuera del polígono", () => {
    // Los dos casos de arriba cortan en el chequeo de la caja envolvente y nunca
    // llegan al ray casting. Las esquinas NE, NO y SE de la caja sí entran al
    // polígono como candidatas y quedan afuera: es lo único que ejercita el
    // algoritmo en su rama negativa.
    expect(isInsideBoundary(BARRIO_BOUNDS.north, BARRIO_BOUNDS.east)).toBe(false);
    expect(isInsideBoundary(BARRIO_BOUNDS.north, BARRIO_BOUNDS.west)).toBe(false);
    expect(isInsideBoundary(BARRIO_BOUNDS.south, BARRIO_BOUNDS.east)).toBe(false);
  });
});

describe("boundaryToSvgPath", () => {
  it("arma un path cerrado con un punto por vértice, dentro del viewBox", () => {
    const d = boundaryToSvgPath(200, 120, 4);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = numbers.filter((_, i) => i % 2 === 0);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...xs)).toBeLessThanOrEqual(196);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...ys)).toBeLessThanOrEqual(116);
    // Un vértice por punto del anillo sin el cierre repetido.
    expect(xs.length).toBe(BARRIO_BOUNDARY.length - 1);
    // La proporción dibujada es la del barrio proyectado con la corrección por el
    // coseno de la latitud media: sin ella el barrio sale ~30% más ancho.
    const expectedRatio =
      (BARRIO_BOUNDS.north - BARRIO_BOUNDS.south) /
      ((BARRIO_BOUNDS.east - BARRIO_BOUNDS.west) * Math.cos((BARRIO_CENTER[0] * Math.PI) / 180));
    expect((Math.max(...ys) - Math.min(...ys)) / (Math.max(...xs) - Math.min(...xs))).toBeCloseTo(
      expectedRatio,
      2,
    );
  });
});
