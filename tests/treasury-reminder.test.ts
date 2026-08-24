import { beforeEach, describe, expect, it, vi } from "vitest";
// `reminder.ts` exporta el singleton `reminderCron`, armado sobre el cliente
// real: sin este mock el módulo se cae al evaluarse si no hay DATABASE_URL
// (misma regla que `treasury-accrual.test.ts` — mockear ANTES de importar).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeReminderCron } from "@/lib/treasury/reminder";

const LAST_DAY = new Date("2026-09-30T13:00:00Z"); // 10:00 AR del 30/09
const MID_MONTH = new Date("2026-09-15T13:00:00Z");

type M = { id: number; fullName: string; email: string | null; emailStatus: string; category: string };
const socio = (over: Partial<M> = {}): M => ({
  id: 1, fullName: "Ana Gómez", email: "ana@example.com", emailStatus: "verified", category: "active", ...over,
});

function build(members: M[], opts?: {
  paidThisMonth?: number[];
  notified?: number[];
  pending?: Array<{ memberId: number; _count: { _all: number } }>;
  send?: ReturnType<typeof vi.fn>;
  now?: Date;
}) {
  const send = opts?.send ?? vi.fn(async () => ({ messageId: "id" }));
  const db = {
    member: { findMany: vi.fn(async () => members) },
    fee: {
      findMany: vi.fn(async () => (opts?.paidThisMonth ?? []).map((memberId) => ({ memberId }))),
      groupBy: vi.fn(async () => opts?.pending ?? []),
    },
    notification: { findMany: vi.fn(async () => (opts?.notified ?? []).map((memberId) => ({ memberId }))) },
  };
  const cron = makeReminderCron({
    db: db as never,
    // `vi.fn()` sin genéricos no matchea la firma de `sendToMember` para tsc
    // (el mock también es constructor): el doble entra por `never`, como el db.
    mailer: { sendToMember: send as never },
    feeValues: { current: vi.fn(async () => ({ id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: new Date(), minuteId: null })) },
    now: () => opts?.now ?? LAST_DAY,
  });
  return { cron, db, send };
}

beforeEach(() => { delete process.env.MAIL_BATCH_CAP; });

describe("reminder cron", () => {
  it("willAct() sólo el último día civil del mes", () => {
    expect(build([]).cron.willAct()).toBe(true);
    expect(build([], { now: MID_MONTH }).cron.willAct()).toBe(false);
  });

  it("le avisa al devengante que no pagó el mes en curso", async () => {
    const { cron, send } = build([socio()]);
    const s = await cron.run();
    expect(s.period).toBe("2026-09");
    expect(s.candidates).toBe(1);
    expect(s.sent).toBe(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 1, to: "ana@example.com", type: "fee_reminder", period: "2026-09",
    }));
  });

  it("al que ya pagó el mes NO se le avisa", async () => {
    const { cron, send } = build([socio()], { paidThisMonth: [1] });
    const s = await cron.run();
    expect(s.candidates).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("dedupe persistida: corrido dos veces, el segundo no reenvía", async () => {
    const { cron, send } = build([socio()], { notified: [1] });
    const s = await cron.run();
    expect(s.alreadyNotified).toBe(1);
    expect(s.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  // La mitad de arriba fija el filtro; ésta cierra el círculo: la fila que
  // escribe el mailer en la primera corrida es la que apaga la segunda. Es el
  // caso real —una línea duplicada en el crontab, un restart de PM2 en el
  // medio— y por eso la marca es una fila y no una variable de módulo.
  it("dos corridas del mismo día con una base que RECUERDA: un solo correo", async () => {
    const rows: Array<{ memberId: number; type: string; period: string | null; status: string }> = [];
    const send = vi.fn(async (input: { memberId: number; type: string; period?: string | null }) => {
      rows.push({ memberId: input.memberId, type: input.type, period: input.period ?? null, status: "sent" });
      return { messageId: "id" };
    });
    const db = {
      member: { findMany: vi.fn(async () => [socio()]) },
      fee: { findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
      notification: {
        findMany: vi.fn(async ({ where }: { where: { type: string; period: string } }) =>
          rows.filter((r) => r.type === where.type && r.period === where.period && r.status !== "failed")),
      },
    };
    const cron = makeReminderCron({
      db: db as never,
      mailer: { sendToMember: send as never },
      feeValues: { current: vi.fn(async () => ({ id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: new Date(), minuteId: null })) },
      now: () => LAST_DAY,
    });

    const first = await cron.run();
    const second = await cron.run();

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.alreadyNotified).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });

  it("la dedupe NO cuenta los intentos fallidos: un `failed` no bloquea el reintento", async () => {
    const { cron, db } = build([socio()]);
    await cron.run();
    expect(db.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: "fee_reminder", period: "2026-09", status: { not: "failed" },
      }),
    }));
  });

  it("el que no tiene casilla utilizable se cuenta aparte (va a la lista de gestión manual)", async () => {
    const { cron, send } = build([socio({ id: 2, email: null }), socio({ id: 3, emailStatus: "bounced" })]);
    const s = await cron.run();
    expect(s.noEmail).toBe(2);
    expect(send).not.toHaveBeenCalled();
  });

  it("si arrastra deuda, el correo la lleva a valor vigente", async () => {
    const { cron, send } = build([socio()], { pending: [{ memberId: 1, _count: { _all: 3 } }] });
    await cron.run();
    const msg = send.mock.calls[0][0].message;
    expect(msg.text).toContain("3");
    expect(msg.text).toContain("18.000"); // 3 × 6000, valor vigente del activo
  });

  it("el tope difiere lo que sobra y no lo pierde de vista", async () => {
    process.env.MAIL_BATCH_CAP = "1";
    const { cron, send } = build([socio({ id: 1 }), socio({ id: 2 })]);
    const s = await cron.run();
    expect(s.sent).toBe(1);
    expect(s.deferred).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("un envío que falla no frena a los demás y su CÓDIGO queda en errors[]", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED ana@example.com"), { code: "ECONNREFUSED" }))
      .mockResolvedValueOnce({ messageId: "id" });
    const { cron } = build([socio({ id: 1 }), socio({ id: 2 })], { send });
    const s = await cron.run();
    expect(s.sent).toBe(1);
    expect(s.errors).toEqual(["member:1: ECONNREFUSED"]);
    // Nunca la dirección: el error de nodemailer la trae en claro (docs/08).
    expect(s.errors[0]).not.toContain("@");
  });
});
