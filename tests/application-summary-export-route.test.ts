import { beforeEach, describe, expect, it, vi } from "vitest";

// El endpoint descarga nombres y DNIs de gente que todavía no es socia (Ley
// 25.326). Mismo patrón que tests/padron-export-route.test.ts: se mockea módulo
// por módulo, sin base ni sesión real, para que la suite se entere si alguien
// saca la guarda `requireAdmin`, el `audit(...)` o las cabeceras de caché.
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    application: { findMany: vi.fn() },
    movement: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.7"]])),
}));

import { GET } from "@/app/api/admin/solicitudes/resumen-export/route";
import type { AdminActor } from "@/lib/auth/require-admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

type MockedFn = ReturnType<typeof vi.fn>;

function applicationRow(over: Record<string, unknown> = {}) {
  return {
    id: 1, fullName: "Pérez, Ana", dni: "30111222", requestedCategory: "active",
    wantsDebit: true, memberId: null, minuteId: null,
    createdAt: new Date("2026-08-03T14:00:00Z"), decidedAt: null,
    ...over,
  };
}

// `xlsx.load` está tipado contra el `Buffer` de @types/node y `Buffer.from()`
// devuelve `Buffer<ArrayBuffer>`: son compatibles en runtime, no en el tipo.
async function loadWorkbook(buffer: Buffer) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

function requestWithQuery(query: Record<string, string> = {}) {
  return { nextUrl: { searchParams: new URLSearchParams(query) } } as unknown as Parameters<typeof GET>[0];
}

const ok: AdminActor = { ok: true, actorId: 7 };
const blocked: AdminActor = {
  ok: false, reason: "not_admin", error: "No tenés permiso para editar el padrón.",
};

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.application.findMany as MockedFn).mockResolvedValue([]);
  (prisma.movement.findMany as MockedFn).mockResolvedValue([]);
});

describe("GET /api/admin/solicitudes/resumen-export — autorización", () => {
  it("returns 403 and never touches the database for an anonymous request", async () => {
    (requireAdmin as MockedFn).mockResolvedValue({
      ok: false, reason: "anonymous", error: "Sesión inválida.",
    } satisfies AdminActor);

    const res = await GET(requestWithQuery());

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Sesión inválida.");
    expect(prisma.application.findMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("returns 403 for a session without the admin role, with no download headers", async () => {
    (requireAdmin as MockedFn).mockResolvedValue(blocked);

    const res = await GET(requestWithQuery({ mes: "2026-08" }));

    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(prisma.application.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/solicitudes/resumen-export — pedido autorizado", () => {
  beforeEach(() => {
    (requireAdmin as MockedFn).mockResolvedValue(ok);
  });

  it("returns the file named after the month it summarises", async () => {
    const res = await GET(requestWithQuery({ mes: "2026-08" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="resumen-solicitudes-2026-08.xlsx"',
    );
    const buffer = Buffer.from(await res.arrayBuffer());
    // Magic bytes de un .xlsx (es un ZIP): "PK".
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("attaches no-store, private cache headers so no intermediary can cache the DNIs", async () => {
    const res = await GET(requestWithQuery({ mes: "2026-08" }));

    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toContain("Cookie");
  });

  // Las tres hojas SIEMPRE: una hoja faltante parecería un error de
  // exportación, no una lista vacía.
  it("always writes the three sheets, even when every list is empty", async () => {
    const res = await GET(requestWithQuery({ mes: "2026-08" }));
    const buffer = Buffer.from(await res.arrayBuffer());

    const wb = await loadWorkbook(buffer);
    expect(wb.worksheets.map((w) => w.name))
      .toEqual(["Pendientes de asiento", "Pendientes CD", "Asentadas"]);
  });

  // La fecha tiene que llegar a Excel como FECHA: si sale como texto
  // DD/MM/AAAA, ordenar la hoja compara el día antes que el año.
  it("writes the date column as a real date cell, not as text", async () => {
    (prisma.application.findMany as MockedFn).mockResolvedValue([applicationRow()]);

    const res = await GET(requestWithQuery({ mes: "2026-08" }));
    const wb = await loadWorkbook(Buffer.from(await res.arrayBuffer()));

    const ws = wb.getWorksheet("Pendientes de asiento")!;
    expect(ws.getRow(1).values).toContain("apellido_nombre");
    const cell = ws.getRow(2).getCell(6);
    expect(cell.value).toBeInstanceOf(Date);
    expect(cell.numFmt).toBe("dd/mm/yyyy");
  });

  it("writes an audit entry with the month and the per-list counts — never the row data", async () => {
    (prisma.application.findMany as MockedFn).mockImplementation(async (args: {
      where: { status: string };
    }) => (args.where.status === "approved_pending_minute"
      ? [applicationRow({ dni: "30111222", fullName: "Pérez, Ana" }),
         applicationRow({ id: 2, dni: "30333444", fullName: "Gómez, Luis" })]
      : []));

    await GET(requestWithQuery({ mes: "2026-08" }));

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 7,
      action: "application_summary_export",
      detail: {
        month: "2026-08",
        counts: { accepted: 2, pendingBoard: 0, recordedInMonth: 0 },
      },
      ip: "10.0.0.7",
    });
    const serialized = JSON.stringify(entry.detail);
    expect(serialized).not.toContain("30111222");
    expect(serialized).not.toContain("Pérez");
    expect(serialized).not.toContain("Gómez");
  });

  // Un `?mes=` tipeado a mano no puede romper la descarga: cae al mes corriente,
  // igual que la pantalla.
  it("falls back to the current month when the parameter is junk", async () => {
    const res = await GET(requestWithQuery({ mes: "no-es-un-mes" }));

    expect(res.status).toBe(200);
    const month = (audit as MockedFn).mock.calls[0][0].detail.month as string;
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="resumen-solicitudes-${month}.xlsx"`,
    );
  });
});
