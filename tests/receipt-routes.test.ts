import { beforeEach, describe, expect, it, vi } from "vitest";

// Las dos rutas que sirven el PDF de un recibo (spec §6.5). Un recibo lleva el
// nombre del socio, su número de padrón y lo que pagó: es un documento personal,
// así que vale lo mismo que para los DNIs de una solicitud (docs/08) —guarda de
// autorización, sin caché, `nosniff`, y asiento por CADA vista del panel—. Todo
// eso es invisible en el render y se puede borrar sin que nada más falle: de ahí
// este test. Mismo patrón de mockeo que tests/application-document-route.test.ts.
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth/require-member", () => ({ requireMember: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { receipt: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/treasury/receipts-dir", () => ({
  readReceiptPdf: vi.fn(),
  // La real valida la forma `AAAA/AAAA-NNNNN.pdf`; acá alcanza con que arme la
  // misma ruta, porque lo que se prueba es CUÁNDO se la usa.
  receiptRelativePath: (n: string) => `${n.slice(0, 4)}/${n}.pdf`,
}));

vi.mock("@/lib/treasury/service", () => ({
  treasuryService: { regenerateReceiptPdf: vi.fn() },
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-real-ip": "1.2.3.4" })),
}));

import { GET as adminGet } from "@/app/api/admin/recibos/[id]/route";
import { GET as memberGet } from "@/app/api/mi/recibos/[id]/route";
import { audit } from "@/lib/audit";
import type { AdminActor } from "@/lib/auth/require-admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { MemberActor } from "@/lib/auth/require-member";
import { requireMember } from "@/lib/auth/require-member";
import { prisma } from "@/lib/prisma";
import { readReceiptPdf } from "@/lib/treasury/receipts-dir";
import { treasuryService } from "@/lib/treasury/service";

type MockedFn = ReturnType<typeof vi.fn>;

const ADMIN_OK: AdminActor = { ok: true, actorId: 9 };
const MEMBER_OK: MemberActor = {
  ok: true, userId: 3, memberId: 144, fullName: "Ana Gómez", suspension: null,
};

const ON_DISK = Buffer.from("%PDF-1.4 en disco");
const REGENERATED = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

function receipt(over: Record<string, unknown> = {}) {
  return {
    id: 5,
    number: "2026-00005",
    pdfPath: "2026/2026-00005.pdf",
    payment: { memberId: 144 },
    ...over,
  };
}

const call = (
  handler: typeof adminGet,
  id = "5",
) => handler(new Request("http://localhost/x"), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  (requireAdmin as MockedFn).mockResolvedValue(ADMIN_OK);
  (requireMember as MockedFn).mockResolvedValue(MEMBER_OK);
  (prisma.receipt.findUnique as MockedFn).mockResolvedValue(receipt());
  (readReceiptPdf as MockedFn).mockResolvedValue(ON_DISK);
  (treasuryService.regenerateReceiptPdf as MockedFn).mockResolvedValue(REGENERATED);
});

describe("GET /api/admin/recibos/[id] — autorización", () => {
  it("responde 403 sin tocar la base ni el disco para un anónimo", async () => {
    (requireAdmin as MockedFn).mockResolvedValue({
      ok: false, reason: "anonymous", error: "Sesión inválida.",
    } satisfies AdminActor);

    const res = await call(adminGet);

    expect(res.status).toBe(403);
    expect(prisma.receipt.findUnique).not.toHaveBeenCalled();
    expect(readReceiptPdf).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("responde 403 a una sesión sin rol de admin", async () => {
    (requireAdmin as MockedFn).mockResolvedValue({
      ok: false, reason: "not_admin", error: "No tenés permiso para editar el padrón.",
    } satisfies AdminActor);

    expect((await call(adminGet)).status).toBe(403);
    expect(readReceiptPdf).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/recibos/[id] — entrega", () => {
  it("sirve el PDF inline, sin caché, y audita la vista", async () => {
    const res = await call(adminGet);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toContain("Cookie");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toContain('filename="recibo-2026-00005.pdf"');
    expect(res.headers.get("Content-Disposition")).toContain("inline");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(ON_DISK);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "receipt_view", entity: "receipt", entityId: 5, userId: 9, ip: "1.2.3.4",
    }));
  });

  // Segunda capa sobre nosniff, igual que en la ruta de documentos: un PDF
  // servido en el mismo origen que la sesión de admin va sin scripts y en un
  // origen opaco.
  it("sirve el PDF bajo una CSP propia sin scripts y en sandbox", async () => {
    const csp = (await call(adminGet)).headers.get("Content-Security-Policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("sandbox");
  });

  it("asienta la vista con ids y número, nunca datos personales", async () => {
    await call(adminGet);

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry.detail).toMatchObject({ number: "2026-00005", memberId: 144 });
    // Ni el nombre del socio, ni su DNI, ni la ruta del archivo en disco.
    expect(JSON.stringify(entry.detail)).not.toContain("2026/2026-00005.pdf");
  });

  it("auditar dos veces significa dos asientos: no hay deduplicación", async () => {
    await call(adminGet);
    await call(adminGet);
    expect(audit).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/admin/recibos/[id] — resolución", () => {
  it("regenera el PDF desde la base si falta en disco", async () => {
    (readReceiptPdf as MockedFn).mockRejectedValueOnce(new Error("ENOENT"));

    const res = await call(adminGet);

    expect(res.status).toBe(200);
    expect(treasuryService.regenerateReceiptPdf).toHaveBeenCalledWith(5);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(REGENERATED));
  });

  it("usa la ruta canónica del número cuando la fila no guardó `pdfPath`", async () => {
    (prisma.receipt.findUnique as MockedFn).mockResolvedValue(receipt({ pdfPath: null }));

    expect((await call(adminGet)).status).toBe(200);
    expect(readReceiptPdf).toHaveBeenCalledWith("2026/2026-00005.pdf");
  });

  it("responde 404 —y no 500— si tampoco se puede regenerar", async () => {
    (readReceiptPdf as MockedFn).mockRejectedValue(new Error("ENOENT"));
    (treasuryService.regenerateReceiptPdf as MockedFn).mockRejectedValue(new Error("monto fuera de rango"));

    const res = await call(adminGet);

    expect(res.status).toBe(404);
    // No se vio ningún recibo: no hay nada que asentar.
    expect(audit).not.toHaveBeenCalled();
  });

  it("responde 404 con un id no numérico, sin consultar la base", async () => {
    for (const id of ["abc", "1.5", "-3", "0"]) {
      vi.clearAllMocks();
      (requireAdmin as MockedFn).mockResolvedValue(ADMIN_OK);
      const res = await call(adminGet, id);
      expect(res.status, id).toBe(404);
      expect(prisma.receipt.findUnique).not.toHaveBeenCalled();
    }
  });

  it("responde 404 cuando el recibo no existe", async () => {
    (prisma.receipt.findUnique as MockedFn).mockResolvedValue(null);

    const res = await call(adminGet, "77");

    expect(res.status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("GET /api/mi/recibos/[id]", () => {
  it("sirve el recibo propio, con las mismas cabeceras y sin auditar", async () => {
    const res = await call(memberGet);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // El socio mirando lo suyo no es un hecho auditable (spec §6.5).
    expect(audit).not.toHaveBeenCalled();
  });

  it("responde 404 —no 403— para el recibo de otro socio: no revela que existe", async () => {
    (requireMember as MockedFn).mockResolvedValue({
      ok: true, userId: 3, memberId: 999, fullName: "Otro", suspension: null,
    } satisfies MemberActor);

    const res = await call(memberGet);

    expect(res.status).toBe(404);
    expect(readReceiptPdf).not.toHaveBeenCalled();
  });

  it("responde 404 cuando el pago no está vinculado a ningún socio", async () => {
    // Pago de una solicitud todavía sin ficha: `memberId` nulo no puede
    // colarse como "coincide con el mío".
    (prisma.receipt.findUnique as MockedFn).mockResolvedValue(
      receipt({ payment: { memberId: null } }),
    );

    expect((await call(memberGet)).status).toBe(404);
  });

  it("responde 403 sin sesión de socio, sin tocar la base", async () => {
    (requireMember as MockedFn).mockResolvedValue({
      ok: false, reason: "anonymous", error: "Ingresá a tu cuenta para ver tu panel de socio.",
    } satisfies MemberActor);

    expect((await call(memberGet)).status).toBe(403);
    expect(prisma.receipt.findUnique).not.toHaveBeenCalled();
  });

  it("responde 403 al socio suspendido o dado de baja", async () => {
    (requireMember as MockedFn).mockResolvedValue({
      ok: false, reason: "suspended", error: "Tu condición de socio está suspendida.",
    } satisfies MemberActor);

    expect((await call(memberGet)).status).toBe(403);
  });
});

describe("nombre del archivo sugerido", () => {
  // El nombre se arma con el número de la fila. Si esa fila viniera con basura
  // —una migración a mano, un restore raro—, no se cuela en la cabecera.
  it("cae a un nombre genérico si el número no tiene la forma de la serie", async () => {
    (prisma.receipt.findUnique as MockedFn).mockResolvedValue(
      receipt({ number: "2026-00005\r\nX-Injected: 1" }),
    );

    const cd = (await call(adminGet)).headers.get("Content-Disposition");
    expect(cd).toBe('inline; filename="recibo.pdf"');
  });
});
