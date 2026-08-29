// Envío del correo de invitación de una cuenta de gestión. SIEMPRE post-commit
// y best-effort: si el correo no sale, la cuenta ya quedó creada y el botón
// "Reenviar invitación" del detalle es la recuperación (mismo criterio que el
// PDF del recibo). `EMAIL_ALLOWLIST` envuelve el transporte, así que este
// camino nuevo queda cubierto sin hacer nada — y su bloqueo NO es un fallo:
// se distingue para no auditar `admin_invitation_send_failed` por la guarda
// del entorno de prueba funcionando.
import { mailer } from "@/lib/email";
import { adminInvitationEmail } from "@/lib/email/templates";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";

export type SendAdminInvitationDeps = {
  send: (typeof mailer)["sendToMember"];
  baseUrl: () => string;
};

export function makeSendAdminInvitation(deps: SendAdminInvitationDeps) {
  return async function sendAdminInvitation(input: {
    to: string;
    token: string;
  }): Promise<{ sent: boolean; blocked: boolean }> {
    try {
      await deps.send({
        memberId: null,
        to: input.to,
        type: "generic",
        message: adminInvitationEmail({ url: `${deps.baseUrl()}/acceso/${input.token}` }),
        summary: "invitación de acceso de administración",
      });
      return { sent: true, blocked: false };
    } catch (e) {
      const blocked = (e as { code?: unknown } | null)?.code === ALLOWLIST_BLOCK_CODE;
      return { sent: false, blocked };
    }
  };
}

// AUTH_URL se hornea en el build, mismo criterio que member-debit.ts.
export const sendAdminInvitation = makeSendAdminInvitation({
  send: (i) => mailer.sendToMember(i),
  baseUrl: () => process.env.AUTH_URL ?? "http://localhost:3000",
});
