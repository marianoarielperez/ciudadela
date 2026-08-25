// Task 12 (5B): servicio de adhesión y cancelación del débito del socio.
// Deps FAKES en todo el archivo: acá no hay red ni SDK — lo que se fija es el
// ORDEN de las guardas (ninguna llamada a MP antes de agotarlas), la forma de
// la fila local (memberId puesto, linkedManually: false) y los dos finales
// delicados: el catch de persistencia que NO invita a reintentar y el espejo
// local que falla después de una cancelación que MP ya aceptó.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: {} }));
vi.mock("@/lib/treasury/fee-values", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  feeValueReader: {},
}));
import { makeMemberDebit } from "@/lib/members/member-debit";

const NOW = new Date("2026-09-15T12:00:00Z");
const FEE = { id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: new Date("2026-01-01T12:00:00Z"), minuteId: null };

type MemberRow = {
  id: number; category: string; email: string | null; status: string; joinedAt: Date;
};

function deps(over: {
  member?: Partial<MemberRow>;
  paidCount?: number;
  subs?: Array<{ status: string }>;
  fee?: typeof FEE | null;
  feePeriods?: string[];
  readmission?: { date: Date } | null;
  cancelSub?: { preapprovalId: string; status: string } | null;
  otherSubs?: Array<{ status: string }>;
  latestSub?: { preapprovalId: string; status: string } | null;
} = {}) {
  const member: MemberRow = {
    id: 14, category: "active", email: "vecino@x.com", status: "active",
    joinedAt: new Date("2026-08-21T12:00:00Z"),
    ...over.member,
  };
  const tx = {
    mpSubscription: { create: vi.fn(async () => ({ id: 1 })) },
    member: { update: vi.fn(async () => ({})) },
  };
  const db = {
    member: {
      findUniqueOrThrow: vi.fn(async () => member),
      update: vi.fn(async () => ({})),
    },
    payment: { count: vi.fn(async () => over.paidCount ?? 0) },
    mpSubscription: {
      findMany: vi.fn(async (args: { where?: { preapprovalId?: unknown } }) =>
        args?.where && "preapprovalId" in (args.where as object)
          ? (over.otherSubs ?? [])
          : (over.subs ?? []),
      ),
      findFirst: vi.fn(async (args: { where: { preapprovalId?: string } }) =>
        args.where.preapprovalId !== undefined
          ? (over.cancelSub === undefined ? { preapprovalId: "pre-1", status: "authorized" } : over.cancelSub)
          : (over.latestSub === undefined ? { preapprovalId: "pre-1", status: "pending" } : over.latestSub),
      ),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    fee: { findMany: vi.fn(async () => (over.feePeriods ?? []).map((period) => ({ period }))) },
    movement: { findFirst: vi.fn(async () => over.readmission ?? null) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const gateway = {
    createPreapproval: vi.fn(async () => ({ id: "pre-new", initPoint: "https://mp/x", status: "pending" })),
    getPreapproval: vi.fn(async () => ({
      id: "pre-1", status: "authorized", payerEmail: "vecino@x.com", externalReference: "socio:14",
      amount: 6000, reason: "Cuota", nextPaymentDate: null, dateCreated: null,
    })),
    cancelPreapproval: vi.fn(async () => undefined),
  };
  const feeValues = { current: vi.fn(async () => (over.fee === undefined ? FEE : over.fee)) };
  const service = makeMemberDebit({
    db: db as never, gateway: gateway as never, feeValues,
    baseUrl: () => "https://vecinalciudadela.ar", now: () => NOW,
  });
  return { service, db, tx, gateway, feeValues };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("memberDebit.start", () => {
  it("happy path: crea el preapproval y la fila local con memberId y linkedManually: false, y prende autoDebit", async () => {
    const d = deps();
    const r = await d.service.start({ memberId: 14 });
    expect(r).toEqual({
      ok: true,
      checkoutUrl:
        "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-new&activation=true",
    });
    expect(d.gateway.createPreapproval).toHaveBeenCalledWith({
      reason: "Cuota Vecinal Ciudadela",
      amount: 6000,
      payerEmail: "vecino@x.com",
      externalReference: "socio:14",
      backUrl: "https://vecinalciudadela.ar/mi/debito?volvio=1",
    });
    // La fila nace con memberId puesto: es lo que hace que los cobros entren
    // solos por la regla 3 de resolve.ts sin pasar por la bandeja.
    expect(d.tx.mpSubscription.create).toHaveBeenCalledWith({ data: {
      preapprovalId: "pre-new", memberId: 14, planId: null, status: "pending",
      payerEmail: "vecino@x.com", amount: "6000.00", externalReference: "socio:14",
      linkedManually: false, lastSyncAt: NOW,
    } });
    // `canStillCharge("pending")` es true: se promete el débito ya (mismo
    // criterio que link-subscription.ts).
    expect(d.tx.member.update).toHaveBeenCalledWith({ where: { id: 14 }, data: { autoDebit: true } });
  });

  it("una suscripción todavía cobrable bloquea SIN llamar al gateway", async () => {
    const d = deps({ subs: [{ status: "paused" }] });
    const r = await d.service.start({ memberId: 14 });
    expect(r).toEqual({
      ok: false,
      error: "Ya tenés un débito automático activo. Si querés cambiarlo, primero cancelalo.",
    });
    expect(d.gateway.createPreapproval).not.toHaveBeenCalled();
    expect(d.db.$transaction).not.toHaveBeenCalled();
  });

  it("un pago del mes civil argentino bloquea SIN llamar al gateway, y el conteo usa los límites AR", async () => {
    const d = deps({ paidCount: 1 });
    const r = await d.service.start({ memberId: 14 });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("Ya abonaste una cuota este mes");
    expect(d.gateway.createPreapproval).not.toHaveBeenCalled();
    // El mes civil AR: el 1° a las 00:00 AR es 03:00Z (calcado de monthBoundsAR).
    expect(d.db.payment.count).toHaveBeenCalledWith({
      where: {
        memberId: 14, status: "applied",
        type: { in: ["debit", "link", "cash", "entry"] },
        paidAt: { gte: new Date("2026-09-01T03:00:00Z"), lt: new Date("2026-10-01T03:00:00Z") },
      },
    });
  });

  it("sin valor de cuota vigente corta ANTES de llamar a MP", async () => {
    const d = deps({ fee: null });
    const r = await d.service.start({ memberId: 14 });
    expect(r).toEqual({
      ok: false,
      error: "El valor de la cuota todavía no está publicado. Probá más tarde.",
    });
    expect(d.gateway.createPreapproval).not.toHaveBeenCalled();
  });

  it("socio no activo → error genérico sin llamar a MP (defensa en profundidad)", async () => {
    const d = deps({ member: { status: "suspended" } });
    const r = await d.service.start({ memberId: 14 });
    expect(r).toMatchObject({ ok: false });
    expect(d.gateway.createPreapproval).not.toHaveBeenCalled();
    expect(d.db.$transaction).not.toHaveBeenCalled();
  });

  it("si MP rechaza la creación, el error SÍ invita a reintentar (no quedó nada vivo)", async () => {
    const d = deps();
    d.gateway.createPreapproval.mockRejectedValueOnce({ status: 400, message: "bad" });
    const r = await d.service.start({ memberId: 14 });
    expect(r).toEqual({
      ok: false,
      error: "No pudimos iniciar la adhesión en Mercado Pago. Probá de nuevo en unos minutos.",
    });
    expect(d.db.$transaction).not.toHaveBeenCalled();
  });

  it("si la base falla con el preapproval YA vivo en MP, el error NO invita a reintentar", async () => {
    const d = deps();
    d.db.$transaction.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "P1001" }));
    const r = await d.service.start({ memberId: 14 });
    expect(r).toEqual({
      ok: false,
      error: "No pudimos registrar la adhesión. NO vuelvas a intentarlo: comunicate con la vecinal.",
    });
    // El log lleva el preapprovalId (reconciliable a mano) y jamás el email.
    const logged = (console.error as ReturnType<typeof vi.fn>).mock.calls.flat().map((a) => JSON.stringify(a)).join(" ");
    expect(logged).toContain("pre-new");
    expect(logged).not.toContain("vecino@x.com");
  });
});

describe("memberDebit.preview", () => {
  it("devuelve veredicto, próximos períodos y el monto unitario, sin tocar MP", async () => {
    const d = deps();
    const r = await d.service.preview({ memberId: 14 });
    expect(r.verdict).toEqual({ ok: true });
    expect(r.unit).toBe(6000);
    // joinedAt 21/08/2026 → la cuota de ingreso cubre agosto (REG-14): el
    // primer período que un débito iría creando es septiembre.
    expect(r.upcoming[0]).toBe("2026-09");
    expect(r.upcoming).toHaveLength(60);
    expect(d.gateway.createPreapproval).not.toHaveBeenCalled();
    expect(d.gateway.getPreapproval).not.toHaveBeenCalled();
    expect(d.db.movement.findFirst).toHaveBeenCalledWith({
      where: { memberId: 14, type: "readmission" },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { date: true },
    });
  });

  it("sin valor vigente el unit es null y el veredicto no se rompe", async () => {
    const d = deps({ fee: null });
    const r = await d.service.preview({ memberId: 14 });
    expect(r.verdict).toEqual({ ok: true });
    expect(r.unit).toBeNull();
  });

  it("veredicto bloqueado por suscripción viva, con upcoming igual calculado", async () => {
    const d = deps({ subs: [{ status: "authorized" }] });
    const r = await d.service.preview({ memberId: 14 });
    expect(r.verdict).toEqual({ ok: false, reason: "active_subscription" });
  });
});

describe("memberDebit.syncStatus", () => {
  it("sin suscripción → { status: null } sin tocar MP", async () => {
    const d = deps({ latestSub: null });
    expect(await d.service.syncStatus({ memberId: 14 })).toEqual({ status: null });
    expect(d.gateway.getPreapproval).not.toHaveBeenCalled();
  });

  it("refresca contra MP y actualiza el espejo local", async () => {
    const d = deps({ latestSub: { preapprovalId: "pre-1", status: "pending" } });
    expect(await d.service.syncStatus({ memberId: 14 })).toEqual({ status: "authorized" });
    // El `where` filtra por memberId: sin eso, cualquiera podría refrescar (y
    // espejar) la suscripción de otro socio conociendo su preapprovalId.
    expect(d.db.mpSubscription.findFirst).toHaveBeenCalledWith({
      where: { memberId: 14 },
      orderBy: { id: "desc" },
      select: { preapprovalId: true, status: true },
    });
    expect(d.gateway.getPreapproval).toHaveBeenCalledWith("pre-1");
    expect(d.db.mpSubscription.update).toHaveBeenCalledWith({
      where: { preapprovalId: "pre-1" },
      data: { status: "authorized", lastSyncAt: NOW },
    });
  });

  it("si MP no contesta devuelve el status local sin escribir (best-effort)", async () => {
    const d = deps({ latestSub: { preapprovalId: "pre-1", status: "pending" } });
    d.gateway.getPreapproval.mockRejectedValueOnce({ status: 500 });
    expect(await d.service.syncStatus({ memberId: 14 })).toEqual({ status: "pending" });
    expect(d.db.mpSubscription.update).not.toHaveBeenCalled();
  });
});

describe("memberDebit.cancel", () => {
  it("una suscripción ajena devuelve el error genérico SIN llamar al gateway (sin oráculo)", async () => {
    const d = deps({ cancelSub: null });
    expect(await d.service.cancel({ memberId: 14, preapprovalId: "pre-ajena" })).toEqual({
      ok: false, error: "La suscripción no existe.",
    });
    expect(d.gateway.cancelPreapproval).not.toHaveBeenCalled();
  });

  it("una ya cancelada no vuelve a MP", async () => {
    const d = deps({ cancelSub: { preapprovalId: "pre-1", status: "cancelled" } });
    expect(await d.service.cancel({ memberId: 14, preapprovalId: "pre-1" })).toEqual({
      ok: false, error: "Ese débito ya está cancelado.",
    });
    expect(d.gateway.cancelPreapproval).not.toHaveBeenCalled();
  });

  it("si MP rechaza la cancelación, nada local se toca y el error lo dice", async () => {
    const d = deps();
    d.gateway.cancelPreapproval.mockRejectedValueOnce({ status: 500, message: "boom" });
    expect(await d.service.cancel({ memberId: 14, preapprovalId: "pre-1" })).toEqual({
      ok: false,
      error: "Mercado Pago no aceptó la cancelación. Probá más tarde o consultá en la sede.",
    });
    expect(d.db.mpSubscription.update).not.toHaveBeenCalled();
    expect(d.db.member.update).not.toHaveBeenCalled();
  });

  it("happy path: cancela en MP, espeja local y baja autoDebit si no queda otra cobrable", async () => {
    const d = deps({ otherSubs: [{ status: "cancelled" }] });
    expect(await d.service.cancel({ memberId: 14, preapprovalId: "pre-1" })).toEqual({ ok: true });
    // El `where` de la búsqueda de la suscripción a cancelar lleva memberId:
    // sin eso, un socio podría cancelar el débito de OTRO conociendo su id.
    expect(d.db.mpSubscription.findFirst).toHaveBeenCalledWith({
      where: { preapprovalId: "pre-1", memberId: 14 },
      select: { preapprovalId: true, status: true },
    });
    expect(d.gateway.cancelPreapproval).toHaveBeenCalledWith("pre-1");
    expect(d.db.mpSubscription.update).toHaveBeenCalledWith({
      where: { preapprovalId: "pre-1" },
      data: { status: "cancelled", lastSyncAt: NOW },
    });
    // El reconteo EXCLUYE la recién cancelada (`not`, no igualdad): si fuera
    // igualdad, se bajaría autoDebit mirando solo la que ya se cancela.
    expect(d.db.mpSubscription.findMany).toHaveBeenCalledWith({
      where: { memberId: 14, preapprovalId: { not: "pre-1" } },
      select: { status: true },
    });
    expect(d.db.member.update).toHaveBeenCalledWith({ where: { id: 14 }, data: { autoDebit: false } });
  });

  it("autoDebit NO se baja si al socio le queda otra suscripción cobrable", async () => {
    const d = deps({ otherSubs: [{ status: "authorized" }] });
    expect(await d.service.cancel({ memberId: 14, preapprovalId: "pre-1" })).toEqual({ ok: true });
    expect(d.db.member.update).not.toHaveBeenCalled();
  });

  it("si el espejo local falla después de que MP ya canceló, devuelve ok: true igual", async () => {
    const d = deps();
    d.db.mpSubscription.update.mockRejectedValueOnce(new Error("db down"));
    // MP ya canceló: decirle al socio que falló lo mandaría a cancelar dos veces.
    expect(await d.service.cancel({ memberId: 14, preapprovalId: "pre-1" })).toEqual({ ok: true });
  });
});
