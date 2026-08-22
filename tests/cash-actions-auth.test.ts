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
    // `userId` e `ip` van explícitos: un objectContaining que no los mira deja
    // pasar un asiento auditado bajo el actor equivocado, o bajo null.
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, ip: "unknown",
      action: "cash_payment_create", entity: "payment", entityId: 3,
      detail: { memberId: 1, receiptId: 7, number: "2026-00007", concept: "fees", count: 2, amount: 12000, periods: 2, emailed: "sent" },
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/recibos/7?emitido=1&email=sent");
  });

  it("si sendReceiptEmail explota, la plata ya cobrada igual queda auditada y redirige al recibo", async () => {
    // `sendReceiptEmail` está documentado como best-effort, pero su primer
    // statement (el findUnique del recibo) vive afuera del try interno del
    // módulo: un timeout del pool ahí se escapa igual. El pago, la imputación
    // y el recibo numerado ya están commiteados en `treasuryService`: si esto
    // tira, la auditoría y el redirect tienen que pasar de todos modos, o el
    // operador reintentaría y le cobraría dos veces al socio.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.register.mockResolvedValueOnce({ paymentId: 3, receiptId: 7, number: "2026-00007", periods: ["2026-09"], amount: 6000, pdfWritten: true });
    mocks.sendEmail.mockRejectedValueOnce(Object.assign(new Error("pool timeout"), { code: "ETIMEDOUT" }));
    const form = new FormData();
    form.append("memberId", "1");
    form.append("concept", "voluntary");
    form.append("amount", "6000");
    form.append("sendEmail", "on");
    await registerCashPaymentAction({}, form);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, action: "cash_payment_create", entityId: 3,
      detail: expect.objectContaining({ emailed: "error" }),
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/recibos/7?emitido=1&email=error");
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

  it("un monto con centavos se rechaza con el mensaje de entero (pesos enteros, no fracción)", async () => {
    // Pin del límite exacto: el monto es en pesos enteros a propósito (ver
    // comentario del schema), así que un número válido pero fraccionario tiene
    // que caer en el mensaje de ".int()", no en el genérico de "no es número".
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("memberId", "1");
    form.append("concept", "voluntary");
    form.append("amount", "2500.50");
    const r = await registerCashPaymentAction({}, form);
    expect(r.error).toBe("El monto tiene que ser un número entero de pesos.");
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("un monto entero sin separadores llega al servicio como número", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.register.mockResolvedValueOnce({ paymentId: 1, receiptId: 1, number: "2026-00001", periods: [], amount: 2500, pdfWritten: true });
    const form = new FormData();
    form.append("memberId", "1");
    form.append("concept", "voluntary");
    form.append("amount", "2500");
    await registerCashPaymentAction({}, form);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ amount: 2500 }));
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
