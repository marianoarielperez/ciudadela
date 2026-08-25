import { describe, expect, it } from "vitest";
import { isSolicitudesTabActive, SOLICITUDES_TABS_BASE } from "@/lib/admin/solicitudes-tabs";

describe("SOLICITUDES_TABS_BASE", () => {
  it("Altas primero, De socios apuntando a la subruta que todavía no existe (tarea 8)", () => {
    expect(SOLICITUDES_TABS_BASE.map((t) => t.href)).toEqual([
      "/admin/solicitudes", "/admin/solicitudes/socios",
    ]);
  });
});

// Los cinco casos del brief: la pestaña Altas se prende en la bandeja, el
// detalle y el resumen, pero NO en /admin/solicitudes/socios; esa última
// sólo se prende a sí misma.
describe("isSolicitudesTabActive", () => {
  const ALTAS = "/admin/solicitudes";
  const SOCIOS = "/admin/solicitudes/socios";

  it("Altas está activa en la bandeja", () => {
    expect(isSolicitudesTabActive("/admin/solicitudes", ALTAS)).toBe(true);
  });

  it("Altas está activa en el detalle de una solicitud", () => {
    expect(isSolicitudesTabActive("/admin/solicitudes/42", ALTAS)).toBe(true);
  });

  it("Altas está activa en el resumen para acta", () => {
    expect(isSolicitudesTabActive("/admin/solicitudes/resumen", ALTAS)).toBe(true);
  });

  it("Altas NO está activa en /admin/solicitudes/socios: esa ruta es de la otra pestaña", () => {
    expect(isSolicitudesTabActive("/admin/solicitudes/socios", ALTAS)).toBe(false);
  });

  it("De socios está activa en su propia ruta", () => {
    expect(isSolicitudesTabActive("/admin/solicitudes/socios", SOCIOS)).toBe(true);
  });

  // Casos extra, por las dudas: una subruta de socios sigue siendo de socios,
  // y no hay confusión con un prefijo hermano.
  it("De socios cubre también sus subrutas", () => {
    expect(isSolicitudesTabActive("/admin/solicitudes/socios/7", SOCIOS)).toBe(true);
    expect(isSolicitudesTabActive("/admin/solicitudes/socios/7", ALTAS)).toBe(false);
  });

  it("no confunde con una ruta ajena", () => {
    expect(isSolicitudesTabActive("/admin/socios", ALTAS)).toBe(false);
    expect(isSolicitudesTabActive("/admin/socios", SOCIOS)).toBe(false);
  });
});
