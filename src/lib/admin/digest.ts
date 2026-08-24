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
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { boardDigestEmail } from "@/lib/email/templates";
import { formatDateAR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { civilDayOf } from "@/lib/treasury/periods";

const MAX_ERRORS = 20;

/** Tope del renglón de crons. Los jobs distintos son cinco (`CRON_JOBS`), así que
 *  agrupar por `job` ya acota el renglón a cinco entradas y este `take` no
 *  debería atar nunca. Está igual porque el renglón se arma con lo que devuelve
 *  la consulta y va a varias casillas: un job nuevo, o uno que empiece a escribir
 *  corridas con otro nombre, no puede estirarlo sin límite. */
const MAX_CRON_JOBS = 10;

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
  cronFailures: Array<{ job: string; runs: number }>;
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
  day: string; recipients: number; sent: number;
  /** Bloqueados por `EMAIL_ALLOWLIST`. NO son `failed`: ver el catch de
   *  `send()`. Contarlos aparte es lo que evita que la pantalla de salud arranque
   *  en rojo mientras la lista siga puesta. */
  allowlistBlocked: number;
  failed: number; errors: string[];
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
        // AGRUPADO por job, no una fila por corrida. `reconcile` escribe un
        // `CronRun` en CADA invocación (el 500 y el 207 incluidos), así que un
        // job en loop de reintentos —un curl en un wrapper, o el botón de
        // re-disparo de /admin/salud— daba un renglón que decía
        // "reconcile, reconcile, reconcile, …". Lo que la Comisión necesita
        // saber es QUÉ se rompió y CUÁNTAS veces.
        deps.db.cronRun.groupBy({
          by: ["job"],
          where: { startedAt: range, ok: false },
          _count: { job: true },
          orderBy: { _count: { job: "desc" } },
          take: MAX_CRON_JOBS,
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
        cronFailures: cronFailures.map((c) => ({ job: c.job, runs: c._count.job })),
        webhookErrors,
      };
    },

    async send(data: DigestData): Promise<DigestSendSummary> {
      const to = parseRecipients(await deps.config.getString(CONFIG_KEYS.digestRecipients));
      const s: DigestSendSummary = {
        day: data.label, recipients: to.length, sent: 0, allowlistBlocked: 0, failed: 0, errors: [],
      };
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
          // El bloqueo de la allowlist NO es un fallo de envío (mismo criterio
          // que `treasury/reminder.ts:210` y `email/index.ts:61`). Sin esta
          // rama, el día que el superadmin cargue las direcciones de la Comisión
          // —con la lista todavía puesta, que es el estado de producción hasta
          // el checklist de lanzamiento— la primera noche con novedades cerraría
          // la corrida en `ok: false` y /admin/salud arrancaría en rojo por
          // diseño: un rojo que no se apaga hasta que se borre la variable, y
          // que además queda pegado hasta la próxima corrida con novedades.
          if (codeOf(e) === ALLOWLIST_BLOCK_CODE) { s.allowlistBlocked++; continue; }
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
