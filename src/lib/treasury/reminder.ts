// Recordatorio de vencimiento (spec 4C §5). Corre a diario a las 10:00 y actúa
// el ÚLTIMO día civil del mes: mañana la cuota pasa a ser mora.
//
// Por qué el último día y no "el 30": febrero no tiene 30, y un aviso que se
// saltea un mes entero no es un aviso.
//
// Por qué antes de la mora y no después: el sistema avisa para que el socio
// pueda pagar, no para reprocharle. El aviso de mora (`arrears_alert`) sigue
// existiendo en el enum y no se usa todavía.
//
// La dedupe es una FILA, no una variable: PM2 se reinicia y una línea duplicada
// en el crontab dispara dos corridas (docs/10:595-598). Y excluye las `failed`,
// que registran un intento que no salió.
import type { PrismaClient } from "@/generated/prisma/client";
import { mailer } from "@/lib/email";
import { makeMailBudget } from "@/lib/email/batch-cap";
import { feeReminderEmail } from "@/lib/email/templates";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { prisma } from "@/lib/prisma";
import { feeValueReader, type makeFeeValueReader } from "@/lib/treasury/fee-values";
import { comparePeriods, currentPeriod, isLastCivilDayOfMonth, type Period } from "./periods";
import { ACCRUING_CATEGORIES, coverageFloor, debtAmount, feeAmountFor } from "./rules";

const MAX_ERRORS = 50;
const ERROR_MAX = 240;

// Sólo el código: el error de nodemailer trae la dirección en claro y este
// summary va a `CronRun.summary` y al asiento de auditoría (docs/08).
function codeOf(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && c !== "" ? c : "unknown";
}

export type ReminderSummary = {
  period: Period;
  /** Devengantes vigentes a los que el mes en curso YA les corresponde
   *  (`coverageFloor` ≤ período) y que no lo tienen cubierto. */
  candidates: number;
  sent: number;
  /** Dedupe: ya tenían el aviso de ESTE período. */
  alreadyNotified: number;
  /** Sin casilla utilizable → lista de gestión manual. */
  noEmail: number;
  /** Bloqueados por `EMAIL_ALLOWLIST`. NO son errores: es la guarda del entorno
   *  de prueba funcionando (spec §7.2). Se cuentan aparte para que el operador
   *  vea cuántos avisos NO salieron sin que la corrida quede en rojo. */
  allowlistBlocked: number;
  /** Los que excedieron `MAIL_BATCH_CAP`. Ojo: NO los levanta la corrida
   *  siguiente — `willAct()` sólo es cierto el último día del mes, y para
   *  entonces `period` ya es otro. Este contador es la única señal. */
  deferred: number;
  errors: string[];
  errorsOmitted: number;
};

type Deps = {
  db: Pick<PrismaClient, "member" | "movement" | "fee" | "notification">;
  mailer: Pick<typeof mailer, "sendToMember">;
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  now?: () => Date;
};

export function makeReminderCron(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  return {
    willAct(): boolean {
      return isLastCivilDayOfMonth(now());
    },

    async run(): Promise<ReminderSummary> {
      const at = now();
      // El período sale de `currentPeriod` y no de un armado a mano: es "YYYY-MM"
      // válido por construcción, y viaja a una columna Char(7) que no valida nada.
      const period = currentPeriod(at);
      const s: ReminderSummary = {
        period, candidates: 0, sent: 0, alreadyNotified: 0, noEmail: 0,
        allowlistBlocked: 0, deferred: 0, errors: [], errorsOmitted: 0,
      };
      const fail = (ref: string, e: unknown) => {
        console.error("[reminder]", ref, codeOf(e));
        if (s.errors.length >= MAX_ERRORS) { s.errorsOmitted++; return; }
        s.errors.push(`${ref}: ${codeOf(e)}`.slice(0, ERROR_MAX));
      };

      // Los devengantes vigentes (el adherente no devenga; el suspendido sí).
      // `joinedAt` viaja porque el piso de cobertura se calcula abajo: sin él,
      // esta consulta reclamaría septiembre a quien ingresó en septiembre.
      const members = await deps.db.member.findMany({
        where: { status: { in: ["active", "suspended"] }, category: { in: [...ACCRUING_CATEGORIES] } },
        select: { id: true, fullName: true, email: true, emailStatus: true, category: true, joinedAt: true },
        orderBy: { id: "asc" },
      });
      if (members.length === 0) return s;
      const ids = members.map((m) => m.id);

      const [paidRows, notifiedRows, pendingGroups, readmissions, feeValue] = await Promise.all([
        // Bajo el modelo de dos niveles, la cuota del mes en curso sólo tiene
        // fila si alguien la cubrió (el devengo la materializa el 01 del mes que
        // viene). O sea: "no existe `Fee(M, paid|exempt)`" es exactamente "no
        // tiene cubierto el mes en curso". `exempt` entra porque hoy no lo
        // escribe ningún camino pero las pantallas ya lo renderizan: el día que
        // exista, al eximido no se le puede reclamar la cuota.
        deps.db.fee.findMany({
          where: { memberId: { in: ids }, period, status: { in: ["paid", "exempt"] } },
          select: { memberId: true },
        }),
        deps.db.notification.findMany({
          where: { memberId: { in: ids }, type: "fee_reminder", period, status: { not: "failed" } },
          select: { memberId: true },
        }),
        // ATRASADAS son las de períodos ANTERIORES al corriente. Con `status:
        // "pending"` a secas se colaba la del mes en curso —la deja `revertFees`
        // al anular un recibo del mes— y el correo nombraba dos veces la misma
        // cuota: "vence mañana" y, abajo, "1 cuota atrasada".
        deps.db.fee.groupBy({
          by: ["memberId"],
          where: { memberId: { in: ids }, status: "pending", period: { lt: period } },
          _count: { _all: true },
        }),
        // Mismo lote que el devengo (`accrual.ts`): el reingreso no se deriva de
        // `joinedAt` (REG-11 no reinicia la antigüedad), sale del `Movement` más
        // nuevo. Una consulta para todos, no una por socio.
        deps.db.movement.groupBy({
          by: ["memberId"],
          where: { type: "readmission", memberId: { in: ids } },
          _max: { date: true },
        }),
        deps.feeValues.current(at),
      ]);
      const paid = new Set(paidRows.map((r) => r.memberId));
      const notified = new Set(notifiedRows.map((r) => r.memberId));
      const pendingBy = new Map(pendingGroups.map((g) => [g.memberId, g._count._all]));
      const readmittedBy = new Map<number, Date | null>(readmissions.map((r) => [r.memberId, r._max.date ?? null]));

      const budget = makeMailBudget();
      for (const m of members) {
        // El MISMO piso que usa el devengo (`periodsToAccrue` → `coverageFloor`).
        // La cuota de ingreso cubre el mes del alta (REG-14), así que al que
        // ingresó —o reingresó— este mes no se le devenga nada todavía: no hay
        // `Fee` que reclamar y el pago de ingreso ni siquiera es una cuota.
        // Sin esta guarda, el vecino que se afilió el 25/09 recibía el 30/09 un
        // reclamo por septiembre.
        if (comparePeriods(coverageFloor({ joinedAt: m.joinedAt, readmittedAt: readmittedBy.get(m.id) ?? null }), period) > 0) {
          continue;
        }
        if (paid.has(m.id)) continue;
        s.candidates++;
        if (notified.has(m.id)) { s.alreadyNotified++; continue; }
        // Mismo filtro que el recibo (`receipt-email.ts:59`): sin casilla o con
        // rebote, no se manda. Estos son los que van a la lista imprimible de
        // gestión manual de Deudores.
        if (!m.email || m.emailStatus === "bounced") { s.noEmail++; continue; }
        if (!budget.take()) continue;
        const arrears = pendingBy.get(m.id) ?? 0;
        try {
          await deps.mailer.sendToMember({
            memberId: m.id,
            to: m.email,
            type: "fee_reminder",
            period,
            message: feeReminderEmail({
              name: m.fullName,
              period,
              amount: feeValue ? feeAmountFor(m.category, feeValue) : null,
              arrears,
              debt: feeValue ? debtAmount(arrears, m.category, feeValue) : null,
            }),
            summary: `recordatorio de vencimiento ${period}`,
          });
          s.sent++;
        } catch (e) {
          // El bloqueo de la allowlist NO es un fallo (spec §7.2, mismo criterio
          // que `email/index.ts:61`): en producción la lista sigue definida
          // hasta el checklist de lanzamiento, así que contarlo como error
          // dejaría la corrida del 30 en 207, `CronRun.ok = false` y
          // /admin/salud en rojo por diseño, todos los meses.
          if (codeOf(e) === ALLOWLIST_BLOCK_CODE) {
            s.allowlistBlocked++;
            // El correo nunca tocó la red: devolver el lugar es lo mismo que
            // hace el recibo con el socio sin casilla (`batch-cap.ts`). Si no,
            // en un padrón grande los bloqueados agotarían el tope y diferirían
            // justo a los que sí están en la lista.
            budget.refund();
            continue;
          }
          // El mailer ya dejó la fila `failed` con el código (4C §7.1); acá
          // queda el contador y el id interno, para que el summary diga a
          // cuántos no se les pudo avisar.
          fail(`member:${m.id}`, e);
        }
      }
      s.deferred = budget.deferred;
      return s;
    },
  };
}

export const reminderCron = makeReminderCron({ db: prisma, mailer, feeValues: feeValueReader });
