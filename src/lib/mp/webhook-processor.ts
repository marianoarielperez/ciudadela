// Procesamiento de webhooks de MP (docs/06 §4), inline y idempotente. El
// registro crudo y la respuesta HTTP viven en la ruta; acá solo la reacción a
// cada tópico. Todo camino "raro" devuelve un result y NO lanza: lo que lanza
// es un fallo real (DB caída, MP caído) y la ruta lo convierte en 500 para que
// MP reintente.
import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
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
  audit: typeof audit;
};

// Los errores de nodemailer traen `envelope`, `rejected` y el `response` del
// SMTP —o sea la dirección del vecino en claro— y el log de PM2 no está cubierto
// por los cuidados de docs/08 (Ley 25.326). Mismo criterio que
// `asociate/actions.ts`: al log va el código. El mensaje se conserva porque un
// Error pelado NO tiene `.code` y sin él el operador leía literalmente
// "unknown", pero se enmascara cualquier dirección antes de salir.
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "unknown";
}

function safeMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/[^\s<>@,;]+@[^\s<>@,;]+/g, "[email]").slice(0, 200);
}

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
        console.error(
          "[mp-webhook] falló el email de solicitud aceptada",
          app.id,
          "code:", codeOf(e), "message:", safeMessage(e),
        );
        // El hueco tiene que quedar consultable: el vecino está aceptado y la
        // bienvenida no salió, y hasta acá eso sólo vivía en el log de PM2.
        // Al detalle va el código, nunca el email ni datos personales (docs/08).
        // El asiento es best-effort igual que el envío: si la auditoría también
        // falla, la transición ya está firme y no se deshace.
        await deps
          .audit({
            action: "application_accepted_email_failed",
            entity: "application",
            entityId: app.id,
            detail: { code: codeOf(e) },
          })
          .catch(() => {});
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

export const webhookProcessor = makeWebhookProcessor({ db: prisma, gateway: mpGateway, mailer, audit });
