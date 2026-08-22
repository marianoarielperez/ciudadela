// Serie única AAAA-NNNNN (REG-33). La secuencia se toma DENTRO de la transacción
// que crea el recibo: `INSERT … ON DUPLICATE KEY UPDATE` deja la fila del año
// bloqueada hasta el commit, así que dos pagos concurrentes se serializan y, si
// la transacción falla, el incremento se deshace con ella. Sin huecos.
//
// Costo del candado (importa para quien arme el servicio de cobro): el lock X
// sobre la fila del año NO se suelta al volver de `nextReceiptSeq`, sino recién
// cuando commitea la transacción del llamador. Todo lo que esa transacción haga
// después del pedido de número corre con los demás recibos esperando detrás. De
// ahí dos reglas: pedir el número TARDE en la transacción (después de validar y
// de escribir todo lo que se pueda escribir antes) y NUNCA escribir el PDF a
// disco adentro de la transacción — un I/O de decenas de ms multiplicado por la
// cola alcanza el timeout de 5 s que Prisma aplica por defecto.
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

/**
 * Reserva el próximo número de la serie del año y lo devuelve.
 *
 * **Solo es correcto adentro del `$transaction` que crea el recibo.** El tipo no
 * alcanza para exigirlo: `PrismaClient` satisface estructuralmente a
 * `Prisma.TransactionClient`, así que `nextReceiptSeq(prisma, 2026)` compila —
 * y ejecuta el INSERT en autocommit, consumiendo un número que ya no se puede
 * devolver si el recibo después no se crea. Eso es justamente el hueco en la
 * serie que REG-33 prohíbe. Pasá siempre el `tx` del callback.
 *
 * El lock queda tomado hasta el commit del llamador: pedir el número tarde en la
 * transacción y no hacer I/O de archivos adentro (ver el comentario de cabecera).
 */
export async function nextReceiptSeq(tx: TxLike, year: number): Promise<number> {
  await tx.$executeRaw`INSERT INTO receipt_sequences (year, last) VALUES (${year}, 1) ON DUPLICATE KEY UPDATE last = last + 1`;
  const row = await tx.receiptSequence.findUniqueOrThrow({ where: { year } });
  return row.last;
}
