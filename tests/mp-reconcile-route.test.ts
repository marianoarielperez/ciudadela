import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  // `BigInt(7)` y no `7n`: el target del proyecto es ES2017 y el literal no
  // compila (misma convención que `tests/mp-webhook-route.test.ts`).
  create: vi.fn(async () => ({ id: BigInt(7) })),
  update: vi.fn(async () => ({})),
  run: vi.fn(),
  audit: vi.fn(async () => {}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { cronRun: { create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/mp/reconcile", () => ({ reconcile: { run: mocks.run } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
import { POST } from "@/app/api/cron/reconcile/route";

const summary = { paymentsRecovered: 1, paymentsInbox: 0, paymentsSkipped: 0, debitsRecovered: 0, debitsInbox: 0, debitsSkipped: 0, subscriptionsSynced: 2, subscriptionsDrifted: 0, orphanCreated: 0, orphanCancelled: 0, orphanPreapprovals: 0, amountDivergent: 0, planDivergent: 0, deferred: 0, errors: [] as string[], errorsOmitted: 0 };
const req = (auth?: string) => new Request("http://x/api/cron/reconcile", { method: "POST", headers: auth ? { authorization: auth } : {} });

beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = "s3cret"; mocks.run.mockResolvedValue(summary); });

describe("POST /api/cron/reconcile", () => {
  it("sin CRON_SECRET → 503", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req("Bearer x"))).status).toBe(503);
  });
  it("bearer incorrecto → 401 y no abre corrida", async () => {
    expect((await POST(req("Bearer nope"))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("ok → 200, CronRun abierto y cerrado con summary, asiento reconcile_cron", async () => {
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(summary);
    expect(mocks.create).toHaveBeenCalledWith({ data: { job: "reconcile", startedAt: expect.any(Date) } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: BigInt(7) }, data: { finishedAt: expect.any(Date), ok: true, summary } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "reconcile_cron", detail: summary }));
  });
  it("con errores → 207 y ok:false", async () => {
    mocks.run.mockResolvedValue({ ...summary, errors: ["payments:boom"] });
    expect((await POST(req("Bearer s3cret"))).status).toBe(207);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ok: false }) }));
  });
  it("run() lanza → 500 y el CronRun queda con error", async () => {
    mocks.run.mockRejectedValue(new Error("db down"));
    expect((await POST(req("Bearer s3cret"))).status).toBe(500);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ok: false, error: expect.stringContaining("db down") }) }));
  });
});
