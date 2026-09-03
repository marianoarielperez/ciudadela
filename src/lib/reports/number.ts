// El N° PÚBLICO de un reporte: serie corrida (1, 2, 3…), sin huecos, asignada
// recién al ENVIAR. Calcado de `treasury/receipt-number.ts` (REG-33) sin
// importarlo: el núcleo de plata no se toca ni se extiende para exportar una
// pieza, y el `TxLike` de acá es propio por el mismo motivo.
//
// Por qué existe: la fila de `reports` nace `draft` en el paso 1 del wizard,
// antes de que el vecino termine, así que mostrar `reports.id` le regalaba un
// número a cada wizard abandonado (la purga borra el borrador a las 48 h, pero
// el AUTO_INCREMENT no vuelve). En producción el primer reporte real salió como
// "N° 16". El `id` sigue mandando en todo lo interno: URLs, FKs, claims,
// auditoría y el `reportId` de los formularios. Lo único que cambia es lo que
// se MUESTRA.
//
// Costo del candado (importa para quien toque `service.submit`): el lock X sobre
// la única fila de `report_sequences` NO se suelta al volver de acá, sino recién
// cuando commitea la transacción del llamador. Todo lo que esa transacción haga
// después corre con los demás envíos esperando detrás. De ahí las dos reglas de
// siempre: pedir el número TARDE (después de validar todo lo que se pueda
// validar antes) y NADA de red ni de disco adentro — el timeout por defecto de
// Prisma es de 5 s.
import type { Prisma } from "@/generated/prisma/client";

/** La única fila de `report_sequences`. La tabla es un contador, no un registro:
 *  no hay serie por año como en los recibos, porque el N° del reporte es
 *  corrido de punta a punta (decisión del operador, 03/09/2026). */
const ROW_ID = 1;

/** El cliente que `$transaction` le pasa al callback. Declarado acá y no
 *  importado de treasury: son dos módulos que no se conocen. */
export type TxLike = Prisma.TransactionClient;

/**
 * Reserva el próximo N° público y lo devuelve.
 *
 * **Solo es correcto adentro del `$transaction` que marca el reporte como
 * enviado.** El tipo no alcanza para exigirlo: `PrismaClient` satisface
 * estructuralmente a `Prisma.TransactionClient`, así que `nextReportNumber(prisma)`
 * compila — y ejecuta el INSERT en autocommit, consumiendo un número que ya no
 * se puede devolver si el envío después no se escribe. Ése es justamente el
 * hueco que esta serie viene a evitar. Pasá siempre el `tx` del callback.
 */
export async function nextReportNumber(tx: TxLike): Promise<number> {
  await tx.$executeRaw`INSERT INTO report_sequences (id, last) VALUES (${ROW_ID}, 1) ON DUPLICATE KEY UPDATE last = last + 1`;
  const row = await tx.reportSequence.findUniqueOrThrow({ where: { id: ROW_ID } });
  return row.last;
}
