import { describe, expect, it } from "vitest";
import { isMiTabActive, MI_TABS, miTabsFor } from "@/lib/mi/nav";

describe("MI_TABS", () => {
  it("has unique hrefs, all under /mi", () => {
    const hrefs = MI_TABS.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href.startsWith("/mi")).toBe(true);
  });

  it("starts at Inicio (/mi)", () => {
    expect(MI_TABS[0]).toMatchObject({ href: "/mi", label: "Inicio" });
  });

  it("includes Solicitudes between Mis datos and Documentos", () => {
    const hrefs = MI_TABS.map((t) => t.href);
    expect(hrefs.indexOf("/mi/solicitudes")).toBeGreaterThan(hrefs.indexOf("/mi/datos"));
    expect(hrefs.indexOf("/mi/solicitudes")).toBeLessThan(hrefs.indexOf("/mi/documentos"));
  });

  it("closes with Documentos (the old Estatuto tab, renamed)", () => {
    expect(MI_TABS.at(-1)).toMatchObject({ href: "/mi/documentos", label: "Documentos", icon: "library" });
    expect(MI_TABS.some((t) => t.href === "/mi/estatuto")).toBe(false);
  });

  it("includes Débito automático between Mi cuenta and Mis datos, marked paysFeeOnly", () => {
    const hrefs = MI_TABS.map((t) => t.href);
    expect(hrefs.indexOf("/mi/debito")).toBeGreaterThan(hrefs.indexOf("/mi/cuenta"));
    expect(hrefs.indexOf("/mi/debito")).toBeLessThan(hrefs.indexOf("/mi/datos"));
    expect(MI_TABS.find((t) => t.href === "/mi/debito")).toMatchObject({ paysFeeOnly: true });
  });
});

describe("miTabsFor", () => {
  it("hides /mi/debito for a category that does not pay a fee (e.g. vitalicio)", () => {
    const hrefs = miTabsFor(false).map((t) => t.href);
    expect(hrefs).not.toContain("/mi/debito");
    // El resto del padrón de pestañas sigue intacto.
    expect(hrefs).toEqual(MI_TABS.filter((t) => !t.paysFeeOnly).map((t) => t.href));
  });

  it("shows /mi/debito for a category that pays a fee (e.g. activo)", () => {
    const hrefs = miTabsFor(true).map((t) => t.href);
    expect(hrefs).toEqual(MI_TABS.map((t) => t.href));
  });
});

describe("isMiTabActive", () => {
  it("marks /mi only on the exact path (it is a prefix of everything)", () => {
    expect(isMiTabActive("/mi", "/mi")).toBe(true);
    expect(isMiTabActive("/mi/cuenta", "/mi")).toBe(false);
  });

  it("marks a section on itself and on its subroutes", () => {
    expect(isMiTabActive("/mi/cuenta", "/mi/cuenta")).toBe(true);
    expect(isMiTabActive("/mi/cuenta/algo", "/mi/cuenta")).toBe(true);
  });

  it("does not confuse sibling prefixes", () => {
    expect(isMiTabActive("/mi/cuentas-x", "/mi/cuenta")).toBe(false);
  });
});
