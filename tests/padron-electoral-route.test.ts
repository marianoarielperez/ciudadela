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
import ExcelJS from "exceljs";

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

async function loadWorkbook(res: Response) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  return wb;
}

function memberRow(
  over: { id?: number; fullName?: string; category?: string; joinedAt?: Date } = {},
) {
  return {
    id: over.id ?? 1,
    fullName: over.fullName ?? "Coñuecar, Marta",
    category: over.category ?? "active",
    joinedAt: over.joinedAt ?? new Date("2019-09-01T12:00:00Z"),
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

  it("returns the workbook with the attachment headers and the date in the filename", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([memberRow()]);

    const res = await GET(requestWithQuery({ fecha: "2026-11-15" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="padron-electoral-2026-11-15.xlsx"',
    );
    // Magic bytes de un .xlsx (es un ZIP): "PK".
    const buffer = Buffer.from(await res.clone().arrayBuffer());
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("arma las tres hojas en el orden de la pantalla, la vacía incluida", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([memberRow()]);

    const wb = await loadWorkbook(await GET(requestWithQuery({ fecha: "2026-11-15" })));

    expect(wb.worksheets.map((ws) => ws.name)).toEqual([
      "Habilitados",
      "Con deuda a purgar",
      "No habilitados por antigüedad",
    ]);
    // La hoja vacía se crea igual, con sólo el encabezado: informa que la lista
    // está vacía; una hoja faltante parecería un error de exportación.
    expect(wb.getWorksheet("Con deuda a purgar")!.rowCount).toBe(1);
  });

  it("el que no llega a los 90 días sale en su hoja, con desde cuándo puede votar", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([
      memberRow(),
      memberRow({ id: 2, fullName: "Nuevo, Vecino", joinedAt: new Date("2026-10-01T12:00:00Z") }),
    ]);

    const wb = await loadWorkbook(await GET(requestWithQuery({ fecha: "2026-11-15" })));
    const ws = wb.getWorksheet("No habilitados por antigüedad")!;

    expect(ws.rowCount).toBe(2);
    expect(ws.getRow(2).getCell(2).value).toBe("Nuevo, Vecino");
    // habilitado_desde = 01/10/2026 + 90 días.
    expect(ws.getRow(2).getCell(5).value).toEqual(new Date("2026-12-30T12:00:00Z"));
  });

  it("ninguna hoja lleva DNI, email ni domicilio en sus encabezados", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([memberRow()]);

    const wb = await loadWorkbook(await GET(requestWithQuery({ fecha: "2026-11-15" })));

    for (const ws of wb.worksheets) {
      const headerRow = (ws.getRow(1).values as unknown[]).join(",").toLowerCase();
      expect(headerRow, ws.name).not.toContain("dni");
      expect(headerRow, ws.name).not.toContain("email");
      expect(headerRow, ws.name).not.toContain("domicilio");
    }
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
      memberRow({ id: 3, fullName: "Nuevo, Vecino", joinedAt: new Date("2026-10-01T12:00:00Z") }),
    ]);
    (prisma.fee.groupBy as MockedFn).mockResolvedValue([{ memberId: 2, _count: { _all: 3 } }]);

    await GET(requestWithQuery({ fecha: "2026-11-15" }));

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 7,
      action: "electoral_roll_export",
      detail: { at: "2026-11-15", enabled: 1, toPurge: 1, purgeFees: 3, withoutSeniority: 1 },
      ip: "10.0.0.7",
    });
    const serialized = JSON.stringify(entry.detail);
    expect(serialized).not.toContain("Pérez");
    expect(serialized).not.toContain("Gómez");
    expect(serialized).not.toContain("Nuevo");
  });

  it("la hoja de purga lleva la fila de total y los formatos de fecha y moneda", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([
      memberRow(),
      memberRow({ id: 2, fullName: "Gómez, Luis" }),
    ]);
    (prisma.fee.groupBy as MockedFn).mockResolvedValue([{ memberId: 2, _count: { _all: 3 } }]);

    const wb = await loadWorkbook(await GET(requestWithQuery({ fecha: "2026-11-15" })));
    const purge = wb.getWorksheet("Con deuda a purgar")!;

    // Encabezado + 1 moroso + la fila de total: el número que la Junta se lleva
    // a la mesa de cobro. Borrar el addRow(totals) de la route tiene que poner
    // este test en rojo.
    expect(purge.rowCount).toBe(3);
    const total = purge.getRow(3);
    expect(total.getCell(2).value).toBe("Total a purgar");
    expect(total.getCell(5).value).toBe(3);
    expect(total.getCell(6).value).toBe(18000);
    // Los formatos que la Junta ve al abrir el archivo: fecha argentina y moneda.
    expect(purge.getColumn(4).numFmt).toBe("dd/mm/yyyy");
    expect(purge.getColumn(6).numFmt).toBe('"$" #,##0.00');
    const tooNew = wb.getWorksheet("No habilitados por antigüedad")!;
    expect(tooNew.getColumn(5).numFmt).toBe("dd/mm/yyyy");
  });
});
