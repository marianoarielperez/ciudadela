// La ruta de descarga de la constancia: guarda, validaciones, cabeceras y el
// asiento de auditoría SIN datos personales (misma aserción de estilo que
// "never copies the description text" en minute-edit).
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: requireAdminMock }));

const auditMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({ audit: auditMock }));

const findUniqueMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: { minute: { findUnique: findUniqueMock } },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "10.0.0.9" }),
}));

import { GET } from "@/app/api/admin/actas/[id]/export/route";

const MINUTE = {
  id: 16, type: "board", number: 124, date: new Date(Date.UTC(2026, 7, 15, 12)),
  description: null,
  movements: [{
    type: "admission", previousCategory: null, newCategory: null, reason: null,
    member: { fullName: "Juana Molina", dni: "12345678",
      memberships: [{ memberNumber: 45 }] },
  }],
  applications: [], feeValues: [], booksOpened: [], booksClosed: [],
  processesCalled: [], processesClosed: [],
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (formato: string) =>
  new Request(`http://x/api/admin/actas/16/export?formato=${formato}`);

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ ok: true, actorId: 1 });
  findUniqueMock.mockResolvedValue(MINUTE);
});

describe("guardas", () => {
  it("403 sin admin vivo, sin cabeceras de archivo y sin tocar la base", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, error: "No autorizado" });
    const res = await GET(req("pdf"), params("16"));
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("404 con id inválido, antes de tocar la base", async () => {
    for (const bad of ["abc", "-1", "1.5"]) {
      const res = await GET(req("pdf"), params(bad));
      expect(res.status).toBe(404);
    }
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("404 con acta inexistente y 400 con formato desconocido", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect((await GET(req("pdf"), params("16"))).status).toBe(404);
    expect((await GET(req("csv"), params("16"))).status).toBe(400);
  });
});

describe("descarga", () => {
  it("PDF: bytes, attachment con nombre derivado de tipo+número, sin caché", async () => {
    const res = await GET(req("pdf"), params("16"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition"))
      .toBe('attachment; filename="acta-cd-124.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("Word: content-type OOXML y extensión .docx", async () => {
    const res = await GET(req("docx"), params("16"));
    expect(res.headers.get("Content-Type"))
      .toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(res.headers.get("Content-Disposition"))
      .toBe('attachment; filename="acta-cd-124.docx"');
  });
});

describe("auditoría", () => {
  it("asienta minute_export con metadatos y NUNCA nombres ni DNIs", async () => {
    await GET(req("pdf"), params("16"));
    expect(auditMock).toHaveBeenCalledTimes(1);
    const entry = auditMock.mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 1, action: "minute_export", entity: "minute", entityId: 16,
      ip: "10.0.0.9",
    });
    expect(entry.detail).toEqual({ type: "board", number: 124, format: "pdf", entries: 1 });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("Juana");
    expect(serialized).not.toContain("12345678");
  });

  it("no asienta nada si el acta no existe", async () => {
    findUniqueMock.mockResolvedValue(null);
    await GET(req("pdf"), params("16"));
    expect(auditMock).not.toHaveBeenCalled();
  });
});
