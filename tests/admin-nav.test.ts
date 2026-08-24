import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, isNavItemActive, navForRoles, parseSidebarState } from "@/lib/admin/nav";

describe("ADMIN_NAV routes", () => {
  it("points every href at a route that exists on disk", () => {
    // Una entrada de M3-M6 apuntando a una ruta que nadie creó todavía es un
    // 404 desde la lateral: se detecta acá y no en producción.
    const root = path.resolve(import.meta.dirname, "..", "src", "app");
    for (const href of ADMIN_NAV.flatMap((g) => g.items).map((i) => i.href)) {
      const file = path.join(root, ...href.split("/").filter(Boolean), "page.tsx");
      expect(existsSync(file), `${href} → ${file}`).toBe(true);
    }
  });
});

describe("navForRoles", () => {
  it("hides superadmin-only items from plain admins", () => {
    const groups = navForRoles(["admin"]);
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/admin/socios");
    expect(hrefs).not.toContain("/admin/configuracion");
  });

  it("keeps superadmin-only items for superadmin", () => {
    const hrefs = navForRoles(["superadmin"]).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/admin/configuracion");
  });

  it("drops groups left empty by the filter", () => {
    // "Sistema" solo tiene Configuración: para un admin común el grupo entero desaparece.
    const labels = navForRoles(["admin"]).map((g) => g.label);
    expect(labels).not.toContain("Sistema");
  });

  it("keeps every live section for superadmin, in stable order", () => {
    const hrefs = navForRoles(["superadmin", "admin"]).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual([
      "/admin", "/admin/solicitudes", "/admin/socios", "/admin/tesoreria", "/admin/actas",
      "/admin/noticias", "/admin/actividades", "/admin/salud", "/admin/padron-electoral",
      "/admin/configuracion",
    ]);
  });

  it("Salud vive en Sistema, va antes de Configuración y es sólo para superadmin", () => {
    // El orden dentro del grupo no es cosmético: Salud es la pantalla que se
    // abre cuando algo anda mal y Configuración la que se abre cuando hay que
    // cambiar algo.
    const sistema = ADMIN_NAV.find((g) => g.label === "Sistema")!;
    const salud = sistema.items.find((i) => i.href === "/admin/salud")!;
    expect(salud).toMatchObject({ label: "Salud", icon: "activity", superadminOnly: true });
    expect(sistema.items.map((i) => i.href)).toEqual([
      "/admin/salud", "/admin/padron-electoral", "/admin/configuracion",
    ]);
    expect(
      navForRoles(["admin"]).some((g) => g.items.some((i) => i.href === "/admin/salud")),
    ).toBe(false);
  });

  it("el padrón electoral es sólo del superadmin: prende y apaga una regla estatutaria", () => {
    // El flag `elecciones_en_curso` que se escribe desde esa pantalla bloquea
    // los cambios de categoría de TODO el panel (Art. 5° ter), y el padrón que
    // genera es el documento que se le entrega a la Junta Electoral.
    const sistema = ADMIN_NAV.find((g) => g.label === "Sistema")!;
    const padron = sistema.items.find((i) => i.href === "/admin/padron-electoral")!;
    expect(padron).toMatchObject({ label: "Padrón electoral", icon: "vote", superadminOnly: true });
    expect(
      navForRoles(["admin"]).some((g) => g.items.some((i) => i.href === "/admin/padron-electoral")),
    ).toBe(false);
  });

  it("does not mutate ADMIN_NAV", () => {
    const before = JSON.stringify(ADMIN_NAV);
    navForRoles(["admin"]);
    expect(JSON.stringify(ADMIN_NAV)).toBe(before);
  });
});

describe("isNavItemActive", () => {
  it("marks Inicio only on the exact dashboard route", () => {
    expect(isNavItemActive("/admin", "/admin")).toBe(true);
    expect(isNavItemActive("/admin/socios", "/admin")).toBe(false);
  });

  it("marks a section on its root and nested routes", () => {
    expect(isNavItemActive("/admin/socios", "/admin/socios")).toBe(true);
    expect(isNavItemActive("/admin/socios/143", "/admin/socios")).toBe(true);
    expect(isNavItemActive("/admin/socios/carga/45", "/admin/socios")).toBe(true);
    expect(isNavItemActive("/admin/socios/143/baja", "/admin/socios")).toBe(true);
    expect(isNavItemActive("/admin/salud", "/admin/salud")).toBe(true);
  });

  it("does not match sibling prefixes", () => {
    // "/admin/socios" NO debe activar un hipotético "/admin/soc".
    expect(isNavItemActive("/admin/socios", "/admin/soc")).toBe(false);
    expect(isNavItemActive("/admin/actas", "/admin/actividades")).toBe(false);
  });
});

describe("parseSidebarState", () => {
  it("falls back to expanded on missing or garbage values", () => {
    expect(parseSidebarState(undefined)).toBe("expanded");
    expect(parseSidebarState("")).toBe("expanded");
    expect(parseSidebarState("weird")).toBe("expanded");
  });

  it("honours collapsed", () => {
    expect(parseSidebarState("collapsed")).toBe("collapsed");
  });
});
