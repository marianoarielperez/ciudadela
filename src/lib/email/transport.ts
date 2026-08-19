// Transporte SMTP. Sin credenciales Brevo cae a consola: en desarrollo el
// arranque no se bloquea y ningún correo sale de la máquina.
import nodemailer from "nodemailer";

export type MailMessage = { to: string; subject: string; text: string; html: string };
export type MailTransport = { send(msg: MailMessage): Promise<{ messageId: string | null }> };

function makeBrevoTransport(): MailTransport | null {
  const { BREVO_SMTP_HOST, BREVO_SMTP_PORT, BREVO_SMTP_USER, BREVO_SMTP_KEY, MAIL_FROM } = process.env;
  if (!BREVO_SMTP_HOST || !BREVO_SMTP_USER || !BREVO_SMTP_KEY || !MAIL_FROM) return null;
  const transporter = nodemailer.createTransport({
    host: BREVO_SMTP_HOST,
    port: Number(BREVO_SMTP_PORT ?? 587),
    secure: false,
    auth: { user: BREVO_SMTP_USER, pass: BREVO_SMTP_KEY },
  });
  return {
    async send(msg) {
      const info = await transporter.sendMail({ from: MAIL_FROM, ...msg });
      return { messageId: info.messageId ?? null };
    },
  };
}

function makeConsoleTransport(): MailTransport {
  return {
    async send(msg) {
      console.log(`[mail:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
      return { messageId: null };
    },
  };
}

export function getTransport(): MailTransport {
  return makeBrevoTransport() ?? makeConsoleTransport();
}
