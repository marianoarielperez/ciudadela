// Las sub-pestañas de /mi/solicitudes (spec §6.2), con la trampa del prefijo
// hermano: /mi/solicitudes es prefijo de /mi/solicitudes/reportes, así que
// "reportes gana por prefijo; el resto es institucional".
import { describe, expect, it } from "vitest";
import { isMiSolicitudesTabActive, MI_SOLICITUDES_TABS } from "@/lib/mi/solicitudes-tabs";

const INST = "/mi/solicitudes";
const REP = "/mi/solicitudes/reportes";

describe("MI_SOLICITUDES_TABS", () => {
  it("Institucional primero, Reportes después", () => {
    expect(MI_SOLICITUDES_TABS.map((t) => t.href)).toEqual([INST, REP]);
  });
});

describe("isMiSolicitudesTabActive", () => {
  it("institucional en su ruta y NO en reportes", () => {
    expect(isMiSolicitudesTabActive(INST, INST)).toBe(true);
    expect(isMiSolicitudesTabActive(REP, INST)).toBe(false);
    expect(isMiSolicitudesTabActive(`${REP}/nuevo`, INST)).toBe(false);
  });
  it("reportes en su ruta y sus subrutas", () => {
    expect(isMiSolicitudesTabActive(REP, REP)).toBe(true);
    expect(isMiSolicitudesTabActive(`${REP}/nuevo/abc`, REP)).toBe(true);
    expect(isMiSolicitudesTabActive(INST, REP)).toBe(false);
  });
  it("no confunde una ruta ajena", () => {
    expect(isMiSolicitudesTabActive("/mi/cuenta", INST)).toBe(false);
    expect(isMiSolicitudesTabActive("/mi/cuenta", REP)).toBe(false);
  });
});
