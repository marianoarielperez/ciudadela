import { describe, expect, it, vi } from "vitest";
import {
  classifyDebits, CRON_EXPECTATION, cronState, fetchHealth, safeSummary,
  SIGNATURE_WINDOW_HOURS, WEBHOOK_ERROR_WINDOW_HOURS, type HealthDb,
} from "@/lib/admin/health";
import { healthAlerts } from "@/lib/admin/health-alerts";
import { type BackupHealth, readBackupHealth } from "@/lib/admin/health-backup";
import { formatRelativeAgo } from "@/lib/format";
import { receiptNumberOf, receiptSummaryOf } from "@/lib/treasury/receipt-summary";
import { ACTIVE_SUPERADMINS_WHERE, SIGN_IN_READY_SUPERADMINS_WHERE } from "@/lib/users/query";

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
  it("el borde exacto de las 26 h: 25,9 h todavía es fresco y 26,1 ya no", async () => {
    const at = (h: number) => vi.fn(async () => hoursAgo(h).toISOString());
    expect((await readBackupHealth(NOW, { dir: "/x", readFile: at(25.9) })).state).toBe("fresh");
    expect((await readBackupHealth(NOW, { dir: "/x", readFile: at(26.1) })).state).toBe("stale");
  });
  it("el archivo no existe → 'missing', que NO es lo mismo que 'viejo'", async () => {
    const readFile = vi.fn(async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); });
    expect(await readBackupHealth(NOW, { dir: "/x", readFile })).toEqual({ state: "missing", lastOkAt: null });
  });
  it("un sello ilegible también es 'missing': un backup que no se puede leer no es un backup", async () => {
    const readFile = vi.fn(async () => "la semana pasada");
    expect((await readBackupHealth(NOW, { dir: "/x", readFile })).state).toBe("missing");
  });
  it("el archivo VACÍO es 'missing': existe, pero no acredita ninguna corrida", async () => {
    const readFile = vi.fn(async () => "  \n");
    expect(await readBackupHealth(NOW, { dir: "/x", readFile })).toEqual({ state: "missing", lastOkAt: null });
  });
  it("sin permiso de lectura NO se acusa un backup roto: lo roto son los permisos", async () => {
    // `missing` se pinta rojo; esto no es un backup caído, es la pantalla que no
    // llega al archivo (el backup lo escribe root).
    const readFile = vi.fn(async () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); });
    expect(await readBackupHealth(NOW, { dir: "/x", readFile })).toEqual({ state: "unreadable", lastOkAt: null });
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
  it("lee lo que escribe el builder: son las dos mitades del MISMO formato", () => {
    // El literal vivía repetido en cuatro archivos y este par es todo el nexo
    // entre un aviso fallido y su recibo: una deriva rompe la dedupe en silencio.
    expect(receiptNumberOf(receiptSummaryOf("2026-00042"))).toBe("2026-00042");
  });
});

describe("safeSummary", () => {
  it("enmascara las direcciones ANIDADAS del summary, que es JSON de cinco crons distintos", () => {
    expect(safeSummary({ sent: 3, errors: ["SMTP rechazó vecino@example.com"], nested: { to: "a@b.com" } })).toEqual({
      sent: 3, errors: ["SMTP rechazó [email]"], nested: { to: "[email]" },
    });
  });
  it("deja pasar números, booleanos y null sin tocarlos", () => {
    expect(safeSummary({ n: 1, ok: false, x: null })).toEqual({ n: 1, ok: false, x: null });
    expect(safeSummary(null)).toBeNull();
  });
  it("un JSON absurdamente anidado se corta y no cuelga la pantalla", () => {
    let deep: unknown = "vecino@example.com";
    for (let i = 0; i < 30; i++) deep = { deep };
    expect(() => safeSummary(deep)).not.toThrow();
  });
  it("recorta el preapproval_id que viaja DENTRO del texto de un error", () => {
    // El enmascarado es de la capa de DATOS y no de la pantalla: el próximo
    // consumidor —el resumen diario, un export— hereda el recorte sin acordarse.
    const id = "5eed0000000000000000000000000001";
    const out = safeSummary({ errors: [`sync: status=404 The preapproval with id ${id} does not exist`] });
    expect(out).toEqual({ errors: ["sync: status=404 The preapproval with id 5eed0000… does not exist"] });
    expect(JSON.stringify(out)).not.toContain(id);
  });
});

describe("classifyDebits", () => {
  const sub = (memberId: number | null, status: string, memberStatus: string | null) =>
    ({ memberId, status, member: memberStatus === null ? null : { status: memberStatus } });

  it("un socio VIGENTE cuya suscripción fue cancelada es plata que dejó de entrar en silencio", () => {
    // El vecino la canceló desde su app, o MP la dio de baja tras N rechazos.
    expect(classifyDebits([sub(1, "cancelled", "active")])).toEqual({ stoppedForActive: 1, aliveForWithdrawn: 0 });
  });
  it("pausada o pendiente de un socio vigente también dejan de cobrar", () => {
    expect(classifyDebits([sub(1, "paused", "active"), sub(2, "pending", "suspended")]).stoppedForActive).toBe(2);
  });
  it("un socio vigente que está cobrando no cuenta", () => {
    expect(classifyDebits([sub(1, "authorized", "active")])).toEqual({ stoppedForActive: 0, aliveForWithdrawn: 0 });
  });
  it("el que rehízo el débito no queda alarmado por la cancelada vieja: se cuenta por SOCIO", () => {
    expect(classifyDebits([sub(1, "cancelled", "active"), sub(1, "authorized", "active")]).stoppedForActive).toBe(0);
  });
  it("un socio DADO DE BAJA con la suscripción viva es el caso que hoy le sigue cobrando", () => {
    // `withdrawWithDebits` cancela después del commit y es best-effort: si MP no
    // acepta, la baja queda y el débito sigue.
    expect(classifyDebits([sub(9, "authorized", "withdrawn")])).toEqual({ stoppedForActive: 0, aliveForWithdrawn: 1 });
  });
  it("contra un socio dado de baja, un estado que MP invente cuenta como débito posible", () => {
    expect(classifyDebits([sub(9, "on_hold", "withdrawn")]).aliveForWithdrawn).toBe(1);
    expect(classifyDebits([sub(9, "cancelled", "withdrawn")]).aliveForWithdrawn).toBe(0);
  });
  it("una suscripción sin socio no cuenta: es un alta web que el vecino abandonó", () => {
    expect(classifyDebits([sub(null, "pending", null)])).toEqual({ stoppedForActive: 0, aliveForWithdrawn: 0 });
  });
  it("un suspendido sigue siendo socio y sigue debiendo la cuota", () => {
    expect(classifyDebits([sub(1, "cancelled", "suspended")]).stoppedForActive).toBe(1);
  });
});

// ── fetchHealth ──────────────────────────────────────────────────────────────
// Prisma inyectado: el módulo se prueba sin `.env` y sin base. Los dobles
// aplican `where` y `take` DE VERDAD (`matches` / `query`): con dobles que los
// ignoraban, borrar `voidedAt: null` de la consulta de recibos —lo único que
// impide que un anulado quede en la lista para siempre— no rompía ningún test.

type Row = Record<string, unknown>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    // `OR` es una lista de `where`, no un campo: sin esta rama el doble caía en
    // la comparación por campo y "matcheaba" cualquier cosa.
    if (key === "OR") return (cond as Row[]).some((c) => matches(row, c));
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
    if (typeof cond === "object") {
      const c = cond as Row;
      if ("not" in c) return c.not === null ? value !== null && value !== undefined : value !== c.not;
      if ("in" in c) return (c.in as unknown[]).includes(value);
      if ("notIn" in c) return !(c.notIn as unknown[]).includes(value);
      if ("gte" in c) return value instanceof Date && value.getTime() >= (c.gte as Date).getTime();
      return matches((value ?? {}) as Row, c);
    }
    return value === cond;
  });
}

function query<T extends Row>(rows: readonly T[], args?: { where?: Row; take?: number }): T[] {
  const found = rows.filter((r) => matches(r, args?.where));
  return args?.take === undefined ? found : found.slice(0, args.take);
}

type SubRow = { memberId: number | null; status: string; member: { status: string } | null };
type EventRow = { origin: string; receivedAt: Date; processedAt: Date | null; error: string | null };
type AuditRow = { id: bigint; action: string; createdAt: Date; detail: unknown };
type NotifRow = {
  id: bigint; sentAt: Date; type: string; status: string; error: string | null;
  payloadSummary: string | null; memberId: number | null; applicationId: number | null;
};
type UserRoleRow = {
  role: { name: string };
  user: { active: boolean; passwordChangedAt: Date | null; lastLoginAt: Date | null };
};
type ReceiptRow = {
  id: number; number: string; issuedAt: Date; emailedAt: Date | null; voidedAt: Date | null;
  payment: {
    member: { id: number; fullName: string; email: string | null; emailStatus: string } | null;
    application: { id: number; fullName: string; email: string } | null;
  };
};

function fakeDb(over: Partial<{
  runs: Record<string, { id: bigint; startedAt: Date; finishedAt: Date | null; ok: boolean; error: string | null; summary: unknown } | null>;
  events: EventRow[];
  unmatched: Array<{ status: string }>;
  subs: SubRow[];
  audit: AuditRow[];
  notifications: NotifRow[];
  members: Array<{ id: number; fullName: string }>;
  receipts: ReceiptRow[];
  roles: UserRoleRow[];
}> = {}) {
  const events = over.events ?? [];
  const db = {
    cronRun: {
      findFirst: vi.fn(async ({ where }: { where: { job: string } }) => over.runs?.[where.job] ?? null),
    },
    webhookEvent: {
      findFirst: vi.fn(async (args: { where?: Row }) =>
        query(events, args).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0] ?? null),
      count: vi.fn(async (args: { where?: Row }) => query(events, args).length),
    },
    auditLog: {
      count: vi.fn(async (args: { where?: Row }) => query(over.audit ?? [], args).length),
      findMany: vi.fn(async (args: { where?: Row; take?: number }) => query(over.audit ?? [], args)),
    },
    mpUnmatchedPayment: {
      count: vi.fn(async (args?: { where?: Row }) => query(over.unmatched ?? [], args).length),
    },
    mpSubscription: {
      findMany: vi.fn(async (args: { where?: Row }) => query(over.subs ?? [], args)),
    },
    notification: {
      findMany: vi.fn(async (args: { where?: Row; take?: number }) => query(over.notifications ?? [], args)),
      count: vi.fn(async (args: { where?: Row }) => query(over.notifications ?? [], args).length),
    },
    member: {
      findMany: vi.fn(async (args: { where?: Row }) => query(over.members ?? [], args)),
    },
    receipt: {
      findMany: vi.fn(async (args: { where?: Row; take?: number }) => query(over.receipts ?? [], args)),
      count: vi.fn(async (args: { where?: Row }) => query(over.receipts ?? [], args).length),
    },
    userRole: {
      count: vi.fn(async (args: { where?: Row }) => query(over.roles ?? [], args).length),
    },
  };
  return db as unknown as HealthDb;
}

const run = (over: Partial<{ id: bigint; startedAt: Date; finishedAt: Date | null; ok: boolean; error: string | null; summary: unknown }> = {}) =>
  ({ id: BigInt(7), startedAt: hoursAgo(9), finishedAt: hoursAgo(9), ok: true, error: null, summary: { paymentsRecovered: 1 }, ...over });

const event = (over: Partial<EventRow> = {}): EventRow =>
  ({ origin: "mp", receivedAt: hoursAgo(4), processedAt: hoursAgo(4), error: null, ...over });

const note = (over: Partial<NotifRow> = {}): NotifRow => ({
  id: BigInt(1), sentAt: hoursAgo(2), type: "receipt", status: "sent", error: null,
  payloadSummary: "recibo 2026-00042", memberId: 14, applicationId: null, ...over,
});

const receipt = (over: Partial<ReceiptRow> & { member?: ReceiptRow["payment"]["member"] } = {}): ReceiptRow => ({
  id: over.id ?? 1,
  number: over.number ?? "2026-00042",
  issuedAt: over.issuedAt ?? hoursAgo(20),
  emailedAt: over.emailedAt ?? null,
  voidedAt: over.voidedAt ?? null,
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
  it("el error de la corrida tampoco publica un preapproval_id entero", async () => {
    // `safeMessage` (la ruta del cron) tapa correos pero deja los ids largos: es
    // higiene de LOG, donde el id entero hace falta. El recorte de lo que se
    // publica es de acá.
    const id = "5eed0000000000000000000000000001";
    const h = await fetchHealth(
      fakeDb({ runs: { reconcile: run({ ok: false, error: `preapproval ${id} roto` }) } }),
      NOW,
    );
    expect(h.crons[0].lastRun!.error).toBe("preapproval 5eed0000… roto");
  });
  it("el SUMMARY también sale enmascarado: es la superficie de texto libre del tablero", async () => {
    const h = await fetchHealth(
      fakeDb({ runs: { reconcile: run({ summary: { sent: 2, errors: ["falló vecino@example.com"] } }) } }),
      NOW,
    );
    expect(h.crons[0].lastRun!.summary).toEqual({ sent: 2, errors: ["falló [email]"] });
  });
});

describe("fetchHealth — Mercado Pago y dinero", () => {
  it("trae el ÚLTIMO aviso recibido, y sólo los de Mercado Pago", async () => {
    const h = await fetchHealth(fakeDb({
      events: [event({ receivedAt: hoursAgo(4) }), event({ receivedAt: hoursAgo(30) })],
    }), NOW);
    expect(h.mp.lastEventAt).toEqual(hoursAgo(4));
  });
  it("sin un solo aviso de MP, `lastEventAt` es null y no una fecha inventada", async () => {
    expect((await fetchHealth(fakeDb(), NOW)).mp.lastEventAt).toBeNull();
  });
  it("los avisos con error cuentan sólo si están SIN procesar y dentro de la ventana", async () => {
    // Sin ventana, un evento envenenado que MP ya dejó de reintentar deja un `1`
    // permanente que ninguna acción apaga.
    const h = await fetchHealth(fakeDb({
      events: [
        event({ receivedAt: hoursAgo(10), processedAt: null, error: "boom" }),
        event({ receivedAt: hoursAgo(WEBHOOK_ERROR_WINDOW_HOURS + 5), processedAt: null, error: "viejo" }),
        event({ receivedAt: hoursAgo(2), processedAt: hoursAgo(2), error: "se recuperó" }),
        event({ receivedAt: hoursAgo(2), processedAt: null, error: null }),
      ],
    }), NOW);
    expect(h.mp.unprocessedWithError).toBe(1);
  });
  it("las firmas rechazadas se cuentan sólo dentro de su ventana de 24 h", async () => {
    const audit = (h: number, action: string, id: number): AuditRow =>
      ({ id: BigInt(id), action, createdAt: hoursAgo(h), detail: null });
    const h = await fetchHealth(fakeDb({
      audit: [
        audit(2, "webhook_rejected_signature", 1),
        audit(SIGNATURE_WINDOW_HOURS + 1, "webhook_rejected_signature", 2),
        audit(1, "link_amount_mismatch", 3),
      ],
    }), NOW);
    expect(h.mp.signatureRejections).toBe(1);
    // Y el total de mismatches NO se contamina con los otros asientos.
    expect(h.money.mismatchesEver).toBe(1);
  });
  // El hallazgo del primer día en producción: 51 "firmas inválidas" en 24 h, de
  // las que 49 eran IPN legacy sanas. Son dos cosas distintas y ahora se
  // cuentan por separado: la de firma es señal, la legacy es dato.
  it("las IPN legacy tienen contador propio y NO inflan el de firma inválida", async () => {
    const audit = (h: number, action: string, id: number): AuditRow =>
      ({ id: BigInt(id), action, createdAt: hoursAgo(h), detail: null });
    const h = await fetchHealth(fakeDb({
      audit: [
        audit(1, "webhook_rejected_signature", 1),
        audit(2, "webhook_legacy_ipn", 2),
        audit(3, "webhook_legacy_ipn", 3),
        audit(SIGNATURE_WINDOW_HOURS + 1, "webhook_legacy_ipn", 4),
      ],
    }), NOW);
    expect(h.mp.signatureRejections).toBe(1);
    // Misma ventana de 24 h: la de afuera no cuenta.
    expect(h.mp.legacyIpns).toBe(2);
  });
  it("la bandeja distingue lo abierto del total histórico que pasó por ahí", async () => {
    const h = await fetchHealth(fakeDb({
      unmatched: [{ status: "open" }, { status: "open" }, { status: "matched" }, { status: "dismissed" }],
    }), NOW);
    expect(h.money).toMatchObject({ inboxOpen: 2, inboxTotal: 4 });
  });
  it("los débitos cruzan estado de suscripción con estado de SOCIO", async () => {
    const h = await fetchHealth(fakeDb({
      subs: [
        { memberId: 1, status: "cancelled", member: { status: "active" } },
        { memberId: 2, status: "authorized", member: { status: "withdrawn" } },
        { memberId: 3, status: "authorized", member: { status: "active" } },
        { memberId: null, status: "pending", member: null },
      ],
    }), NOW);
    expect(h.money.debits).toEqual({ stoppedForActive: 1, aliveForWithdrawn: 1 });
    // La consulta no trae las huérfanas: son altas web abandonadas.
    expect(h.money.debits.stoppedForActive + h.money.debits.aliveForWithdrawn).toBe(2);
  });
  it("los links cobrados por otro importe traen socio, cuotas y la diferencia", async () => {
    const h = await fetchHealth(fakeDb({
      audit: [{ id: BigInt(90), action: "link_amount_mismatch", createdAt: hoursAgo(5), detail: { paymentId: 7, memberId: 14, n: 3, expected: 9000, amount: 7500 } }],
      members: [{ id: 14, fullName: "Ana Pérez" }],
    }), NOW);
    expect(h.money.mismatches[0]).toEqual({
      id: "90", createdAt: hoursAgo(5), paymentId: 7, memberId: 14, memberName: "Ana Pérez",
      n: 3, expected: 9000, amount: 7500,
    });
  });
  it("un asiento con el detalle incompleto se muestra igual, con huecos y sin romper la pantalla", async () => {
    const h = await fetchHealth(fakeDb({
      audit: [{ id: BigInt(91), action: "link_amount_mismatch", createdAt: hoursAgo(5), detail: null }],
    }), NOW);
    expect(h.money.mismatches[0]).toMatchObject({ paymentId: null, memberId: null, memberName: null, expected: null });
  });
  it("la lista de mismatches viene recortada y el total dice cuántos hay", async () => {
    const audit = Array.from({ length: 25 }, (_, i): AuditRow =>
      ({ id: BigInt(i), action: "link_amount_mismatch", createdAt: hoursAgo(i), detail: { memberId: 14 } }));
    const h = await fetchHealth(fakeDb({ audit }), NOW);
    expect(h.money.mismatches).toHaveLength(20);
    expect(h.money.mismatchesEver).toBe(25);
  });
});

describe("fetchHealth — avisos que no salieron", () => {
  it("un recibo fallido trae su número, que es el único camino de reenvío", async () => {
    const h = await fetchHealth(fakeDb({
      notifications: [note({ id: BigInt(3), status: "failed", error: "EAUTH" })],
      members: [{ id: 14, fullName: "Ana Pérez" }],
    }), NOW);
    expect(h.failed[0]).toMatchObject({ id: "3", memberName: "Ana Pérez", receiptNumber: "2026-00042" });
  });
  it("sólo se listan las `failed`: una `sent` no es un aviso que no salió", async () => {
    const h = await fetchHealth(fakeDb({
      notifications: [note({ id: BigInt(1), status: "sent" }), note({ id: BigInt(2), status: "failed", error: "EAUTH" })],
    }), NOW);
    expect(h.failed.map((f) => f.id)).toEqual(["2"]);
    expect(h.failedEver).toBe(1);
  });
  it("la lista viene recortada en 50 y el total histórico dice cuántas hay", async () => {
    const notifications = Array.from({ length: 60 }, (_, i) =>
      note({ id: BigInt(i), status: "failed", error: "ETIMEDOUT", payloadSummary: `recordatorio ${i}`, type: "fee_reminder" }));
    const h = await fetchHealth(fakeDb({ notifications }), NOW);
    expect(h.failed).toHaveLength(50);
    expect(h.failedEver).toBe(60);
  });
  it("un aviso sin camino de reenvío lo dice con un null, no con un número inventado", async () => {
    const h = await fetchHealth(fakeDb({
      notifications: [note({
        id: BigInt(4), type: "fee_reminder", status: "failed", error: "ETIMEDOUT",
        payloadSummary: "recordatorio 2026-09", memberId: null, applicationId: 8,
      })],
    }), NOW);
    expect(h.failed[0]).toMatchObject({ receiptNumber: null, memberName: null, applicationId: 8 });
  });
});

describe("fetchHealth — recibos sin enviar", () => {
  it("sin fila de Notification el envío NO SE INTENTÓ, que es lo único que se sabe", async () => {
    // Cuatro caminos dejan la fila ausente y el sistema no los distingue; el
    // dominante con la allowlist puesta es el bloqueo del entorno.
    const h = await fetchHealth(fakeDb({ receipts: [receipt()] }), NOW);
    expect(h.receipts.rows[0]).toMatchObject({ number: "2026-00042", state: "not_attempted", memberName: "Ana Pérez", error: null });
  });
  it("con una fila `failed`, el envío se intentó y no salió", async () => {
    const h = await fetchHealth(fakeDb({
      receipts: [receipt()],
      notifications: [note({ status: "failed", error: "EAUTH" })],
    }), NOW);
    expect(h.receipts.rows[0]).toMatchObject({ state: "failed", error: "EAUTH" });
  });
  it("con una fila `sent`, el recibo SÍ salió: lo que falló fue el sello, y reenviarlo lo duplicaría", async () => {
    const h = await fetchHealth(fakeDb({ receipts: [receipt()], notifications: [note({ status: "sent" })] }), NOW);
    expect(h.receipts.rows[0].state).toBe("sent");
  });
  it("la fila de OTRO recibo no clasifica a éste", async () => {
    const h = await fetchHealth(fakeDb({
      receipts: [receipt({ number: "2026-00042" })],
      notifications: [note({ status: "sent", payloadSummary: "recibo 2026-00099" })],
    }), NOW);
    expect(h.receipts.rows[0].state).toBe("not_attempted");
  });
  it("sin casilla utilizable no hay nada que reenviar", async () => {
    const bounced = await fetchHealth(fakeDb({
      receipts: [receipt({ member: { id: 14, fullName: "Ana Pérez", email: "ana@example.com", emailStatus: "bounced" } })],
    }), NOW);
    expect(bounced.receipts.rows[0].state).toBe("no_email");
    const sinCasilla = await fetchHealth(fakeDb({
      receipts: [receipt({ member: { id: 14, fullName: "Ana Pérez", email: null, emailStatus: "none" } })],
    }), NOW);
    expect(sinCasilla.receipts.rows[0].state).toBe("no_email");
  });
  it("un recibo de una solicitud usa la casilla de la solicitud", async () => {
    const h = await fetchHealth(fakeDb({
      receipts: [receipt({ payment: { member: null, application: { id: 8, fullName: "Juan Vecino", email: "juan@example.com" } } })],
    }), NOW);
    expect(h.receipts.rows[0]).toMatchObject({ state: "not_attempted", applicationId: 8, memberName: "Juan Vecino" });
  });
  it("una solicitud con la casilla en blanco tampoco tiene a dónde mandarlo", async () => {
    const h = await fetchHealth(fakeDb({
      receipts: [receipt({ payment: { member: null, application: { id: 8, fullName: "Juan Vecino", email: "  " } } })],
    }), NOW);
    expect(h.receipts.rows[0].state).toBe("no_email");
  });
  it("un recibo ANULADO no está en la lista: no se manda por diseño y quedaría para siempre", async () => {
    const h = await fetchHealth(fakeDb({
      receipts: [receipt({ id: 1 }), receipt({ id: 2, number: "2026-00043", voidedAt: hoursAgo(3) })],
    }), NOW);
    expect(h.receipts.rows.map((r) => r.id)).toEqual([1]);
    expect(h.receipts.total).toBe(1);
  });
  it("un recibo YA SELLADO tampoco: la pantalla lista lo que falta enviar", async () => {
    const h = await fetchHealth(fakeDb({
      receipts: [receipt({ id: 1, emailedAt: hoursAgo(2) }), receipt({ id: 2, number: "2026-00043" })],
    }), NOW);
    expect(h.receipts.rows.map((r) => r.id)).toEqual([2]);
  });
  it("la lista viene recortada en 50 y el total sale de la base", async () => {
    const receipts = Array.from({ length: 60 }, (_, i) => receipt({ id: i, number: `2026-${String(i).padStart(5, "0")}` }));
    const h = await fetchHealth(fakeDb({ receipts }), NOW);
    expect(h.receipts.rows).toHaveLength(50);
    expect(h.receipts.total).toBe(60);
  });
});

describe("fetchHealth — superadmins que pueden entrar", () => {
  const role = (
    name: string, active: boolean, withPassword = true, everSignedIn = false,
  ): UserRoleRow => ({
    role: { name },
    user: {
      active,
      passwordChangedAt: withPassword ? hoursAgo(100) : null,
      lastLoginAt: everSignedIn ? hoursAgo(5) : null,
    },
  });

  it("cuenta los superadmin cuya CUENTA está activa y tiene contraseña, y sólo ésos", async () => {
    const h = await fetchHealth(fakeDb({
      roles: [
        role("superadmin", true),
        role("superadmin", true),
        // Desactivada: no puede entrar, así que no repone a nadie.
        role("superadmin", false),
        // Otro rol: administrar no es lo mismo que poder tocar la configuración.
        role("admin", true),
      ],
    }), NOW);
    expect(h.signInReadySuperadmins).toBe(2);
  });

  // El caso que la verificación en vivo encontró: cuenta de gestión creada,
  // invitación revocada, rol otorgado. Activa, sin contraseña, sin token y sin
  // ninguna entrada anterior: hoy no entra. Contarla apagaba la alerta
  // prometiendo una red inexistente. Es el par del test de arriba: la cuenta
  // nueva y la cuenta vieja se parecen en `passwordChangedAt: null` y las
  // separa `lastLoginAt`.
  it("NO cuenta un superadmin activo que todavía no creó su contraseña ni entró nunca", async () => {
    const h = await fetchHealth(fakeDb({
      roles: [role("superadmin", true), role("superadmin", true, false)],
    }), NOW);
    expect(h.signInReadySuperadmins).toBe(1);
  });

  // El caso de PRODUCCIÓN, medido contra la base antes de desplegar
  // (29/08/2026): el único superadmin es la cuenta del operador, anterior a la
  // migración `20260819133654_add_password_changed_at` —que agregó la columna y
  // no la rellenó—, así que tiene `passwordChangedAt: null` y entra todos los
  // días. Sin `lastLoginAt` en el criterio, la pantalla de Salud habría nacido
  // en rojo afirmando que nadie puede administrar el sistema.
  it("SÍ cuenta un superadmin sin `passwordChangedAt` que ya inició sesión alguna vez", async () => {
    const h = await fetchHealth(fakeDb({
      roles: [role("superadmin", true, false, true)],
    }), NOW);
    expect(h.signInReadySuperadmins).toBe(1);
  });

  // La contracara, que es lo que el criterio tiene que seguir distinguiendo: la
  // cuenta desactivada no entra ni habiendo entrado antes.
  it("NO cuenta un superadmin DESACTIVADO por más que tenga entradas anteriores", async () => {
    const h = await fetchHealth(fakeDb({
      roles: [role("superadmin", false, true, true)],
    }), NOW);
    expect(h.signInReadySuperadmins).toBe(0);
  });

  it("sin ninguna fila el conteo es 0 y no un null que la alerta tendría que adivinar", async () => {
    expect((await fetchHealth(fakeDb(), NOW)).signInReadySuperadmins).toBe(0);
  });

  // De la fila de la base al renglón del tablero, que es donde el hallazgo
  // dolía: la alerta se apaga con un segundo superadmin que ENTRA, y sigue
  // encendida con uno que todavía no creó su contraseña. Con el criterio viejo
  // —cuentas activas a secas— el segundo caso la apagaba y el tablero decía que
  // el sistema estaba cubierto por una cuenta que no puede iniciar sesión.
  it("de punta a punta: sólo un segundo superadmin con contraseña apaga la alerta", async () => {
    const FRESH: BackupHealth = { state: "fresh", lastOkAt: hoursAgo(6) };
    const alertsFor = async (roles: UserRoleRow[]) =>
      healthAlerts(await fetchHealth(fakeDb({ roles }), NOW), FRESH);

    const invited = await alertsFor([role("superadmin", true), role("superadmin", true, false)]);
    expect(invited.act.map((a) => a.key)).toEqual(["superadmins"]);

    const real = await alertsFor([role("superadmin", true), role("superadmin", true)]);
    expect(real.act.map((a) => a.key)).toEqual([]);
  });

  it("consulta con el `where` de la alerta, importado y no copiado", async () => {
    // Es la invariante del chequeo: con un `where` propio alcanzaría con que se
    // olvidara una cláusula para que el panel dijera "hay dos" mientras el
    // sistema está a una baja de socio del lockout. Y es a propósito OTRO
    // `where` que el de las guardas del dominio (`ACTIVE_SUPERADMINS_WHERE`,
    // que no mira `passwordChangedAt`): son dos preguntas distintas.
    const db = fakeDb() as unknown as { userRole: { count: ReturnType<typeof vi.fn> } };
    await fetchHealth(db as unknown as HealthDb, NOW);
    expect(db.userRole.count).toHaveBeenCalledWith({ where: SIGN_IN_READY_SUPERADMINS_WHERE });
    expect(SIGN_IN_READY_SUPERADMINS_WHERE).not.toEqual(ACTIVE_SUPERADMINS_WHERE);
  });
});
