import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { DASHBOARD_GROUPS } from "@/lib/admin/dashboard-cards";

// El tablero de /admin y la lateral son dos vistas de lo mismo. Cuando M3-M6
// agreguen secciones, olvidarse de una de las dos dejaba el tablero mintiendo
// en silencio: estos tests convierten ese olvido en un test rojo.

// Inicio apunta al tablero mismo: no tiene ni puede tener tarjeta propia.
const liveNavItems = ADMIN_NAV.flatMap((g) => g.items).filter(
  (i) => i.href && i.href !== "/admin",
);
const allCards = DASHBOARD_GROUPS.flatMap((g) => g.cards);

describe("DASHBOARD_GROUPS vs ADMIN_NAV", () => {
  it("gives every live nav section exactly one card", () => {
    for (const item of liveNavItems) {
      const matches = allCards.filter((c) => c.href === item.href);
      expect(matches, `href ${item.href}`).toHaveLength(1);
    }
  });

  it("uses the same label for the card title", () => {
    for (const item of liveNavItems) {
      const card = allCards.find((c) => c.href === item.href);
      expect(card?.title, `href ${item.href}`).toBe(item.label);
    }
  });

  it("keeps the same superadminOnly flag on both sides", () => {
    for (const item of liveNavItems) {
      const card = allCards.find((c) => c.href === item.href);
      expect(card?.superadminOnly ?? false, `href ${item.href}`).toBe(item.superadminOnly ?? false);
    }
  });

  it("does not link a card to a section the nav does not have", () => {
    const navHrefs = new Set(ADMIN_NAV.flatMap((g) => g.items).map((i) => i.href));
    for (const card of allCards) {
      if (card.href) expect(navHrefs, card.href).toContain(card.href);
    }
  });

  it("orders its groups like the nav does", () => {
    const navLabels = ADMIN_NAV.map((g) => g.label).filter((l): l is string => l !== null);
    const dashboardLabels = DASHBOARD_GROUPS.map((g) => g.label);
    // Orden RELATIVO: se comparan sólo los grupos que existen de los dos lados.
    const shared = new Set(dashboardLabels.filter((l) => navLabels.includes(l)));
    expect(dashboardLabels.filter((l) => shared.has(l)))
      .toEqual(navLabels.filter((l) => shared.has(l)));
  });

  it("allows roadmap cards without href as extras", () => {
    // No es un requisito, es la constancia de que el invariante los tolera:
    // "Solicitudes" y "Tesorería" son secciones futuras sin ruta todavía.
    const roadmap = allCards.filter((c) => !c.href).map((c) => c.title);
    expect(roadmap).toContain("Solicitudes");
    expect(roadmap).toContain("Tesorería");
  });
});
