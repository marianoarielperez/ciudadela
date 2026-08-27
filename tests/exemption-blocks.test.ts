// EXENCIÓN DE CUOTA (Art. 7 inc. a.4): los cortes del OPERADOR.
//
// Un eximido no paga cuota, y "no entra ni un peso" rige desde que la Comisión
// lo decidió (spec §3.1), no desde el primer mes eximido. Los tres caminos por
// los que el operador puede cobrarle —efectivo de mostrador, generar un link de
// pago y reenviar por email uno ya generado— tienen que cortar ANTES de tocar el
// núcleo de tesorería, Mercado Pago o el mailer.
//
// Lo que se fija acá:
//
//   - **La defensa en profundidad.** Las pantallas ya avisan y esconden el
//     formulario, pero una pantalla se saltea escribiendo la URL o rearmando el
//     POST: la guarda va TAMBIÉN en la action. Sin ella el cobro se registraba,
//     se emitía recibo numerado y la plata quedaba adentro contra un acta que la
//     perdona — deshacerlo es anular un recibo de la serie.
//   - **Que la fuente sea `activeExemption`.** El `where` no se reimplementa en
//     ninguna action: se verifica que la consulta lleve `revokedAt: null` y el
//     `toPeriod: { gte }`, porque una anulada o una vencida NO tienen que
//     bloquear a nadie.
//   - **El mensaje compartido.** `adminExemptionNotice` es una sola definición
//     para las cinco bocas: si divergieran, la pantalla diría un mes y el
//     servidor otro.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActor } from "@/lib/auth/require-admin";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  sendReceiptEmail: vi.fn(),
  create: vi.fn(),
  sendToMember: vi.fn(),
  audit: vi.fn(async () => {}),
  findUnique: vi.fn(),
  feeCount: vi.fn(async () => 0),
  exemptionFindFirst: vi.fn(
    async () =>
      null as null | {
        id: number;
        toPeriod: string;
        minuteId: number;
        minute: { type: "board" | "assembly"; number: number };
      },
  ),
  admin: vi.fn(async (): Promise<AdminActor> => ({ ok: true, actorId: 9 })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUnique: mocks.findUnique },
    fee: { count: mocks.feeCount },
    feeExemption: { findFirst: mocks.exemptionFindFirst },
  },
}));
vi.mock("@/lib/treasury/service", () => ({
  treasuryService: { registerCashPayment: mocks.register },
  TreasuryError: class extends Error {},
}));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: mocks.sendReceiptEmail }));
vi.mock("@/lib/mp/payment-link", async () => {
  const real = await vi.importActual<typeof import("@/lib/mp/payment-link")>("@/lib/mp/payment-link");
  return { PAYMENT_LINK_ERRORS: real.PAYMENT_LINK_ERRORS, paymentLinks: { create: mocks.create } };
});
vi.mock("@/lib/email", () => ({ mailer: { sendToMember: mocks.sendToMember } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

// El sello del reenvío se firma con AUTH_SECRET (igual que en
// `payment-link-actions-auth.test.ts`): se fija acá, no en la config global.
process.env.AUTH_SECRET = "test-auth-secret";

import { redirect } from "next/navigation";
import { registerCashPaymentAction } from "@/app/admin/tesoreria/efectivo/actions";
import { createPaymentLinkAction, emailPaymentLinkAction } from "@/app/admin/socios/[id]/link/actions";
import { sealPaymentLink } from "@/lib/mp/payment-link-seal";
import { adminExemptionNotice } from "@/lib/treasury/exemptions";

// El acta se nombra por TIPO y NÚMERO, que es su referencia en el libro: el
// `id` de la fila (12) y el número del acta (124) son numeraciones
// independientes, y el mensaje viejo —"acta N° 12"— apuntaba a un documento
// distinto del que respalda la exención.
const EXEMPT = { id: 3, toPeriod: "2027-08", minuteId: 12, minute: { type: "board" as const, number: 124 } };
const NOTICE = "El socio está eximido de la cuota hasta agosto 2027 (acta Comisión Directiva N° 124).";
const MP_URL = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=abc";
const EXPIRES = new Date("2026-08-26T15:00:00.000Z");

function cashForm() {
  const f = new FormData();
  f.append("memberId", "14");
  f.append("concept", "fees");
  f.append("count", "2");
  return f;
}

function linkForm() {
  const f = new FormData();
  f.append("memberId", "14");
  f.append("n", "2");
  return f;
}

function resendForm() {
  const f = new FormData();
  f.append("memberId", "14");
  f.append("url", MP_URL);
  f.append("n", "2");
  f.append("amount", "12000");
  f.append("expiresAt", EXPIRES.toISOString());
  f.append("seal", sealPaymentLink({ memberId: 14, n: 2, amount: 12000, url: MP_URL }));
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ ok: true, actorId: 9 });
  mocks.exemptionFindFirst.mockResolvedValue(null);
  mocks.feeCount.mockResolvedValue(0);
});

describe("el mensaje compartido", () => {
  it("es UNA sola definición y nombra el mes y el acta POR SU REFERENCIA", () => {
    expect(adminExemptionNotice(EXEMPT)).toBe(NOTICE);
    // El `id` de la fila NO se muestra: "acta N° 12" es una referencia falsa —
    // hay un acta N° 12 en el libro y no es ésta—, y el operador que no está de
    // acuerdo con el bloqueo la usa justamente para ir a buscar la decisión.
    expect(adminExemptionNotice(EXEMPT)).not.toContain(`acta N° ${EXEMPT.minuteId}`);
  });
});

describe("registerCashPaymentAction con exención vigente", () => {
  it("no llega a tesorería, no audita y no redirige a ningún recibo", async () => {
    mocks.exemptionFindFirst.mockResolvedValueOnce(EXEMPT);
    const r = await registerCashPaymentAction({}, cashForm());
    expect(r.error).toBe(NOTICE);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(mocks.sendReceiptEmail).not.toHaveBeenCalled();
  });

  it("consulta la exención con el `where` compartido: ni anuladas ni vencidas bloquean", async () => {
    mocks.exemptionFindFirst.mockResolvedValueOnce(EXEMPT);
    await registerCashPaymentAction({}, cashForm());
    expect(mocks.exemptionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memberId: 14,
          revokedAt: null,
          toPeriod: expect.objectContaining({ gte: expect.any(String) }),
        }),
      }),
    );
  });

  it("tampoco se le cobra un aporte voluntario: la plata no entra por ninguna boca", async () => {
    // Decisión 8: "no entra ni un peso". La guarda no mira el concepto — un
    // aporte de mostrador a nombre del eximido es exactamente lo que el acta
    // reemplaza (el aporte del Art. 7 consta en el acta, no en tesorería).
    mocks.exemptionFindFirst.mockResolvedValueOnce(EXEMPT);
    const f = new FormData();
    f.append("memberId", "14");
    f.append("concept", "voluntary");
    f.append("amount", "5000");
    const r = await registerCashPaymentAction({}, f);
    expect(r.error).toBe(NOTICE);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("sin exención el cobro sigue andando igual que siempre", async () => {
    mocks.register.mockResolvedValueOnce({
      paymentId: 3, receiptId: 7, number: "2026-00007",
      periods: ["2026-09", "2026-10"], amount: 12000, pdfWritten: true,
    });
    await registerCashPaymentAction({}, cashForm());
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 14, concept: "fees", count: 2 }),
    );
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/recibos/7?emitido=1&email=skipped");
  });
});

describe("createPaymentLinkAction con exención vigente", () => {
  it("no le pide la preferencia a Mercado Pago ni audita", async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: 14, category: "active", status: "active" });
    mocks.exemptionFindFirst.mockResolvedValueOnce(EXEMPT);
    const r = await createPaymentLinkAction({}, linkForm());
    expect(r.error).toBe(NOTICE);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("sin exención el link se genera igual que siempre", async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: 14, category: "active", status: "active" });
    mocks.create.mockResolvedValueOnce({
      ok: true, initPoint: MP_URL, amount: 12000, unit: 6000, reference: "pago:14:2", expiresAt: EXPIRES,
    });
    const r = await createPaymentLinkAction({}, linkForm());
    expect(r.error).toBeUndefined();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});

describe("emailPaymentLinkAction con exención vigente", () => {
  it("un link generado ANTES de la exención ya no se reenvía", async () => {
    // El corte del reenvío no es simetría decorativa: el link vive 72 h y la
    // Comisión puede asentar la exención en el medio. Sin esta guarda, el
    // operador le manda por email un enlace de cobro a alguien a quien la
    // pantalla le está diciendo que no se le cobra.
    mocks.findUnique.mockResolvedValueOnce({
      id: 14, fullName: "Juan Pérez", email: "juan@example.com", emailStatus: "verified",
    });
    mocks.exemptionFindFirst.mockResolvedValueOnce(EXEMPT);
    const r = await emailPaymentLinkAction({}, resendForm());
    expect(r.error).toBe(NOTICE);
    expect(mocks.sendToMember).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("a un eximido SIN email el motivo que se lee es la exención, no la casilla", async () => {
    // El orden de las dos guardas es el mensaje: "no tiene un email válido"
    // manda al operador a cargarle la casilla para poder mandarle un cobro que
    // no corresponde. Lo que hay que decirle es que está eximido.
    mocks.findUnique.mockResolvedValueOnce({
      id: 14, fullName: "Juan Pérez", email: null, emailStatus: "none",
    });
    mocks.exemptionFindFirst.mockResolvedValueOnce(EXEMPT);
    const r = await emailPaymentLinkAction({}, resendForm());
    expect(r.error).toBe(NOTICE);
    expect(mocks.sendToMember).not.toHaveBeenCalled();
  });

  it("sin exención el reenvío sigue saliendo", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      id: 14, fullName: "Juan Pérez", email: "juan@example.com", emailStatus: "verified",
    });
    mocks.sendToMember.mockResolvedValueOnce({ messageId: "m1" });
    const r = await emailPaymentLinkAction({}, resendForm());
    expect(r.emailed).toBe(true);
    expect(mocks.sendToMember).toHaveBeenCalledTimes(1);
  });
});
