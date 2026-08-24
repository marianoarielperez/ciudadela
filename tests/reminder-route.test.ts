import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  // `BigInt(11)` y no `11n`: el target del proyecto es ES2017.
  create: vi.fn(async () => ({ id: BigInt(11) })),
  update: vi.fn(async () => ({})),
  run: vi.fn(),
  willAct: vi.fn(() => true),
  audit: vi.fn(async () => {}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { cronRun: { create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/treasury/reminder", () => ({ reminderCron: { run: mocks.run, willAct: mocks.willAct } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
import { POST } from "@/app/api/cron/reminder/route";

const summary = {
  period: "2026-09", candidates: 12, sent: 10, alreadyNotified: 0, noEmail: 2, deferred: 0,
  errors: [] as string[], errorsOmitted: 0,
};
const req = (auth?: string) =>
  new Request("http://x/api/cron/reminder", { method: "POST", headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  mocks.willAct.mockReturnValue(true);
  mocks.run.mockResolvedValue(summary);
});

describe("POST /api/cron/reminder", () => {
  it("sin CRON_SECRET → 503", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req("Bearer x"))).status).toBe(503);
  });
  it("bearer incorrecto → 401", async () => {
    expect((await POST(req("Bearer nope"))).status).toBe(401);
  });
  it("un día que no es el último del mes → 200 skipped y NO escribe CronRun", async () => {
    mocks.willAct.mockReturnValue(false);
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "not_last_day" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("el último día → 200, CronRun abierto y cerrado, asiento reminder_cron", async () => {
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({ data: { job: "reminder", startedAt: expect.any(Date) } });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: BigInt(11) },
      data: { finishedAt: expect.any(Date), ok: true, summary },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reminder_cron", entity: "cron", detail: summary }),
    );
  });
  it("con errores → 207 y ok:false", async () => {
    mocks.run.mockResolvedValue({ ...summary, errors: ["member:4: ECONNREFUSED"] });
    expect((await POST(req("Bearer s3cret"))).status).toBe(207);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ok: false }) }));
  });
  it("se cae entera → 500 y el CronRun queda con error", async () => {
    mocks.run.mockRejectedValue(new Error("db down"));
    expect((await POST(req("Bearer s3cret"))).status).toBe(500);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: false, error: expect.stringContaining("db down") }),
    }));
  });
});
