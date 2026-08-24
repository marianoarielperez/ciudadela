import { describe, expect, it } from "vitest";
import { isMiTabActive, MI_TABS } from "@/lib/mi/nav";

describe("MI_TABS", () => {
  it("has unique hrefs, all under /mi", () => {
    const hrefs = MI_TABS.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href.startsWith("/mi")).toBe(true);
  });

  it("starts at Inicio (/mi)", () => {
    expect(MI_TABS[0]).toMatchObject({ href: "/mi", label: "Inicio" });
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
