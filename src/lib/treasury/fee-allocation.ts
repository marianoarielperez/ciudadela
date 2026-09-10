// La imputación de cuotas de un cobro: qué pendientes se pagan y qué períodos
// hay que crear. Vive acá porque la comparten el núcleo que ASIENTA
// (`preparePart`, en `service.ts`) y la vista previa que el operador LEE antes
// de confirmar (`previewSplit`, en `split-preview.ts`). No es una regla copiada
// dos veces: es la misma función, igual que `coverageFloor` entre el devengo, el
// recordatorio y la imputación. Con una copia por camino alcanza con que alguien
// toque una para que la pantalla anuncie un mes y el recibo diga otro.
//
// Módulo puro: el cliente de Prisma se INYECTA, nunca se importa. `@/lib/prisma`
// tira al evaluarse si falta `DATABASE_URL`, y un test puro que importe este
// módulo se caería sin `.env`.
import type { PrismaClient } from "@/generated/prisma/client";
import type { Period } from "./periods";
import { allocate, coverageFloor } from "./rules";

/** Lo que hace falta de la base para imputar: las pendientes del socio, TODAS
 *  sus cuotas (para no crear un período que ya existe) y su reingreso más
 *  nuevo. */
export type FeeContext = { pending: Period[]; existing: Period[]; readmittedAt: Date | null };

/** Las dos consultas, en paralelo.
 *
 *  El reingreso más nuevo entra en el piso de cobertura y NO se puede derivar de
 *  `joinedAt` (REG-11: el reingreso no reinicia la antigüedad, ver
 *  `applications/record.ts`). `date` es la fecha del ACTA que resolvió el
 *  reingreso: el reingreso rige desde el acta. */
export async function readFeeContext(
  db: Pick<PrismaClient, "fee" | "movement">,
  memberId: number,
): Promise<FeeContext> {
  const [fees, readmission] = await Promise.all([
    db.fee.findMany({ where: { memberId }, select: { period: true, status: true } }),
    db.movement.findFirst({
      where: { memberId, type: "readmission" },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { date: true },
    }),
  ]);
  return {
    pending: fees.filter((f) => f.status === "pending").map((f) => f.period),
    existing: fees.map((f) => f.period),
    readmittedAt: readmission?.date ?? null,
  };
}

/** `allocate` con el PISO de cobertura, no con el mes en curso: la cuenta
 *  corriente no tiene fila para lo que ya está cubierto. El piso puede quedar
 *  ANTES de hoy (quien no pagó septiembre y paga en octubre cubre septiembre
 *  primero) y también DESPUÉS (un alta de noviembre). */
export function allocateFor(
  ctx: FeeContext,
  member: { joinedAt: Date },
  n: number,
): { toPay: Period[]; toCreate: Period[] } {
  return allocate({
    pending: ctx.pending,
    existing: ctx.existing,
    n,
    startAt: coverageFloor({ joinedAt: member.joinedAt, readmittedAt: ctx.readmittedAt }),
  });
}
