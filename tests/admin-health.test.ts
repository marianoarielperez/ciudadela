import { describe, expect, it, vi } from "vitest";
import {
  CRON_EXPECTATION, cronState, fetchHealth, receiptNumberOf, type HealthDb,
} from "@/lib/admin/health";
import { readBackupHealth } from "@/lib/admin/health-backup";
import { formatRelativeAgo } from "@/lib/format";

const NOW = new Date("2026-09-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe("formatRelativeAgo", () => {
  it("bajo el minuto, 'recién'", () => {
    expect(formatRelativeAgo(new Date(NOW.getTime() - 30_000), NOW)).toBe("recién");
  });
  it("minutos, horas y días en es-AR, en singular y plural", () => {
    expect(formatRelativeAgo(hoursAgo(0.5), NOW)).toBe("hace 30 minutos");
    expect(formatRelativeAgo(hoursAgo(1), NOW)).toBe("hace 1 hora");
    expect(formatRelativeAgo(hoursAgo(3), NOW)).toBe("hace 3 horas");
    expect(formatRelativeAgo(hoursAgo(25), NOW)).toBe("hace 1 día");
    expect(formatRelativeAgo(hoursAgo(72), NOW)).toBe("hace 3 días");
  });
});

describe("cronState", () => {
  const ran = (over: Partial<{ startedAt: Date; finishedAt: Date | null; ok: boolean }> = {}) =>
    ({ startedAt: hoursAgo(2), finishedAt: hoursAgo(2), ok: true, ...over });

  it("sin ninguna corrida, 'never'", () => {
    expect(cronState(null, 24, NOW)).toBe("never");
  });
  it("corrida reciente y limpia, 'ok'", () => {
    expect(cronState(ran(), 24, NOW)).toBe("ok");
  });
  it("una corrida abierta hace horas está COLGADA, no 'mal': el proceso murió sin cerrarla", () => {
    expect(cronState(ran({ finishedAt: null, ok: false }), 24, NOW)).toBe("hung");
  });
  it("una corrida abierta recién puede estar corriendo ahora mismo", () => {
    expect(cronState({ startedAt: new Date(NOW.getTime() - 60_000), finishedAt: null, ok: false }, 24, NOW)).toBe("ok");
  });
  it("terminó con errores → 'errors', aunque sea de hace un minuto", () => {
    expect(cronState(ran({ ok: false }), 24, NOW)).toBe("errors");
  });
  it("vieja más del DOBLE del período esperado → 'stale'", () => {
    expect(cronState(ran({ startedAt: hoursAgo(49), finishedAt: hoursAgo(49) }), 24, NOW)).toBe("stale");
    expect(cronState(ran({ startedAt: hoursAgo(47), finishedAt: hoursAgo(47) }), 24, NOW)).toBe("ok");
  });
  it("el devengo y el recordatorio son MENSUALES: 30 h sin correr es normal", () => {
    expect(CRON_EXPECTATION.accrual.everyHours).toBeGreaterThan(24 * 27);
    expect(CRON_EXPECTATION.reminder.everyHours).toBeGreaterThan(24 * 27);
    expect(cronState(ran({ startedAt: hoursAgo(30), finishedAt: hoursAgo(30) }), CRON_EXPECTATION.accrual.everyHours, NOW)).toBe("ok");
  });
  it("el resumen no escribe fila los días sin novedades: una semana de silencio sigue siendo 'ok'", () => {
    // Para ESTA asociación —160 vigentes, el débito alrededor del 10— el día
    // tranquilo es la regla. Medirlo con la vara de `reconcile` (24 h) lo
    // pintaría de gris varias veces por semana estando sano.
    expect(CRON_EXPECTATION.digest.everyHours).toBeGreaterThanOrEqual(24 * 7);
    expect(cronState(ran({ startedAt: hoursAgo(24 * 9), finishedAt: hoursAgo(24 * 9) }), CRON_EXPECTATION.digest.everyHours, NOW)).toBe("ok");
  });
  it("los cinco jobs tienen expectativa declarada", () => {
    expect(Object.keys(CRON_EXPECTATION).sort()).toEqual(["accrual", "applications", "digest", "reconcile", "reminder"]);
  });
});

describe("readBackupHealth", () => {
  it("sin BACKUP_DIR, 'unconfigured' — no revienta ni acusa un backup roto", async () => {
    expect(await readBackupHealth(NOW, { dir: undefined })).toEqual({ state: "unconfigured", lastOkAt: null });
  });
  it("con el sello fresco, 'fresh'", async () => {
    const readFile = vi.fn(async () => `${hoursAgo(8).toISOString()}\n`);
    expect(await readBackupHealth(NOW, { dir: "/var/sigev/backups", readFile })).toEqual({
      state: "fresh", lastOkAt: hoursAgo(8),
    });
  });
  it("más de 26 h, 'stale' (el backup corre a las 04:00: 26 h da margen a un atraso)", async () => {
    const readFile = vi.fn(async () => hoursAgo(30).toISOString());
    expect((await readBackupHealth(NOW, { dir: "/x", readFile })).state).toBe("stale");
  });
  it("el archivo no existe → 'missing', que NO es lo mismo que 'viejo'", async () => {
    const readFile = vi.fn(async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); });
    expect(await readBackupHealth(NOW, { dir: "/x", readFile })).toEqual({ state: "missing", lastOkAt: null });
  });
  it("un sello ilegible también es 'missing': un backup que no se puede leer no es un backup", async () => {
    const readFile = vi.fn(async () => "la semana pasada");
    expect((await readBackupHealth(NOW, { dir: "/x", readFile })).state).toBe("missing");
  });
});

describe("receiptNumberOf", () => {
  it("saca el número del resumen que escribe el mailer del recibo", () => {
    expect(receiptNumberOf("recibo 2026-00042")).toBe("2026-00042");
  });
  it("cualquier otro resumen no tiene camino de reenvío", () => {
    expect(receiptNumberOf("link de pago × 3")).toBeNull();
    expect(receiptNumberOf(null)).toBeNull();
  });
});

// ── fetchHealth ──────────────────────────────────────────────────────────────
// Prisma inyectado: el módulo se prueba sin `.env` y sin base. Los dobles
// filtran de verdad donde el filtro ES la regla que se está probando (las
// suscripciones), y devuelven filas fijas donde el filtro es trivial.

type SubRow = { status: string; memberId: number | null };
type ReceiptRow = {
  id: number; number: string; issuedAt: Date;
  payment: {
    member: { id: number; fullName: string; email: string | null; emailStatus: string } | null;
    application: { id: number; fullName: string } | null;
  };
};
type NoteRow = { payloadSummary: string | null; status: string; error: string | null };

function fakeDb(over: Partial<{
  runs: Record<string, { id: bigint; startedAt: Date; finishedAt: Date | null; ok: boolean; error: string | null; summary: unknown } | null>;
  lastEvent: { receivedAt: Date } | null;
  unprocessed: number;
  rejections: number;
  inboxOpen: number;
  inboxTotal: number;
  subs: SubRow[];
  mismatches: Array<{ id: bigint; createdAt: Date; detail: unknown }>;
  failed: Array<{
    id: bigint; sentAt: Date; type: string; error: string | null; payloadSummary: string | null;
    memberId: number | null; applicationId: number | null;
  }>;
  failedTotal: number;
  members: Array<{ id: number; fullName: string }>;
  receipts: ReceiptRow[];
  receiptsTotal: number;
  receiptNotes: NoteRow[];
}> = {}) {
  const subs = over.subs ?? [];
  const db = {
    cronRun: {
      findFirst: vi.fn(async ({ where }: { where: { job: string } }) => over.runs?.[where.job] ?? null),
    },
    webhookEvent: {
      findFirst: vi.fn(async () => over.lastEvent ?? null),
      count: vi.fn(async () => over.unprocessed ?? 0),
    },
    auditLog: {
      count: vi.fn(async () => over.rejections ?? 0),
      findMany: vi.fn(async () => over.mismatches ?? []),
    },
    mpUnmatchedPayment: {
      count: vi.fn(async (args?: { where?: { status?: string } }) =>
        args?.where?.status === "open" ? (over.inboxOpen ?? 0) : (over.inboxTotal ?? 0)),
    },
    mpSubscription: {
      // El filtro se ejecuta de verdad: que una cancelada no cuente es LA regla
      // de este contador, no un detalle de la consulta.
      count: vi.fn(async ({ where }: { where: { memberId?: unknown; status: { notIn: readonly string[] } } }) =>
        subs.filter((s) => (where.memberId ? s.memberId !== null : true) && !where.status.notIn.includes(s.status)).length),
    },
    notification: {
      findMany: vi.fn(async ({ where }: { where: { status?: string } }) =>
        where.status === "failed" ? (over.failed ?? []) : (over.receiptNotes ?? [])),
      count: vi.fn(async () => over.failedTotal ?? (over.failed ?? []).length),
    },
    member: { findMany: vi.fn(async () => over.members ?? []) },
    receipt: {
      findMany: vi.fn(async () => over.receipts ?? []),
      count: vi.fn(async () => over.receiptsTotal ?? (over.receipts ?? []).length),
    },
  };
  return db as unknown as HealthDb;
}

const run = (over: Partial<{ id: bigint; startedAt: Date; finishedAt: Date | null; ok: boolean; error: string | null; summary: unknown }> = {}) =>
  ({ id: BigInt(7), startedAt: hoursAgo(9), finishedAt: hoursAgo(9), ok: true, error: null, summary: { paymentsRecovered: 1 }, ...over });

const receipt = (over: Partial<ReceiptRow> & { member?: ReceiptRow["payment"]["member"] } = {}): ReceiptRow => ({
  id: over.id ?? 1,
  number: over.number ?? "2026-00042",
  issuedAt: over.issuedAt ?? hoursAgo(20),
  payment: over.payment ?? {
    member: over.member === undefined
      ? { id: 14, fullName: "Ana Pérez", email: "ana@example.com", emailStatus: "verified" }
      : over.member,
    application: null,
  },
});

describe("fetchHealth — tareas automáticas", () => {
  it("devuelve los cinco jobs en el orden de la pantalla, con etiqueta y expectativa", async () => {
    const h = await fetchHealth(fakeDb({ runs: { reconcile: run() } }), NOW);
    expect(h.crons.map((c) => c.job)).toEqual(["reconcile", "applications", "accrual", "reminder", "digest"]);
    expect(h.crons[0]).toMatchObject({ label: CRON_EXPECTATION.reconcile.label, state: "ok" });
    expect(h.crons[0].lastRun).toMatchObject({ id: "7", ok: true });
    // Los que nunca corrieron no mienten ni se pintan de rojo.
    expect(h.crons.slice(1).map((c) => c.state)).toEqual(["never", "never", "never", "never"]);
    expect(h.now).toBe(NOW);
  });
  it("el devengo de hace dos días sigue 'ok' y el reconcile no: la vara es la de cada job", async () => {
    const old = { startedAt: hoursAgo(50), finishedAt: hoursAgo(50) };
    const h = await fetchHealth(fakeDb({ runs: { reconcile: run(old), accrual: run(old) } }), NOW);
    expect(h.crons.find((c) => c.job === "reconcile")!.state).toBe("stale");
    expect(h.crons.find((c) => c.job === "accrual")!.state).toBe("ok");
  });
  it("el error de la corrida se muestra sin direcciones de correo", async () => {
    const h = await fetchHealth(
      fakeDb({ runs: { reconcile: run({ ok: false, error: "SMTP rechazó vecino@example.com" }) } }),
      NOW,
    );
    expect(h.crons[0].lastRun!.error).toBe("SMTP rechazó [email]");
  });
});

describe("fetchHealth — Mercado Pago y dinero", () => {
  it("trae el último aviso recibido y los dos contadores", async () => {
    const h = await fetchHealth(
      fakeDb({ lastEvent: { receivedAt: hoursAgo(4) }, unprocessed: 2, rejections: 5 }),
      NOW,
    );
    expect(h.mp).toEqual({ lastEventAt: hoursAgo(4), unprocessedWithError: 2, signatureRejections: 5 });
  });
  it("sin un solo aviso de MP, `lastEventAt` es null y no una fecha inventada", async () => {
    expect((await fetchHealth(fakeDb(), NOW)).mp.lastEventAt).toBeNull();
  });
  it("las suscripciones que cuentan son las que dejaron de cobrar sin estar cerradas", async () => {
    // Una cancelada NO cuenta: cancelar el débito de un socio dado de baja es la
    // acción correcta, y si sumara, hacerla bien subiría la alarma. Una sin
    // socio tampoco: es un alta web abandonada, y no hay nada que atender.
    const h = await fetchHealth(fakeDb({
      subs: [
        { status: "authorized", memberId: 1 },
        { status: "cancelled", memberId: 2 },
        { status: "paused", memberId: 3 },
        { status: "pending", memberId: 4 },
        { status: "pending", memberId: null },
      ],
    }), NOW);
    expect(h.money.subscriptionsStalled).toBe(2);
  });
  it("la bandeja distingue lo abierto del total que pasó por ahí", async () => {
    const h = await fetchHealth(fakeDb({ inboxOpen: 3, inboxTotal: 41 }), NOW);
    expect(h.money).toMatchObject({ inboxOpen: 3, inboxTotal: 41 });
  });
  it("los links cobrados por otro importe traen socio, cuotas y la diferencia", async () => {
    const h = await fetchHealth(fakeDb({
      mismatches: [{ id: BigInt(90), createdAt: hoursAgo(5), detail: { paymentId: 7, memberId: 14, n: 3, expected: 9000, amount: 7500 } }],
      members: [{ id: 14, fullName: "Ana Pérez" }],
    }), NOW);
    expect(h.money.mismatches[0]).toEqual({
      id: "90", createdAt: hoursAgo(5), paymentId: 7, memberId: 14, memberName: "Ana Pérez",
      n: 3, expected: 9000, amount: 7500,
    });
  });
  it("un asiento con el detalle incompleto se muestra igual, con huecos y sin romper la pantalla", async () => {
    const h = await fetchHealth(fakeDb({
      mismatches: [{ id: BigInt(91), createdAt: hoursAgo(5), detail: null }],
    }), NOW);
    expect(h.money.mismatches[0]).toMatchObject({ paymentId: null, memberId: null, memberName: null, expected: null });
  });
});

describe("fetchHealth — avisos que no salieron", () => {
  it("un recibo fallido trae su número, que es el único camino de reenvío", async () => {
    const h = await fetchHealth(fakeDb({
      failed: [{ id: BigInt(3), sentAt: hoursAgo(2), type: "receipt", error: "EAUTH", payloadSummary: "recibo 2026-00042", memberId: 14, applicationId: null }],
      members: [{ id: 14, fullName: "Ana Pérez" }],
      failedTotal: 9,
    }), NOW);
    expect(h.failed[0]).toMatchObject({ id: "3", memberName: "Ana Pérez", receiptNumber: "2026-00042" });
    // El total dice cuántos hay de verdad: una lista recortada en silencio
    // miente sobre el tamaño del problema.
    expect(h.failedTotal).toBe(9);
  });
  it("un aviso sin camino de reenvío lo dice con un null, no con un número inventado", async () => {
    const h = await fetchHealth(fakeDb({
      failed: [{ id: BigInt(4), sentAt: hoursAgo(2), type: "fee_reminder", error: "ETIMEDOUT", payloadSummary: "recordatorio 2026-09", memberId: null, applicationId: 8 }],
    }), NOW);
    expect(h.failed[0]).toMatchObject({ receiptNumber: null, memberName: null, applicationId: 8 });
  });
});

describe("fetchHealth — recibos sin enviar", () => {
  it("sin fila de Notification, el recibo quedó DIFERIDO por el tope de envíos", async () => {
    const h = await fetchHealth(fakeDb({ receipts: [receipt()], receiptNotes: [] }), NOW);
    expect(h.receipts.rows[0]).toMatchObject({ number: "2026-00042", state: "deferred", memberName: "Ana Pérez", error: null });
  });
  it("con una fila `failed`, el envío se intentó y no salió", async () => {
    const h = await fetchHealth(fakeDb({
      receipts: [receipt()],
      receiptNotes: [{ payloadSummary: "recibo 2026-00042", status: "failed", error: "EAUTH" }],
    }), NOW);
    expect(h.receipts.rows[0]).toMatchObject({ state: "failed", error: "EAUTH" });
  });
  it("con una fila `sent`, el recibo SÍ salió: lo que falló fue el sello, y reenviarlo lo duplicaría", async () => {
    const h = await fetchHealth(fakeDb({
      receipts: [receipt()],
      receiptNotes: [{ payloadSummary: "recibo 2026-00042", status: "sent", error: null }],
    }), NOW);
    expect(h.receipts.rows[0].state).toBe("sent");
  });
  it("sin casilla utilizable no hay nada que reenviar, y no es un envío diferido", async () => {
    const bounced = await fetchHealth(fakeDb({
      receipts: [receipt({ member: { id: 14, fullName: "Ana Pérez", email: "ana@example.com", emailStatus: "bounced" } })],
    }), NOW);
    expect(bounced.receipts.rows[0].state).toBe("no_email");
    const sinCasilla = await fetchHealth(fakeDb({
      receipts: [receipt({ member: { id: 14, fullName: "Ana Pérez", email: null, emailStatus: "none" } })],
    }), NOW);
    expect(sinCasilla.receipts.rows[0].state).toBe("no_email");
  });
  it("un recibo de una solicitud usa la casilla de la solicitud, que siempre existe", async () => {
    const h = await fetchHealth(fakeDb({
      receipts: [receipt({ payment: { member: null, application: { id: 8, fullName: "Juan Vecino" } } })],
    }), NOW);
    expect(h.receipts.rows[0]).toMatchObject({ state: "deferred", applicationId: 8, memberName: "Juan Vecino" });
  });
  it("el total sale de la base y no del largo de la lista recortada", async () => {
    const h = await fetchHealth(fakeDb({ receipts: [receipt()], receiptsTotal: 24 }), NOW);
    expect(h.receipts.total).toBe(24);
  });
});
