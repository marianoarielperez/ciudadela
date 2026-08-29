import { describe, expect, it } from "vitest";

import { SALUD_TABS, actCountByTab, alertHrefFor, tabForAlertHref } from "@/lib/admin/salud-tabs";

describe("SALUD_TABS", () => {
  it("define las cuatro pestañas en orden, sin valores repetidos", () => {
    expect(SALUD_TABS.map((t) => t.value)).toEqual([
      "tareas", "infraestructura", "dinero", "correo",
    ]);
    expect(new Set(SALUD_TABS.map((t) => t.value)).size).toBe(4);
  });
});

describe("tabForAlertHref", () => {
  // Los literales están COPIADOS de health-alerts.ts (que no se toca): son
  // todos los href que el veredicto puede emitir hoy. El cruce contra el
  // render real lo hace admin-health-screen.test.ts.
  it("mapea cada ancla a su pestaña", () => {
    expect(tabForAlertHref("#tareas")).toBe("tareas");
    expect(tabForAlertHref("#backup")).toBe("infraestructura");
    expect(tabForAlertHref("#mercado-pago")).toBe("infraestructura");
    expect(tabForAlertHref("#dinero")).toBe("dinero");
    expect(tabForAlertHref("#avisos")).toBe("correo");
    expect(tabForAlertHref("#recibos")).toBe("correo");
  });
  it("la alerta de accesos cae en la pestaña Correo", () => {
    // El enlace de invitación que no llegó (o que nadie usó) es un asunto de
    // correo: el panel vive con los avisos y los recibos.
    expect(tabForAlertHref("#accesos")).toBe("correo");
    expect(alertHrefFor("#accesos")).toBe("?tab=correo#accesos");
  });
  it("las rutas de Tesorería cuentan como Dinero", () => {
    expect(tabForAlertHref("/admin/tesoreria/suscripciones")).toBe("dinero");
    expect(tabForAlertHref("/admin/tesoreria/sin-conciliar")).toBe("dinero");
  });
  it("un ancla desconocida o una ruta ajena no mapean", () => {
    expect(tabForAlertHref("#otra-cosa")).toBeNull();
    expect(tabForAlertHref("/admin/socios/3")).toBeNull();
  });
});

describe("alertHrefFor", () => {
  it("traduce un ancla a ?tab=X#ancla", () => {
    expect(alertHrefFor("#tareas")).toBe("?tab=tareas#tareas");
    expect(alertHrefFor("#recibos")).toBe("?tab=correo#recibos");
  });
  it("deja las rutas y las anclas desconocidas como están", () => {
    expect(alertHrefFor("/admin/tesoreria/suscripciones")).toBe("/admin/tesoreria/suscripciones");
    expect(alertHrefFor("#otra-cosa")).toBe("#otra-cosa");
  });
});

describe("actCountByTab", () => {
  it("cuenta act por pestaña, rutas de tesorería incluidas", () => {
    expect(actCountByTab([
      { href: "#tareas" },
      { href: "#tareas" },
      { href: "#recibos" },
      { href: "/admin/tesoreria/suscripciones" },
    ])).toEqual({ tareas: 2, correo: 1, dinero: 1 });
  });
  it("sin act, no hay puntos", () => {
    expect(actCountByTab([])).toEqual({});
  });
});
