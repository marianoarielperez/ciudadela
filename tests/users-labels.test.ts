import { describe, expect, it } from "vitest";
import { accountState, ACCOUNT_STATE_LABELS, auditActionLabel } from "@/lib/users/labels";
import { parseUserFilters } from "@/lib/users/query";

const NOW = new Date("2026-08-29T12:00:00Z");
const live = { expiresAt: new Date("2026-09-04T12:00:00Z"), usedAt: null };
const expired = { expiresAt: new Date("2026-08-01T12:00:00Z"), usedAt: null };
const used = { expiresAt: new Date("2026-09-04T12:00:00Z"), usedAt: NOW };

describe("accountState", () => {
  it("una cuenta desactivada es 'disabled' aunque tenga invitación viva", () => {
    expect(accountState({ active: false, passwordChangedAt: null }, live, NOW)).toBe("disabled");
  });
  it("invitación viva sin contraseña → 'invited'", () => {
    expect(accountState({ active: true, passwordChangedAt: null }, live, NOW)).toBe("invited");
  });
  it("invitación vencida sin contraseña → 'invitation_expired'", () => {
    expect(accountState({ active: true, passwordChangedAt: null }, expired, NOW)).toBe("invitation_expired");
  });
  it("token canjeado → 'active' (passwordChangedAt quedó escrito en el canje)", () => {
    expect(accountState({ active: true, passwordChangedAt: NOW }, used, NOW)).toBe("active");
  });
  it("passwordChangedAt null SIN invitación jamás emitida es 'active' (fila previa a la migración de la columna)", () => {
    expect(accountState({ active: true, passwordChangedAt: null }, null, NOW)).toBe("active");
  });
  it("todo estado tiene etiqueta", () => {
    for (const s of ["active", "disabled", "invited", "invitation_expired"] as const) {
      expect(ACCOUNT_STATE_LABELS[s]).toBeTruthy();
    }
  });
});

describe("auditActionLabel", () => {
  it("traduce las conocidas y devuelve la cruda como fallback", () => {
    expect(auditActionLabel("role_grant")).toBe("Rol otorgado");
    expect(auditActionLabel("accion_rara")).toBe("accion_rara");
  });
});

describe("parseUserFilters", () => {
  it("solo acepta vistas válidas y trimea la búsqueda", () => {
    expect(parseUserFilters({ vista: "gestion", q: "  ana " })).toEqual({ vista: "gestion", q: "ana" });
    expect(parseUserFilters({ vista: "basura" })).toEqual({});
    expect(parseUserFilters({ vista: ["gestion", "socios"] })).toEqual({ vista: "gestion" });
    expect(parseUserFilters({})).toEqual({});
  });
});
