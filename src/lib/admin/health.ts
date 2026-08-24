// Los datos de /admin/salud (spec 4C §8). Prisma INYECTADO: el módulo se prueba
// sin `.env`.
//
// Alcance (D3): tablero de una mirada. Dice QUÉ está mal y DESDE CUÁNDO, con el
// dato mínimo para ir a buscarlo. El diagnóstico fino sigue en `pm2 logs sigev`
// y en las tablas — y eso es un techo real, no una omisión: los ids de lo que
// falló en el reconcile van al log y NO al summary (decisión de
// `mp/reconcile.ts:124-127`, para que la causa sobreviva al recorte).
//
// Sin tablas nuevas: `cron_runs`, `webhook_events`, `audit_log` por acción,
// `notifications` por estado, `receipts` sin sellar y el `LAST_OK` del backup en
// disco.
import type { NotificationType, PrismaClient } from "@/generated/prisma/client";
import { CRON_JOB_LIST, type CronJob } from "@/lib/cron/auth";
import { maskEmails } from "@/lib/log-safe";

/** Cada cuánto se espera una corrida EFECTIVA de cada job. No es el intervalo
 *  del crontab: `accrual` y `reminder` corren a diario y actúan una vez por mes,
 *  y `digest` no escribe fila los días sin novedades. Medir a los cinco con la
 *  misma vara pintaría de rojo tres crons sanos varias veces por semana. */
export const CRON_EXPECTATION: Record<CronJob, { label: string; everyHours: number }> = {
  reconcile: { label: "Conciliación con Mercado Pago", everyHours: 24 },
  applications: { label: "Mantenimiento de solicitudes", everyHours: 24 },
  // Actúa el día 1; el recordatorio, el último día del mes. Los días que no
  // actúan no abren `CronRun`, así que su antigüedad normal es de un mes.
  accrual: { label: "Devengo de cuotas", everyHours: 24 * 31 },
  reminder: { label: "Recordatorio de vencimiento", everyHours: 24 * 31 },
  // El resumen no se manda los días sin novedades, así que su fila puede faltar
  // varios días seguidos sin que nada esté mal — y para ESTA asociación (160
  // vigentes, el débito alrededor del 10) el día tranquilo es la regla, no la
  // excepción (`api/cron/digest/route.ts`, cabecera). Con el doble del período,
  // el aviso llega recién a los 14 días: una quincena sin UNA sola novedad en
  // todo el sistema sí amerita mirar si el cron sigue instalado.
  digest: { label: "Resumen diario a la Comisión", everyHours: 24 * 7 },
};

export type CronState = "ok" | "errors" | "stale" | "hung" | "never";

/** Una corrida abierta hace menos de esto puede estar corriendo AHORA. */
const RUNNING_GRACE_HOURS = 2;

export function cronState(
  run: { startedAt: Date; finishedAt: Date | null; ok: boolean } | null,
  everyHours: number,
  now: Date,
): CronState {
  if (!run) return "never";
  const ageHours = (now.getTime() - run.startedAt.getTime()) / 3_600_000;
  // `finishedAt IS NULL` con `startedAt` viejo es una corrida que se abrió y
  // nunca cerró: el proceso murió. Es distinto de `ok: false` —que significa
  // "terminó y algo falló"— y hoy son indistinguibles si se mira sólo el
  // booleano, porque `ok` arranca en `false`.
  // Umbral inclusivo: una corrida que lleva DOS horas abierta ya está colgada.
  // Las cinco tardan minutos, y la más pesada —la conciliación— la corta
  // Cloudflare a los ~100 s (docs/11).
  if (run.finishedAt === null) return ageHours >= RUNNING_GRACE_HOURS ? "hung" : "ok";
  if (!run.ok) return "errors";
  // El doble del período esperado: un atraso de una corrida es ruido de
  // calendario; dos seguidas es que dejó de correr.
  return ageHours > everyHours * 2 ? "stale" : "ok";
}

export type CronHealth = {
  job: CronJob;
  label: string;
  everyHours: number;
  state: CronState;
  lastRun: {
    id: string; startedAt: Date; finishedAt: Date | null; ok: boolean; error: string | null; summary: unknown;
  } | null;
};

export type MpHealth = {
  /** El último evento RECIBIDO. Es la señal más importante del panel: un
   *  preapproval ignora `notification_url`, así que si la configuración de
   *  webhooks del panel de MP se rompe, los débitos dejan de avisar sin ninguna
   *  otra señal. */
  lastEventAt: Date | null;
  unprocessedWithError: number;
  signatureRejections: number;
};

export type AmountMismatch = {
  id: string; createdAt: Date; paymentId: number | null; memberId: number | null;
  memberName: string | null; n: number | null; expected: number | null; amount: number | null;
};

export type MoneyHealth = {
  inboxOpen: number;
  inboxTotal: number;
  /** Suscripciones de un socio que NO están cobrando y tampoco están cerradas
   *  (pausadas, pendientes, o un estado que MP invente). Ver `STALLED_EXCLUDED`. */
  subscriptionsStalled: number;
  mismatches: AmountMismatch[];
  /** Cuántos asientos hay de verdad: la lista viene recortada. */
  mismatchesTotal: number;
};

export type FailedNotification = {
  id: string; sentAt: Date; type: NotificationType; error: string | null;
  payloadSummary: string | null; memberId: number | null; memberName: string | null;
  applicationId: number | null;
  /** Número de recibo si el aviso era un recibo (único camino de reenvío). */
  receiptNumber: string | null;
};

/** Por qué este recibo sigue sin sellar `emailedAt` (spec §8, panel 6). El sello
 *  vacío es AMBIGUO —lo dejan así tres cosas distintas— y cada una se atiende de
 *  una manera:
 *
 *    deferred — el tope de envíos por corrida lo dejó afuera y NADIE lo reintenta
 *               (`MAIL_BATCH_CAP`): un diferido no llega al mailer, así que no
 *               deja fila de `Notification`. Es el que hay que reenviar a mano.
 *    failed   — se intentó y el envío se cayó: hay fila `failed` con su código.
 *    no_email — no hay casilla utilizable. No hay nada que reenviar hasta que el
 *               socio tenga email; ofrecer el botón sería mentir.
 *    sent     — salió (hay fila `sent`) y lo que falló fue el UPDATE del sello
 *               (`receipt-email.ts`, último try/catch). Reenviarlo le duplica el
 *               PDF al socio: se muestra para que se entienda por qué está en la
 *               lista, sin acción. */
export type PendingReceiptState = "deferred" | "failed" | "no_email" | "sent";

export type PendingReceipt = {
  id: number; number: string; issuedAt: Date; state: PendingReceiptState;
  memberId: number | null; applicationId: number | null; memberName: string | null;
  /** Código del fallo cuando `state === "failed"`. Nunca la dirección. */
  error: string | null;
};

export type ReceiptsHealth = { rows: PendingReceipt[]; total: number };

export type HealthSnapshot = {
  now: Date;
  crons: CronHealth[];
  mp: MpHealth;
  money: MoneyHealth;
  failed: FailedNotification[];
  /** Cuántas `Notification.failed` hay en total: la lista viene recortada. */
  failedTotal: number;
  receipts: ReceiptsHealth;
};

/** El ÚNICO camino de reenvío que existe (spec §7.5): el recibo, por el modelo
 *  del botón "Reenviar por email".
 *
 *  Sale de `payloadSummary` porque no hay de dónde más: la fila no guarda el id
 *  de la entidad y `payloadSummary` es texto libre de 300 caracteres, no un
 *  payload re-armable. Esa es la limitación, y por eso NO hay cola genérica de
 *  reintentos: los demás avisos se muestran con su error y de qué entidad
 *  vienen, y se rehacen desde la pantalla que los origina. El formato lo fija
 *  `treasury/receipt-email.ts` (`recibo ${número}`). */
export function receiptNumberOf(payloadSummary: string | null): string | null {
  if (!payloadSummary?.startsWith("recibo ")) return null;
  const n = payloadSummary.slice("recibo ".length).trim();
  return n === "" ? null : n;
}

const SIGNATURE_WINDOW_HOURS = 24;
const MISMATCH_LIMIT = 20;
const FAILED_LIMIT = 50;
const RECEIPT_LIMIT = 50;

/** Los dos estados que NO son un problema pendiente.
 *
 *  `authorized` cobra. `cancelled` está cerrada, y ésa es la clave: cancelar el
 *  débito de un socio dado de baja es exactamente lo que la pantalla de
 *  suscripciones ofrece hacer, así que si contara, hacer lo correcto SUBIRÍA la
 *  alarma. Es el mismo argumento por el que el cron dejó de contar las huérfanas
 *  canceladas (`mp/reconcile.ts`, paso 4): una alarma que ninguna acción apaga
 *  entrena al operador a ignorar el tablero entero.
 *
 *  Y se cuentan sólo las que tienen socio: una `pending` sin socio es un alta web
 *  que el vecino abandonó antes de autorizar, y no hay nada que atender. */
const STALLED_EXCLUDED: readonly string[] = ["authorized", "cancelled"];

export type HealthDb = Pick<
  PrismaClient,
  "cronRun" | "webhookEvent" | "auditLog" | "notification" | "mpUnmatchedPayment" | "mpSubscription" | "member" | "receipt"
>;

/** La casilla a la que iría el recibo, con la MISMA condición que usa
 *  `sendReceiptEmail` para elegir destinatario: la ficha manda sobre la
 *  solicitud, y un socio con la casilla rebotada no recibe nada (su recibo NO se
 *  desvía a la dirección de la solicitud vieja). Replicarla acá es lo que separa
 *  "no tiene a dónde ir" de "quedó diferido". */
function hasUsableTarget(
  member: { email: string | null; emailStatus: string } | null,
  application: { id: number } | null,
): boolean {
  if (member) return member.email !== null && member.email !== "" && member.emailStatus !== "bounced";
  return application !== null;
}

export async function fetchHealth(db: HealthDb, now: Date): Promise<HealthSnapshot> {
  const since = new Date(now.getTime() - SIGNATURE_WINDOW_HOURS * 3_600_000);
  const [
    runs, lastEvent, unprocessedWithError, signatureRejections, inboxOpen, inboxTotal,
    subscriptionsStalled, mismatchRows, mismatchesTotal, failedRows, failedTotal, receiptRows, receiptsTotal,
  ] = await Promise.all([
    // Una consulta por job y no un groupBy: son cinco, el índice
    // `[job, startedAt]` está hecho para esto y el groupBy no puede traer la
    // fila entera de la última corrida.
    Promise.all(CRON_JOB_LIST.map((job) =>
      db.cronRun.findFirst({
        where: { job }, orderBy: { startedAt: "desc" },
        select: { id: true, startedAt: true, finishedAt: true, ok: true, error: true, summary: true },
      }).then((r) => [job, r] as const),
    )),
    db.webhookEvent.findFirst({ where: { origin: "mp" }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    db.webhookEvent.count({ where: { origin: "mp", processedAt: null, error: { not: null } } }),
    db.auditLog.count({ where: { action: "webhook_rejected_signature", createdAt: { gte: since } } }),
    db.mpUnmatchedPayment.count({ where: { status: "open" } }),
    db.mpUnmatchedPayment.count(),
    db.mpSubscription.count({ where: { memberId: { not: null }, status: { notIn: [...STALLED_EXCLUDED] } } }),
    db.auditLog.findMany({
      where: { action: "link_amount_mismatch" },
      orderBy: { id: "desc" }, take: MISMATCH_LIMIT,
      select: { id: true, createdAt: true, detail: true },
    }),
    db.auditLog.count({ where: { action: "link_amount_mismatch" } }),
    db.notification.findMany({
      where: { status: "failed" },
      orderBy: { sentAt: "desc" }, take: FAILED_LIMIT,
      select: {
        id: true, sentAt: true, type: true, error: true, payloadSummary: true,
        memberId: true, applicationId: true,
      },
    }),
    db.notification.count({ where: { status: "failed" } }),
    // Panel 6: los recibos que nunca se sellaron. Un anulado no cuenta —no se
    // manda por diseño (`receipt-email.ts`)— y quedaría para siempre en la lista.
    db.receipt.findMany({
      where: { emailedAt: null, voidedAt: null },
      orderBy: { issuedAt: "desc" }, take: RECEIPT_LIMIT,
      select: {
        id: true, number: true, issuedAt: true,
        payment: {
          select: {
            member: { select: { id: true, fullName: true, email: true, emailStatus: true } },
            application: { select: { id: true, fullName: true } },
          },
        },
      },
    }),
    db.receipt.count({ where: { emailedAt: null, voidedAt: null } }),
  ]);

  // Los nombres de socio se resuelven por id al renderizar (mismo criterio que
  // `fee_value_applied`): el `detail` del asiento nunca los guarda.
  const memberIds = [
    ...new Set([
      ...mismatchRows.map((r) => Number((r.detail as { memberId?: unknown } | null)?.memberId)).filter(Number.isInteger),
      ...failedRows.map((r) => r.memberId).filter((v): v is number => v !== null),
    ]),
  ];
  // El aviso del recibo se busca por `payloadSummary` porque la fila de
  // `Notification` no guarda el id del recibo: el mailer escribe ahí
  // `recibo ${número}` y el número es único. La consulta va acotada al lote que
  // se muestra, no a la tabla entera.
  const summaries = receiptRows.map((r) => `recibo ${r.number}`);
  const [members, receiptNotes] = await Promise.all([
    memberIds.length === 0 ? [] : db.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, fullName: true } }),
    summaries.length === 0 ? [] : db.notification.findMany({
      where: { type: "receipt", payloadSummary: { in: summaries } },
      select: { payloadSummary: true, status: true, error: true },
    }),
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.fullName]));
  const notesOf = new Map<string, Array<{ status: string; error: string | null }>>();
  for (const n of receiptNotes) {
    if (n.payloadSummary === null) continue;
    const list = notesOf.get(n.payloadSummary) ?? [];
    list.push({ status: n.status, error: n.error });
    notesOf.set(n.payloadSummary, list);
  }
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  // El `error` de la corrida ya sale enmascarado de la ruta del cron
  // (`safeMessage`), pero acá se vuelve a pasar: es lo único de todo el tablero
  // que arrastra el texto de una excepción, y un escritor nuevo que se olvide no
  // puede terminar publicando la casilla de un vecino en pantalla (docs/08).
  const safeError = (raw: string | null) => (raw === null ? null : maskEmails(raw));

  return {
    now,
    crons: runs.map(([job, r]) => ({
      job,
      label: CRON_EXPECTATION[job].label,
      everyHours: CRON_EXPECTATION[job].everyHours,
      state: cronState(r, CRON_EXPECTATION[job].everyHours, now),
      lastRun: r ? { ...r, id: String(r.id), error: safeError(r.error) } : null,
    })),
    mp: { lastEventAt: lastEvent?.receivedAt ?? null, unprocessedWithError, signatureRejections },
    money: {
      inboxOpen, inboxTotal, subscriptionsStalled, mismatchesTotal,
      mismatches: mismatchRows.map((r) => {
        const d = (r.detail ?? {}) as Record<string, unknown>;
        const memberId = num(d.memberId);
        return {
          id: String(r.id), createdAt: r.createdAt,
          paymentId: num(d.paymentId), memberId,
          memberName: memberId === null ? null : nameOf.get(memberId) ?? null,
          n: num(d.n), expected: num(d.expected), amount: num(d.amount),
        };
      }),
    },
    failed: failedRows.map((r) => ({
      ...r, id: String(r.id),
      memberName: r.memberId === null ? null : nameOf.get(r.memberId) ?? null,
      receiptNumber: receiptNumberOf(r.payloadSummary),
    })),
    failedTotal,
    receipts: {
      total: receiptsTotal,
      rows: receiptRows.map((r) => {
        const member = r.payment.member;
        const application = r.payment.application;
        const notes = notesOf.get(`recibo ${r.number}`) ?? [];
        const failedNote = notes.find((n) => n.status === "failed");
        // El orden importa: una fila `sent` gana sobre todo (el recibo salió), y
        // "no tiene casilla" sólo se afirma cuando NO hubo ningún intento —si
        // hubo uno fallido, el dato útil es el código del fallo—.
        const state: PendingReceiptState = notes.some((n) => n.status === "sent")
          ? "sent"
          : failedNote
            ? "failed"
            : hasUsableTarget(member, application)
              ? "deferred"
              : "no_email";
        return {
          id: r.id, number: r.number, issuedAt: r.issuedAt, state,
          memberId: member?.id ?? null,
          applicationId: member ? null : application?.id ?? null,
          memberName: member?.fullName ?? application?.fullName ?? null,
          error: state === "failed" ? safeError(failedNote?.error ?? null) : null,
        };
      }),
    },
  };
}
