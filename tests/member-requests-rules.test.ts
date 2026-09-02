import { describe, expect, it } from "vitest";
import {
  canCreateRequest, renderWithdrawalText, requestableCategories,
} from "@/lib/members/member-requests/rules";

describe("canCreateRequest", () => {
  it("allows a vigente member to request a withdrawal", () => {
    const result = canCreateRequest({
      type: "withdrawal",
      member: { status: "active", category: "adherent" },
      requestedCategory: null,
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(true);
  });

  it("blocks a suspended member (REG-20)", () => {
    const result = canCreateRequest({
      type: "withdrawal",
      member: { status: "suspended", category: "adherent" },
      requestedCategory: null,
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Solo un socio vigente puede presentar solicitudes.");
  });

  it("blocks a duplicate pending request of the same type", () => {
    const result = canCreateRequest({
      type: "withdrawal",
      member: { status: "active", category: "adherent" },
      requestedCategory: null,
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Ya tenés una solicitud pendiente");
  });

  it("a pending withdrawal does not block a category_change request (independent per type)", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "adherent" },
      requestedCategory: "active",
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(true);
  });

  it("requires a requested category", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "adherent" },
      requestedCategory: null,
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Elegí la categoría nueva.");
  });

  it("blocks a category outside REQUESTABLE_CATEGORIES (e.g. cadet)", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "adherent" },
      requestedCategory: "cadet",
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Elegí la categoría nueva.");
  });

  // The collaborator category belongs to the reformed statute, which the IGJ
  // has not approved yet (spec 2026-09-02): the switch decides whether it can
  // be requested, and the same function feeds the /mi/solicitudes cards.
  it("blocks requesting collaborator while colaborador_habilitado is off", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "adherent" },
      requestedCategory: "collaborator",
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: false,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Por ahora no se puede pedir el pase a socio colaborador.");
  });

  it("allows requesting collaborator once the switch is on", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "adherent" },
      requestedCategory: "collaborator",
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(true);
  });

  it("a collaborator member asking for collaborator gets 'already your category', not the switch message", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "collaborator" },
      requestedCategory: "collaborator",
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: false,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Esa ya es tu categoría.");
  });

  it("blocks requesting the same category the member already has", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "adherent" },
      requestedCategory: "adherent",
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Esa ya es tu categoría.");
  });

  it("blocks a category change while elections are ongoing (Art. 5° ter)", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "adherent" },
      requestedCategory: "active",
      electionsOngoing: true,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("elecciones");
  });

  it("blocks a category change with pending fees and states the count (REG-07, Art. 5° ter)", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "adherent" },
      requestedCategory: "active",
      electionsOngoing: false,
      pendingFees: 2,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("2 cuotas");
      expect(result.error).toContain("Art. 5° ter");
    }
  });

  it("allows an adherente to request active with zero pending fees", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "adherent" },
      requestedCategory: "active",
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(true);
  });

  it("does not block a withdrawal with pending fees — resigning with debt is allowed", () => {
    const result = canCreateRequest({
      type: "withdrawal",
      member: { status: "active", category: "adherent" },
      requestedCategory: null,
      electionsOngoing: false,
      pendingFees: 5,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(true);
  });
});

describe("requestableCategories", () => {
  it("drops only collaborator while the switch is off", () => {
    expect(requestableCategories(false)).toEqual(["active", "adherent"]);
    expect(requestableCategories(true)).toEqual(["active", "adherent", "collaborator"]);
  });
});

describe("renderWithdrawalText", () => {
  it("includes the member's name, number, formatted date and declared reason", () => {
    const text = renderWithdrawalText({
      fullName: "Juana Pérez",
      memberNumber: 15,
      date: new Date("2026-08-24T12:00:00Z"),
      message: "Me mudo del barrio.",
    });
    expect(text).toContain("Juana Pérez");
    expect(text).toContain("N° 15");
    expect(text).toContain("24/08/2026");
    expect(text).toContain("Motivo declarado: Me mudo del barrio.");
  });

  it("renders s/n when there is no member number and omits the reason line when there is no message", () => {
    const text = renderWithdrawalText({
      fullName: "Juan Gómez",
      memberNumber: null,
      date: new Date("2026-08-24T12:00:00Z"),
      message: null,
    });
    expect(text).toContain("s/n");
    expect(text).not.toContain("Motivo declarado");
  });
});
