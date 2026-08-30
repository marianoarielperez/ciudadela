import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_DOC_BYTES,
  deleteInstitutionalDocument,
  institutionalDocsDir,
  saveInstitutionalDocument,
  sniffPdf,
} from "@/lib/institutional-documents/storage";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n%contenido de prueba");

// `Uint8Array<ArrayBuffer>` y no `Uint8Array` a secas: el genérico por defecto
// es `ArrayBufferLike`, que incluye `SharedArrayBuffer` y no es un `BlobPart`.
function fileOf(bytes: Uint8Array<ArrayBuffer>, name = "doc.pdf"): File {
  return new File([bytes], name, { type: "application/pdf" });
}

describe("sniffPdf", () => {
  it("acepta solo la firma %PDF-", () => {
    expect(sniffPdf(PDF_BYTES)).toBe(true);
    expect(sniffPdf(new TextEncoder().encode("<!DOCTYPE html>"))).toBe(false);
    // Un JPEG o un PNG no son un documento institucional aunque el sniffer de
    // imágenes los acepte: acá la allowlist es PDF y nada más.
    expect(sniffPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(sniffPdf(new Uint8Array([]))).toBe(false);
    expect(sniffPdf(new TextEncoder().encode("%PD"))).toBe(false);
  });
});

describe("saveInstitutionalDocument / deleteInstitutionalDocument", () => {
  let dir: string;
  let prevUploads: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sigev-docs-"));
    prevUploads = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = dir;
  });
  afterEach(() => {
    process.env.UPLOADS_DIR = prevUploads;
    if (prevUploads === undefined) delete process.env.UPLOADS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("escribe {uuid}.pdf bajo UPLOADS_DIR/institucional y reporta el tamaño real", async () => {
    const saved = await saveInstitutionalDocument(fileOf(PDF_BYTES));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.fileName).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(saved.size).toBe(PDF_BYTES.length);
    const onDisk = readFileSync(path.join(institutionalDocsDir(), saved.fileName));
    expect(new Uint8Array(onDisk)).toEqual(PDF_BYTES);
  });

  it("rechaza archivo vacío, no-PDF y tamaño excedido", async () => {
    expect(await saveInstitutionalDocument(fileOf(new Uint8Array([])))).toMatchObject({ ok: false });
    const html = new TextEncoder().encode("<!DOCTYPE html><script>1</script>");
    expect(await saveInstitutionalDocument(fileOf(html))).toMatchObject({ ok: false });
    // File sintético que MIENTE su .size: el corte temprano lo agarra sin leer.
    const liar = { size: MAX_DOC_BYTES + 1, arrayBuffer: async () => PDF_BYTES.buffer } as unknown as File;
    expect(await saveInstitutionalDocument(liar)).toMatchObject({ ok: false });
  });

  // El corte temprano por `file.size` no alcanza: un File sintético puede
  // DECLARAR poco y traer de más. El límite que importa es el que se aplica
  // sobre los bytes que van al disco, y este caso es el único que lo ejerce.
  it("rechaza los bytes reales excedidos aunque el File declare un tamaño chico", async () => {
    const oversized = new Uint8Array(MAX_DOC_BYTES + 1);
    oversized.set(new TextEncoder().encode("%PDF-1.7"), 0);
    const liar = { size: 8, arrayBuffer: async () => oversized.buffer } as unknown as File;
    expect(await saveInstitutionalDocument(liar)).toMatchObject({ ok: false });
    expect(existsSync(institutionalDocsDir())).toBe(false);
  });

  it("el borrado trata ENOENT como éxito y rechaza nombres inválidos sin tocar el fs", async () => {
    await expect(
      deleteInstitutionalDocument("123e4567-e89b-42d3-a456-426614174000.pdf"),
    ).resolves.toBeUndefined();
    // El nombre inválido tiene que cortarse ANTES del unlink: si se concatenara,
    // `institucional/../algo.pdf` sale del directorio y borra un archivo ajeno.
    const outside = path.join(dir, "algo.pdf");
    writeFileSync(outside, "no me toques");
    await expect(deleteInstitutionalDocument("../algo.pdf")).resolves.toBeUndefined();
    expect(existsSync(outside)).toBe(true);
  });

  it("borra el archivo guardado cuando el nombre es válido", async () => {
    const saved = await saveInstitutionalDocument(fileOf(PDF_BYTES));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const onDisk = path.join(institutionalDocsDir(), saved.fileName);
    expect(existsSync(onDisk)).toBe(true);
    await deleteInstitutionalDocument(saved.fileName);
    expect(existsSync(onDisk)).toBe(false);
  });
});
