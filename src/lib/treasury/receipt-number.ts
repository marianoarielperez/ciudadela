// Serie única AAAA-NNNNN (REG-33). La secuencia se toma DENTRO de la transacción
// que crea el recibo: `INSERT … ON DUPLICATE KEY UPDATE` deja la fila del año
// bloqueada hasta el commit, así que dos pagos concurrentes se serializan y, si
// la transacción falla, el incremento se deshace con ella. Sin huecos.
import type { Prisma } from "@/generated/prisma/client";

export function formatReceiptNumber(year: number, seq: number): string {
  return `${year}-${String(seq).padStart(5, "0")}`;
}

export function parseReceiptNumber(s: string): { year: number; seq: number } | null {
  const m = /^(\d{4})-(\d{5})$/.exec(s);
  return m ? { year: Number(m[1]), seq: Number(m[2]) } : null;
}

// El cliente que `$transaction` le pasa al callback.
export type TxLike = Prisma.TransactionClient;

export async function nextReceiptSeq(tx: TxLike, year: number): Promise<number> {
  await tx.$executeRaw`INSERT INTO receipt_sequences (year, last) VALUES (${year}, 1) ON DUPLICATE KEY UPDATE last = last + 1`;
  const row = await tx.receiptSequence.findUniqueOrThrow({ where: { year } });
  return row.last;
}
