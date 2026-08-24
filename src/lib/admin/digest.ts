// Resumen diario a la Comisión (spec 4C §6). Corre a las 07:30 y cuenta lo que
// pasó el DÍA CIVIL ANTERIOR.
//
// Dos decisiones que están en el CA y no son detalle:
//   - Sin novedades NO se envía. Y no enviar es el desenlace sano, así que la
//     ruta tampoco abre un `CronRun`: /admin/salud no puede pintar de rojo un
//     día tranquilo.
//   - El contenido son AGREGADOS. Nombres de socio sólo donde el renglón los
//     pide; nunca direcciones de email de terceros ni ids de mandato completos
//     (Ley 25.326, mismo criterio que los asientos de auditoría).
//
// Va en dos pasos —`collect()` y `send(data)`— para que la ruta pueda decidir si
// hay algo que informar ANTES de abrir la corrida.
//
// Sin `MailBudget`, a diferencia del recordatorio y de la conciliación: el tope
// de `batch-cap.ts` protege de un lote proporcional al PADRÓN (160 socios, o los
// 24 recibos que la conciliación recuperó de golpe el 23/08). Acá el lote es la
// Comisión, y su largo lo acota la propia pantalla —`digest_recipients` no pasa
// de 500 caracteres, o sea una docena larga de direcciones—. Un presupuesto que
// nunca ata no protege de nada, y el día que atara diferiría en silencio el
// único correo que el operador espera todas las mañanas: `DigestSendSummary` ni
// siquiera tiene dónde decirlo.
import type { PrismaClient } from "@/generated/prisma/client";
import { CONFIG_KEYS, configReader, parseRecipients } from "@/lib/config";
import { mailer } from "@/lib/email";
import { boardDigestEmail } from "@/lib/email/templates";
import { formatDateAR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { civilDayOf } from "@/lib/treasury/periods";

const MAX_ERRORS = 20;

function codeOf(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && c !== "" ? c : "unknown";
}

/** El día civil ARGENTINO anterior, como rango UTC semiabierto. 03:00 UTC son
 *  las 00:00 de acá — mismo idioma que `arMonthRangeUtc` en
 *  `applications/summary.ts`. Se resuelve desde `civilDayOf` y no desde el reloj
 *  UTC porque a las 07:30 AR del 1° de mes, "ayer" es el último día del mes
 *  anterior y UTC ya está en el mes nuevo. */
export function previousCivilDayRangeUtc(now: Date): { from: Date; to: Date; label: string } {
  const today = civilDayOf(now);
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 3));
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return { from, to, label: formatDateAR(from) };
}

export type DigestPaymentGroup = { type: string; count: number; total: number };

export type DigestData = {
  from: Date;
  to: Date;
  label: string;
  payments: DigestPaymentGroup[];
  paymentsCount: number;
  paymentsTotal: number;
  applications: number;
  inboxNew: number;
  notificationsFailed: number;
  cronFailures: Array<{ job: string; startedAt: Date; error: string | null }>;
  webhookErrors: number;
};

/** Qué cuenta como novedad. Si algún día se agrega un renglón al resumen, se
 *  agrega TAMBIÉN acá: un renglón que no cuenta como novedad no se manda nunca
 *  solo, y uno que cuenta pero no se muestra manda correos vacíos. */
export function hasNews(d: DigestData): boolean {
  return (
    d.paymentsCount > 0 || d.applications > 0 || d.inboxNew > 0 ||
    d.notificationsFailed > 0 || d.cronFailures.length > 0 || d.webhookErrors > 0
  );
}

export type DigestSendSummary = {
  day: string; recipients: number; sent: number; failed: number; errors: string[];
};

type Deps = {
  db: Pick<PrismaClient, "payment" | "application" | "mpUnmatchedPayment" | "notification" | "cronRun" | "webhookEvent">;
  mailer: Pick<typeof mailer, "sendToMember">;
  config: { getString(key: string): Promise<string | null> };
  now?: () => Date;
};

export function makeDigestCron(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  return {
    async collect(): Promise<DigestData> {
      const { from, to, label } = previousCivilDayRangeUtc(now());
      const range = { gte: from, lt: to };
      const [payments, applications, inboxNew, notificationsFailed, cronFailures, webhookErrors] = await Promise.all([
        // Por `createdAt` y no por `paidAt`: el resumen cuenta lo que el sistema
        // REGISTRÓ ayer. Un débito de MP acreditado hace tres días que la
        // conciliación recuperó anoche es una novedad de anoche.
        deps.db.payment.groupBy({
          by: ["type"],
          where: { createdAt: range, status: "applied" },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        deps.db.application.count({ where: { createdAt: range } }),
        deps.db.mpUnmatchedPayment.count({ where: { createdAt: range } }),
        deps.db.notification.count({ where: { sentAt: range, status: "failed" } }),
        deps.db.cronRun.findMany({
          where: { startedAt: range, ok: false },
          select: { job: true, startedAt: true, error: true },
          orderBy: { startedAt: "asc" },
        }),
        deps.db.webhookEvent.count({ where: { receivedAt: range, error: { not: null } } }),
      ]);
      const groups: DigestPaymentGroup[] = payments.map((p) => ({
        type: p.type,
        count: p._count._all,
        // Decimal → número de pesos, como en el resto del módulo.
        total: Number(p._sum.amount ?? 0),
      }));
      return {
        from, to, label,
        payments: groups,
        paymentsCount: groups.reduce((a, g) => a + g.count, 0),
        paymentsTotal: groups.reduce((a, g) => a + g.total, 0),
        applications, inboxNew, notificationsFailed,
        cronFailures: cronFailures.map((c) => ({ job: c.job, startedAt: c.startedAt, error: c.error })),
        webhookErrors,
      };
    },

    async send(data: DigestData): Promise<DigestSendSummary> {
      const to = parseRecipients(await deps.config.getString(CONFIG_KEYS.digestRecipients));
      const s: DigestSendSummary = { day: data.label, recipients: to.length, sent: 0, failed: 0, errors: [] };
      // Sin destinatarios cargados no hay a quién mandarle, y eso NO es un fallo
      // técnico: la corrida cierra en verde con `sent: 0`. Es el estado del día
      // que se lanza el sistema, antes de que el superadmin cargue la clave.
      if (to.length === 0) return s;
      const message = boardDigestEmail(data);
      for (const address of to) {
        try {
          // `memberId: null`: el destinatario es la Comisión, no un socio. La
          // fila queda acreditada igual (el mailer la escribe).
          await deps.mailer.sendToMember({
            memberId: null, to: address, type: "board_digest", message,
            summary: `resumen diario ${data.label}`,
          });
          s.sent++;
        } catch (e) {
          s.failed++;
          // El CÓDIGO, nunca la dirección: este summary va a `CronRun.summary` y
          // al asiento de auditoría (docs/08).
          if (s.errors.length < MAX_ERRORS) s.errors.push(codeOf(e));
        }
      }
      return s;
    },
  };
}

export const digestCron = makeDigestCron({ db: prisma, mailer, config: configReader });
