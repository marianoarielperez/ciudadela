import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  // `BigInt(7)` y no `7n`: el target del proyecto es ES2017.
  create: vi.fn(async () => ({ id: BigInt(7) })),
  update: vi.fn(async () => ({})),
  run: vi.fn(),
  audit: vi.fn(async () => {}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { cronRun: { create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/applications/cron", async (orig) => ({
  ...(await orig<typeof import("@/lib/applications/cron")>()),
  applicationsCron: { run: mocks.run },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
import { POST } from "@/app/api/cron/applications/route";

const req = (auth?: string) =>
  new Request("http://x/api/cron/applications", { method: "POST", headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  mocks.run.mockResolvedValue({ reminded: 2, expired: 1, errors: 0 });
});

describe("POST /api/cron/applications", () => {
  it("sin CRON_SECRET → 503 y no abre corrida", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req("Bearer x"))).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("bearer incorrecto → 401 y no abre corrida", async () => {
    expect((await POST(req("Bearer nope"))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("corrida limpia → 200, CronRun abierto y cerrado con ok:true", async () => {
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({ data: { job: "applications", startedAt: expect.any(Date) } });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: BigInt(7) },
      data: { finishedAt: expect.any(Date), ok: true, summary: { reminded: 2, expired: 1, errors: 0 } },
    });
  });
  it("con errores por ítem → 207 y ok:false (la corrida terminó, pero algo no salió)", async () => {
    mocks.run.mockResolvedValue({ reminded: 1, expired: 0, errors: 3 });
    expect((await POST(req("Bearer s3cret"))).status).toBe(207);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ok: false }) }));
  });
  it("la corrida se cae entera → 500, CronRun con error y el parcial asentado", async () => {
    mocks.run.mockRejectedValue(new Error("db down"));
    expect((await POST(req("Bearer s3cret"))).status).toBe(500);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: false, error: expect.stringContaining("db down") }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "applications_cron" }));
  });
});
