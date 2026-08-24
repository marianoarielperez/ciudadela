import { beforeEach, describe, expect, it, vi } from "vitest";

// `linkSubscriptionAction` es un endpoint despachado por el id del encabezado
// `Next-Action`, así que el proxy de /admin no la cubre y se autoriza sola. Y
// no alcanza con "es admin": lo que se autoriza acá es un cobro que después se
// repite solo sobre la tarjeta de un vecino, así que es superadmin.
const requireSuperadmin = vi.hoisted(() => vi.fn());
const link = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/require-admin", () => ({
  requireSuperadmin,
  SUPERADMIN_BLOCKED_MESSAGE: "Solo el superadmin puede cambiar la configuración.",
}));
vi.mock("@/lib/mp/link-subscription", () => ({ subscriptionLinker: { link } }));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { SUPERADMIN_BLOCKED_MESSAGE } from "@/lib/auth/require-admin";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";
import { linkSubscriptionAction } from "@/app/admin/tesoreria/suscripciones/[preapprovalId]/vincular/actions";

const PRE = "a69d4b7c9e65472bb46c0489897880af";

function form(over: Partial<Record<"preapprovalId" | "memberId" | "confirmToken", string>> = {}) {
  const fd = new FormData();
  const values = { preapprovalId: PRE, memberId: "14", confirmToken: `${PRE}|14`, ...over };
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperadmin.mockResolvedValue({ ok: true, actorId: 3 });
  link.mockResolvedValue({ ok: true, applied: [{ paymentId: 8, receiptId: 9 }], unapplied: 0, amount: 6000, status: "authorized", autoDebit: true });
});

describe("linkSubscriptionAction", () => {
  it("un admin común no vincula: ni link, ni asiento, ni redirect", async () => {
    requireSuperadmin.mockResolvedValue({ ok: false, reason: "not_admin", error: SUPERADMIN_BLOCKED_MESSAGE });
    expect(await linkSubscriptionAction({}, form())).toEqual({ error: SUPERADMIN_BLOCKED_MESSAGE });
    expect(link).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("superadmin con un token que no coincide: se vuelve a pedir, sin vincular", async () => {
    const result = await linkSubscriptionAction({}, form({ confirmToken: `${PRE}|306` }));
    expect(result.error).toBe(
      "Lo que confirmaste no coincide con lo que se iba a vincular. Volvé a leer y confirmá de nuevo.",
    );
    expect(link).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("superadmin: vincula, asienta sin datos personales y redirige con el resultado", async () => {
    await linkSubscriptionAction({}, form());
    expect(link).toHaveBeenCalledWith({ preapprovalId: PRE, memberId: 14, actorId: 3 });
    const entry = vi.mocked(audit).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 3, action: "subscription_linked", entity: "mp_subscription", entityId: PRE,
      detail: { preapprovalId: PRE, memberId: 14, amount: 6000, status: "authorized", autoDebit: true, applied: [8], unapplied: 0, emailed: 1, deferred: 0 },
    });
    // Ni el nombre del socio, ni el email del pagador, ni la descripción de la
    // suscripción: el asiento lleva ids, montos y estados (Ley 25.326).
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toMatch(/@/);
    expect(serialized.toLowerCase()).not.toContain("perez");
    expect(redirect).toHaveBeenCalledWith(
      `/admin/tesoreria/suscripciones?vinculada=${PRE}&aplicados=1&pendientes=0&diferidos=0`,
    );
  });

  // Vincular una suscripción vieja recupera de golpe todos los cobros
  // históricos de UNA persona: el 23/08/2026 fueron 24 recibos en minutos.
  it("con el tope alcanzado, los recibos que sobran no se mandan y el resultado lo dice", async () => {
    process.env.MAIL_BATCH_CAP = "1";
    try {
      link.mockResolvedValue({
        ok: true, applied: [{ paymentId: 8, receiptId: 9 }, { paymentId: 10, receiptId: 11 }, { paymentId: 12, receiptId: 13 }],
        unapplied: 0, amount: 6000, status: "authorized", autoDebit: true,
      });
      await linkSubscriptionAction({}, form());
      // El tope es de CORREOS: los tres cobros ya los aplicó el vinculador y el
      // asiento los sigue listando enteros.
      expect(sendReceiptEmail).toHaveBeenCalledTimes(1);
      expect(vi.mocked(audit).mock.calls[0][0]).toMatchObject({
        detail: expect.objectContaining({ applied: [8, 10, 12], emailed: 1, deferred: 2 }),
      });
      expect(redirect).toHaveBeenCalledWith(
        `/admin/tesoreria/suscripciones?vinculada=${PRE}&aplicados=3&pendientes=0&diferidos=2`,
      );
    } finally {
      delete process.env.MAIL_BATCH_CAP;
    }
  });

  // Mismo lote, pero el socio no tiene casilla: sin correo no se gasta cupo, o
  // el tope mordería por la razón equivocada (37 emails sobre 278 socios).
  it("los recibos de un socio sin casilla no consumen el tope", async () => {
    process.env.MAIL_BATCH_CAP = "1";
    try {
      vi.mocked(sendReceiptEmail).mockResolvedValue({ sent: false, reason: "no_email" });
      link.mockResolvedValue({
        ok: true, applied: [{ paymentId: 8, receiptId: 9 }, { paymentId: 10, receiptId: 11 }, { paymentId: 12, receiptId: 13 }],
        unapplied: 0, amount: 6000, status: "authorized", autoDebit: true,
      });
      await linkSubscriptionAction({}, form());
      expect(sendReceiptEmail).toHaveBeenCalledTimes(3);
      expect(vi.mocked(audit).mock.calls[0][0]).toMatchObject({
        detail: expect.objectContaining({ emailed: 0, deferred: 0 }),
      });
    } finally {
      delete process.env.MAIL_BATCH_CAP;
      vi.mocked(sendReceiptEmail).mockResolvedValue({ sent: true });
    }
  });

  it("un rechazo del vinculador se muestra tal cual y no se asienta nada", async () => {
    link.mockResolvedValue({ ok: false, error: "Esa suscripción ya está vinculada." });
    expect(await linkSubscriptionAction({}, form())).toEqual({ error: "Esa suscripción ya está vinculada." });
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  // El SDK de Mercado Pago NO lanza `Error`: hace `throw await response.json()`,
  // y ese cuerpo puede arrastrar el `payer_email` del vecino. Un `console.error`
  // crudo lo dejaba entero en el log de PM2 (Ley 25.326).
  it("un fallo de Mercado Pago no deja el email del vecino en el log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    link.mockRejectedValue({
      status: 400, message: "payer_email is invalid: vecino@ejemplo.com",
      error: "bad_request", cause: [{ code: "2034", description: "payer_email vecino@ejemplo.com" }],
    });
    expect(await linkSubscriptionAction({}, form())).toEqual({
      error: "No pudimos vincular la suscripción. Reintentá en un momento.",
    });
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("vecino@ejemplo.com");
    expect(logged).toContain("[email]");
    // Y lo que SÍ sirve para diagnosticar sigue estando.
    expect(logged).toContain("mp:linkSubscription");
    expect(logged).toContain("status=400");
    expect(logged).toContain(PRE);
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("un id de suscripción con forma rara no llega a Mercado Pago", async () => {
    const result = await linkSubscriptionAction({}, form({ preapprovalId: "../../etc/passwd", confirmToken: "../../etc/passwd|14" }));
    expect(result.error).toBe("Suscripción inválida.");
    expect(link).not.toHaveBeenCalled();
  });
});
