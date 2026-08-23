import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mp/webhook-processor", () => ({ webhookProcessor: {} }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: {} }));
vi.mock("@/lib/config", () => ({ configReader: {}, CONFIG_KEYS: { mpPlanActiveId: "mp_plan_active_id", mpPlanSharedId: "mp_plan_shared_id" } }));
import { makeReconcile, RECONCILE_WINDOW_MS } from "@/lib/mp/reconcile";

const NOW = new Date("2026-09-11T06:00:00Z");
const pay = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, status: "approved", statusDetail: null, transactionAmount: 6000, externalReference: null, dateApproved: NOW, payerEmail: null, description: null, ...over });

type Sub = { preapprovalId: string; memberId: number | null; status: string; amount: string | null; externalReference: string | null; member: { category: string } | null };

function deps(over: Partial<{
  payments: ReturnType<typeof pay>[]; localIds: string[]; inboxIds: string[]; subs: Sub[];
  authorized: Array<{ id: string; preapprovalId: string; status: string; paymentId: string | null }>;
  remote: Record<string, { status: string; amount: number | null; payerEmail: string | null; externalReference: string | null }>;
  preapprovals: Array<{ id: string; status: string; externalReference: string | null; amount: number | null; payerEmail: string | null }>;
  applications: Record<number, { id: number; status: string }>;
  planIds: { active: string | null; shared: string | null }; plans: Record<string, number>;
}> = {}) {
  const localIds = new Set(over.localIds ?? []);
  const inboxIds = new Set(over.inboxIds ?? []);
  const subs = over.subs ?? [];
  const db = {
    payment: { findUnique: vi.fn(async ({ where }: { where: { mpPaymentId: string } }) => (localIds.has(where.mpPaymentId) ? { id: 1 } : null)) },
    mpUnmatchedPayment: { findUnique: vi.fn(async ({ where }: { where: { mpPaymentId: string } }) => (inboxIds.has(where.mpPaymentId) ? { id: 1 } : null)) },
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
  const processor = { applyPayment: vi.fn(async () => "debit_applied") };
  const feeValues = { current: vi.fn(async () => ({ activeAmount: 6000, sharedAmount: 3000 })) };
  const config = { getString: vi.fn(async (k: string) => (k === "mp_plan_active_id" ? over.planIds?.active ?? null : over.planIds?.shared ?? null)) };
  const r = makeReconcile({ db: db as never, gateway: gateway as never, processor, feeValues: feeValues as never, config, now: () => NOW });
  return { r, db, gateway, processor };
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
    expect(d.processor.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), null);
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
    expect(d.processor.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "777" }), "pre-1");
    expect(s.debitsRecovered).toBe(1);
  });
  it("paso 2 no repite un cobro que ya tiene Payment local", async () => {
    const d = deps({ localIds: ["777"], subs: [liveSub("pre-1", 14)], authorized: [{ id: "a1", preapprovalId: "pre-1", status: "processed", paymentId: "777" }] });
    await d.r.run();
    expect(d.processor.applyPayment).not.toHaveBeenCalled();
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
      applications: { 1: { id: 1, status: "pending_payment" }, 2: { id: 2, status: "expired" } },
    });
    const s = await d.r.run();
    expect(d.db.mpSubscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({ preapprovalId: "p-live", applicationId: 1, status: "authorized", amount: "6000.00", externalReference: "solicitud:1", planId: null }) });
    expect(d.gateway.cancelPreapproval).toHaveBeenCalledWith("p-exp");
    expect(s).toMatchObject({ orphanCreated: 1, orphanCancelled: 1, orphanPreapprovals: 2 });
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
});
