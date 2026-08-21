import { describe, expect, it, vi } from "vitest";

// El singleton del procesador importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeWebhookProcessor } from "@/lib/mp/webhook-processor";

function deps(payment?: Partial<{ status: string; externalReference: string | null; transactionAmount: number }>) {
  const application = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue({ id: 55, fullName: "Ana Pérez", email: "a@b.com", status: "approved_pending_minute" }),
  };
  const mpSubscription = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const db = {
    application, mpSubscription,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ application, mpSubscription })),
  };
  const gateway = {
    getPayment: vi.fn().mockResolvedValue({
      id: "777", status: "approved", transactionAmount: 6000, externalReference: "solicitud:55", ...payment,
    }),
    getPreapproval: vi.fn().mockResolvedValue({ id: "pre-1", status: "authorized", payerEmail: "a@b.com", externalReference: "solicitud:55" }),
    getAuthorizedPayment: vi.fn().mockResolvedValue({ id: "9", preapprovalId: "pre-1", status: "processed" }),
  };
  const mailerMock = { sendToApplication: vi.fn().mockResolvedValue({ messageId: "m" }) };
  const auditMock = vi.fn<(entry: unknown) => Promise<void>>(async () => {});
  return {
    db: db as never, gateway: gateway as never, mailer: mailerMock as never, audit: auditMock as never,
    application, mpSubscription, gatewayMock: gateway, mailerMock, auditMock,
  };
}

describe("webhookProcessor payments", () => {
  it("pago aprobado de una solicitud pendiente → transición + email de aceptada", async () => {
    const d = deps();
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");
    const upd = d.application.updateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: 55, status: "pending_payment" });
    expect(upd.data).toMatchObject({ status: "approved_pending_minute", mpPaymentIdEntry: "777" });
    // UN solo email acá (la bienvenida): la verificación ya salió al crear la
    // solicitud (Task 11) y no se repite.
    expect(d.mailerMock.sendToApplication).toHaveBeenCalledTimes(1);
  });
  it("reintento (updateMany count 0) → already_processed y SIN email", async () => {
    const d = deps();
    d.application.updateMany.mockResolvedValue({ count: 0 });
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("already_processed");
    expect(d.mailerMock.sendToApplication).not.toHaveBeenCalled();
  });
  // ── El pago que llega DESPUÉS del vencimiento ──────────────────────────────
  // El cron expira a los 7 días; si MP demora o reintenta el aviso del primer
  // pago, la solicitud ya está `expired`. Antes eso devolvía `already_processed`
  // —indistinguible de un reintento— y el vecino quedaba pagado y afuera.
  it("pago aprobado sobre una solicitud VENCIDA → revive, con result y asiento distinguibles", async () => {
    const d = deps();
    // El primer UPDATE (desde pending_payment) no encuentra nada; el segundo
    // (desde expired) sí.
    d.application.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const p = makeWebhookProcessor(d);

    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe(
      "application_approved_after_expiry",
    );

    expect(d.application.updateMany).toHaveBeenCalledTimes(2);
    const second = d.application.updateMany.mock.calls[1][0];
    expect(second.where).toMatchObject({ id: 55, status: "expired" });
    expect(second.data).toMatchObject({ status: "approved_pending_minute", mpPaymentIdEntry: "777" });

    // El asiento es la única señal que le queda al operador: al expirar, el cron
    // ya canceló el preapproval y el alta quedó sin débito automático.
    expect(d.auditMock).toHaveBeenCalledTimes(1);
    const entry = d.auditMock.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      action: "application_approved_after_expiry",
      entity: "application",
      entityId: 55,
    });
    expect(JSON.stringify(entry)).not.toContain("a@b.com");
    expect(JSON.stringify(entry)).not.toContain("Ana");
    // Y el vecino igual recibe la bienvenida: pagó y está aceptado.
    expect(d.mailerMock.sendToApplication).toHaveBeenCalledTimes(1);
  });

  it("el reintento del MISMO evento sobre la revivida sigue sin efectos", async () => {
    const d = deps();
    // Ya está en approved_pending_minute: ninguno de los dos UPDATE la agarra.
    d.application.updateMany.mockResolvedValue({ count: 0 });
    const p = makeWebhookProcessor(d);

    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("already_processed");

    expect(d.application.updateMany).toHaveBeenCalledTimes(2);
    expect(d.mailerMock.sendToApplication).not.toHaveBeenCalled();
    expect(d.auditMock).not.toHaveBeenCalled();
  });

  it("el camino normal no cambia: un solo UPDATE, sin asiento de vencida", async () => {
    const d = deps();
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");
    // Sin el `count === 0`, el segundo UPDATE ni se intenta.
    expect(d.application.updateMany).toHaveBeenCalledTimes(1);
    expect(d.auditMock).not.toHaveBeenCalled();
  });

  it("si la auditoría de la revivida falla, la aceptación sigue en pie", async () => {
    const d = deps();
    d.application.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    d.auditMock.mockRejectedValue(new Error("db down"));
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe(
      "application_approved_after_expiry",
    );
  });

  it("pago rechazado → payment_rejected sin transición", async () => {
    const d = deps({ status: "rejected" });
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("payment_rejected");
    expect(d.application.updateMany).not.toHaveBeenCalled();
  });
  it("external_reference ajena → no_match (nunca error)", async () => {
    const d = deps({ externalReference: "otra-cosa" });
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("no_match");
  });

  // Extras sobre el brief: los caminos que no estaban ejercitados y que, si se
  // rompieran, o bien perderían plata (un pago en curso tomado por bueno) o
  // bien des-aceptarían a alguien ya aceptado.
  it("external_reference nula → no_match sin tocar la base", async () => {
    const d = deps({ externalReference: null });
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("no_match");
    expect(d.application.updateMany).not.toHaveBeenCalled();
  });
  it("pago en proceso (ni approved ni rejected) → payment_ignored sin transición", async () => {
    const d = deps({ status: "in_process" });
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("payment_ignored");
    expect(d.application.updateMany).not.toHaveBeenCalled();
    expect(d.mailerMock.sendToApplication).not.toHaveBeenCalled();
  });
  it("guarda el monto con dos decimales y el id del pago tal cual vino de MP", async () => {
    const d = deps({ transactionAmount: 6000.5 });
    const p = makeWebhookProcessor(d);
    await p.process({ topic: "payment", dataId: "777" });
    const upd = d.application.updateMany.mock.calls[0][0];
    expect(String(upd.data.entryAmount)).toBe("6000.5");
    expect(upd.data.mpPaymentIdEntry).toBe("777");
  });
  it("un SMTP caído NO revierte la aceptación: sigue devolviendo application_approved", async () => {
    const d = deps();
    d.mailerMock.sendToApplication.mockRejectedValue(Object.assign(new Error("smtp down"), { code: "ECONNREFUSED" }));
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");
  });

  // Sin asiento, una bienvenida perdida sólo vivía en el log de PM2: el vecino
  // queda aceptado, el correo nunca llega y nada en la base lo dice.
  it("una bienvenida perdida deja asiento de auditoría y la transición IGUAL queda firme", async () => {
    const d = deps();
    d.mailerMock.sendToApplication.mockRejectedValue(Object.assign(new Error("smtp down"), { code: "ECONNREFUSED" }));
    const p = makeWebhookProcessor(d);

    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");

    expect(d.auditMock).toHaveBeenCalledTimes(1);
    const entry = d.auditMock.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      action: "application_accepted_email_failed",
      entity: "application",
      entityId: 55,
      detail: { code: "ECONNREFUSED" },
    });
    // El asiento no puede llevar el email ni el nombre del vecino (docs/08).
    expect(JSON.stringify(entry)).not.toContain("a@b.com");
    expect(JSON.stringify(entry)).not.toContain("Ana");
  });

  it("si la auditoría del email perdido también falla, la aceptación sigue en pie", async () => {
    const d = deps();
    d.mailerMock.sendToApplication.mockRejectedValue(new Error("smtp down"));
    d.auditMock.mockRejectedValue(new Error("db down"));
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");
  });

  it("un envío OK no escribe asiento de fallo", async () => {
    const d = deps();
    const p = makeWebhookProcessor(d);
    await p.process({ topic: "payment", dataId: "777" });
    expect(d.auditMock).not.toHaveBeenCalled();
  });
  it("propaga el fallo del gateway (la ruta lo convierte en 500 y MP reintenta)", async () => {
    const d = deps();
    d.gatewayMock.getPayment.mockRejectedValue(new Error("MP 500"));
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).rejects.toThrow("MP 500");
  });
  it("acepta el tópico en plural que también manda MP", async () => {
    const d = deps();
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payments", dataId: "777" })).resolves.toBe("application_approved");
  });
});

describe("webhookProcessor subscriptions", () => {
  it("subscription_preapproval sincroniza el status local", async () => {
    const d = deps();
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "subscription_preapproval", dataId: "pre-1" })).resolves.toBe("subscription_synced");
  });
  it("preapproval que no es nuestro → no_match", async () => {
    const d = deps();
    d.mpSubscription.updateMany.mockResolvedValue({ count: 0 });
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "subscription_preapproval", dataId: "pre-1" })).resolves.toBe("no_match");
  });
  it("subscription_authorized_payment se traza (la aplicación a cuotas es M4)", async () => {
    const d = deps();
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("authorized_payment_traced");
    expect(d.gatewayMock.getAuthorizedPayment).toHaveBeenCalledWith("9");
  });
  it("tópico desconocido → unknown_topic", async () => {
    const p = makeWebhookProcessor(deps());
    await expect(p.process({ topic: "raro", dataId: "1" })).resolves.toBe("unknown_topic");
  });
});
