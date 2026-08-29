import { describe, expect, it } from "vitest";
import {
  accountState, ACCOUNT_STATE_LABELS, auditActionLabel, hasManagedRole, MANAGED_ROLES,
} from "@/lib/users/labels";
import { parseUserFilters } from "@/lib/users/query";

const NOW = new Date("2026-08-29T12:00:00Z");
const live = { expiresAt: new Date("2026-09-04T12:00:00Z"), usedAt: null };
const expired = { expiresAt: new Date("2026-08-01T12:00:00Z"), usedAt: null };
const used = { expiresAt: new Date("2026-09-04T12:00:00Z"), usedAt: NOW };

describe("accountState", () => {
  it("una cuenta desactivada es 'disabled' aunque tenga invitación viva", () => {
    expect(accountState({ active: false, passwordChangedAt: null }, live, true, NOW)).toBe("disabled");
  });
  it("invitación viva sin contraseña → 'invited'", () => {
    expect(accountState({ active: true, passwordChangedAt: null }, live, true, NOW)).toBe("invited");
  });
  it("invitación vencida sin contraseña → 'invitation_expired'", () => {
    expect(accountState({ active: true, passwordChangedAt: null }, expired, true, NOW))
      .toBe("invitation_expired");
  });
  it("token canjeado → 'active' (passwordChangedAt quedó escrito en el canje)", () => {
    expect(accountState({ active: true, passwordChangedAt: NOW }, used, true, NOW)).toBe("active");
  });

  // EL caso del hallazgo. Una cuenta de gestión recién creada tiene el
  // `passwordChangedAt` en null y un hash de bytes aleatorios que nadie conoce:
  // no puede entrar. Y la fila del token se borra por DOS caminos normales
  // —revocar la invitación, y cambiarle el email antes del canje, que es lo que
  // el hint del formulario anuncia—, así que "no hay token" no es "canjeó".
  // Antes caía en el `return "active"` y la lista —el instrumento con el que se
  // contesta "¿quién tiene acceso?" en un recambio de Comisión— la pintaba de
  // verde, contradiciendo al propio detalle ("No hay una invitación viva…").
  it("cuenta de GESTIÓN sin contraseña y sin ninguna invitación → 'no_access'", () => {
    expect(accountState({ active: true, passwordChangedAt: null }, null, true, NOW)).toBe("no_access");
  });

  // La salvedad del null histórico se conserva, y es donde aplica: una cuenta de
  // SOCIO anterior a la migración que creó la columna tiene `passwordChangedAt`
  // en null sin que eso signifique "nunca tuvo contraseña". Esas cuentas nacen
  // del canje de su `password_invitation` y nunca tuvieron una fila
  // `admin_invitation` que mirar.
  it("passwordChangedAt null SIN invitación en una cuenta de SOCIO sigue siendo 'active'", () => {
    expect(accountState({ active: true, passwordChangedAt: null }, null, false, NOW)).toBe("active");
  });

  it("una cuenta de gestión desactivada y sin invitación sigue siendo 'disabled'", () => {
    // `disabled` gana: es el motivo más específico y el que el operador
    // resuelve primero (reactivar, y recién después reenviar).
    expect(accountState({ active: false, passwordChangedAt: null }, null, true, NOW)).toBe("disabled");
  });

  it("todo estado tiene etiqueta", () => {
    for (const s of ["active", "disabled", "invited", "invitation_expired", "no_access"] as const) {
      expect(ACCOUNT_STATE_LABELS[s]).toBeTruthy();
    }
    expect(ACCOUNT_STATE_LABELS.no_access).toBe("Sin invitación");
  });
});

describe("hasManagedRole", () => {
  // La ÚNICA definición de "cuenta de gestión": la comparten el `where` de los
  // chips (query.ts), el veredicto de la pantalla (detail-verdict.ts) y las
  // guardas del dominio (service.ts). Antes eran dos constantes con el mismo
  // par de strings.
  it("es exactamente admin + superadmin", () => {
    expect([...MANAGED_ROLES].sort()).toEqual(["admin", "superadmin"]);
    expect(hasManagedRole(["admin"])).toBe(true);
    expect(hasManagedRole(["superadmin"])).toBe(true);
    expect(hasManagedRole(["socio", "admin"])).toBe(true);
    expect(hasManagedRole(["socio"])).toBe(false);
    expect(hasManagedRole([])).toBe(false);
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
