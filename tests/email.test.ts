import { afterEach, describe, expect, it, vi } from "vitest";

// El singleton importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeMailer } from "@/lib/email";
import {
  invitationEmail, loginEmailMovedNotice, loginEmailVerification, passwordResetEmail,
  paymentLinkEmail, portalInvite, receiptEmail, verificationEmail,
} from "@/lib/email/templates";
import { PAYMENT_LINK_TTL_HOURS } from "@/lib/mp/references";
import { getTransport, type MailMessage } from "@/lib/email/transport";

describe("templates", () => {
  // El correo de verificación es el de más volumen de la campaña de carga (uno
  // por ficha tipeada desde papel) y el único que un dedazo del operador entrega
  // SOLO, sin que nadie haga clic y sin reparación posible. Por eso no nombra al
  // socio, y la plantilla ni siquiera recibe el nombre: no hay forma de
  // filtrarlo por descuido desde el llamador.
  it("verification email carries the url and cannot carry the member's name", () => {
    const m = verificationEmail({ url: "https://x/verificar/abc" });
    // Y no puede recibirlo: el parámetro es `{ url }` a secas, así que un
    // llamador que intente pasarle `name` no compila (verificado con `tsc`).
    expect(verificationEmail.length).toBe(1);
    expect(m.subject).toContain("Verificá");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("https://x/verificar/abc");
      expect(body).not.toContain("Hola ");
      // Contexto institucional suficiente para que el socio legítimo entienda
      // qué está confirmando y no lo tome por spam.
      expect(body).toContain("Asociación Vecinal del Barrio Ciudadela");
      expect(body).toContain("padrón de socios");
      expect(body).toContain("error de carga");
    }
  });
  it("invitation and reset include their urls", () => {
    expect(invitationEmail({ name: "Ana", url: "https://x/acceso/t" }).text).toContain("https://x/acceso/t");
    expect(passwordResetEmail({ url: "https://x/restablecer/t" }).text).toContain("https://x/restablecer/t");
  });
  // Un cliente sin HTML tiene que poder leer el mensaje completo, enlace incluido.
  it("every template ships a usable plain-text body carrying the link", () => {
    const rendered = [
      verificationEmail({ url: "https://x/v/t" }),
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

  // El correo que le avisa al socio que su dirección de INGRESO se mudó. Lo que
  // NO puede llevar es la dirección nueva: si el cambio fue un secuestro, este
  // correo le confirmaría al atacante que acertó; si fue un dedazo del operador,
  // le estaría mandando la casilla de un tercero a alguien que no tiene por qué
  // verla. Por eso la plantilla ni siquiera RECIBE la dirección nueva: no hay
  // forma de filtrarla por descuido desde el llamador.
  it("warns the previous address without ever naming the new one", () => {
    const m = loginEmailMovedNotice();
    expect(loginEmailMovedNotice.length).toBe(0); // no recibe ninguna dirección
    for (const body of [m.text, m.html]) {
      expect(body).not.toContain("@example");
      // Las tres cosas que la persona tiene que salir sabiendo.
      expect(body).toContain("otra dirección de correo");
      expect(body).toContain("ya no sirve para entrar");
      expect(body).toContain("sede");
    }
    expect(m.subject).toContain("Vecinal Ciudadela");
    // Y ningún enlace: quien recibe esto ya no tiene acceso, y un enlace en un
    // correo de alerta de seguridad es justo lo que enseña a hacer clic.
    expect(m.text).not.toContain("http");
  });

  // La verificación de la dirección nueva se canja en /verificar, igual que
  // cualquier otro `email_verification`: mandarla a /acceso le daría al socio un
  // enlace muerto.
  it("sends the new address a verification link on the /verificar route", () => {
    const v = loginEmailVerification({ baseUrl: "https://x", token: "tok9" });
    expect(v.message.text).toContain("https://x/verificar/tok9");
    expect(v.message.text).not.toContain("/acceso/");
    // Y le dice lo que el correo de verificación común no dice: que esta casilla
    // es, además, con la que ingresa.
    expect(v.message.text).toContain("ingresás al portal");
    expect(v.message.text).toContain("Tu contraseña no cambia");
    expect(v.summary).toContain("acceso");
  });

  // Ninguno de los dos saluda por nombre: la casilla vieja puede estar en manos
  // de un tercero y la nueva todavía no está confirmada.
  it("keeps the member's name out of both sides of the move", () => {
    const bodies = [
      loginEmailMovedNotice(),
      loginEmailVerification({ baseUrl: "https://x", token: "t" }).message,
    ];
    for (const m of bodies) {
      expect(m.text).not.toContain("Hola ");
      expect(m.subject).toContain("Vecinal Ciudadela");
      expect(m.text).toContain("Asociación Vecinal del Barrio Ciudadela");
      expect(m.text).not.toContain("<");
      expect(m.html).toContain("Asociación Vecinal del Barrio Ciudadela");
    }
  });

  // El enlace es dato de entrada: no puede romper el HTML ni inyectar atributos.
  it("escapes interpolated values in html", () => {
    const m = verificationEmail({ url: `https://x/v/t?a=1&b="2"` });
    expect(m.html).not.toContain(`b="2"`);
    expect(m.html).toContain("&amp;");
    expect(m.text).toContain(`https://x/v/t?a=1&b="2"`);
    // El nombre sigue entrando en la invitación, que es la única plantilla que
    // no puede caer en una casilla sin confirmar: ahí el escapado sigue vivo.
    const i = invitationEmail({ name: `Ana "<script>" & Cia`, url: "https://x/i/t" });
    expect(i.html).not.toContain("<script>");
    expect(i.html).toContain("&amp;");
  });

  it("receiptEmail nombra número, concepto y monto, y avisa que el PDF va adjunto", () => {
    const r = receiptEmail({ name: "Ana", number: "2026-00012", concept: "Cuota social · marzo 2025", amount: 6000 });
    expect(r.subject).toBe("Recibo 2026-00012 — Vecinal Ciudadela");
    expect(r.text).toContain("2026-00012");
    expect(r.text).toContain("$ 6.000,00");
    expect(r.text).toContain("adjunto");
    expect(r.html).toContain("Cuota social · marzo 2025");
  });

  // El vecino recibe un enlace de COBRO que no pidió: el correo tiene que
  // dejarlo verificar cuánto y por qué sin abrirlo, y decirle hasta cuándo vale
  // —el importe queda congelado al valor de cuota del día en que se generó—.
  it("paymentLinkEmail dice cuánto, por cuántas cuotas, hasta cuándo vale y cómo salir", () => {
    const r = paymentLinkEmail({ name: "Ana", count: 3, amount: 18000, url: "https://mpago.la/abc" });
    expect(r.subject).toContain("link para pagar");
    for (const body of [r.text, r.html]) {
      expect(body).toContain("Ana");
      expect(body).toContain("3 cuotas sociales");
      expect(body).toContain("$ 18.000,00");
      expect(body).toContain("https://mpago.la/abc");
      // El vencimiento es real (`expiration_date_to` en la preferencia): el
      // texto sale de la misma constante que el cuerpo que se le manda a MP.
      expect(body).toContain(`${PAYMENT_LINK_TTL_HOURS} horas`);
      // La salida, porque el operador puede mandarlo el mismo día en que el
      // socio saldó en la sede.
      expect(body).toContain("Si ya pagaste");
    }
  });

  it("paymentLinkEmail usa el singular con una sola cuota y escapa el nombre", () => {
    expect(paymentLinkEmail({ name: "A", count: 1, amount: 6000, url: "https://mpago.la/x" }).text)
      .toContain("1 cuota social por $ 6.000,00");
    expect(paymentLinkEmail({ name: 'Ana & "Co"', count: 1, amount: 1, url: "https://mpago.la/x" }).html)
      .toContain("Ana &amp; &quot;Co&quot;");
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

  it("el transporte de consola lista los adjuntos por nombre y tamaño, no por contenido", async () => {
    for (const k of ["BREVO_SMTP_HOST", "BREVO_SMTP_USER", "BREVO_SMTP_KEY", "MAIL_FROM", "EMAIL_ALLOWLIST"]) {
      delete process.env[k];
    }
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await getTransport().send({
      to: "a@b.com", subject: "s", text: "t", html: "<p>t</p>",
      attachments: [{ filename: "recibo-2026-00001.pdf", content: Buffer.from("%PDF-"), contentType: "application/pdf" }],
    });
    expect(log.mock.calls.flat().join("\n")).toContain("recibo-2026-00001.pdf (5 B)");
    log.mockRestore();
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
      message: verificationEmail({ url: "https://x/v/t" }),
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
