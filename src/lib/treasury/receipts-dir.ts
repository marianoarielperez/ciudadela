// Los PDFs viven fuera del webroot (RECEIPTS_DIR, prod /var/sigev/recibos, ya
// incluido en backup.sh) y se sirven solo por rutas autenticadas. Este módulo
// importa node:fs: NO importarlo desde componentes cliente.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseReceiptNumber } from "./receipt-number";

export function receiptsDir(): string {
  return process.env.RECEIPTS_DIR ?? "./recibos";
}

/** Ruta relativa determinística: `2026/2026-00001.pdf`. Lanza con un número
 *  que no tenga la forma de la serie: nunca se arma una ruta con texto libre. */
export function receiptRelativePath(number: string): string {
  const parsed = parseReceiptNumber(number);
  if (!parsed) throw new Error(`Número de recibo inválido: ${number}`);
  return path.posix.join(String(parsed.year), `${number}.pdf`);
}

export async function writeReceiptPdf(relPath: string, bytes: Uint8Array): Promise<void> {
  const abs = path.join(receiptsDir(), relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
}

export async function readReceiptPdf(relPath: string): Promise<Buffer> {
  return readFile(path.join(receiptsDir(), relPath));
}
