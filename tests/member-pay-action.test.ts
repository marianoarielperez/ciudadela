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
  // La guarda de exención (Art. 7 inc. a.4): por defecto "no hay ninguna".
  exemptionFindFirst: vi.fn(async () => null as null | { id: number; toPeriod: string; minuteId: number }),
  member: vi.fn(async (): Promise<MemberActor> => (
    { ok: false, reason: "anonymous", error: "Ingresá a tu cuenta para ver tu panel de socio." }
  )),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUniqueOrThrow: mocks.findUniqueOrThrow },
    feeExemption: { findFirst: mocks.exemptionFindFirst },
  },
}));
vi.mock("@/lib/mp/payment-link", async () => {
  const real = await vi.importActual<typeof import("@/lib/mp/payment-link")>("@/lib/mp/payment-link");
  return { PAYMENT_LINK_ERRORS: real.PAYMENT_LINK_ERRORS, paymentLinks: { create: mocks.create } };
});
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-member", () => ({ requireMember: mocks.member }));
vi.mock("@/lib/auth/rate-limiter", () => ({ memberPayLimiter: { check: mocks.check } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { startMemberPaymentAction } from "@/app/mi/cuenta/actions";

const MP_URL = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=abc";

function form(n = "3", extra?: Record<string, string>) {
  const f = new FormData();
  f.append("n", n);
  for (const [k, v] of Object.entries(extra ?? {})) f.append(k, v);
  return f;
}

function loggedIn() {
  mocks.member.mockResolvedValueOnce({
    ok: true, userId: 42, memberId: 14, fullName: "Juan Pérez", suspension: null,
  });
}

describe("startMemberPaymentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.check.mockReturnValue(true);
    mocks.exemptionFindFirst.mockResolvedValue(null);
  });

  it("con una exención vigente no se crea ninguna preferencia ni queda asiento", async () => {
    // Art. 7 inc. a.4: el socio eximido no tiene cuota que pagar. Que la
    // pantalla esconda "Pagar ahora" no alcanza — una server action no se
    // despacha por su URL, así que la guarda va también acá.
    loggedIn();
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ id: 14, category: "active" });
    mocks.exemptionFindFirst.mockResolvedValueOnce({ id: 3, toPeriod: "2027-08", minuteId: 12 });
    const r = await startMemberPaymentAction({}, form());
    // El HECHO sale del constructor compartido (`memberExemptionFact`, en
    // `debit-adhesion.ts`) y es palabra por palabra el del banner de la cuenta,
    // el de la tarjeta de `/mi` y el del bloqueo del débito; lo propio de esta
    // action es la cola. Antes lo decía con otras palabras ("Tenés una exención
    // de cuota vigente hasta…") y el vecino veía dos frases para un solo hecho.
    expect(r.error).toBe("Estás eximido de la cuota hasta agosto 2027: no hay ninguna cuota que pagar.");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    // El mensaje del SOCIO no nombra el acta: el número de acta es la referencia
    // del operador para buscar la decisión en el libro.
    expect(r.error).not.toContain("acta");
  });

  it("sin socio no crea preferencia ni audita", async () => {
    const r = await startMemberPaymentAction({}, form());
    expect(r.error).toBe("Ingresá a tu cuenta para ver tu panel de socio.");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("un socio suspendido llega en modo lectura y puede pagar (REG-20 amendment)", async () => {
    // Pagar es la única action que el modo lectura le permite (spec M5 §5):
    // saldar deuda lo acerca a la rehabilitación. `requireMember` se lo
    // devuelve `ok: true` con `suspension` cargado, no bloqueado.
    mocks.member.mockResolvedValueOnce({
      ok: true, userId: 42, memberId: 14, fullName: "Juan Pérez",
      suspension: { from: new Date("2026-01-01"), to: null },
    });
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ id: 14, category: "active" });
    mocks.create.mockResolvedValueOnce({ ok: true, initPoint: MP_URL, amount: 18000, unit: 6000, reference: "pago:14:3", expiresAt: new Date("2026-08-26T15:00:00.000Z") });
    const r = await startMemberPaymentAction({}, form());
    expect(r).toEqual({ redirectUrl: MP_URL });
    expect(mocks.create).toHaveBeenCalledWith({ member: { id: 14, category: "active" }, n: 3 });
  });

  it("un socio dado de baja recibe el motivo y no llega a Mercado Pago", async () => {
    // El cesante no llega nunca, ni siquiera en modo lectura (Art. 9).
    mocks.member.mockResolvedValueOnce({
      ok: false, reason: "withdrawn",
      error: "Figurás con baja en el padrón, así que tu panel de socio no está disponible.",
    });
    const r = await startMemberPaymentAction({}, form());
    expect(r.error).toContain("baja");
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
    mocks.create.mockResolvedValueOnce({ ok: true, initPoint: MP_URL, amount: 18000, unit: 6000, reference: "pago:14:3", expiresAt: new Date("2026-08-26T15:00:00.000Z") });
    const r = await startMemberPaymentAction({}, form());
    expect(r).toEqual({ redirectUrl: MP_URL });
    expect(mocks.create).toHaveBeenCalledWith({ member: { id: 14, category: "active" }, n: 3 });
    // Con `ip`, igual que los dos asientos del operador: es el canal donde la
    // identidad es más débil (una sesión de 8 h en un teléfono).
    expect(mocks.audit).toHaveBeenCalledWith({
      userId: 42, ip: "unknown",
      action: "payment_link_create", entity: "member", entityId: 14,
      detail: { memberId: 14, n: 3, amount: 18000, channel: "member" },
    });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("mercadopago");
  });

  it("un memberId colado en el formulario se ignora: el cobro es siempre para el socio de la sesión", async () => {
    loggedIn();
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ id: 14, category: "active" });
    mocks.create.mockResolvedValueOnce({ ok: true, initPoint: MP_URL, amount: 6000, unit: 6000, reference: "pago:14:1", expiresAt: new Date("2026-08-26T15:00:00.000Z") });
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
