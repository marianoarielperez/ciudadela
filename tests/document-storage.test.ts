import { describe, expect, it, vi } from "vitest";

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
