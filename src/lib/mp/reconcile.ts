// Conciliación diaria con Mercado Pago (spec 4B §9): la red si el webhook no
// llega. Pasos aislados — un fallo se cuenta en `errors` y los demás corren
// igual —, y el que aplica pagos es el MISMO camino del webhook
// (`processor.applyPayment`), así el resultado es idéntico al del evento perdido.
import type { PrismaClient } from "@/generated/prisma/client";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { feeValueReader, type makeFeeValueReader } from "@/lib/treasury/fee-values";
import { feeAmountFor } from "@/lib/treasury/rules";
import { mpErrorLog } from "./error-log";
import { mpGateway, type MpGateway, type MpPaymentDetails } from "./gateway";
import { parseApplicationReference } from "./references";
import { webhookProcessor } from "./webhook-processor";

export const RECONCILE_WINDOW_MS = 72 * 60 * 60_000;
/** Estados de MP con los que una suscripción puede seguir cobrando. */
const LIVE_STATUSES = ["authorized", "paused"];
/** Solicitudes por las que vale la pena conservar un preapproval huérfano. */
const LIVE_APPLICATION_STATUSES = ["started", "pending_payment", "approved_pending_minute", "pending_board", "completed"];

export type ReconcileSummary = {
  paymentsRecovered: number;
  debitsRecovered: number;
  subscriptionsSynced: number;
  subscriptionsDrifted: number;
  orphanCreated: number;
  orphanCancelled: number;
  orphanPreapprovals: number;
  amountDivergent: number;
  planDivergent: number;
  errors: string[];
};

type Deps = {
  db: Pick<PrismaClient, "payment" | "mpUnmatchedPayment" | "mpSubscription" | "application">;
  gateway: Pick<MpGateway, "searchPayments" | "searchAuthorizedPayments" | "getPayment" | "getPreapproval" | "searchPreapprovals" | "cancelPreapproval" | "getPlan">;
  processor: { applyPayment(payment: MpPaymentDetails, preapprovalId: string | null): Promise<string> };
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  config: { getString(key: string): Promise<string | null> };
  now?: () => Date;
};

export function makeReconcile(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  return {
    async run(): Promise<ReconcileSummary> {
      const t = now();
      const s: ReconcileSummary = {
        paymentsRecovered: 0, debitsRecovered: 0, subscriptionsSynced: 0, subscriptionsDrifted: 0,
        orphanCreated: 0, orphanCancelled: 0, orphanPreapprovals: 0, amountDivergent: 0, planDivergent: 0, errors: [],
      };
      // Al summary va un código corto; el detalle completo (enmascarado) al log.
      const fail = (step: string, refs: Record<string, string | number>, e: unknown) => {
        const detail = mpErrorLog(`reconcile.${step}`, refs, e);
        console.error("[reconcile]", detail);
        s.errors.push(`${step}:${detail.slice(0, 80)}`);
      };
      const hasLocal = async (mpPaymentId: string) =>
        Boolean(await deps.db.payment.findUnique({ where: { mpPaymentId }, select: { id: true } }));
      const inInbox = async (mpPaymentId: string) =>
        Boolean(await deps.db.mpUnmatchedPayment.findUnique({ where: { mpPaymentId }, select: { id: true } }));

      // ── 1. Pagos aprobados de las últimas 72 h sin rastro local ─────────────
      try {
        const payments = await deps.gateway.searchPayments({ since: new Date(t.getTime() - RECONCILE_WINDOW_MS) });
        for (const p of payments) {
          try {
            if ((await hasLocal(p.id)) || (await inInbox(p.id))) continue;
            await deps.processor.applyPayment(p, null);
            s.paymentsRecovered++;
          } catch (e) { fail("payments.apply", { mpPaymentId: p.id }, e); }
        }
      } catch (e) { fail("payments", {}, e); }

      // ── 2 y 3. Por cada suscripción viva: cobros perdidos + estado ──────────
      let subs: Array<{ preapprovalId: string; memberId: number | null; member: { category: "active" | "adherent" | "collaborator" | "cadet" | "honorary" | "lifetime" } | null }> = [];
      try {
        subs = await deps.db.mpSubscription.findMany({
          where: { status: { in: LIVE_STATUSES } },
          select: { preapprovalId: true, memberId: true, member: { select: { category: true } } },
        });
      } catch (e) { fail("subscriptions", {}, e); }
      const feeValue = await deps.feeValues.current(t).catch(() => null);

      for (const sub of subs) {
        if (sub.memberId !== null) {
          try {
            const charges = await deps.gateway.searchAuthorizedPayments(sub.preapprovalId);
            for (const c of charges) {
              if (!c.paymentId || c.status !== "processed") continue;
              try {
                if (await hasLocal(c.paymentId)) continue;
                const p = await deps.gateway.getPayment(c.paymentId);
                await deps.processor.applyPayment(p, sub.preapprovalId);
                s.debitsRecovered++;
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
          if (remote.status !== "authorized") s.subscriptionsDrifted++;
          // 5a. Monto de la suscripción vs. valor vigente de la categoría.
          if (feeValue && sub.member && remote.amount !== null) {
            const expected = feeAmountFor(sub.member.category, feeValue);
            if (expected !== null && Math.abs(expected - remote.amount) >= 0.01) s.amountDivergent++;
          }
        } catch (e) { fail("sync", { preapprovalId: sub.preapprovalId }, e); }
      }

      // ── 4. Preapprovals del wizard sin fila local ───────────────────────────
      try {
        const remote = await deps.gateway.searchPreapprovals();
        for (const pre of remote) {
          try {
            if (await deps.db.mpSubscription.findUnique({ where: { preapprovalId: pre.id }, select: { preapprovalId: true } })) continue;
            const applicationId = parseApplicationReference(pre.externalReference);
            if (applicationId === null) { s.orphanPreapprovals++; continue; }
            const app = await deps.db.application.findUnique({ where: { id: applicationId }, select: { id: true, status: true } });
            if (!app) { s.orphanPreapprovals++; continue; }
            if (LIVE_APPLICATION_STATUSES.includes(app.status)) {
              await deps.db.mpSubscription.create({
                data: {
                  preapprovalId: pre.id, applicationId: app.id, status: pre.status, payerEmail: pre.payerEmail,
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
      try {
        if (feeValue) {
          const [activeId, sharedId] = await Promise.all([
            deps.config.getString(CONFIG_KEYS.mpPlanActiveId), deps.config.getString(CONFIG_KEYS.mpPlanSharedId),
          ]);
          const checks: Array<[string | null, number]> = [[activeId, feeValue.activeAmount], [sharedId, feeValue.sharedAmount]];
          for (const [planId, expected] of checks) {
            if (!planId) continue;
            const plan = await deps.gateway.getPlan(planId);
            if (Math.abs(plan.amount - expected) >= 0.01) s.planDivergent++;
          }
        }
      } catch (e) { fail("plans", {}, e); }

      return s;
    },
  };
}

export const reconcile = makeReconcile({
  db: prisma, gateway: mpGateway, processor: webhookProcessor, feeValues: feeValueReader, config: configReader,
});
