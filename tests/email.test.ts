import { afterEach, describe, expect, it, vi } from "vitest";

// El singleton importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeMailer } from "@/lib/email";
import { invitationEmail, passwordResetEmail, portalInvite, verificationEmail } from "@/lib/email/templates";
import { getTransport, type MailMessage } from "@/lib/email/transport";

describe("templates", () => {
  it("verification email includes name and url in text and html", () => {
    const m = verificationEmail({ name: "Ana Perez", url: "https://x/verificar/abc" });
    expect(m.subject).toContain("Verificá");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("Ana Perez");
      expect(body).toContain("https://x/verificar/abc");
    }
  });
  it("invitation and reset include their urls", () => {
    expect(invitationEmail({ name: "Ana", url: "https://x/acceso/t" }).text).toContain("https://x/acceso/t");
    expect(passwordResetEmail({ url: "https://x/restablecer/t" }).text).toContain("https://x/restablecer/t");
  });
  // Un cliente sin HTML tiene que poder leer el mensaje completo, enlace incluido.
  it("every template ships a usable plain-text body carrying the link", () => {
    const rendered = [
      verificationEmail({ name: "Ana", url: "https://x/v/t" }),
      invitationEmail({ name: "Ana", url: "https://x/i/t" }),
      passwordResetEmail({ url: "https://x/r/t" }),
    ];
    for (const m of rendered) {
      expect(m.subject).toContain("Vecinal Ciudadela");
      expect(m.text.length).toBeGreaterThan(80);
      expect(m.text).not.toContain("<");
      expect(m.text).toContain("Asociación Vecinal del Barrio Ciudadela");
      expect(m.html).toContain("Asociación Vecinal del Barrio Ciudadela");
    }
  });
  // Cada tipo de enlace se canjea en una ruta distinta: el de verificación en
  // /verificar y el de invitación en /acceso. Mandarlos cruzados le daría al
  // socio un enlace que muere en la primera pantalla.
  it("portalInvite pairs each kind with its own route and template", () => {
    const v = portalInvite({
      kind: "email_verification", name: "Ana", baseUrl: "https://x", token: "tok1",
    });
    expect(v.message.subject).toContain("Verificá");
    expect(v.message.text).toContain("https://x/verificar/tok1");
    expect(v.message.text).not.toContain("/acceso/");
    expect(v.summary).toContain("verificación");

    const i = portalInvite({
      kind: "password_invitation", name: "Ana", baseUrl: "https://x", token: "tok2",
    });
    expect(i.message.subject).toContain("contraseña");
    expect(i.message.text).toContain("https://x/acceso/tok2");
    expect(i.message.text).not.toContain("/verificar/");
    expect(i.summary).toContain("invitación");
  });

  // El enlace es dato de entrada: no puede romper el HTML ni inyectar atributos.
  it("escapes interpolated values in html", () => {
    const m = verificationEmail({ name: `Ana "<script>" & Cia`, url: `https://x/v/t?a=1&b="2"` });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&amp;");
    expect(m.text).toContain(`https://x/v/t?a=1&b="2"`);
  });
});

describe("getTransport", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it("falls back to the console transport when Brevo envs are missing", async () => {
    for (const k of ["BREVO_SMTP_HOST", "BREVO_SMTP_USER", "BREVO_SMTP_KEY", "MAIL_FROM"]) {
      delete process.env[k];
    }
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await getTransport().send({
      to: "nobody@example.invalid",
      subject: "s",
      text: "t",
      html: "<p>t</p>",
    });
    expect(res.messageId).toBeNull();
    expect(log).toHaveBeenCalled();
  });
});

describe("makeMailer", () => {
  it("sends through the transport and records a Notification", async () => {
    const sent: MailMessage[] = [];
    const created: unknown[] = [];
    const mailer = makeMailer({
      transport: { send: async (msg) => { sent.push(msg); return { messageId: "mid-1" }; } },
      db: { notification: { create: async ({ data }: { data: unknown }) => { created.push(data); return data; } } } as never,
    });
    await mailer.sendToMember({
      memberId: 5, to: "a@b.com", type: "email_verification",
      message: verificationEmail({ name: "Ana", url: "https://x/v/t" }),
      summary: "verificación de email",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("a@b.com");
    expect(created[0]).toMatchObject({
      memberId: 5, type: "email_verification", via: "email", status: "sent",
      brevoMessageId: "mid-1", payloadSummary: "verificación de email",
    });
  });

  // Si el SMTP falla no se debe registrar un envío que nunca ocurrió.
  it("does not record a Notification when the transport throws", async () => {
    const created: unknown[] = [];
    const mailer = makeMailer({
      transport: { send: async () => { throw new Error("smtp down"); } },
      db: { notification: { create: async ({ data }: { data: unknown }) => { created.push(data); return data; } } } as never,
    });
    await expect(
      mailer.sendToMember({
        memberId: 5, to: "a@b.com", type: "generic",
        message: passwordResetEmail({ url: "https://x/r/t" }),
        summary: "restablecer contraseña",
      }),
    ).rejects.toThrow("smtp down");
    expect(created).toHaveLength(0);
  });
});
