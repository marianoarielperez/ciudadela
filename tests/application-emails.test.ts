import { describe, expect, it, vi } from "vitest";

// El singleton `mailer` de @/lib/email importa @/lib/prisma (eager, explota sin
// DATABASE_URL) — mockear SIEMPRE, igual que en tests/email.test.ts.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  applicationAcceptedEmail, applicationReceivedEmail, applicationRejectedEmail,
  applicationResumeEmail, paymentReminderEmail,
} from "@/lib/email/templates";
import { makeMailer } from "@/lib/email";

describe("plantillas de solicitud", () => {
  it("acuse con pago: saluda por nombre, niega la membresía y explica quién resuelve", () => {
    const m = applicationAcceptedEmail({ name: "Ana Pérez" });
    expect(m.subject).toMatch(/Recibimos tu solicitud y tu pago/);
    expect(m.subject).not.toMatch(/aceptada/i);
    expect(m.text).toContain("Ana Pérez");
    expect(m.text).toContain("todavía no sos socio/a");
    expect(m.text).toMatch(/Comisión Directiva/);
    expect(m.text).toMatch(/fecha de ingreso/i);
    expect(m.text).toMatch(/no se devuelve/);
    expect(m.text).toMatch(/seis meses/);
    expect(m.text).not.toMatch(/Bienvenid/);
  });
  it("recibida: saluda por nombre, niega la membresía y la resuelve la Comisión Directiva", () => {
    const m = applicationReceivedEmail({ name: "Ana Pérez" });
    expect(m.text).toContain("Ana Pérez");
    expect(m.text).toContain("Todavía no sos socio/a");
    expect(m.text).toMatch(/resolver/);
    expect(m.text).toMatch(/Comisión Directiva/);
  });
  it("rechazada: NO saluda por nombre, sin causa, y solo menciona el ingreso si se retuvo", () => {
    const sin = applicationRejectedEmail({ entryFeeRetained: false });
    const con = applicationRejectedEmail({ entryFeeRetained: true });
    // La rechazada no puede saludar por nombre, y ni siquiera lo RECIBE: el
    // parámetro es `{ entryFeeRetained }` a secas.
    expect(applicationRejectedEmail.length).toBe(1);
    for (const m of [sin, con]) {
      expect(m.text).not.toContain("Hola ");
      expect(m.html).not.toContain("Hola ");
    }
    expect(sin.text).not.toMatch(/cuota de ingreso/i);
    expect(con.text).toMatch(/cuota de ingreso/i);
    expect(con.text).toMatch(/no es reembolsable/i);
    expect(con.text).toMatch(/6 .*meses|seis meses/i);
  });
  it("retome y recordatorio llevan la URL en texto plano", () => {
    expect(applicationResumeEmail({ url: "https://x/asociate/retomar/T" }).text).toContain("/asociate/retomar/T");
    const r = paymentReminderEmail({ url: "https://x/asociate/retomar/T" });
    expect(r.text).toContain("/asociate/retomar/T");
    expect(r.text).toMatch(/7 días|vence/i);
  });
  // Regla declarada en la cabecera de templates.ts: un cliente sin HTML tiene
  // que entender el mensaje completo, enlace incluido.
  it("las cinco plantillas traen un cuerpo de texto plano usable", () => {
    const rendered = [
      applicationAcceptedEmail({ name: "Ana" }),
      applicationReceivedEmail({ name: "Ana" }),
      applicationRejectedEmail({ entryFeeRetained: true }),
      applicationResumeEmail({ url: "https://x/asociate/retomar/T" }),
      paymentReminderEmail({ url: "https://x/asociate/retomar/T" }),
    ];
    for (const m of rendered) {
      expect(m.subject).toContain("Vecinal Ciudadela");
      expect(m.text.length).toBeGreaterThan(80);
      expect(m.text).not.toContain("<");
      expect(m.text).toContain("Asociación Vecinal del Barrio Ciudadela");
      expect(m.html).toContain("Asociación Vecinal del Barrio Ciudadela");
    }
  });
  // El nombre entra desde la base: no puede romper el markup ni inyectar.
  it("escapa el nombre en el html de las plantillas que saludan", () => {
    for (const m of [
      applicationAcceptedEmail({ name: `Ana "<script>" & Cia` }),
      applicationReceivedEmail({ name: `Ana "<script>" & Cia` }),
    ]) {
      expect(m.html).not.toContain("<script>");
      expect(m.html).toContain("&amp;");
    }
  });
});

describe("mailer.sendToApplication", () => {
  it("envía primero y acredita la Notification con applicationId", async () => {
    const calls: string[] = [];
    const created: Record<string, unknown>[] = [];
    const transport = { send: vi.fn(async () => { calls.push("send"); return { messageId: "m1" }; }) };
    const notification = {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        calls.push("record");
        created.push(data);
        return {};
      }),
    };
    const mailer = makeMailer({ transport, db: { notification } as never });
    await mailer.sendToApplication({
      applicationId: 55, to: "a@b.com", type: "application_result",
      message: { subject: "s", text: "t", html: "h" }, summary: "resumen",
    });
    expect(calls).toEqual(["send", "record"]);
    expect(created[0]).toMatchObject({
      applicationId: 55, memberId: null, via: "email", status: "sent", brevoMessageId: "m1",
      payloadSummary: "resumen",
    });
  });
  // Desde la 4C sí queda el rastro del INTENTO —una fila `failed`, que la
  // pantalla de salud lista— pero sigue sin acreditarse ningún envío: `sent`
  // es lo único que el estatuto toma por fehaciente, y ahí no salió nada.
  it("si el SMTP falla no acredita nada: la fila es `failed`, nunca `sent`", async () => {
    const transport = { send: vi.fn().mockRejectedValue(Object.assign(new Error("smtp"), { code: "ESOCKET" })) };
    const notification = { create: vi.fn(async () => ({})) };
    const mailer = makeMailer({ transport, db: { notification } as never });
    await expect(
      mailer.sendToApplication({
        applicationId: 55, to: "a@b.com", type: "application_result",
        message: { subject: "s", text: "t", html: "h" }, summary: "x",
      }),
    ).rejects.toThrow();
    // `toHaveBeenCalledWith` matchea ALGUNA llamada: sin el `Times(1)` el test
    // no verificaría el "nunca `sent`" que promete su nombre.
    expect(notification.create).toHaveBeenCalledTimes(1);
    expect(notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ applicationId: 55, status: "failed", error: "ESOCKET" }),
    });
  });
});
