import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActor } from "@/lib/auth/require-admin";

// La pantalla de efectivo es la que mueve plata: la guarda tiene que cortar
// ANTES de tocar el servicio, de auditar y de redirigir, y el asiento de
// auditoría no puede llevar nombre, DNI ni email (Ley 25.326).
const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  sendEmail: vi.fn(),
  audit: vi.fn(async () => {}),
  // Tipado explícito: sin él TS infiere la forma del rechazo y el
  // `mockResolvedValueOnce` del caso autorizado no compila.
  admin: vi.fn(async (): Promise<AdminActor> => (
    { ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." }
  )),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/treasury/service", () => ({
  treasuryService: { registerCashPayment: mocks.register },
  TreasuryError: class extends Error {},
}));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: mocks.sendEmail }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { registerCashPaymentAction } from "@/app/admin/tesoreria/efectivo/actions";

describe("registerCashPaymentAction", () => {
  // Cada caso mira si SU llamada tocó el servicio o la auditoría: sin
  // limpiar, las llamadas del caso anterior siguen contando.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin admin no registra, no audita, no redirige", async () => {
    const form = new FormData();
    form.append("memberId", "1");
    form.append("concept", "fees");
    form.append("count", "2");
    const r = await registerCashPaymentAction({}, form);
    expect(r.error).toBe("Necesitás permisos de administrador.");
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("con admin: registra, audita sin datos personales, manda el email si se pidió y redirige al recibo", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.register.mockResolvedValueOnce({ paymentId: 3, receiptId: 7, number: "2026-00007", periods: ["2026-09", "2026-10"], amount: 12000, pdfWritten: true });
    mocks.sendEmail.mockResolvedValueOnce({ sent: true });
    const form = new FormData();
    form.append("memberId", "1");
    form.append("concept", "fees");
    form.append("count", "2");
    form.append("sendEmail", "on");
    await registerCashPaymentAction({}, form);
    expect(mocks.register).toHaveBeenCalledWith({ memberId: 1, actorId: 9, concept: "fees", count: 2, amount: undefined, note: undefined });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "cash_payment_create", entity: "payment", entityId: 3,
      detail: { memberId: 1, receiptId: 7, number: "2026-00007", concept: "fees", count: 2, amount: 12000, periods: 2, emailed: "sent" },
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/recibos/7?emitido=1&email=sent");
  });

  it("un monto que no es número se rechaza en castellano, no con el NaN de zod", async () => {
    // Sin mensaje propio en la coerción, zod contesta "Invalid input: expected
    // number, received NaN" y ese texto va derecho a la pantalla del mostrador.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("memberId", "1");
    form.append("concept", "voluntary");
    form.append("amount", "2.500.");
    const r = await registerCashPaymentAction({}, form);
    expect(r.error).toBe("Ingresá el monto del aporte.");
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("un concepto inválido se rechaza en castellano antes de tocar el servicio", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("memberId", "1");
    form.append("concept", "lo-que-sea");
    const r = await registerCashPaymentAction({}, form);
    expect(r.error).toBe("Elegí el concepto del pago.");
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
