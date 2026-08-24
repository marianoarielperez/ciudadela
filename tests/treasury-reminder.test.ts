import { beforeEach, describe, expect, it, vi } from "vitest";
// `reminder.ts` exporta el singleton `reminderCron`, armado sobre el cliente
// real: sin este mock el módulo se cae al evaluarse si no hay DATABASE_URL
// (misma regla que `treasury-accrual.test.ts` — mockear ANTES de importar).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { makeReminderCron, reminderPeriodFor } from "@/lib/treasury/reminder";

const LAST_DAY = new Date("2026-09-30T13:00:00Z"); // 10:00 AR del 30/09
const MID_MONTH = new Date("2026-09-15T13:00:00Z");
// El caso que motivó la escotilla: el 30 el VPS estaba caído y el operador
// re-dispara el 1° a la mañana. 10:00 AR del 01/10.
const DAY_AFTER = new Date("2026-10-01T13:00:00Z");

type M = {
  id: number; fullName: string; email: string | null; emailStatus: string; category: string; joinedAt: Date;
};
// Socia del padrón: alta vieja, así que su piso de cobertura es el del import
// (septiembre de 2026) y el aviso de septiembre le corresponde.
const socio = (over: Partial<M> = {}): M => ({
  id: 1, fullName: "Ana Gómez", email: "ana@example.com", emailStatus: "verified", category: "active",
  joinedAt: new Date("2019-03-10T12:00:00Z"), ...over,
});

function build(members: M[], opts?: {
  paidThisMonth?: number[];
  notified?: number[];
  pending?: Array<{ memberId: number; _count: { _all: number } }>;
  readmissions?: Array<{ memberId: number; _max: { date: Date | null } }>;
  send?: ReturnType<typeof vi.fn>;
  now?: Date;
}) {
  const send = opts?.send ?? vi.fn(async () => ({ messageId: "id" }));
  const db = {
    member: { findMany: vi.fn(async () => members) },
    movement: { groupBy: vi.fn(async () => opts?.readmissions ?? []) },
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
      movement: { groupBy: vi.fn(async () => []) },
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

  // El piso de cobertura: el MISMO que aplica el devengo. La cuota de ingreso
  // cubre el mes del alta (REG-14), así que el mes en curso todavía no le
  // corresponde a quien entró este mes — y su pago de ingreso ni siquiera deja
  // una `Fee`, así que el filtro de "ya pagó" no lo salva.
  it("al que ingresó este mes NO se le reclama este mes", async () => {
    const { cron, send } = build([socio({ joinedAt: new Date("2026-09-25T12:00:00Z") })]);
    const s = await cron.run();
    expect(s.candidates).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("al que REINGRESÓ este mes tampoco (el reingreso sale del Movement, no de joinedAt)", async () => {
    const { cron, send } = build([socio()], {
      readmissions: [{ memberId: 1, _max: { date: new Date("2026-09-05T12:00:00Z") } }],
    });
    const s = await cron.run();
    expect(s.candidates).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("el socio viejo del padrón sí lo recibe, aunque en el mismo lote entre un alta de este mes", async () => {
    const { cron, send } = build([
      socio({ id: 1 }),
      socio({ id: 2, email: "beto@example.com", joinedAt: new Date("2026-09-25T12:00:00Z") }),
    ]);
    const s = await cron.run();
    expect(s.candidates).toBe(1);
    expect(s.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].memberId).toBe(1);
  });

  it("`exempt` cuenta como cubierto: no se reclama la cuota eximida", async () => {
    const { cron, db } = build([socio()]);
    await cron.run();
    expect(db.fee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ period: "2026-09", status: { in: ["paid", "exempt"] } }),
    }));
  });

  it("las atrasadas excluyen el mes en curso: no se nombra dos veces la misma cuota", async () => {
    const { cron, db } = build([socio()]);
    await cron.run();
    expect(db.fee.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "pending", period: { lt: "2026-09" } }),
    }));
  });

  // En producción `EMAIL_ALLOWLIST` sigue definida hasta el checklist de
  // lanzamiento: si el bloqueo contara como error, la corrida del 30 devolvería
  // 207 y /admin/salud mostraría el job en rojo todos los meses (spec §7.2).
  it("un bloqueo de la allowlist se cuenta aparte y NO ensucia la corrida", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("bloqueado"), { code: ALLOWLIST_BLOCK_CODE }))
      .mockResolvedValueOnce({ messageId: "id" });
    const { cron } = build([socio({ id: 1 }), socio({ id: 2, email: "beto@example.com" })], { send });
    const s = await cron.run();
    expect(s.allowlistBlocked).toBe(1);
    expect(s.sent).toBe(1);
    expect(s.errors).toEqual([]);
  });

  it("el bloqueado devuelve su lugar al presupuesto: no difiere a quien sí está en la lista", async () => {
    process.env.MAIL_BATCH_CAP = "1";
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("bloqueado"), { code: ALLOWLIST_BLOCK_CODE }))
      .mockResolvedValueOnce({ messageId: "id" });
    const { cron } = build([socio({ id: 1 }), socio({ id: 2, email: "beto@example.com" })], { send });
    const s = await cron.run();
    expect(s.allowlistBlocked).toBe(1);
    expect(s.sent).toBe(1);
    expect(s.deferred).toBe(0);
  });

  it("el correo del último día es el normal: vence mañana", async () => {
    const { cron, send } = build([socio()]);
    const s = await cron.run();
    expect(s.expired).toBe(false);
    expect(send.mock.calls[0][0].message.text).toContain("vence mañana");
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

// Escotilla de re-disparo (enmienda del operador, 24/08/2026). La corrida
// automática no cambia en nada: sigue cayendo el último día del mes y con el
// texto de siempre. Lo que se agrega es qué pasa cuando el operador la fuerza
// un día posterior.
describe("reminder cron — corrida forzada después del vencimiento", () => {
  it("el período avisado es el que vence hoy, o el último que YA venció", () => {
    // Último día del mes: el mes en curso, que vence mañana.
    expect(reminderPeriodFor(LAST_DAY)).toBe("2026-09");
    // Cualquier otro día: el último vencido. El 1° a la mañana, el aviso que
    // falta es el de SEPTIEMBRE — octubre recién vence dentro de un mes.
    expect(reminderPeriodFor(DAY_AFTER)).toBe("2026-09");
    expect(reminderPeriodFor(MID_MONTH)).toBe("2026-08");
    // Y el borde de año, con la zona argentina: a las 22:00 del 31/12 en UTC ya
    // es enero, y sigue siendo el último día de diciembre.
    expect(reminderPeriodFor(new Date("2027-01-01T01:00:00Z"))).toBe("2026-12");
    expect(reminderPeriodFor(new Date("2027-01-15T13:00:00Z"))).toBe("2026-12");
  });

  it("forzada el 1°, avisa por el mes que venció ayer y el correo lo dice", async () => {
    const { cron, send } = build([socio()], { now: DAY_AFTER });
    const s = await cron.run();
    expect(s.period).toBe("2026-09");
    expect(s.expired).toBe(true);
    expect(s.sent).toBe(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ period: "2026-09" }));
    const msg = send.mock.calls[0][0].message;
    expect(msg.subject).toContain("venció y quedó impaga");
    expect(msg.text).toContain("venció y quedó impaga");
    expect(msg.text).not.toContain("vence mañana");
  });

  // La variante NO sale de si vino `force`: sale del calendario. Forzar la
  // corrida el mismo 30 es re-disparar dentro de la ventana, y ahí "vence
  // mañana" sigue siendo verdad.
  it("forzada el MISMO último día del mes, manda el texto normal", async () => {
    const { cron, send } = build([socio()], { now: LAST_DAY });
    const s = await cron.run();
    expect(s.period).toBe("2026-09");
    expect(s.expired).toBe(false);
    expect(send.mock.calls[0][0].message.text).toContain("vence mañana");
    expect(send.mock.calls[0][0].message.subject).not.toContain("venció");
  });

  it("forzada un día 15, avisa por el mes anterior con el texto de vencida", async () => {
    // 15/10: el período avisado es septiembre, que venció el 30/09. (En
    // septiembre de 2026 la misma corrida no encontraría a nadie: agosto está
    // por debajo del piso de cobertura del import, que es exactamente lo que
    // ese piso significa.)
    const { cron, send } = build([socio()], { now: new Date("2026-10-15T13:00:00Z") });
    const s = await cron.run();
    expect(s.period).toBe("2026-09");
    expect(s.expired).toBe(true);
    expect(s.sent).toBe(1);
    expect(send.mock.calls[0][0].message.text).toContain("venció y quedó impaga");
  });

  it("la dedupe no cambia: al que ya recibió el aviso de septiembre no se lo repite", async () => {
    const { cron, send } = build([socio()], { now: DAY_AFTER, notified: [1] });
    const s = await cron.run();
    expect(s.period).toBe("2026-09");
    expect(s.alreadyNotified).toBe(1);
    expect(s.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("la dedupe forzada consulta el MISMO período que se avisa", async () => {
    const { cron, db } = build([socio()], { now: DAY_AFTER });
    await cron.run();
    expect(db.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: "fee_reminder", period: "2026-09", status: { not: "failed" } }),
    }));
    // Y el resto de las consultas mira ese mismo mes, no el del reloj.
    expect(db.fee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ period: "2026-09" }),
    }));
    expect(db.fee.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ period: { lt: "2026-09" } }),
    }));
  });

  it("el piso de cobertura sigue mandando: al que ingresó en septiembre no se le reclama septiembre el 1° de octubre", async () => {
    const { cron, send } = build([socio({ joinedAt: new Date("2026-09-25T12:00:00Z") })], { now: DAY_AFTER });
    const s = await cron.run();
    expect(s.candidates).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
