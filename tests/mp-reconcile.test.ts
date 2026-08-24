import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
// `WEBHOOK_RESULTS` y `cents` van REALES: la clasificación de results y la
// comparación en centavos son justamente lo que se está probando. Sólo se
// reemplaza el singleton, que arrastraría media app al importarse.
vi.mock("@/lib/mp/webhook-processor", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  webhookProcessor: {},
}));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: {} }));
vi.mock("@/lib/config", () => ({ configReader: {}, CONFIG_KEYS: { mpPlanActiveId: "mp_plan_active_id", mpPlanSharedId: "mp_plan_shared_id" } }));
import { makeReconcile, RECONCILE_WINDOW_MS, SUBSCRIPTION_PACING_MS } from "@/lib/mp/reconcile";

const NOW = new Date("2026-09-11T06:00:00Z");
const pay = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, status: "approved", statusDetail: null, transactionAmount: 6000, externalReference: null, dateApproved: NOW, payerEmail: null, description: null, ...over });

type Sub = { preapprovalId: string; memberId: number | null; status: string; amount: string | null; externalReference: string | null; member: { category: string } | null };

function deps(over: Partial<{
  payments: ReturnType<typeof pay>[]; localIds: string[]; inboxIds: string[]; inboxStatus: Record<string, "open" | "matched" | "dismissed">; subs: Sub[];
  authorized: Array<{ id: string; preapprovalId: string; status: string; paymentId: string | null }>;
  remote: Record<string, { status: string; amount: number | null; payerEmail: string | null; externalReference: string | null }>;
  preapprovals: Array<{ id: string; status: string; externalReference: string | null; amount: number | null; payerEmail: string | null }>;
  applications: Record<number, { id: number; status: string; memberId?: number | null }>;
  planIds: { active: string | null; shared: string | null }; plans: Record<string, number>;
}> = {}) {
  const localIds = new Set(over.localIds ?? []);
  const inboxIds = new Set(over.inboxIds ?? []);
  const subs = over.subs ?? [];
  const db = {
    payment: { findUnique: vi.fn(async ({ where }: { where: { mpPaymentId: string } }) => (localIds.has(where.mpPaymentId) ? { id: 1 } : null)) },
    // La bandeja devuelve el estado: el paso 1 saltea cualquier fila, el paso 2
    // sólo las resueltas. `inboxIds` sin estado explícito = fila `open`.
    mpUnmatchedPayment: {
      findUnique: vi.fn(async ({ where }: { where: { mpPaymentId: string } }) =>
        inboxIds.has(where.mpPaymentId) ? { id: 1, status: over.inboxStatus?.[where.mpPaymentId] ?? "open" } : null),
    },
    mpSubscription: {
      findMany: vi.fn(async () => subs),
      findUnique: vi.fn(async ({ where }: { where: { preapprovalId: string } }) => subs.find((s) => s.preapprovalId === where.preapprovalId) ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({})),
    },
    application: { findUnique: vi.fn(async ({ where }: { where: { id: number } }) => over.applications?.[where.id] ?? null) },
  };
  const gateway = {
    searchPayments: vi.fn(async () => over.payments ?? []),
    searchAuthorizedPayments: vi.fn(async () => over.authorized ?? []),
    getPayment: vi.fn(async (id: string) => pay(id)),
    getPreapproval: vi.fn(async (id: string) => ({ id, reason: null, nextPaymentDate: null, dateCreated: null, ...(over.remote?.[id] ?? { status: "authorized", amount: 6000, payerEmail: null, externalReference: null }) })),
    searchPreapprovals: vi.fn(async () => (over.preapprovals ?? []).map((p) => ({ reason: null, nextPaymentDate: null, dateCreated: null, ...p }))),
    cancelPreapproval: vi.fn(async () => {}),
    getPlan: vi.fn(async (id: string) => ({ id, reason: "", amount: over.plans?.[id] ?? 6000 })),
  };
  // Tipado con los tres parámetros: sin eso no se puede mockear una
  // implementación que consuma el presupuesto de correos.
  const processor = {
    applyPayment: vi.fn<(p: unknown, pre: string | null, opts?: { mailBudget?: { take(): boolean } }) => Promise<string>>(
      async () => "debit_applied",
    ),
  };
  const feeValues = { current: vi.fn(async () => ({ activeAmount: 6000, sharedAmount: 3000 })) };
  const config = { getString: vi.fn(async (k: string) => (k === "mp_plan_active_id" ? over.planIds?.active ?? null : over.planIds?.shared ?? null)) };
  // La pausa entre suscripciones se INYECTA: los tests no duermen de verdad, y
  // así se puede verificar que el espaciado existe (ver el caso dedicado).
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const r = makeReconcile({ db: db as never, gateway: gateway as never, processor, feeValues: feeValues as never, config, now: () => NOW, sleep });
  return { r, db, gateway, processor, feeValues, config, sleep };
}

const liveSub = (preapprovalId: string, memberId: number): Sub =>
  ({ preapprovalId, memberId, status: "authorized", amount: "6000.00", externalReference: null, member: { category: "active" } });

beforeEach(() => vi.clearAllMocks());

describe("reconcile", () => {
  it("paso 1: pago aprobado sin registro local ni bandeja → applyPayment; los conocidos se saltean", async () => {
    const d = deps({ payments: [pay("1"), pay("2"), pay("3")], localIds: ["2"], inboxIds: ["3"] });
    const s = await d.r.run();
    expect(d.gateway.searchPayments).toHaveBeenCalledWith({ since: new Date(NOW.getTime() - RECONCILE_WINDOW_MS) });
    expect(d.processor.applyPayment).toHaveBeenCalledTimes(1);
    expect(d.processor.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), null, { mailBudget: expect.objectContaining({ take: expect.any(Function) }) });
    expect(s.paymentsRecovered).toBe(1);
  });
  it("paso 2: cobros de cada suscripción viva sin Payment local → getPayment + applyPayment con el preapproval", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14)], authorized: [
      { id: "a1", preapprovalId: "pre-1", status: "processed", paymentId: "777" },
      { id: "a2", preapprovalId: "pre-1", status: "scheduled", paymentId: null },
    ] });
    const s = await d.r.run();
    expect(d.gateway.searchAuthorizedPayments).toHaveBeenCalledWith("pre-1");
    expect(d.gateway.getPayment).toHaveBeenCalledWith("777");
    expect(d.processor.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "777" }), "pre-1", { mailBudget: expect.objectContaining({ take: expect.any(Function) }) });
    expect(s.debitsRecovered).toBe(1);
  });
  it("paso 2 no repite un cobro que ya tiene Payment local", async () => {
    const d = deps({ localIds: ["777"], subs: [liveSub("pre-1", 14)], authorized: [{ id: "a1", preapprovalId: "pre-1", status: "processed", paymentId: "777" }] });
    await d.r.run();
    expect(d.processor.applyPayment).not.toHaveBeenCalled();
  });
  it("paso 3: una `pending` que sigue `pending` NO es deriva: es un alta en vuelo", async () => {
    // Con el criterio anterior (`!== authorized`) cualquier noche con un wizard
    // en curso reportaba deriva, y una solicitud vencida cuyo `cancelPreapproval`
    // falló la reportaba TODAS sin que nada la apagara.
    const d = deps({ subs: [{ ...liveSub("pre-1", 14), status: "pending" }], remote: { "pre-1": { status: "pending", amount: 6000, payerEmail: null, externalReference: null } } });
    const s = await d.r.run();
    expect(s.subscriptionsSynced).toBe(1);
    expect(s.subscriptionsDrifted).toBe(0);
  });
  it("paso 3: una `pending` que pasó a `authorized` tampoco es deriva: es el alta que se completó", async () => {
    const d = deps({ subs: [{ ...liveSub("pre-1", 14), status: "pending" }], remote: { "pre-1": { status: "authorized", amount: 6000, payerEmail: null, externalReference: null } } });
    expect((await d.r.run()).subscriptionsDrifted).toBe(0);
  });
  it("paso 3: una `authorized` que MP pausó SÍ es deriva, y la noche siguiente ya no cuenta", async () => {
    const pausada = { status: "paused", amount: 6000, payerEmail: null, externalReference: null };
    expect((await deps({ subs: [liveSub("pre-1", 14)], remote: { "pre-1": pausada } }).r.run()).subscriptionsDrifted).toBe(1);
    // Ya sincronizada: el estado local coincide con MP y el contador vuelve a cero.
    const yaSincronizada = deps({ subs: [{ ...liveSub("pre-1", 14), status: "paused" }], remote: { "pre-1": pausada } });
    expect((await yaSincronizada.r.run()).subscriptionsDrifted).toBe(0);
  });
  it("paso 3: sincroniza estado y monto; cancelada en MP → subscriptionsDrifted", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14)], remote: { "pre-1": { status: "cancelled", amount: 6000, payerEmail: null, externalReference: null } } });
    const s = await d.r.run();
    expect(d.db.mpSubscription.updateMany).toHaveBeenCalledWith({
      where: { preapprovalId: "pre-1" },
      data: { status: "cancelled", amount: "6000.00", payerEmail: null, externalReference: null, lastSyncAt: NOW },
    });
    expect(s.subscriptionsDrifted).toBe(1);
    expect(s.subscriptionsSynced).toBe(1);
  });
  it("paso 4: preapproval solicitud:{id} sin fila local → crea si la solicitud vive; cancela si expiró; huérfana si no existe o no tiene referencia", async () => {
    const d = deps({
      preapprovals: [
        { id: "p-live", status: "authorized", externalReference: "solicitud:1", amount: 6000, payerEmail: "a@b.com" },
        { id: "p-exp", status: "pending", externalReference: "solicitud:2", amount: 6000, payerEmail: null },
        { id: "p-gone", status: "authorized", externalReference: "solicitud:3", amount: 6000, payerEmail: null },
        { id: "p-manual", status: "authorized", externalReference: null, amount: 6000, payerEmail: null },
      ],
      applications: { 1: { id: 1, status: "pending_payment", memberId: null }, 2: { id: 2, status: "expired" } },
    });
    const s = await d.r.run();
    expect(d.db.mpSubscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({ preapprovalId: "p-live", applicationId: 1, memberId: null, status: "authorized", amount: "6000.00", externalReference: "solicitud:1", planId: null }) });
    expect(d.gateway.cancelPreapproval).toHaveBeenCalledWith("p-exp");
    expect(s).toMatchObject({ orphanCreated: 1, orphanCancelled: 1, orphanPreapprovals: 2 });
  });
  it("una huérfana CANCELADA no se cuenta: la alarma tiene que poder apagarse", async () => {
    const d = deps({ preapprovals: [{ id: "pre-cancelada", status: "cancelled", externalReference: null, amount: null, payerEmail: null }] });
    const s = await d.r.run();
    expect(s.orphanPreapprovals).toBe(0);
    expect(d.gateway.cancelPreapproval).not.toHaveBeenCalled();
  });
  it("las `pending` también se sincronizan: sin esto, una que autorizó sin webhook queda muerta para siempre", async () => {
    const d = deps();
    await d.r.run();
    expect(d.db.mpSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ["authorized", "pending", "paused"] } },
    }));
  });
  it("paso 5: divergencia de monto contra feeAmountFor y de planes contra fee_values", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14)], remote: { "pre-1": { status: "authorized", amount: 5000, payerEmail: null, externalReference: null } },
      planIds: { active: "plan-a", shared: "plan-s" }, plans: { "plan-a": 6000, "plan-s": 2500 } });
    const s = await d.r.run();
    expect(s.amountDivergent).toBe(1);
    expect(s.planDivergent).toBe(1);
  });
  it("sin ids de plan, el chequeo de planes no corre", async () => {
    const d = deps();
    const s = await d.r.run();
    expect(d.gateway.getPlan).not.toHaveBeenCalled();
    expect(s.planDivergent).toBe(0);
  });
  it("un paso que explota se cuenta en errors y los demás corren igual", async () => {
    const d = deps({ payments: [pay("1")] });
    d.gateway.searchPayments.mockRejectedValue({ message: "boom", status: 500 });
    const s = await d.r.run();
    expect(s.errors).toEqual([expect.stringMatching(/^payments:/)]);
    expect(d.gateway.searchPreapprovals).toHaveBeenCalled();
  });
  it("un cobro que falla al aplicarse no frena la suscripción siguiente", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14), liveSub("pre-2", 15)], authorized: [{ id: "a1", preapprovalId: "x", status: "processed", paymentId: "777" }] });
    d.processor.applyPayment.mockRejectedValueOnce(new Error("db"));
    const s = await d.r.run();
    expect(d.gateway.searchAuthorizedPayments).toHaveBeenCalledTimes(2);
    expect(s.errors).toHaveLength(1);
    expect(s.debitsRecovered).toBe(1);
  });

  // ── Hallazgos de la revisión ─────────────────────────────────────────────
  it("errors[] conserva la CAUSA del fallo (status/code/message), no sólo el paso y los ids", async () => {
    const d = deps({ subs: [liveSub("pre-0123456789abcdef0123456789abcdef", 14)], authorized: [{ id: "a1", preapprovalId: "x", status: "processed", paymentId: "777" }] });
    d.gateway.getPayment.mockRejectedValue({ status: 403, error: "forbidden", message: "no tiene permisos sobre este recurso" });
    const s = await d.r.run();
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain("status=403");
    expect(s.errors[0]).toContain("code=forbidden");
    expect(s.errors[0]).toContain("no tiene permisos sobre este recurso");
  });

  it("errors[] no arrastra el email del pagador que venga en el mensaje de MP", async () => {
    const d = deps({ payments: [pay("1")] });
    d.processor.applyPayment.mockRejectedValue({ status: 400, message: "payer_email is invalid: juan@example.com" });
    const s = await d.r.run();
    expect(s.errors[0]).not.toContain("juan@example.com");
  });

  // El caso para el que existe la red: el `payment` de una suscripción creada a
  // mano llega sin referencia, cae a la bandeja como `no_reference` y el segundo
  // evento (el que traía el preapproval) se pierde. El paso 2 llega con ese
  // preapproval y es lo único que puede resolverla.
  it("paso 2 APLICA un cobro cuya fila de bandeja sigue abierta, con el preapproval de la suscripción", async () => {
    const d = deps({ inboxIds: ["777"], inboxStatus: { "777": "open" }, subs: [liveSub("pre-1", 14)], authorized: [{ id: "a1", preapprovalId: "pre-1", status: "processed", paymentId: "777" }] });
    const s = await d.r.run();
    expect(d.gateway.getPayment).toHaveBeenCalledWith("777");
    expect(d.processor.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "777" }), "pre-1", { mailBudget: expect.objectContaining({ take: expect.any(Function) }) });
    expect(s.debitsRecovered).toBe(1);
  });

  it("paso 2 saltea un cobro cuya fila la descartó el operador (dismissed): es una decisión tomada", async () => {
    const d = deps({ inboxIds: ["777"], inboxStatus: { "777": "dismissed" }, subs: [liveSub("pre-1", 14)], authorized: [{ id: "a1", preapprovalId: "pre-1", status: "processed", paymentId: "777" }] });
    const s = await d.r.run();
    expect(d.gateway.getPayment).not.toHaveBeenCalled();
    expect(d.processor.applyPayment).not.toHaveBeenCalled();
    expect(s.debitsRecovered).toBe(0);
  });

  it("paso 2 saltea un cobro cuya fila ya se resolvió (matched)", async () => {
    const d = deps({ inboxIds: ["777"], inboxStatus: { "777": "matched" }, subs: [liveSub("pre-1", 14)], authorized: [{ id: "a1", preapprovalId: "pre-1", status: "processed", paymentId: "777" }] });
    const s = await d.r.run();
    expect(d.gateway.getPayment).not.toHaveBeenCalled();
    expect(d.processor.applyPayment).not.toHaveBeenCalled();
    expect(s.debitsRecovered).toBe(0);
  });

  it("paso 1, en cambio, saltea cualquier fila de la bandeja: ahí el cron no sabe más que el webhook", async () => {
    const d = deps({ payments: [pay("1")], inboxIds: ["1"], inboxStatus: { "1": "open" } });
    const s = await d.r.run();
    expect(d.processor.applyPayment).not.toHaveBeenCalled();
    expect(s.paymentsRecovered).toBe(0);
  });

  it("lo que va a la bandeja o ya estaba procesado NO cuenta como recuperado", async () => {
    const d = deps({ payments: [pay("1"), pay("2"), pay("3")], subs: [liveSub("pre-1", 14)],
      authorized: [{ id: "a1", preapprovalId: "pre-1", status: "processed", paymentId: "777" }] });
    d.processor.applyPayment
      .mockResolvedValueOnce("unmatched_withdrawn_no_pending")
      .mockResolvedValueOnce("already_processed")
      .mockResolvedValueOnce("link_applied")
      .mockResolvedValueOnce("unmatched_treasury_rejected");
    const s = await d.r.run();
    expect(s).toMatchObject({
      paymentsRecovered: 1, paymentsInbox: 1, paymentsSkipped: 1,
      debitsRecovered: 0, debitsInbox: 1, debitsSkipped: 0,
    });
    expect(s.errors).toEqual([]);
  });

  it("el fallo al leer fee_values deja su entrada en errors y no simula 'sin divergencias'", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14)], planIds: { active: "plan-a", shared: null } });
    d.feeValues.current.mockRejectedValue(new Error("db down"));
    const s = await d.r.run();
    expect(s.errors).toEqual([expect.stringMatching(/^feeValue: /)]);
    expect(s.errors[0]).toContain("db down");
    expect(d.gateway.getPlan).not.toHaveBeenCalled();
    // Los pasos que no dependen del valor corren igual.
    expect(s.subscriptionsSynced).toBe(1);
    expect(d.gateway.searchPreapprovals).toHaveBeenCalled();
  });

  it("un plan que explota no impide chequear el otro", async () => {
    const d = deps({ planIds: { active: "plan-a", shared: "plan-s" }, plans: { "plan-s": 2500 } });
    d.gateway.getPlan.mockRejectedValueOnce({ status: 404, message: "plan not found" });
    const s = await d.r.run();
    expect(d.gateway.getPlan).toHaveBeenCalledTimes(2);
    expect(s.planDivergent).toBe(1);
    expect(s.errors).toEqual([expect.stringMatching(/^plans\.one: /)]);
  });

  it("montos con ruido de float no inventan divergencia (comparación en centavos)", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14)], remote: { "pre-1": { status: "authorized", amount: 6000.000000000001, payerEmail: null, externalReference: null } },
      planIds: { active: "plan-a", shared: null }, plans: { "plan-a": 5999.999999999999 } });
    const s = await d.r.run();
    expect(s.amountDivergent).toBe(0);
    expect(s.planDivergent).toBe(0);
  });

  it("paso 4: la suscripción recreada queda vinculada al socio de la solicitud", async () => {
    const d = deps({
      preapprovals: [{ id: "p-live", status: "authorized", externalReference: "solicitud:9", amount: 6000, payerEmail: null }],
      applications: { 9: { id: 9, status: "completed", memberId: 213 } },
    });
    await d.r.run();
    expect(d.db.mpSubscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({ preapprovalId: "p-live", applicationId: 9, memberId: 213 }) });
  });

  it("un preapproval que explota en el paso 4 no frena a los demás", async () => {
    const d = deps({
      preapprovals: [
        { id: "p-boom", status: "pending", externalReference: "solicitud:2", amount: 6000, payerEmail: null },
        { id: "p-live", status: "authorized", externalReference: "solicitud:1", amount: 6000, payerEmail: null },
      ],
      applications: { 1: { id: 1, status: "pending_payment", memberId: 7 }, 2: { id: 2, status: "expired" } },
    });
    d.gateway.cancelPreapproval.mockRejectedValue({ status: 500, message: "MP caído" });
    const s = await d.r.run();
    expect(s.orphanCreated).toBe(1);
    expect(s.orphanCancelled).toBe(0);
    expect(s.errors).toEqual([expect.stringMatching(/^orphans\.one: /)]);
  });

  it("un fallo en debits y otro en sync dejan correr el paso 4", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14)],
      preapprovals: [{ id: "p-live", status: "authorized", externalReference: "solicitud:1", amount: 6000, payerEmail: null }],
      applications: { 1: { id: 1, status: "pending_payment", memberId: 7 } } });
    d.gateway.searchAuthorizedPayments.mockRejectedValue({ status: 500, message: "search down" });
    d.gateway.getPreapproval.mockRejectedValue({ status: 500, message: "preapproval down" });
    const s = await d.r.run();
    expect(s.errors).toEqual([expect.stringMatching(/^debits: /), expect.stringMatching(/^sync: /)]);
    expect(s.subscriptionsSynced).toBe(0);
    expect(s.orphanCreated).toBe(1);
  });

  it("si falla la consulta de suscripciones queda su error y los pasos independientes corren igual", async () => {
    const d = deps({ payments: [pay("1")],
      preapprovals: [{ id: "p-live", status: "authorized", externalReference: "solicitud:1", amount: 6000, payerEmail: null }],
      applications: { 1: { id: 1, status: "pending_payment", memberId: 7 } } });
    d.db.mpSubscription.findMany.mockRejectedValue(new Error("subs down"));
    const s = await d.r.run();
    expect(s.errors).toEqual([expect.stringMatching(/^subscriptions: /)]);
    expect(s.paymentsRecovered).toBe(1);
    expect(s.orphanCreated).toBe(1);
  });

  it("con el tope alcanzado, los recibos que sobran se cuentan en `deferred`", async () => {
    process.env.MAIL_BATCH_CAP = "1";
    try {
      // Dos débitos recuperables: el procesador consume el presupuesto en el
      // primero y el segundo queda diferido. La plata se asienta en los dos —lo
      // que el tope frena es el AVISO—, así que `debitsRecovered` sigue en 2.
      const d = deps({ subs: [liveSub("pre-1", 14), liveSub("pre-2", 15)], authorized: [{ id: "a1", preapprovalId: "x", status: "processed", paymentId: "777" }] });
      d.processor.applyPayment.mockImplementation(async (_p, _pre, opts) => {
        opts?.mailBudget?.take();
        return "debit_applied";
      });
      const s = await d.r.run();
      expect(d.processor.applyPayment).toHaveBeenCalledTimes(2);
      expect(s.debitsRecovered).toBe(2);
      expect(s.deferred).toBe(1);
    } finally {
      delete process.env.MAIL_BATCH_CAP;
    }
  });

  it("sin llegar al tope, `deferred` queda en cero", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14)], authorized: [{ id: "a1", preapprovalId: "pre-1", status: "processed", paymentId: "777" }] });
    d.processor.applyPayment.mockImplementation(async (_p, _pre, opts) => {
      opts?.mailBudget?.take();
      return "debit_applied";
    });
    expect((await d.r.run()).deferred).toBe(0);
  });

  it("errors[] tiene tope y lo que se pasa se cuenta en errorsOmitted", async () => {
    const d = deps({ payments: Array.from({ length: 60 }, (_, i) => pay(String(i + 1))) });
    d.processor.applyPayment.mockRejectedValue(new Error("base caída"));
    const s = await d.r.run();
    expect(s.errors).toHaveLength(50);
    expect(s.errorsOmitted).toBe(10);
  });
});

// ── Espaciado entre suscripciones (hallazgo de producción, 24/08/2026) ───────
// La primera corrida real terminó con tres pasos caídos por 429: el bucle
// pedía `authorized_payments/search` + `preapproval` de cada suscripción sin
// respirar y MP cortó por ráfaga. El reintento del gateway es la mitad del
// arreglo; la otra mitad es no provocarlo.
describe("reconcile — pausa entre suscripciones", () => {
  const sub = (n: number) => liveSub(`pre-${n}`, n);

  it("espera entre una suscripción y la siguiente, no antes de la primera", async () => {
    const d = deps({ subs: [sub(1), sub(2), sub(3)] });
    await d.r.run();
    // Tres suscripciones, dos pausas: la primera arranca sin demora.
    expect(d.sleep).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledWith(SUBSCRIPTION_PACING_MS);
  });

  it("con una sola suscripción no espera nada", async () => {
    const d = deps({ subs: [sub(1)] });
    await d.r.run();
    expect(d.sleep).not.toHaveBeenCalled();
  });

  it("la pausa va INTERCALADA: no se agrupan todas al principio", async () => {
    const order: string[] = [];
    const d = deps({ subs: [sub(1), sub(2)] });
    d.sleep.mockImplementation(async () => void order.push("sleep"));
    d.gateway.getPreapproval.mockImplementation(async (id: string) => {
      order.push(`sync:${id}`);
      return { id, status: "authorized", amount: 6000, payerEmail: null, externalReference: null, reason: null, nextPaymentDate: null, dateCreated: null };
    });
    await d.r.run();
    expect(order).toEqual(["sync:pre-1", "sleep", "sync:pre-2"]);
  });
});
