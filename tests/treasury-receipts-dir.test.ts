import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readReceiptPdf, receiptRelativePath, receiptsDir, writeReceiptPdf,
} from "@/lib/treasury/receipts-dir";

const saved = { ...process.env };
const temps: string[] = [];

afterEach(async () => {
  process.env = { ...saved };
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function useTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sigev-recibos-"));
  temps.push(dir);
  process.env.RECEIPTS_DIR = dir;
  return dir;
}

describe("receiptsDir", () => {
  it("cae a ./recibos cuando no está RECEIPTS_DIR", () => {
    delete process.env.RECEIPTS_DIR;
    expect(receiptsDir()).toBe("./recibos");
  });
  it("usa RECEIPTS_DIR cuando está definida", () => {
    process.env.RECEIPTS_DIR = "/var/sigev/recibos";
    expect(receiptsDir()).toBe("/var/sigev/recibos");
  });
});

describe("receiptRelativePath", () => {
  it("arma AAAA/AAAA-NNNNN.pdf", () => {
    expect(receiptRelativePath("2026-00001")).toBe("2026/2026-00001.pdf");
    expect(receiptRelativePath("1999-12345")).toBe("1999/1999-12345.pdf");
  });
  it.each(["", "2026-1", "26-00001", "2026-000001", "abc", "../../etc/passwd", "2026-00001.pdf"])(
    "lanza con %s: nunca se arma una ruta con texto libre",
    (bad) => {
      expect(() => receiptRelativePath(bad)).toThrow(/inválido/i);
    },
  );
});

// La guarda vive adentro de write/read y no solo en `receiptRelativePath`: la
// ruta del recibo viaja en la fila de la DB y la route handler que sirve el PDF
// la toma de ahí, salteándose el armado.
describe("writeReceiptPdf / readReceiptPdf", () => {
  const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

  it("hace el viaje de ida y vuelta bajo RECEIPTS_DIR", async () => {
    const dir = await useTempDir();
    const rel = receiptRelativePath("2026-00007");
    await writeReceiptPdf(rel, BYTES);
    expect(await readdir(path.join(dir, "2026"))).toEqual(["2026-00007.pdf"]);
    expect(Buffer.from(await readReceiptPdf(rel))).toEqual(Buffer.from(BYTES));
  });

  const BAD = [
    "../../../etc/passwd",
    "2026/../../../etc/passwd",
    "2026/../2026/2026-00001.pdf",
    "2026\\2026-00001.pdf", // separador de Windows: no es la forma que producimos
    "/2026/2026-00001.pdf",
    "2026/2026-00001.pdf/../../x.pdf",
    "2026/2026-00001.PDF",
    "2026/recibo.pdf",
    "2025/2026-00001.pdf", // año del directorio distinto del año del número
    "",
  ];

  it.each(BAD)("writeReceiptPdf rechaza %s", async (bad) => {
    await useTempDir();
    await expect(writeReceiptPdf(bad, BYTES)).rejects.toThrow(/Ruta de recibo inválida/);
  });

  it.each(BAD)("readReceiptPdf rechaza %s", async (bad) => {
    await useTempDir();
    await expect(readReceiptPdf(bad)).rejects.toThrow(/Ruta de recibo inválida/);
  });

  it("un intento de traversal no deja nada escrito", async () => {
    const dir = await useTempDir();
    await expect(writeReceiptPdf("../fuera.pdf", BYTES)).rejects.toThrow(/inválida/);
    expect(await readdir(dir)).toEqual([]);
    expect(await readdir(path.dirname(dir))).not.toContain("fuera.pdf");
  });
});
