// Los PDFs viven fuera del webroot (RECEIPTS_DIR, prod /var/sigev/recibos, ya
// incluido en backup.sh) y se sirven solo por rutas autenticadas. Este módulo
// importa node:fs: NO importarlo desde componentes cliente.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseReceiptNumber } from "./receipt-number";

export function receiptsDir(): string {
  return process.env.RECEIPTS_DIR ?? "./recibos";
}

// La única forma de ruta que este módulo produce: `2026/2026-00001.pdf`. Sin
// separadores extra, sin `..`, sin barras invertidas.
const REL_PATH_RE = /^\d{4}\/\d{4}-\d{5}\.pdf$/;

/** Ruta relativa determinística: `2026/2026-00001.pdf`. Lanza con un número
 *  que no tenga la forma de la serie: nunca se arma una ruta con texto libre. */
export function receiptRelativePath(number: string): string {
  const parsed = parseReceiptNumber(number);
  if (!parsed) throw new Error(`Número de recibo inválido: ${number}`);
  return path.posix.join(String(parsed.year), `${number}.pdf`);
}

// La guarda va acá adentro y no solo en `receiptRelativePath` porque el llamador
// puede saltearse ese armado: la ruta del recibo viaja en la fila de la DB y la
// route handler que sirve el PDF la toma de ahí. Validar en el punto donde se
// toca el disco hace que el camino seguro sea el único camino.
function assertReceiptRelPath(relPath: string): string {
  if (!REL_PATH_RE.test(relPath)) {
    throw new Error(`Ruta de recibo inválida: ${relPath}`);
  }
  // El directorio tiene que ser el año del número; `2025/2026-00001.pdf` no.
  const [dir, file] = relPath.split("/");
  if (dir !== file.slice(0, 4)) {
    throw new Error(`Ruta de recibo inválida: ${relPath}`);
  }
  return relPath;
}

export async function writeReceiptPdf(relPath: string, bytes: Uint8Array): Promise<void> {
  const abs = path.join(receiptsDir(), assertReceiptRelPath(relPath));
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
}

export async function readReceiptPdf(relPath: string): Promise<Buffer> {
  return readFile(path.join(receiptsDir(), assertReceiptRelPath(relPath)));
}
