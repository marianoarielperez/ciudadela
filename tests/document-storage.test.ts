import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// El singleton `documentStore` importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { MAX_DOCUMENT_BYTES, makeDocumentStore, sniffDocument } from "@/lib/documents/storage";

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
const PDF = Buffer.from("%PDF-1.7\n...");

describe("sniffDocument", () => {
  it("reconoce jpg, png, webp y pdf por contenido", () => {
    expect(sniffDocument(JPG)).toEqual({ ext: "jpg", mime: "image/jpeg" });
    expect(sniffDocument(PNG)).toEqual({ ext: "png", mime: "image/png" });
    expect(sniffDocument(WEBP)).toEqual({ ext: "webp", mime: "image/webp" });
    expect(sniffDocument(PDF)).toEqual({ ext: "pdf", mime: "application/pdf" });
  });
  it("rechaza contenido desconocido aunque venga con extensión linda", () => {
    expect(sniffDocument(Buffer.from("GIF89a..."))).toBeNull();
    expect(sniffDocument(Buffer.from("<html>"))).toBeNull();
    expect(sniffDocument(Buffer.alloc(0))).toBeNull();
  });
  it("expone el límite de 10 MB", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10 * 1024 * 1024);
  });
});

// El `db` vacío es deliberado: las tres guardas cortan ANTES de tocar disco o
// DB, así que no hacen falta fixtures. Si alguna dejara de cortar temprano, el
// test explotaría contra el mock vacío — que es exactamente la señal buscada.
describe("saveApplicationDocument — guardas previas al disco", () => {
  const store = makeDocumentStore({} as never);
  const args = { applicationId: 1, type: "dni_front" as const };

  it("rechaza un archivo vacío", async () => {
    await expect(
      store.saveApplicationDocument({ ...args, data: Buffer.alloc(0) }),
    ).rejects.toThrow(/10 MB|vacío/i);
  });
  it("rechaza un archivo que supera el máximo", async () => {
    await expect(
      store.saveApplicationDocument({ ...args, data: Buffer.alloc(MAX_DOCUMENT_BYTES + 1) }),
    ).rejects.toThrow(/10 MB/);
  });
  it("rechaza un formato no admitido aunque tenga extensión linda", async () => {
    await expect(
      store.saveApplicationDocument({ ...args, data: Buffer.from("GIF89a") }),
    ).rejects.toThrow(/JPG|PDF|admitido/i);
  });
  it("rechaza un applicationId inválido antes de armar la ruta", async () => {
    await expect(
      store.saveApplicationDocument({ ...args, applicationId: Number.NaN, data: JPG }),
    ).rejects.toThrow(/inválida/i);
  });
});

// El re-empadronamiento (M6) reusa el mismo store: mismos magic bytes, mismo
// tope, misma regla de reemplazo, `ownerType: "presentation"`. Las guardas se
// prueban aparte de las del alta porque el que falla es OTRO id: una ruta
// armada con un `presentationId` basura escaparía de UPLOADS_DIR igual que uno
// de solicitud.
describe("savePresentationDocument — guardas previas al disco", () => {
  const store = makeDocumentStore({} as never);
  const args = { presentationId: 1, type: "dni_front" as const };

  it("rechaza un archivo vacío", async () => {
    await expect(
      store.savePresentationDocument({ ...args, data: Buffer.alloc(0) }),
    ).rejects.toThrow(/10 MB|vacío/i);
  });
  it("rechaza un archivo que supera el máximo", async () => {
    await expect(
      store.savePresentationDocument({ ...args, data: Buffer.alloc(MAX_DOCUMENT_BYTES + 1) }),
    ).rejects.toThrow(/10 MB/);
  });
  it("rechaza un formato no admitido aunque tenga extensión linda", async () => {
    await expect(
      store.savePresentationDocument({ ...args, data: Buffer.from("GIF89a") }),
    ).rejects.toThrow(/JPG|PDF|admitido/i);
  });
  it("rechaza un presentationId inválido antes de armar la ruta", async () => {
    await expect(
      store.savePresentationDocument({ ...args, presentationId: Number.NaN, data: JPG }),
    ).rejects.toThrow(/inválida/i);
  });
});

// Ida y vuelta REAL contra un directorio temporal: es la única forma de fijar
// que el archivo cae bajo `presentations/<id>/` y no en la carpeta del alta, y
// que el `ownerType` de la fila dice "presentation". Con esas dos cosas mal,
// los documentos de un re-empadronamiento aparecerían colgados de la solicitud
// número 1 de otro vecino.
describe("savePresentationDocument — escritura", () => {
  let root: string;
  const rows: Array<Record<string, unknown>> = [];
  let nextId = 1;

  const db = {
    document: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((r) =>
          Object.entries(where).every(([k, v]) => r[k] === v),
        ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: nextId++, ...data };
        rows.push(created);
        return created;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: number } }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i >= 0) rows.splice(i, 1);
        return { count: 1 };
      }),
    },
  };

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "sigev-docs-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("guarda bajo presentations/<id>/ con ownerType presentation", async () => {
    const store = makeDocumentStore(db as never, root);
    await store.savePresentationDocument({ presentationId: 12, type: "dni_front", data: PNG });

    expect(rows).toHaveLength(1);
    expect(rows[0].ownerType).toBe("presentation");
    expect(rows[0].ownerId).toBe(12);
    expect(rows[0].mime).toBe("image/png");
    expect(String(rows[0].path)).toMatch(/^presentations\/12\/[0-9a-f-]+\.png$/);
    await expect(readFile(path.join(root, String(rows[0].path)))).resolves.toEqual(PNG);
  });

  it("re-subir el frente REEMPLAZA: una sola fila y el archivo viejo se borra", async () => {
    const store = makeDocumentStore(db as never, root);
    const first = String(rows[0].path);
    await store.savePresentationDocument({ presentationId: 12, type: "dni_front", data: JPG });

    expect(rows.filter((r) => r.type === "dni_front")).toHaveLength(1);
    await expect(readFile(path.join(root, first))).rejects.toThrow();
  });

  it("los anexos se ACUMULAN: son documentos distintos bajo el mismo tipo", async () => {
    const store = makeDocumentStore(db as never, root);
    await store.savePresentationDocument({ presentationId: 12, type: "annex", data: PDF });
    await store.savePresentationDocument({ presentationId: 12, type: "annex", data: PNG });

    expect(rows.filter((r) => r.type === "annex")).toHaveLength(2);
  });
});
