import { beforeEach, describe, expect, it, vi } from "vitest";

// El visor de documentos de una PRESENTACIÓN de re-empadronamiento sirve las
// fotos del DNI que subió un vecino, o que el operador escaneó en el mostrador
// (Ley 25.326, docs/08). Es exactamente el mismo dato personal que sirve la
// ruta de las solicitudes de alta, y por el mismo motivo lleva el mismo test:
// todo lo que la hace segura —la guarda de admin, el atado al dueño de la URL,
// el asiento por CADA visualización, las cabeceras que impiden que el archivo
// quede en una caché o se interprete como HTML— es INVISIBLE EN EL RENDER y se
// puede borrar sin que nada más se rompa.
//
// Molde: tests/application-document-route.test.ts. Se sostienen las dos por
// separado a propósito: son dos handlers distintos sobre la misma tabla
// `documents`, y el día que uno se toque sin el otro, el que quedó atrás tiene
// que ponerse rojo solo.
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

import { GET } from "@/app/api/admin/reempadronamiento/presentaciones/[id]/documentos/[docId]/route";
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
    id: 12, ownerType: "presentation", ownerId: 40, type: "dni_front",
    path: "presentations/40/abc.jpg", mime: "image/jpeg", size: JPEG.length,
    uploadedAt: new Date("2026-10-05T12:00:00Z"), validatedById: null, validatedAt: null,
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

describe("GET del documento de una presentación — autorización", () => {
  it("responde 403 sin tocar la base ni el disco para un anónimo", async () => {
    // Una route handler NO pasa por el layout del panel: lo único que cierra
    // esta puerta es el `requireAdmin()` de la primera línea.
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

describe("GET del documento de una presentación — resolución", () => {
  it("acota la búsqueda al dueño de la URL: un docId de otra presentación no se sirve", async () => {
    // EL CASO QUE NO PUEDE FALTAR. `ownerId` sale de la ruta y no del
    // documento, y `ownerType` acota a las presentaciones: las solicitudes de
    // alta viven en la MISMA tabla `documents`. Sin este filtro,
    // /presentaciones/40/documentos/999 serviría el DNI de otra presentación
    // —o el de una solicitud— a cualquier admin que tipeara un número.
    await call("40", "12");

    expect(prisma.document.findFirst).toHaveBeenCalledWith({
      where: { id: 12, ownerType: "presentation", ownerId: 40 },
    });
  });

  it("responde 404 cuando el documento no pertenece a esa presentación", async () => {
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

describe("GET del documento de una presentación — entrega", () => {
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
    expect(cd).toContain("presentacion-40-dni_front-12.jpg");
    expect(cd).not.toContain("abc.jpg");
  });

  it("asienta CADA visualización con ids y tipo, nunca datos personales", async () => {
    await call();

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 7,
      action: "presentation_document_view",
      entity: "document",
      entityId: 12,
      detail: { presentationId: 40, type: "dni_front" },
      ip: "10.0.0.7",
    });
    // Ni la ruta en disco ni el mime son datos que el asiento necesite; el
    // nombre y el DNI del socio nunca entran acá.
    expect(JSON.stringify(entry.detail)).not.toContain("presentations/40");
  });

  it("auditar dos veces significa dos asientos: no hay deduplicación", async () => {
    // Con el visor embebido cada <img>/<iframe> dispara su propio GET, así que
    // abrir el detalle dos veces audita dos vistas. Sobre-reporta contra la
    // semántica vieja de "vista deliberada", que es la dirección segura.
    await call();
    await call();
    expect(audit).toHaveBeenCalledTimes(2);
  });
});
