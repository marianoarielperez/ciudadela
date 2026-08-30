// Conciliación diaria con Mercado Pago (spec 4B §9): la red si el webhook no
// llega. Pasos aislados — un fallo se cuenta en `errors` y los demás corren
// igual —, y el que aplica pagos es el MISMO camino del webhook
// (`processor.applyPayment`), así el resultado es idéntico al del evento perdido.
import type { PrismaClient } from "@/generated/prisma/client";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { makeMailBudget, type MailBudget } from "@/lib/email/batch-cap";
import { prisma } from "@/lib/prisma";
import { feeValueReader, type makeFeeValueReader } from "@/lib/treasury/fee-values";
import { feeAmountFor } from "@/lib/treasury/rules";
import { describeMpError, mpErrorLog } from "./error-log";
import { mpGateway, type MpGateway, type MpPaymentDetails } from "./gateway";
import { parseApplicationReference } from "./references";
import { CHARGEABLE_STATUSES, isKnownDead } from "./subscription-status";
import { cents, WEBHOOK_RESULTS, webhookProcessor, type WebhookResult } from "./webhook-processor";

export const RECONCILE_WINDOW_MS = 72 * 60 * 60_000;
/** Pausa entre una suscripción y la siguiente del paso 2/3.
 *
 *  EL PORQUÉ (primera corrida real, 24/08/2026): el bucle pedía
 *  `authorized_payments/search` + `preapproval` de cada suscripción una atrás
 *  de la otra y Mercado Pago cortó por LÍMITE DE RÁFAGA — tres pasos de la
 *  corrida terminaron en `errors` con 429, incluido el único camino que
 *  recupera un débito cuyo webhook no llegó. El gateway ya reintenta el 429
 *  (`mp/retry.ts`); esto es la otra mitad: no provocarlo. Con el padrón actual
 *  —decenas de suscripciones— agrega segundos a una corrida de las 03:17 que
 *  no le rinde cuentas a nadie. */
export const SUBSCRIPTION_PACING_MS = 250;
/** Solicitudes por las que vale la pena conservar un preapproval huérfano. */
const LIVE_APPLICATION_STATUSES = ["started", "pending_payment", "approved_pending_minute", "pending_board", "completed"];

/** Tope de entradas en `errors`. El summary va a `CronRun.summary` y al asiento
 *  de auditoría, y con la base caída cada fila devuelta por MP deja una entrada:
 *  sin tope, una noche mala escribe cientos y el JSON deja de ser legible. Lo
 *  que se pasa del tope se cuenta en `errorsOmitted`. */
const MAX_ERRORS = 50;
/** Largo de cada entrada. Alcanza para status + code + el message de MP, que es
 *  justamente la causa: el prefijo del paso y los ids ya no van acá (van al log
 *  completo), porque se comían el recorte y dejaban el error sin diagnóstico. */
const ERROR_MAX = 240;

/** Qué significó para la conciliación lo que devolvió el procesador:
 *  - `applied`: se asentó plata (o su devolución). Es lo único "recuperado".
 *  - `inbox`: quedó en la bandeja de sin conciliar, esperando al operador.
 *  - `skipped`: el procesador no escribió nada (ya estaba, o no correspondía). */
type ApplyOutcome = "applied" | "inbox" | "skipped";

/** Clasificación de CADA result del procesador. Es un `Record` sobre la unión
 *  `WebhookResult` a propósito: cuando 4B/4C agreguen un result nuevo, este
 *  archivo no compila hasta que alguien decida si cuenta como recuperado. Sin
 *  esto el contador decía "recuperado" para todo, incluido lo que se fue a la
 *  bandeja, y el summary salía en verde justo cuando la red estaba trabada. */
const OUTCOME_OF: Record<WebhookResult, ApplyOutcome> = {
  // Escribieron plata.
  debit_applied: "applied",
  link_applied: "applied",
  application_approved: "applied",
  application_approved_after_expiry: "applied",
  entry_payment_recovered: "applied",
  // Una devolución también es un movimiento asentado: si el cron la recuperó,
  // hizo su trabajo.
  payment_refunded: "applied",
  // A la bandeja: hay una fila esperando decisión humana.
  unmatched_no_reference: "inbox",
  unmatched_no_subscription: "inbox",
  unmatched_application_missing: "inbox",
  unmatched_duplicate_entry: "inbox",
  unmatched_withdrawn_no_pending: "inbox",
  unmatched_treasury_rejected: "inbox",
  // No escribieron nada.
  already_processed: "skipped",
  payment_ignored: "skipped",
  payment_rejected_traced: "skipped",
  refund_ignored: "skipped",
  no_match: "skipped",
  authorized_payment_traced: "skipped",
  subscription_synced: "skipped",
  unknown_topic: "skipped",
};

/** El procesador devuelve `string` (así lo declara el contrato inyectado): si
 *  llegara algo fuera del catálogo, no se cuenta como recuperado. */
function outcomeOf(result: string): ApplyOutcome {
  return result in WEBHOOK_RESULTS ? OUTCOME_OF[result as WebhookResult] : "skipped";
}

export type ReconcileSummary = {
  /** Pagos sueltos (paso 1) que el procesador efectivamente asentó. */
  paymentsRecovered: number;
  /** Pagos sueltos que terminaron en la bandeja de sin conciliar. */
  paymentsInbox: number;
  /** Pagos sueltos que el procesador no escribió (ya estaban, o no correspondía). */
  paymentsSkipped: number;
  /** Débitos de suscripción (paso 2) efectivamente asentados. */
  debitsRecovered: number;
  /** Débitos que terminaron en la bandeja. */
  debitsInbox: number;
  /** Débitos que el procesador no escribió. */
  debitsSkipped: number;
  subscriptionsSynced: number;
  /** Suscripciones cuyo estado en MP CAMBIÓ esta corrida hacia algo que no es
   *  `authorized` (pausada, cancelada, o un estado que MP invente). Es un delta
   *  de la corrida, no un stock: el criterio y su porqué están donde se cuenta. */
  subscriptionsDrifted: number;
  orphanCreated: number;
  orphanCancelled: number;
  orphanPreapprovals: number;
  amountDivergent: number;
  planDivergent: number;
  /** Recibos que la corrida NO mandó por el tope de envíos (`MAIL_BATCH_CAP`).
   *  No se pierden: se reenvían desde la pantalla del recibo. Que el número esté
   *  en el summary es la mitad del punto — un tope silencioso es peor que no
   *  tener tope. */
  deferred: number;
  /** `paso: causa` — sin datos personales, con tope `MAX_ERRORS`. */
  errors: string[];
  /** Errores que no entraron en `errors` por el tope. */
  errorsOmitted: number;
};

type Deps = {
  db: Pick<PrismaClient, "payment" | "mpUnmatchedPayment" | "mpSubscription" | "application">;
  gateway: Pick<MpGateway, "searchPayments" | "searchAuthorizedPayments" | "getPayment" | "getPreapproval" | "searchPreapprovals" | "cancelPreapproval" | "getPlan">;
  processor: {
    applyPayment(
      payment: MpPaymentDetails,
      preapprovalId: string | null,
      opts?: { mailBudget?: MailBudget },
    ): Promise<string>;
  };
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  config: { getString(key: string): Promise<string | null> };
  now?: () => Date;
  /** Inyectable para que los tests no duerman de verdad. */
  sleep?: (ms: number) => Promise<void>;
};

export function makeReconcile(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return {
    async run(): Promise<ReconcileSummary> {
      const t = now();
      const s: ReconcileSummary = {
        paymentsRecovered: 0, paymentsInbox: 0, paymentsSkipped: 0,
        debitsRecovered: 0, debitsInbox: 0, debitsSkipped: 0,
        subscriptionsSynced: 0, subscriptionsDrifted: 0,
        orphanCreated: 0, orphanCancelled: 0, orphanPreapprovals: 0,
        amountDivergent: 0, planDivergent: 0, deferred: 0, errors: [], errorsOmitted: 0,
      };
      // Un presupuesto POR CORRIDA. Vive acá y no en el procesador porque el
      // procesador es un singleton de proceso. Topea el AVISO, nunca la
      // imputación: el cobro se asienta igual.
      //
      // Lo diferido NO vuelve en la corrida siguiente: mañana `hasLocal` ve el
      // pago ya asentado y hace `continue` antes de llegar al mail. Tampoco
      // aparece entre los avisos fallidos —un diferido no llega a
      // `sendReceiptEmail` y por eso no escribe fila de `Notification`—. Se
      // resuelve a mano y no con un barrido: `/admin/salud` lista los recibos
      // sin enviar y cada uno tiene su botón "Reenviar por email"; mientras
      // tanto el socio lo tiene en `/mi/cuenta` desde que se emite.
      const mailBudget = makeMailBudget();
      // Al summary va el paso y LA CAUSA (status/code/message, ya enmascarados
      // por `describeMpError`). Los ids y el prefijo `mp:` van sólo al log
      // completo: repetirlos acá desplazaba la causa fuera del recorte y dejaba
      // a `/admin/salud` mostrando "falló" y nada más.
      const fail = (step: string, refs: Record<string, string | number>, e: unknown) => {
        console.error("[reconcile]", mpErrorLog(`reconcile.${step}`, refs, e));
        if (s.errors.length >= MAX_ERRORS) { s.errorsOmitted++; return; }
        const d = describeMpError(e);
        const parts: string[] = [];
        if (d.status !== null) parts.push(`status=${d.status}`);
        if (d.code) parts.push(`code=${d.code}`);
        parts.push(d.message === "" ? "(sin mensaje)" : d.message);
        if (d.cause.length > 0) {
          parts.push(`cause=[${d.cause.map((c) => (c.code === "" ? c.description : `${c.code}: ${c.description}`)).join(" | ")}]`);
        }
        s.errors.push(`${step}: ${parts.join(" ")}`.slice(0, ERROR_MAX));
      };
      const hasLocal = async (mpPaymentId: string) =>
        Boolean(await deps.db.payment.findUnique({ where: { mpPaymentId }, select: { id: true } }));
      // Paso 1: cualquier fila de la bandeja frena. Ahí el cron no sabe nada que
      // el webhook no supiera —le pasa el mismo `payment` y `preapprovalId: null`—,
      // así que re-procesar una fila abierta sería ruido, y una que el operador
      // descartó (`dismissed`) o resolvió (`matched`) es una decisión tomada que
      // volver a aplicar sería pisar.
      const inInbox = async (mpPaymentId: string) =>
        Boolean(await deps.db.mpUnmatchedPayment.findUnique({ where: { mpPaymentId }, select: { id: true } }));
      // Paso 2: sólo frenan las RESUELTAS. La justificación de arriba vale para
      // `dismissed`/`matched`, no para `open`: acá el cron llega con algo que el
      // webhook no tenía —el `preapprovalId` de la suscripción vinculada—, que es
      // justamente lo que a esa fila le falta. Caso real: el débito de una
      // suscripción creada a mano en el panel de MP, cuyo `payment` no trae
      // referencia; si el evento `subscription_authorized_payment` se pierde,
      // esta es la única red que lo levanta. Aplicar una fila `open` es seguro:
      // `registerPaymentCore` la cierra (`matched`) dentro de la misma
      // transacción que asienta el pago.
      const resolvedInInbox = async (mpPaymentId: string) => {
        const row = await deps.db.mpUnmatchedPayment.findUnique({ where: { mpPaymentId }, select: { status: true } });
        return row !== null && row.status !== "open";
      };
      const count = (result: string, kind: "payments" | "debits") => {
        const outcome = outcomeOf(result);
        if (kind === "payments") {
          if (outcome === "applied") s.paymentsRecovered++;
          else if (outcome === "inbox") s.paymentsInbox++;
          else s.paymentsSkipped++;
        } else {
          if (outcome === "applied") s.debitsRecovered++;
          else if (outcome === "inbox") s.debitsInbox++;
          else s.debitsSkipped++;
        }
      };

      // ── 1. Pagos aprobados de las últimas 72 h sin rastro local ─────────────
      try {
        const payments = await deps.gateway.searchPayments({ since: new Date(t.getTime() - RECONCILE_WINDOW_MS) });
        for (const p of payments) {
          try {
            if ((await hasLocal(p.id)) || (await inInbox(p.id))) continue;
            count(await deps.processor.applyPayment(p, null, { mailBudget }), "payments");
          } catch (e) { fail("payments.apply", { mpPaymentId: p.id }, e); }
        }
      } catch (e) { fail("payments", {}, e); }

      // ── 2 y 3. Por cada suscripción viva: cobros perdidos + estado ──────────
      // "Viva" acá es `canStillCharge`: la pregunta es de dónde puede salir
      // plata. Incluye `pending`, que antes quedaba afuera — una suscripción
      // que autorizó y cuyo webhook no llegó nunca se sincronizaba y nadie le
      // buscaba los débitos perdidos.
      let subs: Array<{ preapprovalId: string; memberId: number | null; status: string; member: { category: "active" | "adherent" | "collaborator" | "cadet" | "honorary" | "lifetime" } | null }> = [];
      try {
        subs = await deps.db.mpSubscription.findMany({
          where: { status: { in: [...CHARGEABLE_STATUSES] } },
          // `status` viaja porque la deriva se mide contra lo que teníamos
          // guardado, no contra una constante (ver el contador, más abajo).
          select: { preapprovalId: true, memberId: true, status: true, member: { select: { category: true } } },
        });
      } catch (e) { fail("subscriptions", {}, e); }
      // Si esto falla, los chequeos de divergencia (5a y 5b) no pueden correr:
      // que se vea en `errors`, porque `amountDivergent: 0` sin explicación es
      // indistinguible de "no hay divergencias".
      let feeValue: Awaited<ReturnType<typeof deps.feeValues.current>> | null = null;
      try {
        feeValue = await deps.feeValues.current(t);
      } catch (e) { fail("feeValue", {}, e); }

      for (const [i, sub] of subs.entries()) {
        // Respirar ENTRE suscripciones, no antes de la primera: la pausa existe
        // para espaciar llamadas consecutivas, y demorar el arranque de la
        // corrida no espacia nada.
        if (i > 0) await sleep(SUBSCRIPTION_PACING_MS);
        if (sub.memberId !== null) {
          try {
            const charges = await deps.gateway.searchAuthorizedPayments(sub.preapprovalId);
            for (const c of charges) {
              if (!c.paymentId || c.status !== "processed") continue;
              try {
                const paymentId = c.paymentId;
                if ((await hasLocal(paymentId)) || (await resolvedInInbox(paymentId))) continue;
                const p = await deps.gateway.getPayment(paymentId);
                count(await deps.processor.applyPayment(p, sub.preapprovalId, { mailBudget }), "debits");
              } catch (e) { fail("debits.apply", { preapprovalId: sub.preapprovalId, mpPaymentId: c.paymentId }, e); }
            }
          } catch (e) { fail("debits", { preapprovalId: sub.preapprovalId }, e); }
        }
        try {
          const remote = await deps.gateway.getPreapproval(sub.preapprovalId);
          await deps.db.mpSubscription.updateMany({
            where: { preapprovalId: sub.preapprovalId },
            data: {
              status: remote.status, amount: remote.amount === null ? null : remote.amount.toFixed(2),
              payerEmail: remote.payerEmail, externalReference: remote.externalReference, lastSyncAt: t,
            },
          });
          s.subscriptionsSynced++;
          // DERIVA = el estado CAMBIÓ y no cambió para bien. Las dos mitades
          // hacen falta, y cada una tapa una alarma que no se apagaba nunca:
          //
          //   "cambió"          — un `pending` que sigue `pending` no derivó de
          //                       nada: es un alta EN VUELO (el vecino tiene
          //                       hasta `EXPIRE_AFTER_DAYS` para autorizar) o
          //                       una colgada porque `cancelPreapproval` falló
          //                       al vencer la solicitud (`applications/cron.ts`
          //                       es best-effort). Contra la constante a secas,
          //                       cualquier noche con un wizard en curso
          //                       reportaba deriva, y la colgada la reportaba
          //                       TODAS, sin que ninguna acción la bajara.
          //   "no `authorized`" — un `pending` que pasó a `authorized` cambió,
          //                       sí, pero es un alta que se completó. Eso no es
          //                       deriva: es el final feliz.
          //
          // Es un contador de LA CORRIDA, no un stock: la noche en que MP pausa
          // una suscripción se cuenta una vez y después el estado local ya
          // coincide. El stock —cuántas están pausadas hoy— se lee en
          // /admin/tesoreria/suscripciones, que es donde el operador puede hacer
          // algo al respecto. `/admin/salud` (Task 13) muestra corridas.
          if (remote.status !== sub.status && remote.status !== "authorized") s.subscriptionsDrifted++;
          // 5a. Monto de la suscripción vs. valor vigente de la categoría, en
          // centavos redondeados: mismo criterio que el webhook (`cents`).
          if (feeValue && sub.member && remote.amount !== null) {
            const expected = feeAmountFor(sub.member.category, feeValue);
            if (expected !== null && cents(expected) !== cents(remote.amount)) s.amountDivergent++;
          }
        } catch (e) { fail("sync", { preapprovalId: sub.preapprovalId }, e); }
      }

      // ── 4. Preapprovals del wizard sin fila local ───────────────────────────
      try {
        const remote = await deps.gateway.searchPreapprovals();
        for (const pre of remote) {
          try {
            if (await deps.db.mpSubscription.findUnique({ where: { preapprovalId: pre.id }, select: { preapprovalId: true } })) continue;
            // Una cancelada no es una huérfana que haya que atender: no cobra
            // nunca más. Antes se contaban igual y el número no podía bajar —en
            // producción daba 3 desde siempre—, así que /admin/salud iba a nacer
            // con una alarma que ninguna acción apaga. Una alarma que no se apaga
            // entrena al operador a ignorar el tablero entero.
            if (isKnownDead(pre.status)) continue;
            const applicationId = parseApplicationReference(pre.externalReference);
            if (applicationId === null) { s.orphanPreapprovals++; continue; }
            // El `memberId` de la solicitud no es opcional acá: sin él la fila
            // recreada queda inerte (el paso 2 saltea las suscripciones sin
            // socio) y todos sus débitos futuros terminan en la bandeja.
            const app = await deps.db.application.findUnique({ where: { id: applicationId }, select: { id: true, status: true, memberId: true } });
            if (!app) { s.orphanPreapprovals++; continue; }
            if (LIVE_APPLICATION_STATUSES.includes(app.status)) {
              await deps.db.mpSubscription.create({
                data: {
                  preapprovalId: pre.id, applicationId: app.id, memberId: app.memberId ?? null, status: pre.status, payerEmail: pre.payerEmail,
                  amount: pre.amount === null ? null : pre.amount.toFixed(2), externalReference: pre.externalReference, planId: null, lastSyncAt: t,
                },
              });
              s.orphanCreated++;
            } else if (pre.status !== "cancelled") {
              await deps.gateway.cancelPreapproval(pre.id);
              s.orphanCancelled++;
            }
          } catch (e) { fail("orphans.one", { preapprovalId: pre.id }, e); }
        }
      } catch (e) { fail("orphans", {}, e); }

      // ── 5b. Planes de referencia (si están cargados) vs. fee_values ─────────
      if (feeValue) {
        const value = feeValue;
        try {
          const [activeId, sharedId] = await Promise.all([
            deps.config.getString(CONFIG_KEYS.mpPlanActiveId), deps.config.getString(CONFIG_KEYS.mpPlanSharedId),
          ]);
          const checks: Array<[string | null, number]> = [[activeId, value.activeAmount], [sharedId, value.sharedAmount]];
          for (const [planId, expected] of checks) {
            if (!planId) continue;
            // Un `try` por plan: si el primero explota, el segundo se chequea igual.
            try {
              const plan = await deps.gateway.getPlan(planId);
              if (cents(plan.amount) !== cents(expected)) s.planDivergent++;
            } catch (e) { fail("plans.one", { planId }, e); }
          }
        } catch (e) { fail("plans", {}, e); }
      }

      s.deferred = mailBudget.deferred;
      return s;
    },
  };
}

export const reconcile = makeReconcile({
  db: prisma, gateway: mpGateway, processor: webhookProcessor, feeValues: feeValueReader, config: configReader,
});
