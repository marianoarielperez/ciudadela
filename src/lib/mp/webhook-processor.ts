// Procesamiento de webhooks de MP (docs/06 §4), inline y idempotente. El
// registro crudo y la respuesta HTTP viven en la ruta; acá solo la reacción a
// cada tópico. Todo camino "raro" devuelve un result y NO lanza: lo que lanza
// es un fallo real (DB caída, MP caído) y la ruta lo convierte en 500 para que
// MP reintente.
import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { mailer } from "@/lib/email";
import { applicationAcceptedEmail } from "@/lib/email/templates";
import { prisma } from "@/lib/prisma";
import { mpGateway, type MpGateway } from "./gateway";

export type WebhookInput = { topic: string; dataId: string };

const APPLICATION_REF = /^solicitud:(\d+)$/;

type Deps = {
  db: Pick<PrismaClient, "application" | "mpSubscription" | "$transaction">;
  gateway: Pick<MpGateway, "getPayment" | "getPreapproval" | "getAuthorizedPayment">;
  mailer: Pick<typeof mailer, "sendToApplication">;
};

export function makeWebhookProcessor(deps: Deps) {
  async function onPayment(dataId: string): Promise<string> {
    const payment = await deps.gateway.getPayment(dataId);
    const match = payment.externalReference?.match(APPLICATION_REF);
    if (!match) return "no_match";
    const applicationId = Number(match[1]);

    if (payment.status === "rejected") return "payment_rejected";
    if (payment.status !== "approved") return "payment_ignored";

    // UPDATE condicional por estado = idempotencia de la transición: el
    // reintento del mismo evento (o un segundo pago del ciclo) ve count 0.
    const { count } = await deps.db.application.updateMany({
      where: { id: applicationId, status: "pending_payment" },
      data: {
        status: "approved_pending_minute",
        mpPaymentIdEntry: payment.id,
        entryAmount: new Prisma.Decimal(payment.transactionAmount.toFixed(2)),
      },
    });
    if (count === 0) return "already_processed";

    const app = await deps.db.application.findUnique({ where: { id: applicationId } });
    if (app) {
      // Best-effort: el estado ya cambió; un SMTP caído no puede des-aceptar.
      try {
        await deps.mailer.sendToApplication({
          applicationId: app.id,
          to: app.email,
          type: "application_result",
          message: applicationAcceptedEmail({ name: app.fullName }),
          summary: "solicitud aceptada (débito autorizado)",
        });
      } catch (e) {
        console.error("accepted email failed", (e as { code?: string })?.code ?? "unknown");
      }
    }
    return "application_approved";
  }

  async function onPreapproval(dataId: string): Promise<string> {
    const pre = await deps.gateway.getPreapproval(dataId);
    const { count } = await deps.db.mpSubscription.updateMany({
      where: { preapprovalId: pre.id },
      data: { status: pre.status, lastSyncAt: new Date() },
    });
    return count > 0 ? "subscription_synced" : "no_match";
  }

  async function onAuthorizedPayment(dataId: string): Promise<string> {
    // M3 solo lo traza (queda en el WebhookEvent); la aplicación a cuotas es M4.
    await deps.gateway.getAuthorizedPayment(dataId);
    return "authorized_payment_traced";
  }

  return {
    async process(input: WebhookInput): Promise<string> {
      switch (input.topic) {
        case "payment":
        case "payments":
          return onPayment(input.dataId);
        case "subscription_preapproval":
          return onPreapproval(input.dataId);
        case "subscription_authorized_payment":
          return onAuthorizedPayment(input.dataId);
        default:
          return "unknown_topic";
      }
    },
  };
}

export const webhookProcessor = makeWebhookProcessor({ db: prisma, gateway: mpGateway, mailer });
