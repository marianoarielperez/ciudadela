import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberActor } from "@/lib/auth/require-member";

// "Pagar ahora" del panel del socio. Lo que este test cuida es que el socio no
// pueda elegir a quién se le cobra —el `memberId` sale de la sesión viva, nunca
// del formulario— y que un socio bloqueado (baja, suspensión, cuenta cerrada)
// no llegue a crear una preferencia en Mercado Pago.
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  audit: vi.fn(async () => {}),
  findUniqueOrThrow: vi.fn(),
  check: vi.fn(() => true),
  member: vi.fn(async (): Promise<MemberActor> => (
    { ok: false, reason: "anonymous", error: "Ingresá a tu cuenta para ver tu panel de socio." }
  )),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { member: { findUniqueOrThrow: mocks.findUniqueOrThrow } } }));
vi.mock("@/lib/mp/payment-link", async () => {
  const real = await vi.importActual<typeof import("@/lib/mp/payment-link")>("@/lib/mp/payment-link");
  return { PAYMENT_LINK_ERRORS: real.PAYMENT_LINK_ERRORS, paymentLinks: { create: mocks.create } };
});
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-member", () => ({ requireMember: mocks.member }));
vi.mock("@/lib/auth/rate-limiter", () => ({ memberPayLimiter: { check: mocks.check } }));

import { startMemberPaymentAction } from "@/app/mi/cuenta/actions";

const MP_URL = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=abc";

function form(n = "3", extra?: Record<string, string>) {
  const f = new FormData();
  f.append("n", n);
  for (const [k, v] of Object.entries(extra ?? {})) f.append(k, v);
  return f;
}

function loggedIn() {
  mocks.member.mockResolvedValueOnce({ ok: true, userId: 42, memberId: 14, fullName: "Juan Pérez" });
}

describe("startMemberPaymentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.check.mockReturnValue(true);
  });

  it("sin socio no crea preferencia ni audita", async () => {
    const r = await startMemberPaymentAction({}, form());
    expect(r.error).toBe("Ingresá a tu cuenta para ver tu panel de socio.");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("un socio suspendido recibe el motivo y no llega a Mercado Pago", async () => {
    // `requireMember` resuelve contra la fila viva: el JWT de 8 h que todavía
    // dice "socio" no alcanza para pagar desde el panel (REG-20).
    mocks.member.mockResolvedValueOnce({
      ok: false, reason: "suspended",
      error: "Tu condición de socio está suspendida: mientras dure la suspensión no podés operar desde tu panel (Art. 10). Comunicate con la vecinal.",
    });
    const r = await startMemberPaymentAction({}, form());
    expect(r.error).toContain("suspendida");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("pasado el techo de intentos no se crea una preferencia más", async () => {
    loggedIn();
    mocks.check.mockReturnValue(false);
    const r = await startMemberPaymentAction({}, form());
    expect(r.error).toBe("Demasiados intentos seguidos. Esperá un minuto y volvé a probar.");
    expect(mocks.create).not.toHaveBeenCalled();
    // El techo es por socio, no por IP: la pantalla es autenticada.
    expect(mocks.check).toHaveBeenCalledWith("14");
  });

  it("ok: devuelve la URL de checkout y audita con channel member", async () => {
    loggedIn();
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ id: 14, category: "active" });
    mocks.create.mockResolvedValueOnce({ ok: true, initPoint: MP_URL, amount: 18000, unit: 6000, reference: "pago:14:3" });
    const r = await startMemberPaymentAction({}, form());
    expect(r).toEqual({ redirectUrl: MP_URL });
    expect(mocks.create).toHaveBeenCalledWith({ member: { id: 14, category: "active" }, n: 3 });
    expect(mocks.audit).toHaveBeenCalledWith({
      userId: 42,
      action: "payment_link_create", entity: "member", entityId: 14,
      detail: { memberId: 14, n: 3, amount: 18000, channel: "member" },
    });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("mercadopago");
  });

  it("un memberId colado en el formulario se ignora: el cobro es siempre para el socio de la sesión", async () => {
    loggedIn();
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ id: 14, category: "active" });
    mocks.create.mockResolvedValueOnce({ ok: true, initPoint: MP_URL, amount: 6000, unit: 6000, reference: "pago:14:1" });
    await startMemberPaymentAction({}, form("1", { memberId: "306" }));
    expect(mocks.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 14 } }));
    expect(mocks.create).toHaveBeenCalledWith({ member: { id: 14, category: "active" }, n: 1 });
  });

  it("una cantidad fuera de rango se rechaza en castellano y sin tocar Mercado Pago", async () => {
    loggedIn();
    expect((await startMemberPaymentAction({}, form("61"))).error).toBe("Como máximo 60 cuotas.");
    loggedIn();
    expect((await startMemberPaymentAction({}, form("0"))).error).toBe("Al menos una cuota.");
    loggedIn();
    expect((await startMemberPaymentAction({}, form("tres"))).error).toBe("Indicá cuántas cuotas querés pagar.");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("sin valor de cuota vigente se explica y no queda asiento de un link que no existe", async () => {
    loggedIn();
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ id: 14, category: "active" });
    mocks.create.mockResolvedValueOnce({ ok: false, error: "no_fee_value" });
    const r = await startMemberPaymentAction({}, form());
    expect(r.error).toBe("El valor de la cuota no está configurado: no se puede generar el link.");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("si Mercado Pago tira, el socio ve un mensaje suyo y no el error del SDK", async () => {
    loggedIn();
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ id: 14, category: "active" });
    mocks.create.mockRejectedValueOnce({ message: "bad token", status: 401 });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await startMemberPaymentAction({}, form());
    expect(r.error).toBe("No pudimos iniciar el pago en Mercado Pago. Probá de nuevo en unos minutos.");
    expect(mocks.audit).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
