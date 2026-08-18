import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeMemberService } from "@/lib/members/service";

const MINUTE = { id: 10, type: "board", number: 3, date: new Date("2026-08-20T12:00:00Z") };
const JOINED_AT = new Date("2019-09-01T12:00:00Z");

type FakeConfig = {
  elections?: boolean;
  // El invariante "un solo libro abierto" no lo protege el schema: el fake tiene
  // que poder devolver cero y dos libros abiertos para ejercitar las dos guardas.
  openBooks?: { id: number; number: number; status: string }[];
};

function makeFakeDb(member: Record<string, unknown>, config: FakeConfig = {}) {
  const state = {
    member: { id: 1, status: "active", category: "adherent", reentryBlocked: false,
      debtAtWithdrawal: false, withdrawalReason: null, joinedAt: JOINED_AT, ...member },
    movements: [] as Record<string, unknown>[],
    memberships: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
  };
  const openBooks = config.openBooks ?? [{ id: 1, number: 1, status: "open" }];
  const db = {
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
    configuration: { findUnique: async () => ({ value: config.elections ?? false }) },
    book: { findMany: async () => openBooks },
    minute: { findUniqueOrThrow: async () => MINUTE },
    membership: {
      aggregate: async () => ({ _max: { memberNumber: 305 } }),
      create: async ({ data }: { data: Record<string, unknown> }) => { state.memberships.push(data); return data; },
    },
    movement: { create: async ({ data }: { data: Record<string, unknown> }) => { state.movements.push(data); return data; } },
    member: {
      // Prisma devuelve una fila materializada, no una referencia viva a la DB.
      // Devolver `state.member` directo aliasearía la lectura con el update
      // posterior (Object.assign) y `previousCategory` leería el valor NUEVO.
      findUniqueOrThrow: async () => ({ ...state.member }),
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 99, ...data }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        Object.assign(state.member, data);
        return { ...state.member };
      },
    },
  };
  return { db, state };
}

describe("memberService.admit", () => {
  it("assigns the next member number and uses the minute date as joinedAt (REG-11)", async () => {
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    const member = await svc.admit({ fullName: "Perez Ana", category: "active", minuteId: 10, actorId: 2 });
    expect(member.joinedAt).toEqual(MINUTE.date);
    expect(state.memberships[0]).toMatchObject({ memberNumber: 306 });
    expect(state.movements[0]).toMatchObject({ type: "admission", minuteId: 10, newCategory: "active", createdById: 2 });
  });

  it("refuses to admit when no book is open", async () => {
    const { db } = makeFakeDb({}, { openBooks: [] });
    const svc = makeMemberService(db as never);
    await expect(svc.admit({ fullName: "Perez Ana", category: "active", minuteId: 10, actorId: 2 }))
      .rejects.toThrow(/No hay ningún libro abierto/);
  });

  it("refuses to admit when more than one book is open (the schema does not enforce it)", async () => {
    const openBooks = [{ id: 1, number: 1, status: "open" }, { id: 2, number: 2, status: "open" }];
    const { db, state } = makeFakeDb({}, { openBooks });
    const svc = makeMemberService(db as never);
    await expect(svc.admit({ fullName: "Perez Ana", category: "active", minuteId: 10, actorId: 2 }))
      .rejects.toThrow(/más de un libro abierto/);
    expect(state.memberships).toHaveLength(0);
    expect(state.movements).toHaveLength(0);
  });
});

describe("memberService.withdraw", () => {
  it("records the reason, the minute date as leftAt and a movement", async () => {
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    await svc.withdraw({ memberId: 1, reason: "arrears", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toMatchObject({ status: "withdrawn", withdrawalReason: "arrears", leftAt: MINUTE.date });
    expect(state.movements[0]).toMatchObject({ type: "withdrawal", reason: "arrears", minuteId: 10 });
  });

  it("expulsion blocks any future reentry (REG-04)", async () => {
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    await svc.withdraw({ memberId: 1, reason: "expulsion", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toMatchObject({ reentryBlocked: true });
  });

  it("refuses to withdraw an already withdrawn member", async () => {
    const { db } = makeFakeDb({ status: "withdrawn" });
    const svc = makeMemberService(db as never);
    await expect(svc.withdraw({ memberId: 1, reason: "death", minuteId: 10, actorId: 2 })).rejects.toThrow(/ya está dado de baja/);
  });
});

describe("memberService.changeCategory", () => {
  it("changes category without touching joinedAt (REG-07)", async () => {
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    await svc.changeCategory({ memberId: 1, newCategory: "active", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toEqual({ category: "active" });
    expect(state.updates[0]).not.toHaveProperty("joinedAt");
    expect(state.movements[0]).toMatchObject({ type: "category_change", previousCategory: "adherent", newCategory: "active" });
  });

  it("is blocked while an election is ongoing (REG-07)", async () => {
    const { db } = makeFakeDb({}, { elections: true });
    const svc = makeMemberService(db as never);
    await expect(svc.changeCategory({ memberId: 1, newCategory: "active", minuteId: 10, actorId: 2 })).rejects.toThrow(/elecciones/);
  });
});

describe("memberService.suspend / endSuspension", () => {
  it("stores the suspension window and clears it when lifted", async () => {
    const from = new Date("2026-09-01T12:00:00Z");
    const to = new Date("2026-10-01T12:00:00Z");
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    await svc.suspend({ memberId: 1, from, to, minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toMatchObject({ status: "suspended", suspendedFrom: from, suspendedTo: to });
    await svc.endSuspension({ memberId: 1, minuteId: 10, actorId: 2 });
    expect(state.updates[1]).toMatchObject({ status: "active", suspendedFrom: null, suspendedTo: null });
    expect(state.movements.map((m) => m.type)).toEqual(["suspension", "suspension_end"]);
  });
});

describe("memberService.readmit", () => {
  it("reactivates and keeps the debt flag for the M4 calculation (REG-16)", async () => {
    const { db, state } = makeFakeDb({ status: "withdrawn", withdrawalReason: "arrears", debtAtWithdrawal: true });
    const svc = makeMemberService(db as never);
    await svc.readmit({ memberId: 1, category: "active", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toMatchObject({ status: "active", category: "active", withdrawalReason: null, leftAt: null });
    expect(state.updates[0]).not.toHaveProperty("debtAtWithdrawal");
    expect(state.movements[0]).toMatchObject({ type: "readmission" });
  });

  it("refuses to readmit an expelled member (REG-04)", async () => {
    const { db } = makeFakeDb({ status: "withdrawn", reentryBlocked: true });
    const svc = makeMemberService(db as never);
    await expect(svc.readmit({ memberId: 1, category: "active", minuteId: 10, actorId: 2 })).rejects.toThrow(/expulsión/);
  });
});

// REG-11: joinedAt es la antigüedad del socio y el estatuto dice que nunca se
// reinicia. El schema no lo protege (es una columna cualquiera), así que el
// invariante vive acá: ninguna acción salvo `admit` puede escribirlo.
describe("Member.joinedAt is immutable after admission", () => {
  it("no statutory action other than admit ever writes joinedAt", async () => {
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    const from = new Date("2026-09-01T12:00:00Z");
    const to = new Date("2026-10-01T12:00:00Z");

    await svc.changeCategory({ memberId: 1, newCategory: "active", minuteId: 10, actorId: 2 });
    await svc.suspend({ memberId: 1, from, to, minuteId: 10, actorId: 2 });
    await svc.endSuspension({ memberId: 1, minuteId: 10, actorId: 2 });
    await svc.withdraw({ memberId: 1, reason: "arrears", minuteId: 10, actorId: 2 });
    await svc.readmit({ memberId: 1, category: "adherent", minuteId: 10, actorId: 2 });

    expect(state.updates).toHaveLength(5);
    for (const update of state.updates) expect(update).not.toHaveProperty("joinedAt");
    expect(state.member.joinedAt).toEqual(JOINED_AT);
  });
});
