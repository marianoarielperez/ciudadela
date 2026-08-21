// El `reason` de la suscripción tiene un tope DURO de 60 en Mercado Pago, y
// pasarse no degrada nada: rechaza el pedido entero con 400 y el vecino no
// llega al checkout. Esto se prueba sin base ni red porque el módulo es puro
// (CLAUDE.md: reglas de negocio como funciones puras, testeadas aparte).
import { describe, expect, it } from "vitest";
import { MAX_SUBSCRIPTION_REASON, clampReason, subscriptionReason } from "@/lib/mp/reason";

// Los dos `reason` reales de los planes cargados en MP el 21/08/2026. El de
// adherente es el que disparó el 400 con el formato anterior.
const PLAN_ACTIVE = "SOCIO ACTIVO";
const PLAN_SHARED = "SOCIO ADHERENTE/COLABORADOR";

function withinMpLimit(s: string) {
  return s.length <= MAX_SUBSCRIPTION_REASON && Buffer.byteLength(s, "utf8") <= MAX_SUBSCRIPTION_REASON;
}

describe("subscriptionReason", () => {
  it("entra en el límite de MP con los dos planes reales", () => {
    expect(withinMpLimit(subscriptionReason(PLAN_ACTIVE))).toBe(true);
    expect(withinMpLimit(subscriptionReason(PLAN_SHARED))).toBe(true);
  });

  it("nombra la asociación y la categoría", () => {
    const reason = subscriptionReason(PLAN_SHARED);
    expect(reason).toContain("Vecinal Ciudadela");
    expect(reason).toContain("SOCIO ADHERENTE");
  });

  it("entra en el límite aunque la CD cargue un plan largo desde el panel de MP", () => {
    const largo = "CATEGORÍA DE SOCIO ADHERENTE COLABORADOR CON APORTE EXTRAORDINARIO";
    expect(withinMpLimit(subscriptionReason(largo))).toBe(true);
  });

  it("sigue nombrando a la asociación cuando el plan viene sin nombre", () => {
    expect(subscriptionReason("")).toBe("Cuota Vecinal Ciudadela");
    expect(subscriptionReason("   ")).toBe("Cuota Vecinal Ciudadela");
  });
});

describe("clampReason", () => {
  it("deja intacto lo que ya entra", () => {
    expect(clampReason("Cuota Vecinal Ciudadela - SOCIO ACTIVO")).toBe("Cuota Vecinal Ciudadela - SOCIO ACTIVO");
  });

  it("cuenta BYTES, no sólo caracteres", () => {
    // 60 caracteres pero 120 bytes: si sólo mirara `length`, pasaría.
    const acentos = "á".repeat(60);
    const out = clampReason(acentos);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(MAX_SUBSCRIPTION_REASON);
    expect(out.length).toBe(30);
  });

  it("no deja el separador ni un espacio colgando al final", () => {
    const out = clampReason(`${"x".repeat(58)} - algo`);
    expect(out).toBe("x".repeat(58));
  });

  it("no rompe con la cadena vacía", () => {
    expect(clampReason("")).toBe("");
    expect(clampReason("   ")).toBe("");
  });
});
