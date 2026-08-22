// Mailer: sends and records the statutory Notification row in one call.
// El estatuto (Art. 5° quater) le da carácter fehaciente al domicilio
// electrónico: cada envío tiene que quedar acreditado en la base.
import type { NotificationType, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getTransport, type MailMessage, type MailTransport } from "./transport";

type MailerDeps = { transport: MailTransport; db: Pick<PrismaClient, "notification"> };

export function makeMailer(deps: MailerDeps) {
  async function send(input: {
    memberId: number | null;
    applicationId: number | null;
    to: string;
    type: NotificationType;
    message: Omit<MailMessage, "to">;
    summary: string;
  }): Promise<{ messageId: string | null }> {
    // Primero el envío: si el SMTP falla, no queda registrada una
    // notificación que nunca salió.
    const { messageId } = await deps.transport.send({ to: input.to, ...input.message });
    await deps.db.notification.create({
      data: {
        memberId: input.memberId,
        applicationId: input.applicationId,
        type: input.type,
        via: "email",
        status: "sent",
        brevoMessageId: messageId,
        payloadSummary: input.summary,
      },
    });
    return { messageId };
  }
  return {
    sendToMember(input: {
      memberId: number | null;
      to: string;
      type: NotificationType;
      message: Omit<MailMessage, "to">;
      summary: string;
    }) {
      return send({ ...input, applicationId: null });
    },
    // El destinatario todavía no es socio, pero el envío queda acreditado
    // igual (Art. 5° quater): la Notification cuelga de la solicitud.
    sendToApplication(input: {
      applicationId: number;
      to: string;
      type: NotificationType;
      message: Omit<MailMessage, "to">;
      summary: string;
    }) {
      return send({ ...input, memberId: null });
    },
  };
}

export const mailer = makeMailer({ transport: getTransport(), db: prisma });
