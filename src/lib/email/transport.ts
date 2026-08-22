// Transporte SMTP. Sin credenciales Brevo cae a consola: en desarrollo el
// arranque no se bloquea y ningún correo sale de la máquina.
import nodemailer from "nodemailer";

// `content` como Buffer y no como stream: los adjuntos del sistema son PDFs de
// recibo de pocos kB, ya materializados en memoria por quien los lee del disco.
export type MailAttachment = { filename: string; content: Buffer; contentType: string };
export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
};
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
      // Los adjuntos se listan por nombre y tamaño: volcar un PDF binario a la
      // consola no le sirve a nadie y ensucia el log de dev.
      const attached = (msg.attachments ?? []).map((a) => `${a.filename} (${a.content.length} B)`).join(", ");
      console.log(
        `[mail:dev] to=${msg.to} subject="${msg.subject}"${attached ? ` attachments=${attached}` : ""}\n${msg.text}`,
      );
      return { messageId: null };
    },
  };
}

/** Guarda de STAGING (spec M3 §6): con EMAIL_ALLOWLIST definida, ningún correo
 *  sale hacia una casilla no listada. Vive en el transporte y no en los
 *  call-sites para cubrir wizard, panel y cron por igual. El error viaja como
 *  excepción: los call-sites ya compensan un fallo de envío (queman token,
 *  devuelven cupo), y un bloqueo silencioso escondería que la prueba no probó
 *  nada. El log NO incluye la dirección (docs/08). */
export function parseAllowlist(csv: string | undefined): Set<string> | null {
  if (!csv) return null;
  const items = csv.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
  return items.length > 0 ? new Set(items) : null;
}

export function makeAllowlistTransport(inner: MailTransport, allowlist: Set<string>): MailTransport {
  return {
    async send(msg) {
      if (!allowlist.has(msg.to.trim().toLowerCase())) {
        console.warn("[mail:allowlist] envío bloqueado por EMAIL_ALLOWLIST");
        // `code` propio: sin él, `codeOf()` en los call-sites cae a "unknown" y
        // no se puede distinguir "bloqueado por este entorno" de "SMTP caído".
        throw Object.assign(
          new Error("Envíos de email restringidos en este entorno (EMAIL_ALLOWLIST)."),
          { code: "EMAIL_ALLOWLIST" },
        );
      }
      return inner.send(msg);
    },
  };
}

export function getTransport(): MailTransport {
  const inner = makeBrevoTransport() ?? makeConsoleTransport();
  const allowlist = parseAllowlist(process.env.EMAIL_ALLOWLIST);
  return allowlist ? makeAllowlistTransport(inner, allowlist) : inner;
}
