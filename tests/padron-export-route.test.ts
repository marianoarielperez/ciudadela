import { beforeEach, describe, expect, it, vi } from "vitest";

// El endpoint que descarga el padrón entero (283 DNIs, domicilios y
// teléfonos — Ley 25.326) no tenía ni un test: los 17 tests previos son todos
// de funciones puras (src/lib/members/export.ts). Nada impedía borrar la
// guarda `requireAdmin`, sacar el `audit(...)`, o perder las cabeceras de
// caché sin que la suite se enterara. Ver task-16-review.md, I-2.
//
// Mismo patrón que tests/send-verification-action.test.ts y
// tests/update-member-action.test.ts: se mockea módulo por módulo, sin base
// ni sesión real.
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { membership: { findMany: vi.fn() } },
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.7"]])),
}));

import { GET } from "@/app/api/admin/padron-export/route";
import type { AdminActor } from "@/lib/auth/require-admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import type { Member, Street } from "@/generated/prisma/client";

type MockedFn = ReturnType<typeof vi.fn>;

function membershipRow(over: Partial<Member & { street: Street | null }> = {}) {
  const member: Member & { street: Street | null } = {
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
    ...over,
  };
  return { memberNumber: 42, member };
}

// Sólo `req.nextUrl.searchParams` se lee en la ruta: un objeto liviano alcanza
// y evita arrastrar el runtime completo de next/server a un test unitario.
function requestWithQuery(query: Record<string, string> = {}) {
  return {
    nextUrl: { searchParams: new URLSearchParams(query) },
  } as unknown as Parameters<typeof GET>[0];
}

const ok: AdminActor = { ok: true, actorId: 7 };
const blocked: AdminActor = { ok: false, reason: "not_admin", error: "No tenés permiso para editar el padrón." };

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.membership.findMany as MockedFn).mockResolvedValue([]);
});

describe("GET /api/admin/padron-export — autorización", () => {
  it("returns 403 and never touches the database for an anonymous request", async () => {
    (requireAdmin as MockedFn).mockResolvedValue({
      ok: false, reason: "anonymous", error: "Sesión inválida.",
    } satisfies AdminActor);

    const res = await GET(requestWithQuery());

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Sesión inválida.");
    expect(prisma.membership.findMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("returns 403 and never touches the database for a session without the admin role", async () => {
    (requireAdmin as MockedFn).mockResolvedValue(blocked);

    const res = await GET(requestWithQuery({ status: "active" }));

    expect(res.status).toBe(403);
    expect(await res.text()).toBe(blocked.error);
    expect(prisma.membership.findMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  // No hay Content-Disposition en el rechazo: nada que se parezca a una
  // descarga sale por la vía anónima.
  it("does not attach the file headers to the 403", async () => {
    (requireAdmin as MockedFn).mockResolvedValue(blocked);

    const res = await GET(requestWithQuery());

    expect(res.headers.get("Content-Disposition")).toBeNull();
  });
});

describe("GET /api/admin/padron-export — pedido autorizado", () => {
  beforeEach(() => {
    (requireAdmin as MockedFn).mockResolvedValue(ok);
  });

  it("returns the file with the expected attachment headers", async () => {
    (prisma.membership.findMany as MockedFn).mockResolvedValue([membershipRow()]);

    const res = await GET(requestWithQuery({ status: "active" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="padron-libro-1.xlsx"',
    );
    const buffer = Buffer.from(await res.arrayBuffer());
    // Magic bytes de un .xlsx (es un ZIP): "PK".
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(buffer.length).toBeGreaterThan(0);
  });

  // I-1: sin esto la respuesta puede quedar cacheada en un intermediario
  // (Nginx/Cloudflare) — ver task-16-review.md.
  it("attaches no-store, private cache headers so no intermediary can cache 283 DNIs", async () => {
    const res = await GET(requestWithQuery());

    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toContain("Cookie");
  });

  it("writes an audit entry with who exported, the filters and the row count — never the row data", async () => {
    (prisma.membership.findMany as MockedFn).mockResolvedValue([
      membershipRow({ dni: "30111222", fullName: "Pérez, Ana" }),
      membershipRow({ dni: "30333444", fullName: "Gómez, Luis" }),
    ]);

    await GET(requestWithQuery({ status: "active", category: "adherent" }));

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 7,
      action: "padron_export",
      detail: { filters: { status: "active", category: "adherent", hasQuery: false }, rows: 2 },
      ip: "10.0.0.7",
    });
    // Nada de DNI, nombre ni ningún otro dato personal de las filas exportadas.
    const serialized = JSON.stringify(entry.detail);
    expect(serialized).not.toContain("30111222");
    expect(serialized).not.toContain("30333444");
    expect(serialized).not.toContain("Pérez");
    expect(serialized).not.toContain("Gómez");
  });

  // La búsqueda libre (`q`) puede traer un apellido o un DNI tipeado a mano:
  // sanitizeFiltersForAudit ya lo cubre a nivel unitario, pero acá se fija que
  // la ruta efectivamente pasa por esa función y no el filtro crudo.
  it("never lets the free-text query reach the audit entry", async () => {
    await GET(requestWithQuery({ q: "Coñuecar, Marta - DNI 12345678" }));

    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(JSON.stringify(entry.detail)).not.toContain("Coñuecar");
    expect(entry.detail).toMatchObject({ filters: { hasQuery: true } });
  });

  it("audits zero rows honestly when the filtered padron is empty", async () => {
    (prisma.membership.findMany as MockedFn).mockResolvedValue([]);

    await GET(requestWithQuery());

    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry.detail).toMatchObject({ rows: 0 });
  });
});
