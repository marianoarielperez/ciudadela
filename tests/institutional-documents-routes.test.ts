import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  institutionalDocument: { findUnique: vi.fn() },
}));
const fsMock = vi.hoisted(() => ({ readFile: vi.fn() }));
const requireMemberMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("node:fs/promises", () => fsMock);
vi.mock("@/lib/auth/require-member", () => ({ requireMember: requireMemberMock }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: requireAdminMock }));

import { GET as memberGet } from "@/app/api/mi/documentos/[id]/route";
import { GET as adminGet } from "@/app/api/admin/documentos/[id]/route";

const DOC = {
  id: 7,
  title: "Memoria 2025",
  fileName: "123e4567-e89b-42d3-a456-426614174000.pdf",
};
const PDF = Buffer.from("%PDF-1.7 contenido");

const props = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost/api/x");

describe("GET /api/mi/documentos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireMemberMock.mockResolvedValue({ ok: true, memberId: 1 });
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(DOC);
    fsMock.readFile.mockResolvedValue(PDF);
  });

  it("sirve el PDF con las cabeceras defensivas y el nombre derivado del título", async () => {
    const res = await memberGet(req(), props("7"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="memoria-2025.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    // Sexta cabecera del contrato: la respuesta depende de la cookie de sesión.
    // Sin este assert, borrarla del helper dejaba la suite verde (mutación).
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    // El cuerpo son los bytes del archivo que se leyó, no uno vacío ni otro:
    // ata el readFile a la ruta del documento pedido.
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 contenido");
    // El suspendido lee: modo lectura del panel de socio.
    expect(requireMemberMock).toHaveBeenCalledWith({ allowSuspended: true });
  });

  it("403 sin sesión de socio, sin tocar la base", async () => {
    requireMemberMock.mockResolvedValue({ ok: false, reason: "anonymous", error: "Iniciá sesión." });
    const res = await memberGet(req(), props("7"));
    expect(res.status).toBe(403);
    expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
  });

  it("404 con id no numérico, documento inexistente o archivo faltante", async () => {
    expect((await memberGet(req(), props("abc"))).status).toBe(404);
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(null);
    expect((await memberGet(req(), props("99"))).status).toBe(404);
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(DOC);
    fsMock.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect((await memberGet(req(), props("7"))).status).toBe(404);
  });

  // `Number("999999999999999999999")` es 1e21: `Number.isInteger` lo daba por
  // bueno y el id se colaba al `where` de Prisma, que respondía 500 con su
  // stack. Todo lo que no sea "no hay sesión" responde 404.
  it("404 con un id fuera del rango entero seguro, sin tocar la base", async () => {
    const res = await memberGet(req(), props("999999999999999999999"));
    expect(res.status).toBe(404);
    expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
  });

  it("404 si la fila trae un fileName corrupto (no se toca el filesystem)", async () => {
    prismaMock.institutionalDocument.findUnique.mockResolvedValue({ ...DOC, fileName: "../.env" });
    const res = await memberGet(req(), props("7"));
    expect(res.status).toBe(404);
    expect(fsMock.readFile).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/documentos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({ ok: true, actorId: 1 });
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(DOC);
    fsMock.readFile.mockResolvedValue(PDF);
  });

  it("sirve el PDF a un admin", async () => {
    const res = await adminGet(req(), props("7"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    // Las mismas cabeceras defensivas que la ruta del socio: las dos rutas
    // comparten `institutionalDocResponse`, y esto es lo que prueba que la del
    // panel no se arme una respuesta propia y pierda el nosniff o la CSP.
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="memoria-2025.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 contenido");
  });

  it("404 con id no numérico, documento inexistente o archivo faltante", async () => {
    expect((await adminGet(req(), props("abc"))).status).toBe(404);
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(null);
    expect((await adminGet(req(), props("99"))).status).toBe(404);
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(DOC);
    fsMock.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect((await adminGet(req(), props("7"))).status).toBe(404);
  });

  it("404 con un id fuera del rango entero seguro, sin tocar la base", async () => {
    const res = await adminGet(req(), props("999999999999999999999"));
    expect(res.status).toBe(404);
    expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
  });

  // La guarda de path traversal es ahora una sola (vive en la carga compartida),
  // pero se ejercita por las dos rutas: lo que se prueba es que la del panel
  // pase por esa carga y no se arme una consulta propia.
  it("404 si la fila trae un fileName corrupto (no se toca el filesystem)", async () => {
    prismaMock.institutionalDocument.findUnique.mockResolvedValue({ ...DOC, fileName: "../.env" });
    const res = await adminGet(req(), props("7"));
    expect(res.status).toBe(404);
    expect(fsMock.readFile).not.toHaveBeenCalled();
  });

  it("403 sin sesión de admin, sin tocar la base", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, reason: "anonymous", error: "Sesión inválida." });
    const res = await adminGet(req(), props("7"));
    expect(res.status).toBe(403);
    expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
  });
});
