import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  // `BigInt(7)` y no `7n`: el target del proyecto es ES2017.
  create: vi.fn(async () => ({ id: BigInt(7) })),
  update: vi.fn(async () => ({})),
  collect: vi.fn(),
  send: vi.fn(),
  audit: vi.fn(async () => {}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { cronRun: { create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/admin/digest", async (importOriginal) => {
  // `hasNews` se usa DE VERDAD (es una función pura y es la que decide si el día
  // fue tranquilo): mockearla dejaría al test sin verificar el desenlace que da
  // nombre a esta tarea. Lo que se dobla es el par que toca la base y la red.
  const real = await importOriginal<typeof import("@/lib/admin/digest")>();
  return { ...real, digestCron: { collect: mocks.collect, send: mocks.send } };
});
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
import { POST } from "@/app/api/cron/digest/route";
import type { DigestData } from "@/lib/admin/digest";

const quiet: DigestData = {
  from: new Date("2026-09-14T03:00:00Z"), to: new Date("2026-09-15T03:00:00Z"), label: "14/09/2026",
  payments: [], paymentsCount: 0, paymentsTotal: 0,
  applications: 0, inboxNew: 0, notificationsFailed: 0, cronFailures: [], webhookErrors: 0,
};
const busy: DigestData = { ...quiet, applications: 2, paymentsCount: 1, paymentsTotal: 6000 };
const summary = { day: "14/09/2026", recipients: 2, sent: 2, allowlistBlocked: 0, failed: 0, errors: [] as string[] };

const req = (auth?: string) =>
  new Request("http://x/api/cron/digest", { method: "POST", headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  mocks.collect.mockResolvedValue(busy);
  mocks.send.mockResolvedValue(summary);
});

describe("POST /api/cron/digest", () => {
  it("sin CRON_SECRET → 503", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req("Bearer x"))).status).toBe(503);
    expect(mocks.collect).not.toHaveBeenCalled();
  });

  it("bearer incorrecto → 401", async () => {
    expect((await POST(req("Bearer nope"))).status).toBe(401);
    expect(mocks.collect).not.toHaveBeenCalled();
  });

  // EL caso de esta tarea: un día tranquilo no manda correo Y NO deja fila en
  // `cron_runs`. Una fila verde que dice "no mandé nada" entrenaría al operador
  // a ignorar /admin/salud, que es exactamente lo contrario de para qué está.
  it("sin novedades → 200 skipped, sin correo y sin CronRun", async () => {
    mocks.collect.mockResolvedValue(quiet);
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "no_news", day: "14/09/2026" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("con novedades → 200, CronRun abierto y cerrado, asiento digest_cron", async () => {
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(summary);
    expect(mocks.create).toHaveBeenCalledWith({ data: { job: "digest", startedAt: expect.any(Date) } });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: BigInt(7) },
      data: { finishedAt: expect.any(Date), ok: true, summary },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "digest_cron", entity: "cron", entityId: "7", detail: summary }),
    );
  });

  // Sin destinatarios cargados no hay a quién avisarle, y eso no es un fallo: la
  // corrida cierra en verde. Es el estado del sistema recién lanzado.
  it("sin destinatarios cargados → 200 y ok:true, con sent en cero", async () => {
    mocks.send.mockResolvedValue({ day: "14/09/2026", recipients: 0, sent: 0, allowlistBlocked: 0, failed: 0, errors: [] });
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: true }),
    }));
  });

  it("un destinatario que falló → 207 y ok:false", async () => {
    mocks.send.mockResolvedValue({ day: "14/09/2026", recipients: 2, sent: 1, allowlistBlocked: 0, failed: 1, errors: ["EAUTH"] });
    expect((await POST(req("Bearer s3cret"))).status).toBe(207);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: false }),
    }));
  });

  // Con `EMAIL_ALLOWLIST` puesta —producción, hasta el checklist de
  // lanzamiento— ésta es la corrida NORMAL de todas las noches con novedades.
  // Si cerrara en `ok: false`, /admin/salud nacería en rojo y el operador
  // aprendería a no mirarla.
  it("todos los destinatarios bloqueados por la allowlist → 200 y ok:true", async () => {
    mocks.send.mockResolvedValue({ day: "14/09/2026", recipients: 2, sent: 0, allowlistBlocked: 2, failed: 0, errors: [] });
    expect((await POST(req("Bearer s3cret"))).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: true }),
    }));
  });

  // La contracara honesta del "no abro la corrida antes de saber si hay algo":
  // si `collect()` se cae no hay `CronRun` que mostrar. Queda el 500 en el log
  // del cron y /admin/salud lo ve como antigüedad (el job pasa a "stale").
  it("collect() que se cae → 500 y NINGÚN CronRun", async () => {
    mocks.collect.mockRejectedValue(new Error("db down"));
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "cron_failed" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("send() que se cae entero → 500 y el CronRun queda con error", async () => {
    mocks.send.mockRejectedValue(new Error("smtp down"));
    expect((await POST(req("Bearer s3cret"))).status).toBe(500);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: false, error: expect.stringContaining("smtp down") }),
    }));
  });
});
