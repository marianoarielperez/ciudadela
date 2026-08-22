// Valor de cuota vigente e historial (REG-34). Prisma inyectado.
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { civilDayOf } from "@/lib/treasury/periods";

export type CurrentFeeValue = {
  id: number;
  activeAmount: number;
  sharedAmount: number;
  validFrom: Date;
  minuteId: number | null;
};

export type FeeValueRow = CurrentFeeValue;

type Db = Pick<PrismaClient, "feeValue">;

// Las columnas Decimal vuelven de Prisma como objetos `Decimal`, no como
// números: `Number()` acá es lo que deja al resto del sistema trabajar con
// pesos comunes. La vuelta (número → string con dos decimales) la hace quien
// escribe.
function toRow(r: {
  id: number; activeAmount: unknown; sharedAmount: unknown; validFrom: Date; minuteId: number | null;
}): FeeValueRow {
  return {
    id: r.id,
    activeAmount: Number(r.activeAmount),
    sharedAmount: Number(r.sharedAmount),
    validFrom: r.validFrom,
    minuteId: r.minuteId,
  };
}

const SELECT = { id: true, activeAmount: true, sharedAmount: true, validFrom: true, minuteId: true } as const;

export function makeFeeValueReader(db: Db) {
  return {
    /** El vigente a `at` (default: ahora): mayor `validFrom` ≤ el DÍA de `at`.
     *  `null` si no rige ninguno todavía — quien cobra tiene que abortar, no
     *  inventar.
     *
     *  La comparación no va contra el instante sino contra el mediodía UTC del
     *  día argentino de `at` (`civilDayOf`), porque `validFrom` es una fecha
     *  civil guardada al mediodía UTC = 09:00 argentinas. Contra el instante
     *  crudo, un valor que rige "desde hoy" no existiría hasta las 09:00 y el
     *  cron de devengo de las 00:30 del día 1 abortaría sin valor de cuota. */
    async current(at: Date = new Date()): Promise<CurrentFeeValue | null> {
      const row = await db.feeValue.findFirst({
        where: { validFrom: { lte: civilDayOf(at) } },
        orderBy: [{ validFrom: "desc" }, { id: "desc" }],
        select: SELECT,
      });
      return row ? toRow(row) : null;
    },
    async history(): Promise<FeeValueRow[]> {
      const rows = await db.feeValue.findMany({ orderBy: [{ validFrom: "desc" }, { id: "desc" }], select: SELECT });
      return rows.map(toRow);
    },
  };
}

export const feeValueReader = makeFeeValueReader(prisma);

/** Mensaje único para los caminos que necesitan un valor y no lo hay. */
export const NO_FEE_VALUE_MESSAGE =
  "No hay un valor de cuota vigente: registralo en Configuración → Tesorería antes de continuar.";
