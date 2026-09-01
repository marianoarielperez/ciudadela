import { describe, expect, it, vi } from "vitest";
// `digest.ts` exporta el singleton `digestCron`, armado sobre el cliente real:
// sin este mock el módulo se cae al evaluarse si no hay DATABASE_URL (misma
// regla que `treasury-reminder.test.ts` — mockear ANTES de importar). Lo que se
// ejercita acá es la factory, con dobles inyectados.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { hasNews, makeDigestCron, previousCivilDayRangeUtc, type DigestData } from "@/lib/admin/digest";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";

const NOW = new Date("2026-09-15T10:30:00Z"); // 07:30 AR del 15/09

const empty: DigestData = {
  from: new Date(), to: new Date(), label: "14/09/2026",
  payments: [], paymentsCount: 0, paymentsTotal: 0,
  applications: 0, inboxNew: 0, notificationsFailed: 0, cronFailures: [], webhookErrors: 0,
  reportsReceived: 0, reportsClaims: 0, reportsInitiatives: 0, reportsPending: 0,
};

function build(over?: Partial<{
  payments: Array<{ type: string; _count: { _all: number }; _sum: { amount: unknown } }>;
  applications: number; inboxNew: number; failed: number;
  cronFailures: Array<{ job: string; _count: { job: number } }>;
  webhookErrors: number; recipients: string | null;
  reportsClaims: number; reportsInitiatives: number; reportsPending: number;
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
    cronRun: { groupBy: vi.fn(async () => over?.cronFailures ?? []) },
    webhookEvent: { count: vi.fn(async () => over?.webhookErrors ?? 0) },
    // El doble HONRA el `where` que recibe en vez de devolver una constante:
    // así el filtro por `kind` y el de la cola (`status: "received"` a secas)
    // quedan efectivamente ejercitados (lección del M6).
    report: {
      count: vi.fn(async ({ where }: { where: { kind?: string; status: string | { in: string[] } } }) => {
        if (where.status === "received" && !where.kind) return over?.reportsPending ?? 0;
        if (where.kind === "claim") return over?.reportsClaims ?? 0;
        if (where.kind === "initiative") return over?.reportsInitiatives ?? 0;
        return (over?.reportsClaims ?? 0) + (over?.reportsInitiatives ?? 0);
      }),
    },
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
    expect(hasNews({ ...empty, cronFailures: [{ job: "reconcile", runs: 1 }] })).toBe(true);
  });
  it("un reporte recibido ayer es novedad; la cola sin novedades, no", () => {
    expect(hasNews({ ...empty, reportsReceived: 1 })).toBe(true);
    expect(hasNews({ ...empty, reportsPending: 7 })).toBe(false);
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

  // El operador recibió un resumen real que decía "reconcile, reconcile,
  // reconcile, reconcile, reconcile, reconcile": la consulta traía UNA FILA POR
  // CORRIDA. `reconcile` escribe un `CronRun` en cada invocación, así que un job
  // en loop de reintentos estiraba el renglón sin techo.
  it("las corridas fallidas vienen AGRUPADAS por job y con tope", async () => {
    const { cron, db } = build({ cronFailures: [{ job: "reconcile", _count: { job: 6 } }] });
    const d = await cron.collect();
    expect(d.cronFailures).toEqual([{ job: "reconcile", runs: 6 }]);
    expect(db.cronRun.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["job"],
      where: expect.objectContaining({ ok: false }),
      take: expect.any(Number),
    }));
  });

  it("junta los reportes recibidos ayer por tipo y la cola sin presentar", async () => {
    const { cron } = build({ reportsClaims: 2, reportsInitiatives: 1, reportsPending: 7 });
    const d = await cron.collect();
    expect(d).toMatchObject({ reportsReceived: 3, reportsClaims: 2, reportsInitiatives: 1, reportsPending: 7 });
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

  it("el bloqueo por EMAIL_ALLOWLIST NO es un fallo: se cuenta aparte y la corrida cierra en verde", async () => {
    // Con la lista puesta —el estado de producción hasta el checklist de
    // lanzamiento—, contarlo como `failed` dejaba `CronRun.ok = false` y
    // /admin/salud en rojo desde la primera noche con novedades, sin nada que
    // apagara el rojo salvo borrar la variable.
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("bloqueado"), { code: ALLOWLIST_BLOCK_CODE }))
      .mockResolvedValueOnce({ messageId: "id" });
    const { cron } = build({ applications: 1, recipients: "a@b.com, c@d.com", send });
    const s = await cron.send(await cron.collect());
    expect(s).toMatchObject({ sent: 1, allowlistBlocked: 1, failed: 0, errors: [] });
  });
});
