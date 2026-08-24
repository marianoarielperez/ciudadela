import { describe, expect, it, vi } from "vitest";
// `digest.ts` exporta el singleton `digestCron`, armado sobre el cliente real:
// sin este mock el módulo se cae al evaluarse si no hay DATABASE_URL (misma
// regla que `treasury-reminder.test.ts` — mockear ANTES de importar). Lo que se
// ejercita acá es la factory, con dobles inyectados.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { hasNews, makeDigestCron, previousCivilDayRangeUtc, type DigestData } from "@/lib/admin/digest";

const NOW = new Date("2026-09-15T10:30:00Z"); // 07:30 AR del 15/09

const empty: DigestData = {
  from: new Date(), to: new Date(), label: "14/09/2026",
  payments: [], paymentsCount: 0, paymentsTotal: 0,
  applications: 0, inboxNew: 0, notificationsFailed: 0, cronFailures: [], webhookErrors: 0,
};

function build(over?: Partial<{
  payments: Array<{ type: string; _count: { _all: number }; _sum: { amount: unknown } }>;
  applications: number; inboxNew: number; failed: number;
  cronFailures: Array<{ job: string; startedAt: Date; error: string | null }>;
  webhookErrors: number; recipients: string | null;
  send: ReturnType<typeof vi.fn>;
}>) {
  const send = over?.send ?? vi.fn(async () => ({ messageId: "id" }));
  // `?? default` NO sirve acá: `recipients: null` es justamente el caso "la
  // clave no está cargada", y el coalescing lo devolvería al default dejando
  // ese test verde sin ejercitar nada. Se distingue por presencia de la clave.
  const recipients = over && "recipients" in over ? over.recipients : "comision@vecinal.ar";
  const db = {
    payment: { groupBy: vi.fn(async () => over?.payments ?? []) },
    application: { count: vi.fn(async () => over?.applications ?? 0) },
    mpUnmatchedPayment: { count: vi.fn(async () => over?.inboxNew ?? 0) },
    notification: { count: vi.fn(async () => over?.failed ?? 0) },
    cronRun: { findMany: vi.fn(async () => over?.cronFailures ?? []) },
    webhookEvent: { count: vi.fn(async () => over?.webhookErrors ?? 0) },
  };
  const cron = makeDigestCron({
    db: db as never,
    // `as never` en el doble del mailer, como el resto de los tests de cron: un
    // `vi.fn()` sin tipar no satisface la firma exacta de `sendToMember`, y
    // tiparla acá a mano duplicaría la del módulo sin ganar nada.
    mailer: { sendToMember: send } as never,
    config: { getString: vi.fn(async () => recipients ?? null) },
    now: () => NOW,
  });
  return { cron, db, send };
}

describe("previousCivilDayRangeUtc", () => {
  it("el día civil argentino anterior, de 00:00 a 00:00 (03:00 UTC)", () => {
    const r = previousCivilDayRangeUtc(NOW);
    expect(r.from.toISOString()).toBe("2026-09-14T03:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-15T03:00:00.000Z");
    expect(r.label).toBe("14/09/2026");
  });
  it("a las 07:30 AR del 1° de mes, el día anterior es el último del mes pasado", () => {
    expect(previousCivilDayRangeUtc(new Date("2026-10-01T10:30:00Z")).label).toBe("30/09/2026");
  });
});

describe("hasNews", () => {
  it("un día sin nada no es novedad", () => {
    expect(hasNews(empty)).toBe(false);
  });
  it("cualquiera de los seis renglones alcanza", () => {
    expect(hasNews({ ...empty, paymentsCount: 1 })).toBe(true);
    expect(hasNews({ ...empty, applications: 1 })).toBe(true);
    expect(hasNews({ ...empty, inboxNew: 1 })).toBe(true);
    expect(hasNews({ ...empty, notificationsFailed: 1 })).toBe(true);
    expect(hasNews({ ...empty, webhookErrors: 1 })).toBe(true);
    expect(hasNews({ ...empty, cronFailures: [{ job: "reconcile", startedAt: NOW, error: "x" }] })).toBe(true);
  });
});

describe("digest cron", () => {
  it("junta los pagos del día anterior por medio, con total", async () => {
    const { cron, db } = build({
      payments: [
        { type: "cash", _count: { _all: 2 }, _sum: { amount: "9000.00" } },
        { type: "debit", _count: { _all: 1 }, _sum: { amount: "6000.00" } },
      ],
    });
    const d = await cron.collect();
    expect(d.paymentsCount).toBe(3);
    expect(d.paymentsTotal).toBe(15000);
    expect(d.payments).toEqual([
      { type: "cash", count: 2, total: 9000 },
      { type: "debit", count: 1, total: 6000 },
    ]);
    // Todas las consultas acotadas al MISMO rango del día civil anterior.
    expect(db.payment.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gte: expect.any(Date), lt: expect.any(Date) } }),
    }));
  });

  it("manda a cada destinatario configurado y cuenta los envíos", async () => {
    const { cron, send } = build({ applications: 2, recipients: "a@b.com, c@d.com" });
    const data = await cron.collect();
    const s = await cron.send(data);
    expect(s.recipients).toBe(2);
    expect(s.sent).toBe(2);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ memberId: null, type: "board_digest" }));
  });

  it("sin destinatarios configurados no manda nada y lo dice", async () => {
    const { cron, send } = build({ applications: 1, recipients: null });
    const s = await cron.send(await cron.collect());
    expect(s.recipients).toBe(0);
    expect(s.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("un destinatario que falla no impide el envío al otro, y su código queda en errors[]", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("smtp a@b.com"), { code: "EAUTH" }))
      .mockResolvedValueOnce({ messageId: "id" });
    const { cron } = build({ applications: 1, recipients: "a@b.com, c@d.com", send });
    const s = await cron.send(await cron.collect());
    expect(s.sent).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.errors).toEqual(["EAUTH"]);
    // Nunca la dirección de un tercero, ni siquiera en el summary del cron.
    expect(s.errors[0]).not.toContain("@");
  });
});
