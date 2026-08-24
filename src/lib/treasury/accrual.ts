// Cron de devengo (spec 4C §4). Corre todos los días a las 00:30 y ACTÚA sólo
// cuando el día civil argentino es 1.
//
// Qué materializa: la cuota del mes M nace el 01/M ("al cobro") pero su FILA se
// crea el 01/M+1, cuando ya es mora (decisión del operador, 23/08/2026). Por eso
// `upTo` es el mes VENCIDO y no el corriente: así los 21 puntos del sistema que
// cuentan filas `pending` a secas —Deudores, niveles de mora, cesantía,
// `debtAtWithdrawal`— siguen siendo correctos sin tocar ninguno.
//
// Por qué existe: el padrón de deuda (foto del 21/08/2026) cubre a todos hasta
// agosto de 2026 y trajo SÓLO lo impago. Sin este cron, desde octubre un socio
// que debe septiembre se muestra "al día" porque no hay fila que contar.
//
// NO manda emails y NO lee `fee_values`: la cuota no lleva monto (la deuda se
// valúa a valor vigente al momento del pago, REG-16 generalizado).
import type { PrismaClient } from "@/generated/prisma/client";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";
import { addMonths, comparePeriods, currentPeriod, isFirstCivilDayOfMonth, type Period } from "./periods";
import { ACCRUING_CATEGORIES, periodsToAccrue } from "./rules";

/** Mismos topes que el reconcile: el summary va a `CronRun.summary` y al asiento
 *  de auditoría, así que no puede crecer sin techo. */
const MAX_ERRORS = 50;
const ERROR_MAX = 240;

export type AccrualSummary = {
  membersScanned: number;
  membersAccrued: number;
  feesCreated: number;
  /** De las planificadas, cuántas son de períodos ANTERIORES a `upTo`. Es el
   *  número que dice si la corrida fue de rutina o tapó un hueco. */
  backfilled: number;
  upTo: Period;
  errors: string[];
  errorsOmitted: number;
};

type Deps = {
  db: Pick<PrismaClient, "member" | "movement" | "fee">;
  now?: () => Date;
};

export function makeAccrualCron(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  return {
    /** La decisión de "hoy no corresponde" vive ACÁ y no en la ruta (spec §4):
     *  la ruta sólo la consulta para no abrir un `CronRun` que no representa
     *  ninguna corrida (§8, D2: una corrida que decide no actuar no es una
     *  corrida). */
    willAct(): boolean {
      return isFirstCivilDayOfMonth(now());
    },

    async run(opts?: { upTo?: Period }): Promise<AccrualSummary> {
      // El mes VENCIDO. Inyectable para poder probar "corrió por primera vez en
      // noviembre" sin tocar el reloj del sistema.
      const upTo = opts?.upTo ?? addMonths(currentPeriod(now()), -1);
      const s: AccrualSummary = {
        membersScanned: 0, membersAccrued: 0, feesCreated: 0, backfilled: 0,
        upTo, errors: [], errorsOmitted: 0,
      };
      const fail = (ref: string, e: unknown) => {
        console.error("[accrual]", ref, safeMessage(e));
        if (s.errors.length >= MAX_ERRORS) { s.errorsOmitted++; return; }
        s.errors.push(`${ref}: ${safeMessage(e)}`.slice(0, ERROR_MAX));
      };

      // El `where` filtra las dos condiciones que la regla pura volvería a
      // aplicar: así no se traen los 124 adherentes ni los 117 dados de baja.
      // El SUSPENDIDO entra: la suspensión es disciplinaria, no eximición
      // (rules.ts:80), y Deudores ya cuenta sus pendientes (debtors.ts:56).
      const members = await deps.db.member.findMany({
        where: { status: { in: ["active", "suspended"] }, category: { in: [...ACCRUING_CATEGORIES] } },
        select: { id: true, status: true, category: true, joinedAt: true },
        orderBy: { id: "asc" },
      });
      s.membersScanned = members.length;
      if (members.length === 0) return s;
      const ids = members.map((m) => m.id);

      // Las dos consultas de contexto, en LOTE. El reingreso no se puede derivar
      // de `joinedAt` (REG-11: no reinicia la antigüedad), así que sale del
      // `Movement` de tipo `readmission` más nuevo — una consulta para todos, no
      // una por socio.
      const [feeRows, readmissions] = await Promise.all([
        deps.db.fee.findMany({ where: { memberId: { in: ids } }, select: { memberId: true, period: true } }),
        deps.db.movement.groupBy({
          by: ["memberId"],
          where: { type: "readmission", memberId: { in: ids } },
          _max: { date: true },
        }),
      ]);
      const existingBy = new Map<number, Period[]>();
      for (const f of feeRows) existingBy.set(f.memberId, [...(existingBy.get(f.memberId) ?? []), f.period]);
      const readmittedBy = new Map<number, Date | null>(readmissions.map((r) => [r.memberId, r._max.date ?? null]));

      for (const m of members) {
        // `readmittedAt` es OPCIONAL en la firma de `periodsToAccrue`: omitirlo
        // acá compilaría y le devengaría al reingresado los meses en los que no
        // fue socio. Va explícito, y hay un test que lo fija.
        const periods = periodsToAccrue(
          { ...m, readmittedAt: readmittedBy.get(m.id) ?? null },
          upTo,
          existingBy.get(m.id) ?? [],
        );
        if (periods.length === 0) continue;
        try {
          // Un `createMany` POR SOCIO y no uno global (mismo argumento de
          // atomicidad que el import de deuda): un socio queda con todo su
          // backfill o con nada, y la corrida se puede cortar y relanzar.
          //
          // `skipDuplicates` NO reemplaza a la lectura previa —la lectura es la
          // que respeta que una cuota `import` o `paid` manda sobre el devengo, y
          // la que hace honesto el summary—: está por la CARRERA con un pago
          // simultáneo, que puede crear el mismo período entre el findMany y esta
          // línea. Sin él, ese P2002 mataría el INSERT entero del socio.
          const r = await deps.db.fee.createMany({
            data: periods.map((period) => ({
              memberId: m.id, period, status: "pending" as const, origin: "accrual" as const,
            })),
            skipDuplicates: true,
          });
          s.feesCreated += r.count;
          s.backfilled += periods.filter((p) => comparePeriods(p, upTo) < 0).length;
          if (r.count > 0) s.membersAccrued++;
        } catch (e) {
          // El id del socio SÍ va al summary: es un id interno, no un dato
          // personal, y sin él "falló uno de 35" no le sirve a nadie.
          fail(`member:${m.id}`, e);
        }
      }
      return s;
    },
  };
}

export const accrualCron = makeAccrualCron({ db: prisma });
