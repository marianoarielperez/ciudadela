import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  // `BigInt(11)` y no `11n`: el target del proyecto es ES2017.
  create: vi.fn(async () => ({ id: BigInt(11) })),
  update: vi.fn(async () => ({})),
  run: vi.fn(),
  willAct: vi.fn(() => true),
  audit: vi.fn(async () => {}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { cronRun: { create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/treasury/accrual", () => ({ accrualCron: { run: mocks.run, willAct: mocks.willAct } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
import { POST } from "@/app/api/cron/accrual/route";

const summary = { membersScanned: 35, membersAccrued: 35, feesCreated: 35, backfilled: 0, upTo: "2026-09", errors: [] as string[], errorsOmitted: 0 };
const req = (auth?: string, query = "") =>
  new Request(`http://x/api/cron/accrual${query}`, { method: "POST", headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  mocks.willAct.mockReturnValue(true);
  mocks.run.mockResolvedValue(summary);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/cron/accrual", () => {
  it("sin CRON_SECRET → 503", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req("Bearer x"))).status).toBe(503);
  });
  it("bearer incorrecto → 401", async () => {
    expect((await POST(req("Bearer nope"))).status).toBe(401);
  });
  it("un día que no es 1 → 200 skipped y NO escribe CronRun", async () => {
    mocks.willAct.mockReturnValue(false);
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "not_first_day" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("el día 1 → 200, CronRun abierto y cerrado, asiento accrual_cron", async () => {
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({ data: { job: "accrual", startedAt: expect.any(Date) } });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: BigInt(11) },
      data: { finishedAt: expect.any(Date), ok: true, summary: { ...summary, forced: false } },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "accrual_cron", entity: "cron", detail: { ...summary, forced: false } }),
    );
  });
  it("con errores → 207 y ok:false", async () => {
    mocks.run.mockResolvedValue({ ...summary, errors: ["member:4: deadlock"] });
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

// Escotilla de re-disparo (enmienda del operador, 24/08/2026). La ventana de
// `upTo` se mide contra el reloj, así que estos tests lo fijan: el 15/12/2026 el
// rango válido es 2026-09..2026-11 (piso `IMPORT_COVERAGE_FLOOR`, techo el mes
// vencido).
describe("POST /api/cron/accrual — escotilla de re-disparo", () => {
  const atDecember = () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-12-15T12:00:00Z"));
  };

  it("con force=1 un día que no es 1 → actúa igual y deja CronRun", async () => {
    mocks.willAct.mockReturnValue(false);
    const res = await POST(req("Bearer s3cret", "?force=1"));
    expect(res.status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith({ upTo: undefined });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("la corrida forzada se distingue de la automática en el summary", async () => {
    mocks.willAct.mockReturnValue(false);
    const res = await POST(req("Bearer s3cret", "?force=true"));
    expect(await res.json()).toEqual({ ...summary, forced: true });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ summary: { ...summary, forced: true } }),
    }));
    // El asiento lleva los parámetros usados y ningún dato personal.
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ forced: true, upTo: "2026-09" }) }),
    );
  });

  it("la escotilla no pide una segunda barrera: sin bearer, force=1 sigue siendo 401", async () => {
    expect((await POST(req("Bearer nope", "?force=1"))).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("sin force el comportamiento no cambia: el día 15 sigue sin actuar", async () => {
    mocks.willAct.mockReturnValue(false);
    expect(await (await POST(req("Bearer s3cret"))).json()).toEqual({ skipped: "not_first_day" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("upTo válido llega a run()", async () => {
    atDecember();
    mocks.willAct.mockReturnValue(false);
    expect((await POST(req("Bearer s3cret", "?force=1&upTo=2026-10"))).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith({ upTo: "2026-10" });
  });

  it("upTo con forma inválida → 400 y NO toca la base", async () => {
    atDecember();
    for (const raw of ["2026-13", "2026", "octubre", "2026-9", ""]) {
      vi.clearAllMocks();
      const res = await POST(req("Bearer s3cret", `?force=1&upTo=${encodeURIComponent(raw)}`));
      expect(res.status, raw).toBe(400);
      expect((await res.json()).error, raw).toBe("bad_up_to");
      expect(mocks.create, raw).not.toHaveBeenCalled();
      expect(mocks.run, raw).not.toHaveBeenCalled();
    }
  });

  it("upTo futuro o anterior al piso de cobertura → 400 fuera de rango", async () => {
    atDecember();
    for (const raw of ["2026-12", "2027-01", "2026-08", "2022-01"]) {
      vi.clearAllMocks();
      const res = await POST(req("Bearer s3cret", `?force=1&upTo=${raw}`));
      expect(res.status, raw).toBe(400);
      expect((await res.json()).error, raw).toBe("up_to_out_of_range");
      expect(mocks.create, raw).not.toHaveBeenCalled();
    }
  });

  it("el rango se valida también en la corrida automática (sin force)", async () => {
    atDecember();
    const res = await POST(req("Bearer s3cret", "?upTo=2027-05"));
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("force con un valor que no es 1/true → 400, no un silencio", async () => {
    mocks.willAct.mockReturnValue(false);
    const res = await POST(req("Bearer s3cret", "?force=0"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_force");
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
