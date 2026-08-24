import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActor } from "@/lib/auth/require-admin";

// Las dos actions del link de pago crean un cobro en Mercado Pago y mandan un
// correo con el membrete de la vecinal: la guarda tiene que cortar ANTES de
// tocar MP y antes de tocar el mailer. Y el asiento no puede llevar la URL del
// checkout ni el email del socio (Ley 25.326).
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  sendToMember: vi.fn(),
  audit: vi.fn(async () => {}),
  findUnique: vi.fn(),
  feeCount: vi.fn(),
  // Tipado explícito: sin él TS infiere la forma del rechazo y el
  // `mockResolvedValueOnce` del caso autorizado no compila.
  admin: vi.fn(async (): Promise<AdminActor> => (
    { ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." }
  )),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { member: { findUnique: mocks.findUnique }, fee: { count: mocks.feeCount } },
}));
vi.mock("@/lib/mp/payment-link", async () => {
  // El mapa de mensajes es real: si un mensaje cambia, el test que lo pinea
  // tiene que verlo.
  const real = await vi.importActual<typeof import("@/lib/mp/payment-link")>("@/lib/mp/payment-link");
  return { PAYMENT_LINK_ERRORS: real.PAYMENT_LINK_ERRORS, paymentLinks: { create: mocks.create } };
});
vi.mock("@/lib/email", () => ({ mailer: { sendToMember: mocks.sendToMember } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// El sello de pertenencia (`payment-link-seal`) se firma con AUTH_SECRET. En el
// test se fija acá y no en la config global: el resto de la suite no tiene por
// qué heredar un secreto.
process.env.AUTH_SECRET = "test-auth-secret";

import { createPaymentLinkAction, emailPaymentLinkAction } from "@/app/admin/socios/[id]/link/actions";
import { sealPaymentLink } from "@/lib/mp/payment-link-seal";

const MP_URL = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=abc";
const EXPIRES = new Date("2026-08-26T15:00:00.000Z");

function createForm(n = "2", memberId = "14") {
  const f = new FormData();
  f.append("memberId", memberId);
  f.append("n", n);
  return f;
}

function emailForm(url = MP_URL, seal?: string) {
  const f = new FormData();
  f.append("memberId", "14");
  f.append("url", url);
  f.append("n", "2");
  f.append("amount", "12000");
  f.append("expiresAt", EXPIRES.toISOString());
  f.append("seal", seal ?? sealPaymentLink({ memberId: 14, n: 2, amount: 12000, url }));
  return f;
}

describe("createPaymentLinkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin admin no crea la preferencia, no audita y no lee la ficha", async () => {
    const r = await createPaymentLinkAction({}, createForm());
    expect(r.error).toBe("Necesitás permisos de administrador.");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("con admin devuelve el link y audita ids/cantidad/monto — SIN la URL", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ id: 14, category: "active", status: "active" });
    mocks.create.mockResolvedValueOnce({ ok: true, initPoint: MP_URL, amount: 12000, unit: 6000, reference: "pago:14:2", expiresAt: EXPIRES });
    const r = await createPaymentLinkAction({}, createForm());
    expect(r).toEqual({
      link: {
        url: MP_URL, amount: 12000, n: 2, expiresAt: EXPIRES,
        seal: sealPaymentLink({ memberId: 14, n: 2, amount: 12000, url: MP_URL }),
      },
    });
    expect(mocks.create).toHaveBeenCalledWith({ member: { id: 14, category: "active", status: "active" }, n: 2 });
    expect(mocks.audit).toHaveBeenCalledWith({
      userId: 9, ip: "unknown",
      action: "payment_link_create", entity: "member", entityId: 14,
      detail: { memberId: 14, n: 2, amount: 12000, channel: "admin" },
    });
    // El asiento entero, serializado, no puede contener el enlace de cobro.
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("mercadopago");
  });

  it("si Mercado Pago tira, el error es en castellano y no se audita nada", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ id: 14, category: "active", status: "active" });
    // El SDK de MP no lanza `Error`: lanza el cuerpo de la respuesta.
    mocks.create.mockRejectedValueOnce({ message: "invalid token", status: 401, cause: [{ code: "unauthorized", description: "bad token" }] });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await createPaymentLinkAction({}, createForm());
    expect(r.error).toBe("No pudimos crear el link en Mercado Pago. Probá de nuevo en unos minutos.");
    expect(mocks.audit).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("la categoría sin cuota se explica y no se audita un link que no existe", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ id: 14, category: "lifetime", status: "active" });
    mocks.create.mockResolvedValueOnce({ ok: false, error: "category_without_fee" });
    const r = await createPaymentLinkAction({}, createForm());
    expect(r.error).toBe("Esta categoría no paga cuota: no hay nada que cobrar por link.");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("un socio que no existe se rechaza antes de tocar Mercado Pago", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(null);
    const r = await createPaymentLinkAction({}, createForm());
    expect(r.error).toBe("El socio no existe.");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("una cantidad que no es número se rechaza en castellano, no con el NaN de zod", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const r = await createPaymentLinkAction({}, createForm("dos"));
    expect(r.error).toBe("Indicá cuántas cuotas.");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("una cantidad por encima del tope se rechaza sin crear la preferencia", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const r = await createPaymentLinkAction({}, createForm("61"));
    expect(r.error).toBe("Como máximo 60 cuotas.");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  // Un cesante no devenga (REG-16): lo único que se le puede cobrar es la deuda
  // que quedó congelada al darlo de baja. Sin la guarda el link se generaba
  // igual, el vecino pagaba y la plata caía en la bandeja de sin conciliar.
  it("un cesante SIN cuotas pendientes no puede recibir un link: la plata entraría y no habría a qué imputarla", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ id: 7, category: "active", status: "withdrawn" });
    mocks.feeCount.mockResolvedValueOnce(0);
    const r = await createPaymentLinkAction({}, createForm("1", "7"));
    expect(r.error).toContain("dado de baja");
    expect(mocks.create).not.toHaveBeenCalled(); // ni siquiera se le pide el link a MP
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("un cesante CON deuda puede recibir un link por lo que debe, y no por más", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 }).mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique
      .mockResolvedValueOnce({ id: 7, category: "active", status: "withdrawn" })
      .mockResolvedValueOnce({ id: 7, category: "active", status: "withdrawn" });
    mocks.feeCount.mockResolvedValueOnce(2).mockResolvedValueOnce(2);
    mocks.create.mockResolvedValueOnce({ ok: true, initPoint: MP_URL, amount: 12000, unit: 6000, reference: "pago:7:2", expiresAt: EXPIRES });
    // Tres cuotas para quien debe dos: el excedente no tendría a qué imputarse.
    expect((await createPaymentLinkAction({}, createForm("3", "7"))).error).toContain("2");
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await createPaymentLinkAction({}, createForm("2", "7"))).error).toBeUndefined();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("un socio vigente no paga la consulta de más: sólo se cuentan cuotas si está de baja", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ id: 7, category: "active", status: "active" });
    mocks.create.mockResolvedValueOnce({ ok: true, initPoint: MP_URL, amount: 18000, unit: 6000, reference: "pago:7:3", expiresAt: EXPIRES });
    await createPaymentLinkAction({}, createForm("3", "7"));
    expect(mocks.feeCount).not.toHaveBeenCalled();
  });
});

describe("emailPaymentLinkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin admin no manda nada", async () => {
    const r = await emailPaymentLinkAction({}, emailForm());
    expect(r.error).toBe("Necesitás permisos de administrador.");
    expect(mocks.sendToMember).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("una URL que no es de Mercado Pago se rechaza: la action no es un relé de spam", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const r = await emailPaymentLinkAction({}, emailForm("https://phishing.example/pagar"));
    expect(r.error).toBe("Link inválido.");
    expect(mocks.sendToMember).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("algo que ni siquiera es una URL se rechaza igual", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const r = await emailPaymentLinkAction({}, emailForm("javascript:alert(1)"));
    expect(r.error).toBe("Link inválido.");
    expect(mocks.sendToMember).not.toHaveBeenCalled();
  });

  it("un link de OTRO socio se rechaza: el sello ata la tupla al destinatario", async () => {
    // Inalcanzable desde la pantalla y sólo para admins, pero un POST armado a
    // mano mandaría al socio A un enlace cuya referencia acredita al socio B: el
    // vecino paga y la cuota se le imputa a otro. La URL sola no dice de quién
    // es —es `.../redirect?pref_id=...`— y la preferencia no se persiste, así
    // que la pertenencia tiene que viajar firmada.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const ajeno = sealPaymentLink({ memberId: 306, n: 2, amount: 12000, url: MP_URL });
    const r = await emailPaymentLinkAction({}, emailForm(MP_URL, ajeno));
    expect(r.error).toBe("Link inválido.");
    expect(mocks.sendToMember).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("un monto retocado invalida el sello aunque la URL siga siendo la misma", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const f = emailForm();
    f.set("amount", "1");
    const r = await emailPaymentLinkAction({}, f);
    expect(r.error).toBe("Link inválido.");
    expect(mocks.sendToMember).not.toHaveBeenCalled();
  });

  it("un socio sin email no dispara ningún envío", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ id: 14, fullName: "Juan Pérez", email: null, emailStatus: "none" });
    const r = await emailPaymentLinkAction({}, emailForm());
    expect(r.error).toBe("El socio no tiene un email válido cargado.");
    expect(mocks.sendToMember).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("una dirección rebotada tampoco: el envío quedaría acreditado sin haber llegado", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ id: 14, fullName: "Juan Pérez", email: "j@example.com", emailStatus: "bounced" });
    const r = await emailPaymentLinkAction({}, emailForm());
    expect(r.error).toBe("El socio no tiene un email válido cargado.");
    expect(mocks.sendToMember).not.toHaveBeenCalled();
  });

  it("con email válido manda, audita el canal y NO deja la dirección en el asiento", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ id: 14, fullName: "Juan Pérez", email: "juan@example.com", emailStatus: "verified" });
    mocks.sendToMember.mockResolvedValueOnce({ messageId: "m1" });
    const r = await emailPaymentLinkAction({}, emailForm());
    expect(r).toEqual({
      link: {
        url: MP_URL, amount: 12000, n: 2, expiresAt: EXPIRES,
        seal: sealPaymentLink({ memberId: 14, n: 2, amount: 12000, url: MP_URL }),
      },
      emailed: true,
    });
    expect(mocks.sendToMember).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 14, to: "juan@example.com", type: "fee_reminder", summary: "link de pago × 2",
    }));
    expect(mocks.audit).toHaveBeenCalledWith({
      userId: 9, ip: "unknown",
      action: "payment_link_create", entity: "member", entityId: 14,
      detail: { memberId: 14, n: 2, amount: 12000, channel: "email" },
    });
    const serialized = JSON.stringify(mocks.audit.mock.calls);
    expect(serialized).not.toContain("juan@example.com");
    expect(serialized).not.toContain("mercadopago");
  });

  it("si el SMTP falla, el link vuelve intacto para copiarlo y el envío no se acredita", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ id: 14, fullName: "Juan Pérez", email: "juan@example.com", emailStatus: "verified" });
    mocks.sendToMember.mockRejectedValueOnce(Object.assign(new Error("smtp"), { code: "ECONNREFUSED" }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await emailPaymentLinkAction({}, emailForm());
    expect(r.error).toContain("El link sigue siendo válido");
    expect(r.link).toMatchObject({ url: MP_URL, amount: 12000, n: 2, expiresAt: EXPIRES });
    expect(mocks.audit).not.toHaveBeenCalled();
    // El log lleva el código del fallo, nunca la dirección del socio.
    expect(spy).toHaveBeenCalledWith("[payment-link] email", "ECONNREFUSED");
    spy.mockRestore();
  });
});
