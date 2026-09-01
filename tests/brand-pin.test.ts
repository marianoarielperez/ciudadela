// El pin de marca del mapa vive en un módulo compartido: /ubicacion, el picker
// del wizard y el mapa del admin dibujan el MISMO SVG, con el color que cada uno
// pide.
import { describe, expect, it } from "vitest";
import { PIN_ANCHOR, PIN_SIZE, PIN_SVG, pinSvg } from "@/components/map/brand-pin";

describe("brand pin", () => {
  it("el pin por defecto es celeste --primary con halo blanco", () => {
    expect(PIN_SVG).toContain('fill="#0079BC"');
    expect(PIN_SVG).toContain('stroke="#FFFFFF"');
    expect(PIN_SVG).toContain('aria-hidden="true"');
  });

  it("pinSvg cambia sólo el relleno", () => {
    const green = pinSvg("#15803D");
    expect(green).toContain('fill="#15803D"');
    expect(green).not.toContain('fill="#0079BC"');
    expect(green.replace("#15803D", "#0079BC")).toBe(PIN_SVG);
  });

  it("el tamaño y el ancla son los del divIcon de /ubicacion", () => {
    expect(PIN_SIZE).toEqual([40, 48]);
    expect(PIN_ANCHOR).toEqual([20, 46]);
  });
});
