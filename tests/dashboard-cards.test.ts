import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { DASHBOARD_GROUPS, type DashboardCard } from "@/lib/admin/dashboard-cards";

// Regla: una tarjeta sin `href` se muestra como "Próximamente" y no puede
// llevar `cta` (no habría adónde ir). El tipo no la fuerza —`href` y `cta` son
// los dos opcionales— así que la chequeamos a mano. No la usa nadie más que
// este test: la página ya rama sobre `card.href` solo, sin mirar `cta`.
function isValidRoadmapCard(card: DashboardCard): boolean {
  if (card.href) return true;
  return card.cta === undefined;
}

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
});

describe("roadmap card without href never carries a cta", () => {
  it("flags a roadmap card that carries a cta and accepts one that doesn't", () => {
    // Fixture local, no DASHBOARD_GROUPS: hoy no hay ninguna tarjeta roadmap ahí
    // —"Solicitudes" salió en el M3 y "Tesorería" en el M4— así que filtrar la
    // lista viva deja el loop sin iteraciones y el test pasa sin verificar nada.
    // Estas tres formas (roadmap válida, roadmap con CTA colgado, tarjeta viva)
    // sí ejercitan la regla y el test puede fallar de verdad.
    const roadmapCard: DashboardCard = { title: "Próxima sección", description: "En construcción." };
    const roadmapCardWithStrayCta: DashboardCard = {
      title: "Próxima sección",
      description: "En construcción.",
      cta: "Ver",
    };
    const liveCard: DashboardCard = {
      title: "Socios",
      description: "Padrón, fichas y estado de cada socio.",
      href: "/admin/socios",
      cta: "Ver el padrón",
    };

    expect(isValidRoadmapCard(roadmapCard)).toBe(true);
    expect(isValidRoadmapCard(liveCard)).toBe(true);
    expect(isValidRoadmapCard(roadmapCardWithStrayCta)).toBe(false);
  });
});
