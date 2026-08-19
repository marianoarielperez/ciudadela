import { describe, expect, it } from "vitest";
import { buildExportRow, memberAddress, PADRON_EXPORT_COLUMNS, sanitizeFiltersForAudit } from "@/lib/members/export";
import type { Member, Street } from "@/generated/prisma/client";

// Fábrica mínima: sólo completamos lo que cada test necesita, el resto son los
// valores más comunes del padrón real (socio activo, sin baja, sin domicilio
// de catálogo). Así cada test declara nada más que lo que le importa.
function makeMember(overrides: Partial<Member & { street: Street | null }> = {}) {
  const base: Member & { street: Street | null } = {
    id: 1,
    fullName: "Coñuecar, Marta",
    dni: "12345678",
    birthDate: null,
    civilStatus: null,
    nationality: null,
    occupation: null,
    phone: "2974000000",
    streetId: null,
    street: null,
    streetText: "Pizarro , Francisco",
    streetNumber: "1234",
    neighborhood: "Ciudadela",
    email: "marta@example.com",
    emailStatus: "verified",
    emailVerifiedAt: null,
    category: "active",
    status: "active",
    withdrawalReason: null,
    joinedAt: new Date("2019-09-01T12:00:00Z"),
    leftAt: null,
    debtAtWithdrawal: false,
    autoDebit: true,
    reentryBlocked: false,
    rejectedUntil: null,
    suspendedFrom: null,
    suspendedTo: null,
    userId: null,
    createdAt: new Date("2019-09-01T12:00:00Z"),
    updatedAt: new Date("2019-09-01T12:00:00Z"),
  };
  return { ...base, ...overrides };
}

describe("memberAddress", () => {
  it("prefers the catalog street over streetText, and appends the number", () => {
    const member = makeMember({
      street: { id: 3, loadOrder: 1, name: "Agüero", normalizedName: "aguero" },
      streetText: null,
      streetNumber: "456",
    });
    expect(memberAddress(member)).toBe("Agüero 456");
  });

  it("falls back to streetText when there is no catalog street (member outside the neighborhood)", () => {
    const member = makeMember({ street: null, streetText: "Ñiripil", streetNumber: "78" });
    expect(memberAddress(member)).toBe("Ñiripil 78");
  });

  it("returns just the street when there is no number", () => {
    const member = makeMember({ street: null, streetText: "Paillamán", streetNumber: null });
    expect(memberAddress(member)).toBe("Paillamán");
  });

  it("returns an empty string when there is neither catalog street nor free text", () => {
    const member = makeMember({ street: null, streetText: null, streetNumber: null });
    expect(memberAddress(member)).toBe("");
  });
});

describe("PADRON_EXPORT_COLUMNS", () => {
  it("matches exactly the column names and order agreed with the client", () => {
    expect(PADRON_EXPORT_COLUMNS.map((c) => c.header)).toEqual([
      "numero_socio", "apellido_nombre", "dni", "categoria", "estado", "email",
      "email_estado", "telefono", "domicilio", "barrio", "fecha_ingreso",
      "fecha_egreso", "motivo_baja", "deuda_tesoreria", "debito_automatico",
    ]);
  });
});

describe("sanitizeFiltersForAudit", () => {
  it("drops the free-text query value and keeps only whether one was used", () => {
    expect(sanitizeFiltersForAudit({ q: "Coñuecar" })).toEqual({ hasQuery: true });
    expect(sanitizeFiltersForAudit({ q: "12345678" })).toEqual({ hasQuery: true });
  });

  it("marks hasQuery false when there was no free-text search", () => {
    expect(sanitizeFiltersForAudit({})).toEqual({ hasQuery: false });
  });

  it("passes enum-valued filters through untouched (not personal data)", () => {
    expect(sanitizeFiltersForAudit({ category: "active", status: "withdrawn", email: "con", dni: "sin" }))
      .toEqual({ category: "active", status: "withdrawn", email: "con", dni: "sin", hasQuery: false });
  });

  it("never leaks the raw query string anywhere in the sanitized object", () => {
    const secret = "Coñuecar, Marta - DNI 12345678";
    const sanitized = sanitizeFiltersForAudit({ q: secret });
    expect(JSON.stringify(sanitized)).not.toContain(secret);
  });
});

describe("buildExportRow", () => {
  it("keeps DNI as a string (never a number) so Excel can't coerce it", () => {
    const row = buildExportRow({ memberNumber: 7, member: makeMember({ dni: "05123456" }) });
    expect(row.dni).toBe("05123456");
    expect(typeof row.dni).toBe("string");
  });

  it("keeps unicode surnames intact (accents and ñ)", () => {
    const row = buildExportRow({ memberNumber: 1, member: makeMember({ fullName: "Ñiripil, José Luis" }) });
    expect(row.name).toBe("Ñiripil, José Luis");
  });

  it("resolves category, status and email-status labels in Spanish", () => {
    const row = buildExportRow({
      memberNumber: 2,
      member: makeMember({ category: "lifetime", status: "suspended", emailStatus: "bounced" }),
    });
    expect(row.cat).toBe("Vitalicio");
    expect(row.st).toBe("Suspendido");
    expect(row.es).toBe("Rebotado");
  });

  it("passes joinedAt through as a native Date (not a formatted string) for native Excel dates", () => {
    const joinedAt = new Date("2020-03-15T12:00:00Z");
    const row = buildExportRow({ memberNumber: 3, member: makeMember({ joinedAt }) });
    expect(row.in).toEqual(joinedAt);
  });

  it("leaves fecha_egreso empty (null) for a member with no withdrawal", () => {
    const row = buildExportRow({ memberNumber: 4, member: makeMember({ leftAt: null }) });
    expect(row.out).toBeNull();
  });

  it("resolves the withdrawal reason label only when the member was withdrawn", () => {
    const withdrawn = buildExportRow({
      memberNumber: 5,
      member: makeMember({
        status: "withdrawn", leftAt: new Date("2022-01-10T12:00:00Z"),
        withdrawalReason: "arrears", debtAtWithdrawal: true,
      }),
    });
    expect(withdrawn.reason).toBe("Cesantía por mora");
    expect(withdrawn.out).toEqual(new Date("2022-01-10T12:00:00Z"));
    expect(withdrawn.debt).toBe("Sí");

    const active = buildExportRow({ memberNumber: 6, member: makeMember({ withdrawalReason: null }) });
    expect(active.reason).toBe("");
  });

  it("renders booleans as Sí/No, not true/false", () => {
    const row = buildExportRow({
      memberNumber: 8,
      member: makeMember({ autoDebit: false, debtAtWithdrawal: false }),
    });
    expect(row.ad).toBe("No");
    expect(row.debt).toBe("No");
  });

  it("blanks out missing optional fields instead of writing null/undefined", () => {
    const row = buildExportRow({
      memberNumber: 9,
      member: makeMember({ dni: null, email: null, phone: null, neighborhood: null }),
    });
    expect(row.dni).toBe("");
    expect(row.email).toBe("");
    expect(row.phone).toBe("");
    expect(row.nb).toBe("");
  });
});
