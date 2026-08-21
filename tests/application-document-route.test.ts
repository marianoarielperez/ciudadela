import { beforeEach, describe, expect, it, vi } from "vitest";

// El visor de documentos de una solicitud sirve las FOTOS DEL DNI que subió un
// vecino (Ley 25.326, docs/08). Todo lo que lo hace seguro —la guarda de admin,
// el asiento por CADA visualización, las cabeceras que impiden que el archivo
// quede en una caché o se interprete como HTML— es invisible en el render y se
// puede borrar sin que nada más se rompa. De ahí este test.
//
// Mismo patrón de mockeo que tests/padron-export-route.test.ts.
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { document: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/documents/storage", () => ({
  documentStore: { readDocumentFile: vi.fn() },
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.7"]])),
}));

import { GET } from "@/app/api/admin/solicitudes/[id]/documentos/[docId]/route";
import type { AdminActor } from "@/lib/auth/require-admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { audit } from "@/lib/audit";
import { documentStore } from "@/lib/documents/storage";
import { prisma } from "@/lib/prisma";

type MockedFn = ReturnType<typeof vi.fn>;

const ok: AdminActor = { ok: true, actorId: 7 };
const blocked: AdminActor = {
  ok: false, reason: "not_admin", error: "No tenés permiso para editar el padrón.",
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);

function doc(over: Record<string, unknown> = {}) {
  return {
    id: 12, ownerType: "application", ownerId: 40, type: "dni_front",
    path: "applications/40/abc.jpg", mime: "image/jpeg", size: JPEG.length,
    uploadedAt: new Date("2026-08-20T12:00:00Z"), validatedById: null, validatedAt: null,
    ...over,
  };
}

const call = (id = "40", docId = "12") =>
  GET(new Request("http://localhost/x"), { params: Promise.resolve({ id, docId }) });

beforeEach(() => {
  vi.clearAllMocks();
  (requireAdmin as MockedFn).mockResolvedValue(ok);
  (prisma.document.findFirst as MockedFn).mockResolvedValue(doc());
  (documentStore.readDocumentFile as MockedFn).mockResolvedValue(JPEG);
});

describe("GET del documento — autorización", () => {
  it("responde 403 sin tocar la base ni el disco para un anónimo", async () => {
    (requireAdmin as MockedFn).mockResolvedValue({
      ok: false, reason: "anonymous", error: "Sesión inválida.",
    } satisfies AdminActor);

    const res = await call();

    expect(res.status).toBe(403);
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
    expect(documentStore.readDocumentFile).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("responde 403 a una sesión sin rol de admin", async () => {
    (requireAdmin as MockedFn).mockResolvedValue(blocked);

    const res = await call();

    expect(res.status).toBe(403);
    expect(documentStore.readDocumentFile).not.toHaveBeenCalled();
  });
});

describe("GET del documento — resolución", () => {
  it("acota la búsqueda al dueño de la URL: un docId de otra solicitud no se sirve", async () => {
    // La invariante que importa: `ownerId` sale de la ruta, no del documento.
    // Sin esto, /solicitudes/1/documentos/999 serviría el DNI de la solicitud 999.
    await call("40", "12");

    expect(prisma.document.findFirst).toHaveBeenCalledWith({
      where: { id: 12, ownerType: "application", ownerId: 40 },
    });
  });

  it("responde 404 cuando el documento no pertenece a esa solicitud", async () => {
    (prisma.document.findFirst as MockedFn).mockResolvedValue(null);

    const res = await call("40", "999");

    expect(res.status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });

  it("responde 404 con ids no numéricos, sin consultar la base", async () => {
    for (const [id, docId] of [["abc", "12"], ["40", "abc"], ["40", "1.5"]]) {
      vi.clearAllMocks();
      (requireAdmin as MockedFn).mockResolvedValue(ok);
      const res = await call(id, docId);
      expect(res.status, `${id}/${docId}`).toBe(404);
      expect(prisma.document.findFirst).not.toHaveBeenCalled();
    }
  });

  it("responde 404 —y no 500— cuando la fila existe pero el archivo no está en disco", async () => {
    (documentStore.readDocumentFile as MockedFn).mockRejectedValue(new Error("ENOENT"));

    const res = await call();

    expect(res.status).toBe(404);
    // Nada que auditar: no se vio ningún documento.
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("GET del documento — entrega", () => {
  it("devuelve el archivo con el mime guardado por el sniff del servidor", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
  });

  // `sniffDocument` valida la FIRMA, no el contenido entero: un archivo con
  // magic bytes de JPEG y HTML adentro pasa la validación de subida. `nosniff`
  // es lo que impide que el navegador lo re-interprete como HTML y ejecute
  // script en el mismo origen que la sesión de admin.
  it("prohíbe el sniffing de tipo del navegador", async () => {
    const res = await call();
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  // Segunda capa sobre nosniff: aunque el tipo se re-interpretara, el documento
  // queda sin scripts y en un origen opaco (patrón de GitHub para raw content).
  it("sirve el archivo bajo una CSP propia sin scripts y en sandbox", async () => {
    const csp = (await call()).headers.get("Content-Security-Policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("sandbox");
  });

  it("no deja el DNI en ninguna caché intermedia", async () => {
    const res = await call();
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toContain("Cookie");
  });

  it("nombra el archivo con datos del servidor, nunca con la ruta guardada", async () => {
    const cd = (await call()).headers.get("Content-Disposition");
    expect(cd).toContain("inline");
    expect(cd).toContain("solicitud-40-dni_front-12.jpg");
    expect(cd).not.toContain("abc.jpg");
  });

  it("asienta CADA visualización con ids y tipo, nunca datos personales", async () => {
    await call();

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 7,
      action: "application_document_view",
      entity: "document",
      entityId: 12,
      detail: { applicationId: 40, type: "dni_front" },
      ip: "10.0.0.7",
    });
    // Ni la ruta en disco ni el mime del archivo son datos que el asiento
    // necesite; el nombre y el DNI del solicitante nunca entran acá.
    expect(JSON.stringify(entry.detail)).not.toContain("applications/40");
  });

  it("auditar dos veces significa dos asientos: no hay deduplicación", async () => {
    await call();
    await call();
    expect(audit).toHaveBeenCalledTimes(2);
  });
});
