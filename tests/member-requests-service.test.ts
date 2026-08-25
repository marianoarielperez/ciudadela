import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/members/service", () => ({ electionsOngoing: vi.fn(async () => false) }));
import { makeMemberRequests } from "@/lib/members/member-requests/service";

const NOW = new Date("2026-09-01T12:00:00Z");

type Member = {
  id: number;
  fullName: string;
  status: string;
  category: string;
  memberships: Array<{ memberNumber: number; book: { status: string } }>;
};

function fakeDb(opts: { member: Member; electionsOngoing?: boolean }) {
  const state = {
    requests: [] as Array<Record<string, unknown> & { id: number }>,
    fees: [] as Array<{ memberId: number; status: string }>,
    movements: [] as Array<{ id: number; memberId: number; type: string; date: Date }>,
    nextId: 1,
  };
  const tx = {
    member: {
      findUnique: vi.fn(async (args: { where: { id: number } }) =>
        args.where.id === opts.member.id ? opts.member : null),
    },
    fee: {
      count: vi.fn(async (args: { where: { memberId: number; status: string } }) =>
        state.fees.filter((f) => f.memberId === args.where.memberId && f.status === args.where.status).length),
    },
    memberRequest: {
      count: vi.fn(async (args: { where: { memberId: number; type: string; status: string } }) =>
        state.requests.filter(
          (r) => r.memberId === args.where.memberId && r.type === args.where.type && r.status === args.where.status,
        ).length),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const row = { id: state.nextId++, ...args.data };
        state.requests.push(row);
        return row;
      }),
    },
  };
  const db = {
    member: tx.member,
    fee: tx.fee,
    memberRequest: {
      ...tx.memberRequest,
      updateMany: vi.fn(async (args: { where: { id: number; memberId?: number; status?: string }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const r of state.requests) {
          if (r.id !== args.where.id) continue;
          if (args.where.memberId !== undefined && r.memberId !== args.where.memberId) continue;
          if (args.where.status !== undefined && r.status !== args.where.status) continue;
          Object.assign(r, args.data);
          count++;
        }
        return { count };
      }),
      findUnique: vi.fn(async (args: { where: { id: number } }) => state.requests.find((r) => r.id === args.where.id) ?? null),
      update: vi.fn(async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = state.requests.find((r) => r.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      }),
    },
    movement: {
      findFirst: vi.fn(async (args: { where: { memberId: number; type: string } }) => {
        const candidates = state.movements
          .filter((m) => m.memberId === args.where.memberId && m.type === args.where.type)
          .sort((a, b) => (b.date.getTime() - a.date.getTime()) || (b.id - a.id));
        return candidates[0] ?? null;
      }),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const electionsOngoing = vi.fn(async () => opts.electionsOngoing ?? false);
  const service = makeMemberRequests({ db: db as never, electionsOngoing, now: () => NOW });
  return { service, db, tx, state, electionsOngoing };
}

function activeMember(over: Partial<Member> = {}): Member {
  return {
    id: 14, fullName: "Juana Pérez", status: "active", category: "adherent",
    memberships: [{ memberNumber: 15, book: { status: "open" } }],
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("memberRequests.create", () => {
  it("crea una solicitud de baja con el texto formal y el número del libro abierto", async () => {
    const { service, state } = fakeDb({ member: activeMember() });
    const r = await service.create({ memberId: 14, type: "withdrawal", message: "Me mudo del barrio." });
    expect(r).toEqual({ ok: true, requestId: 1 });
    expect(state.requests[0]).toMatchObject({ memberId: 14, type: "withdrawal", status: "pending", message: "Me mudo del barrio." });
    const text = state.requests[0].text as string;
    expect(text).toContain("Juana Pérez");
    expect(text).toContain("N° 15");
    expect(text).toContain("Motivo declarado: Me mudo del barrio.");
  });

  it("crea una solicitud de cambio de categoría con su propio texto", async () => {
    const { service, state } = fakeDb({ member: activeMember() });
    const r = await service.create({ memberId: 14, type: "category_change", requestedCategory: "active" });
    expect(r).toEqual({ ok: true, requestId: 1 });
    expect(state.requests[0]).toMatchObject({
      memberId: 14, type: "category_change", requestedCategory: "active", status: "pending",
    });
    expect(state.requests[0].text).toBe("Solicita el cambio de categoría de Adherente a Activo.");
  });

  it("una pendiente por tipo: la segunda solicitud del MISMO tipo falla", async () => {
    const { service } = fakeDb({ member: activeMember() });
    const first = await service.create({ memberId: 14, type: "withdrawal" });
    expect(first).toMatchObject({ ok: true });
    const second = await service.create({ memberId: 14, type: "withdrawal" });
    expect(second).toMatchObject({ ok: false });
    if (!second.ok) expect(second.error).toContain("Ya tenés una solicitud pendiente");
  });

  it("una pendiente por tipo bajo concurrencia REAL: dos create simultáneos del mismo tipo, uno solo prospera", async () => {
    // Sin `await` entre los dos llamados: las dos transacciones arrancan antes
    // de que la primera termine de leer. Si el mutex no serializara, las dos
    // verían `hasPendingOfType: false` y las dos escribirían — es exactamente
    // la ventana que la garantía tiene que cerrar.
    const { service, state } = fakeDb({ member: activeMember() });
    const [a, b] = await Promise.all([
      service.create({ memberId: 14, type: "withdrawal" }),
      service.create({ memberId: 14, type: "withdrawal" }),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(state.requests).toHaveLength(1);
  });

  it("una pendiente por tipo: tipos DISTINTOS pueden convivir pendientes a la vez", async () => {
    const { service } = fakeDb({ member: activeMember() });
    const withdrawal = await service.create({ memberId: 14, type: "withdrawal" });
    const categoryChange = await service.create({ memberId: 14, type: "category_change", requestedCategory: "active" });
    expect(withdrawal).toMatchObject({ ok: true });
    expect(categoryChange).toMatchObject({ ok: true });
  });

  it("delega en canCreateRequest: un suspendido no puede presentar nada", async () => {
    const { service } = fakeDb({ member: activeMember({ status: "suspended" }) });
    const r = await service.create({ memberId: 14, type: "withdrawal" });
    expect(r).toEqual({ ok: false, error: "Solo un socio vigente puede presentar solicitudes." });
  });

  it("delega en canCreateRequest: elecciones en curso bloquean el cambio de categoría", async () => {
    const { service } = fakeDb({ member: activeMember(), electionsOngoing: true });
    const r = await service.create({ memberId: 14, type: "category_change", requestedCategory: "active" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("elecciones");
  });

  it("socio inexistente: error, sin explotar", async () => {
    const { service } = fakeDb({ member: activeMember() });
    const r = await service.create({ memberId: 999, type: "withdrawal" });
    expect(r).toMatchObject({ ok: false });
  });
});

describe("memberRequests.cancel", () => {
  it("retira una solicitud propia pendiente", async () => {
    const { service, state } = fakeDb({ member: activeMember() });
    const created = await service.create({ memberId: 14, type: "withdrawal" });
    if (!created.ok) throw new Error("setup failed");
    const r = await service.cancel({ memberId: 14, requestId: created.requestId });
    expect(r).toEqual({ ok: true });
    expect(state.requests[0]).toMatchObject({ status: "cancelled", cancelledAt: NOW });
  });

  it("no cancela la solicitud de OTRO socio", async () => {
    const { service } = fakeDb({ member: activeMember() });
    const created = await service.create({ memberId: 14, type: "withdrawal" });
    if (!created.ok) throw new Error("setup failed");
    const r = await service.cancel({ memberId: 99, requestId: created.requestId });
    expect(r).toEqual({ ok: false, error: "La solicitud ya fue resuelta o no existe." });
  });

  it("una solicitud ya decidida no se puede retirar", async () => {
    const { service, state } = fakeDb({ member: activeMember() });
    const created = await service.create({ memberId: 14, type: "withdrawal" });
    if (!created.ok) throw new Error("setup failed");
    state.requests[0].status = "accepted";
    const r = await service.cancel({ memberId: 14, requestId: created.requestId });
    expect(r).toEqual({ ok: false, error: "La solicitud ya fue resuelta o no existe." });
  });

  it("una solicitud inexistente da el mismo error genérico", async () => {
    const { service } = fakeDb({ member: activeMember() });
    const r = await service.cancel({ memberId: 14, requestId: 12345 });
    expect(r).toEqual({ ok: false, error: "La solicitud ya fue resuelta o no existe." });
  });
});

describe("memberRequests.markAccepted", () => {
  it("toma el movimiento MÁS NUEVO del tipo correcto", async () => {
    const { service, state } = fakeDb({ member: activeMember() });
    const created = await service.create({ memberId: 14, type: "withdrawal" });
    if (!created.ok) throw new Error("setup failed");
    state.movements.push(
      { id: 1, memberId: 14, type: "withdrawal", date: new Date("2026-08-01T00:00:00Z") },
      { id: 2, memberId: 14, type: "withdrawal", date: new Date("2026-09-01T00:00:00Z") },
      { id: 3, memberId: 14, type: "category_change", date: new Date("2026-09-05T00:00:00Z") },
    );
    await service.markAccepted({ requestId: created.requestId, memberId: 14, decidedById: 7, type: "withdrawal" });
    expect(state.requests[0]).toMatchObject({
      status: "accepted", decidedById: 7, decidedAt: NOW, movementId: 2,
    });
  });

  it("category_change toma el movimiento de tipo category_change, no cualquiera", async () => {
    const { service, state } = fakeDb({ member: activeMember() });
    const created = await service.create({ memberId: 14, type: "category_change", requestedCategory: "active" });
    if (!created.ok) throw new Error("setup failed");
    state.movements.push(
      { id: 5, memberId: 14, type: "withdrawal", date: new Date("2026-09-10T00:00:00Z") },
      { id: 6, memberId: 14, type: "category_change", date: new Date("2026-09-02T00:00:00Z") },
    );
    await service.markAccepted({ requestId: created.requestId, memberId: 14, decidedById: 3, type: "category_change" });
    expect(state.requests[0]).toMatchObject({ status: "accepted", movementId: 6 });
  });
});

describe("memberRequests.reject", () => {
  it("rechaza una solicitud pendiente y devuelve memberId y type para notificar", async () => {
    const { service, state } = fakeDb({ member: activeMember() });
    const created = await service.create({ memberId: 14, type: "withdrawal" });
    if (!created.ok) throw new Error("setup failed");
    const r = await service.reject({ requestId: created.requestId, decidedById: 8, note: "No corresponde." });
    expect(r).toEqual({ ok: true, memberId: 14, type: "withdrawal" });
    expect(state.requests[0]).toMatchObject({
      status: "rejected", decidedById: 8, decidedAt: NOW, decisionNote: "No corresponde.",
    });
  });

  it("no rechaza una solicitud que ya no está pendiente", async () => {
    const { service, state } = fakeDb({ member: activeMember() });
    const created = await service.create({ memberId: 14, type: "withdrawal" });
    if (!created.ok) throw new Error("setup failed");
    state.requests[0].status = "cancelled";
    const r = await service.reject({ requestId: created.requestId, decidedById: 8 });
    expect(r).toMatchObject({ ok: false });
  });

  it("una solicitud inexistente da error", async () => {
    const { service } = fakeDb({ member: activeMember() });
    const r = await service.reject({ requestId: 999, decidedById: 8 });
    expect(r).toMatchObject({ ok: false });
  });
});
