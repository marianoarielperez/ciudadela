// GET /api/admin/padron-electoral — el archivo que se lleva la Junta Electoral.
//
// Molde: tests/padron-export-route.test.ts. Lo que se afirma acá es lo que no se
// ve mirando la pantalla: quién puede descargarlo, que una fecha basura no llegue
// nunca a la base, que el archivo abra bien en Excel, que ningún intermediario lo
// cachee y que el asiento no lleve el nombre de ningún vecino.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-admin", () => ({ requireSuperadmin: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { member: { findMany: vi.fn() }, fee: { groupBy: vi.fn() } },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/treasury/fee-values", () => ({
  feeValueReader: { current: vi.fn(async () => ({ activeAmount: 6000, sharedAmount: 3000 })) },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.7"]])),
}));

import { GET } from "@/app/api/admin/padron-electoral/route";
import { audit } from "@/lib/audit";
import type { AdminActor } from "@/lib/auth/require-admin";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";

type MockedFn = ReturnType<typeof vi.fn>;

const ok: AdminActor = { ok: true, actorId: 7 };
const blocked: AdminActor = {
  ok: false,
  reason: "not_admin",
  error: "Solo el superadmin puede cambiar la configuración.",
};

// Sólo `req.nextUrl.searchParams` se lee en la ruta: un objeto liviano alcanza y
// evita arrastrar el runtime completo de next/server a un test unitario.
function requestWithQuery(query: Record<string, string> = {}) {
  return { nextUrl: { searchParams: new URLSearchParams(query) } } as unknown as Parameters<
    typeof GET
  >[0];
}

function memberRow(over: { id?: number; fullName?: string; category?: string } = {}) {
  return {
    id: over.id ?? 1,
    fullName: over.fullName ?? "Coñuecar, Marta",
    category: over.category ?? "active",
    joinedAt: new Date("2019-09-01T12:00:00Z"),
    memberships: [{ memberNumber: 42, book: { status: "open" } }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.member.findMany as MockedFn).mockResolvedValue([]);
  (prisma.fee.groupBy as MockedFn).mockResolvedValue([]);
});

describe("GET /api/admin/padron-electoral — autorización", () => {
  it("returns 403 and never touches the database for a plain admin", async () => {
    (requireSuperadmin as MockedFn).mockResolvedValue(blocked);

    const res = await GET(requestWithQuery({ fecha: "2026-11-15" }));

    expect(res.status).toBe(403);
    expect(await res.text()).toBe(blocked.error);
    expect(prisma.member.findMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("does not attach the file headers to the 403", async () => {
    (requireSuperadmin as MockedFn).mockResolvedValue(blocked);

    const res = await GET(requestWithQuery({ fecha: "2026-11-15" }));

    expect(res.headers.get("Content-Disposition")).toBeNull();
  });
});

describe("GET /api/admin/padron-electoral — la fecha es un parámetro", () => {
  beforeEach(() => {
    (requireSuperadmin as MockedFn).mockResolvedValue(ok);
  });

  it("rejects a missing date with 400 and no query", async () => {
    const res = await GET(requestWithQuery());

    expect(res.status).toBe(400);
    expect(prisma.member.findMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("rejects a malformed date with 400", async () => {
    for (const fecha of ["15/11/2026", "2026-11", "ayer", "2026-11-15T00:00:00Z"]) {
      const res = await GET(requestWithQuery({ fecha }));
      expect(res.status, fecha).toBe(400);
    }
    expect(prisma.member.findMany).not.toHaveBeenCalled();
  });

  it("rejects a day that does not exist and a mistyped year, which the shape regex lets through", async () => {
    // "2026-02-31" rodaría a marzo y "0202-11-15" es un dedazo de "2026": los dos
    // pasan el regex de forma y los frena `parseCivilDate`.
    for (const fecha of ["2026-02-31", "0202-11-15", "2019-11-15"]) {
      const res = await GET(requestWithQuery({ fecha }));
      expect(res.status, fecha).toBe(400);
    }
    expect(prisma.member.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/padron-electoral — descarga", () => {
  beforeEach(() => {
    (requireSuperadmin as MockedFn).mockResolvedValue(ok);
  });

  it("returns the CSV with the attachment headers and the date in the filename", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([memberRow()]);

    const res = await GET(requestWithQuery({ fecha: "2026-11-15" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="padron-electoral-2026-11-15.csv"',
    );
  });

  it("starts the body with the BOM so Excel on Windows does not eat the accents", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([memberRow()]);

    // Por BYTES y no por `text()`: la decodificación UTF-8 del estándar se come
    // el BOM, así que un cuerpo sin BOM pasaría igual leído como texto.
    const bytes = Buffer.from(
      await (await GET(requestWithQuery({ fecha: "2026-11-15" }))).arrayBuffer(),
    );

    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = bytes.toString("utf8").slice(1);
    expect(body.split("\r\n")[0]).toBe(
      "bloque,numero_socio,apellido_nombre,categoria,cuotas_adeudadas,monto_a_purgar",
    );
    expect(body).toContain("Coñuecar, Marta");
    // RFC 4180: filas separadas por CRLF y salto final. Los importadores viejos
    // de Excel se comen la última fila de un archivo que no termina en salto.
    expect(body.endsWith("\r\n")).toBe(true);
  });

  it("attaches no-store, private cache headers so no intermediary can cache the roll", async () => {
    const res = await GET(requestWithQuery({ fecha: "2026-11-15" }));

    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toContain("Cookie");
  });

  it("writes an audit entry with the date used and the block sizes — never a name", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([
      memberRow({ id: 1, fullName: "Pérez, Ana" }),
      memberRow({ id: 2, fullName: "Gómez, Luis" }),
    ]);
    (prisma.fee.groupBy as MockedFn).mockResolvedValue([{ memberId: 2, _count: { _all: 3 } }]);

    await GET(requestWithQuery({ fecha: "2026-11-15" }));

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 7,
      action: "electoral_roll_export",
      detail: { at: "2026-11-15", enabled: 1, toPurge: 1, purgeFees: 3 },
      ip: "10.0.0.7",
    });
    const serialized = JSON.stringify(entry.detail);
    expect(serialized).not.toContain("Pérez");
    expect(serialized).not.toContain("Gómez");
  });
});
