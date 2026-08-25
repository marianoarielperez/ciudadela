import { beforeEach, describe, expect, it, vi } from "vitest";

// Revisión de Task 10 (5B) — arreglo 3: no había ninguna guarda de regresión
// sobre las tres propiedades que impiden cobrarle de más (o de menos) a un
// vecino cuando la Comisión le cambia la categoría:
//
//   1. ORDEN: si hay que empujar un monto nuevo, MP se toca ANTES que el
//      cambio local — así el corte total (arreglo 2 de la spec) tiene algo que
//      cortar.
//   2. CORTE: si MP rechaza el monto, no queda escrito NADA — ni el cambio de
//      categoría, ni el asiento, ni el redirect de éxito.
//   3. REGLA DE ORO: un socio SIN suscripción viva no nota ninguna diferencia
//      con el comportamiento de siempre — nunca se llama a MP.
//
// Mismo patrón que `tests/member-actions.test.ts` y
// `tests/auto-debit-action.test.ts`: se mockean los módulos de los que depende
// la action ("use server") y se ejercita `changeCategoryAction` de verdad. El
// gateway de MP y el lector de valor vigente son fábricas lazy
// (`@/lib/mp/gateway`, `@/lib/treasury/fee-values`), así que mockearlos es una
// línea cada uno — el informe anterior que decía que esto no se podía testear
// estaba equivocado.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUnique: vi.fn() },
    fee: { count: vi.fn(async () => 0) },
    minute: { findUnique: vi.fn(async () => ({ id: 5 })) },
    memberRequest: { findUnique: vi.fn() },
    mpSubscription: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.9"]])),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 7 })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

// `changeCategory` está en el doble a propósito, igual que `withdraw` en
// `member-actions.test.ts`: si no estuviera, "no se llamó" se cumpliría por la
// forma del doble y no por lo que hace la action.
vi.mock("@/lib/members/service", () => ({
  electionsOngoing: vi.fn(async () => false),
  memberService: { changeCategory: vi.fn(async () => ({ id: 12, category: "collaborator" })) },
}));

vi.mock("@/lib/members/withdraw-with-debits", () => ({
  withdrawWithDebits: { withdraw: vi.fn(async () => ({ debits: { cancelled: [], failed: [] } })) },
}));
vi.mock("@/lib/members/member-requests/service", () => ({
  memberRequests: { markAccepted: vi.fn(async () => {}) },
}));
vi.mock("@/lib/members/member-requests/notify", () => ({
  notifyRequestDecided: vi.fn(async () => {}),
}));

vi.mock("@/lib/mp/gateway", () => ({
  mpGateway: { updatePreapprovalAmount: vi.fn(async () => ({})) },
}));
vi.mock("@/lib/treasury/fee-values", () => ({
  feeValueReader: { current: vi.fn(async () => ({ activeAmount: 7000, sharedAmount: 3500 })) },
}));

import { redirect } from "next/navigation";
import { changeCategoryAction } from "@/app/admin/socios/[id]/actions";
import { audit } from "@/lib/audit";
import { memberService } from "@/lib/members/service";
import { mpGateway } from "@/lib/mp/gateway";
import { prisma } from "@/lib/prisma";

type MockedFn = ReturnType<typeof vi.fn>;

const db = prisma as unknown as {
  member: { findUnique: MockedFn };
  fee: { count: MockedFn };
  minute: { findUnique: MockedFn };
  mpSubscription: { findMany: MockedFn; update: MockedFn };
};

const ACTIVE_MEMBER = { id: 12, fullName: "Vecino Juan", category: "active", status: "active" };

function form(over: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = {
    memberId: "12", newCategory: "collaborator", minuteId: "5", ...over,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.member.findUnique.mockResolvedValue(ACTIVE_MEMBER);
  db.minute.findUnique.mockResolvedValue({ id: 5 });
  db.fee.count.mockResolvedValue(0);
  db.mpSubscription.findMany.mockResolvedValue([]);
  db.mpSubscription.update.mockResolvedValue({});
  vi.mocked(mpGateway.updatePreapprovalAmount).mockResolvedValue(undefined);
  vi.mocked(memberService.changeCategory).mockResolvedValue({ id: 12, category: "collaborator" } as never);
});

describe("changeCategoryAction — cableado con Mercado Pago (revisión Task 10)", () => {
  it("1. ORDEN: con plan, MP se toca ANTES que el cambio de categoría local", async () => {
    db.mpSubscription.findMany.mockResolvedValue([
      { preapprovalId: "pre-1", status: "authorized", amount: "1000" },
    ]);
    const calls: string[] = [];
    vi.mocked(mpGateway.updatePreapprovalAmount).mockImplementation(async () => {
      calls.push("mp");
    });
    vi.mocked(memberService.changeCategory).mockImplementation(async () => {
      calls.push("local");
      return { id: 12, category: "collaborator" } as never;
    });

    const r = await changeCategoryAction({}, form());

    expect(r?.error).toBeUndefined();
    expect(calls).toEqual(["mp", "local"]);
    expect(mpGateway.updatePreapprovalAmount).toHaveBeenCalledWith("pre-1", 3500);
  });

  it("2. CORTE: si MP rechaza el monto, no queda escrito nada", async () => {
    db.mpSubscription.findMany.mockResolvedValue([
      { preapprovalId: "pre-1", status: "authorized", amount: "1000" },
    ]);
    vi.mocked(mpGateway.updatePreapprovalAmount).mockRejectedValue(new Error("MP: preapproval rejected"));

    const r = await changeCategoryAction({}, form());

    expect(r.error).toBeTruthy();
    expect(memberService.changeCategory).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("3. REGLA DE ORO: sin suscripción viva, MP nunca se toca y el resto sigue igual", async () => {
    db.mpSubscription.findMany.mockResolvedValue([]);

    const r = await changeCategoryAction({}, form());

    expect(r?.error).toBeUndefined();
    expect(mpGateway.updatePreapprovalAmount).not.toHaveBeenCalled();
    expect(memberService.changeCategory).toHaveBeenCalledWith({
      memberId: 12, minuteId: 5, actorId: 7, newCategory: "collaborator",
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ subscriptionUpdated: false, subscriptionSkipped: "no_subscription" }),
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/socios/12");
  });

  it("4. espejo local best-effort: si falla, el cambio de categoría queda hecho igual y no hay error", async () => {
    db.mpSubscription.findMany.mockResolvedValue([
      { preapprovalId: "pre-1", status: "authorized", amount: "1000" },
    ]);
    db.mpSubscription.update.mockRejectedValue(new Error("timeout"));

    const r = await changeCategoryAction({}, form());

    expect(r?.error).toBeUndefined();
    expect(memberService.changeCategory).toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ subscriptionUpdated: true, preapprovalId: "pre-1", amount: 3500 }),
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/socios/12");
  });
});
