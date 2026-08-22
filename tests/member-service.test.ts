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
  // Hace fallar el asiento del movimiento para ejercitar el rollback: es el
  // último paso de casi toda acción, así que el update del socio ya está
  // aplicado cuando explota.
  failMovementCreate?: boolean;
  // Cuotas pendientes del socio al momento de la acción: la baja las cuenta
  // para congelar `debtAtWithdrawal` (REG-16).
  pendingFees?: number;
};

type FakeToken = { id: number; memberId: number; purpose: string; usedAt: Date | null };

// Los enlaces que ya viven cuando llega la acción societaria: la baja tiene que
// matar los del socio y ninguna otra acción tiene que tocarlos.
const LIVE_TOKENS: FakeToken[] = [
  { id: 1, memberId: 1, purpose: "email_verification", usedAt: null },
  { id: 2, memberId: 1, purpose: "password_invitation", usedAt: null },
  { id: 3, memberId: 1, purpose: "password_reset", usedAt: null }, // va atado a la cuenta, no a la ficha
  { id: 4, memberId: 1, purpose: "email_verification", usedAt: new Date("2026-01-02T00:00:00Z") }, // ya usado: es rastro
  { id: 5, memberId: 2, purpose: "email_verification", usedAt: null }, // de otro socio
];

function makeFakeDb(member: Record<string, unknown>, config: FakeConfig = {}) {
  const state = {
    member: { id: 1, status: "active", category: "adherent", reentryBlocked: false,
      debtAtWithdrawal: false, withdrawalReason: null, email: null, joinedAt: JOINED_AT, ...member },
    movements: [] as Record<string, unknown>[],
    memberships: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    tokens: LIVE_TOKENS.map((t) => ({ ...t })),
    // La cuenta del socio: la baja tiene que dejarla sin poder volver a entrar y
    // el reingreso tiene que devolvérsela.
    users: [{ id: 55, active: true }],
    userUpdates: [] as Record<string, unknown>[],
    // Los `where` con los que se contaron las cuotas: la baja tiene que contar
    // las del socio que da de baja y sólo las pendientes.
    feeCounts: [] as Record<string, unknown>[],
  };
  const openBooks = config.openBooks ?? [{ id: 1, number: 1, status: "open" }];
  const db = {
    // Un passthrough (`cb(db)`) no distingue atomicidad de secuencialidad: los
    // tests pasarían igual con las escrituras sueltas. Este fake fotografía el
    // estado antes del callback y lo restaura si algo lanza, que es lo que hace
    // un ROLLBACK. Va envuelto en `vi.fn()` para poder afirmar que las acciones
    // realmente abren transacción y no escriben por fuera.
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        member: { ...state.member },
        movements: [...state.movements],
        memberships: [...state.memberships],
        updates: [...state.updates],
        tokens: state.tokens.map((t) => ({ ...t })),
        users: state.users.map((u) => ({ ...u })),
        userUpdates: [...state.userUpdates],
      };
      try {
        return await cb(db);
      } catch (err) {
        state.member = snapshot.member;
        state.movements = snapshot.movements;
        state.memberships = snapshot.memberships;
        state.updates = snapshot.updates;
        state.tokens = snapshot.tokens;
        state.users = snapshot.users;
        state.userUpdates = snapshot.userUpdates;
        throw err;
      }
    }),
    configuration: { findUnique: async () => ({ value: config.elections ?? false }) },
    // Imita el filtro del motor con los tres predicados, como en tests/tokens.test.ts:
    // si la revocación se llamara con un `where` incompleto tiene que notarse acá.
    actionToken: {
      deleteMany: async ({
        where,
      }: { where: { memberId?: number; purpose?: { in: string[] }; usedAt?: null } }) => {
        const doomed = state.tokens.filter(
          (t) =>
            (where.memberId === undefined || t.memberId === where.memberId) &&
            (where.purpose === undefined || where.purpose.in.includes(t.purpose)) &&
            (where.usedAt === undefined || t.usedAt === where.usedAt),
        );
        state.tokens = state.tokens.filter((t) => !doomed.includes(t));
        return { count: doomed.length };
      },
    },
    book: { findMany: async () => openBooks },
    // `feeCounts` es registro de llamadas, no estado: a propósito NO se
    // restaura en el rollback, así se puede afirmar que el conteo ocurrió
    // aunque la transacción termine deshaciéndose.
    fee: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        state.feeCounts.push(where);
        return config.pendingFees ?? 0;
      },
    },
    minute: { findUniqueOrThrow: async () => MINUTE },
    membership: {
      aggregate: async () => ({ _max: { memberNumber: 305 } }),
      create: async ({ data }: { data: Record<string, unknown> }) => { state.memberships.push(data); return data; },
    },
    movement: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (config.failMovementCreate) throw new Error("movement insert failed");
        state.movements.push(data);
        return data;
      },
    },
    user: {
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = state.users.find((u) => u.id === where.id);
        if (!row) throw new Error("user not found");
        state.userUpdates.push({ id: where.id, ...data });
        Object.assign(row, data);
        return { ...row };
      },
    },
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
    expect(state.movements[0]).toMatchObject({
      type: "admission", minuteId: 10, newCategory: "active", createdById: 2, date: MINUTE.date,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
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
    expect(state.movements[0]).toMatchObject({ type: "withdrawal", reason: "arrears", minuteId: 10, date: MINUTE.date });
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

  // Una invitación emitida mientras el socio estaba vigente sigue sirviendo 7
  // días: en /verificar + /acceso le abre el alta de contraseña a quien tenga
  // ese buzón, que en una baja por fallecimiento suele ser un familiar.
  it("revokes the live email tokens of the member it withdraws", async () => {
    const { db, state } = makeFakeDb({ email: "vecino@example.com" });
    const svc = makeMemberService(db as never);
    await svc.withdraw({ memberId: 1, reason: "death", minuteId: 10, actorId: 2 });
    expect(state.tokens.map((t) => t.id).sort()).toEqual([3, 4, 5]);
  });

  // REG-16: la baja congela la deuda. El flag no lo escribe la pantalla de
  // deudores sino el servicio, así que sale igual por cesantía por mora, por
  // renuncia con deuda o por mudanza con deuda.
  it("freezes the debt flag from the fees pending at the moment of the withdrawal (REG-16)", async () => {
    const { db, state } = makeFakeDb({}, { pendingFees: 4 });
    const svc = makeMemberService(db as never);
    await svc.withdraw({ memberId: 1, reason: "arrears", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toMatchObject({ debtAtWithdrawal: true });
    // El conteo es el del socio y sólo el de las pendientes: contar todas las
    // cuotas marcaría con deuda a cualquiera que alguna vez pagó una.
    expect(state.feeCounts).toEqual([{ memberId: 1, status: "pending" }]);
  });

  it("marks no debt when the member leaves up to date, whatever the reason", async () => {
    const { db, state } = makeFakeDb({ debtAtWithdrawal: true }, { pendingFees: 0 });
    const svc = makeMemberService(db as never);
    await svc.withdraw({ memberId: 1, reason: "resignation", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toMatchObject({ debtAtWithdrawal: false });
    expect(state.member.debtAtWithdrawal).toBe(false);
  });

  // El flag y las cuotas que lo justifican tienen que moverse juntos: si el
  // asiento falla, el socio sigue vigente y no puede quedarle una marca de
  // deuda que nadie escribió.
  it("does not leave the debt flag set when the withdrawal rolls back", async () => {
    const { db, state } = makeFakeDb({}, { pendingFees: 6, failMovementCreate: true });
    const svc = makeMemberService(db as never);
    await expect(svc.withdraw({ memberId: 1, reason: "arrears", minuteId: 10, actorId: 2 }))
      .rejects.toThrow(/movement insert failed/);
    expect(state.feeCounts).toHaveLength(1);
    expect(state.member.debtAtWithdrawal).toBe(false);
    expect(state.member.status).toBe("active");
  });

  it("keeps the withdrawn member's tokens when the movement cannot be written", async () => {
    const { db, state } = makeFakeDb({ email: "vecino@example.com" }, { failMovementCreate: true });
    const svc = makeMemberService(db as never);
    await expect(svc.withdraw({ memberId: 1, reason: "death", minuteId: 10, actorId: 2 }))
      .rejects.toThrow(/movement insert failed/);
    expect(state.member.status).toBe("active");
    expect(state.tokens.map((t) => t.id).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

// Revocar el enlace no alcanza si la cuenta que ese enlace creó sigue entrando:
// la sesión es un JWT de 8 h sin revalidación. `requireMember` cierra el panel
// contra la fila viva; `user.active` es el cerrojo del RE-login.
describe("the account follows the card on withdrawal and readmission", () => {
  it("deactivates the member's account when the withdrawal is recorded", async () => {
    const { db, state } = makeFakeDb({ userId: 55 });
    const svc = makeMemberService(db as never);
    await svc.withdraw({ memberId: 1, reason: "death", minuteId: 10, actorId: 2 });
    expect(state.userUpdates).toEqual([{ id: 55, active: false }]);
    expect(state.users[0].active).toBe(false);
  });

  it("reactivates it on readmission", async () => {
    const { db, state } = makeFakeDb({
      userId: 55, status: "withdrawn", withdrawalReason: "resignation",
    });
    state.users[0].active = false;
    const svc = makeMemberService(db as never);
    await svc.readmit({ memberId: 1, category: "adherent", minuteId: 10, actorId: 2 });
    expect(state.userUpdates).toEqual([{ id: 55, active: true }]);
    expect(state.users[0].active).toBe(true);
  });

  it("does nothing when the member has no account yet", async () => {
    const { db, state } = makeFakeDb({ userId: null });
    const svc = makeMemberService(db as never);
    await svc.withdraw({ memberId: 1, reason: "death", minuteId: 10, actorId: 2 });
    await svc.readmit({ memberId: 1, category: "adherent", minuteId: 10, actorId: 2 });
    expect(state.userUpdates).toEqual([]);
  });

  // `user.active` NO es la herramienta de la suspensión: sería una tercera
  // fuente de verdad junto a `status` y `suspendedFrom/To`, y una suspensión
  // vencida por fecha sin acta de fin dejaría la cuenta muerta para siempre. Lo
  // que corta el panel de un suspendido es `requireMember` (REG-20).
  it("never touches the account on suspension, end of suspension or category change", async () => {
    const from = new Date("2026-09-01T12:00:00Z");
    const to = new Date("2026-10-01T12:00:00Z");
    const { db, state } = makeFakeDb({ userId: 55 });
    const svc = makeMemberService(db as never);
    await svc.changeCategory({ memberId: 1, newCategory: "active", minuteId: 10, actorId: 2 });
    await svc.suspend({ memberId: 1, from, to, minuteId: 10, actorId: 2 });
    await svc.endSuspension({ memberId: 1, minuteId: 10, actorId: 2 });
    expect(state.userUpdates).toEqual([]);
    expect(state.users[0].active).toBe(true);
  });

  it("leaves the account alone when the withdrawal rolls back", async () => {
    const { db, state } = makeFakeDb({ userId: 55 }, { failMovementCreate: true });
    const svc = makeMemberService(db as never);
    await expect(svc.withdraw({ memberId: 1, reason: "death", minuteId: 10, actorId: 2 }))
      .rejects.toThrow(/movement insert failed/);
    expect(state.users[0].active).toBe(true);
    expect(state.userUpdates).toEqual([]);
  });
});

// La suspensión es temporal y no le saca al socio el domicilio electrónico: el
// envío a un suspendido está habilitado (`verificationTarget`), así que matarle
// el enlace que ya recibió sería incoherente. El resto de las acciones no toca
// el email ni deja de reconocerlo como socio.
describe("statutory actions other than withdrawal keep the live tokens", () => {
  it("suspension, end of suspension, category change and readmission revoke nothing", async () => {
    const from = new Date("2026-09-01T12:00:00Z");
    const to = new Date("2026-10-01T12:00:00Z");
    const { db, state } = makeFakeDb({ email: "vecino@example.com" });
    const svc = makeMemberService(db as never);

    await svc.changeCategory({ memberId: 1, newCategory: "active", minuteId: 10, actorId: 2 });
    await svc.suspend({ memberId: 1, from, to, minuteId: 10, actorId: 2 });
    await svc.endSuspension({ memberId: 1, minuteId: 10, actorId: 2 });
    expect(state.tokens.map((t) => t.id).sort()).toEqual([1, 2, 3, 4, 5]);

    // Readmisión aparte: requiere un socio dado de baja (canReadmit), así que no
    // puede encadenarse sobre el mismo socio que arriba terminó "active" otra
    // vez. Es la fila de la tabla que más lo necesitaba: a diferencia de la
    // baja, acá no hay ningún `Movement` de tipo "readmission" que revoque nada.
    const readmission = makeFakeDb({
      email: "vecino@example.com", status: "withdrawn", withdrawalReason: "resignation",
    });
    await makeMemberService(readmission.db as never).readmit({
      memberId: 1, category: "adherent", minuteId: 10, actorId: 2,
    });
    expect(readmission.state.tokens.map((t) => t.id).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("admission of a brand new member revokes nothing", async () => {
    const { db, state } = makeFakeDb({ email: "vecino@example.com" });
    const svc = makeMemberService(db as never);
    await svc.admit({ fullName: "Perez Ana", category: "active", minuteId: 10, actorId: 2 });
    expect(state.tokens.map((t) => t.id).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("memberService.changeCategory", () => {
  it("changes category without touching joinedAt (REG-07)", async () => {
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    await svc.changeCategory({ memberId: 1, newCategory: "active", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toEqual({ category: "active" });
    expect(state.updates[0]).not.toHaveProperty("joinedAt");
    expect(state.movements[0]).toMatchObject({
      type: "category_change", previousCategory: "adherent", newCategory: "active", date: MINUTE.date,
    });
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
    // La fecha del asiento es la del acta, no la de la suspensión ni la de hoy.
    expect(state.movements[0]).toMatchObject({ type: "suspension", minuteId: 10, date: MINUTE.date });
    expect(state.movements[1]).toMatchObject({ type: "suspension_end", minuteId: 10, date: MINUTE.date });
  });
});

describe("memberService.readmit", () => {
  it("reactivates and keeps the debt flag for the M4 calculation (REG-16)", async () => {
    const { db, state } = makeFakeDb({ status: "withdrawn", withdrawalReason: "arrears", debtAtWithdrawal: true });
    const svc = makeMemberService(db as never);
    await svc.readmit({ memberId: 1, category: "active", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toMatchObject({ status: "active", category: "active", withdrawalReason: null, leftAt: null });
    expect(state.updates[0]).not.toHaveProperty("debtAtWithdrawal");
    expect(state.movements[0]).toMatchObject({ type: "readmission", minuteId: 10, date: MINUTE.date });
  });

  it("refuses to readmit an expelled member (REG-04)", async () => {
    const { db } = makeFakeDb({ status: "withdrawn", reentryBlocked: true });
    const svc = makeMemberService(db as never);
    await expect(svc.readmit({ memberId: 1, category: "active", minuteId: 10, actorId: 2 })).rejects.toThrow(/expulsión/);
  });

  // Una fila con motivo de expulsión y el flag caído no puede colarse por la
  // ventana: la prohibición del Art. 5 inc. 2 no admite excepción.
  it("refuses to readmit on an expulsion reason even with reentryBlocked false (REG-04)", async () => {
    const { db, state } = makeFakeDb({ status: "withdrawn", reentryBlocked: false, withdrawalReason: "expulsion" });
    const svc = makeMemberService(db as never);
    await expect(svc.readmit({ memberId: 1, category: "active", minuteId: 10, actorId: 2 })).rejects.toThrow(/expulsión/);
    expect(state.updates).toHaveLength(0);
    expect(state.movements).toHaveLength(0);
  });
});

// Toda acción estatutaria escribe DOS filas: el estado del socio y el asiento del
// movimiento. Si una queda sin la otra, el Libro deja de reflejar la realidad y
// la trazabilidad ante la IGJ se rompe. El schema no puede exigirlo: lo sostiene
// la transacción, y esto lo verifica.
describe("statutory actions are atomic", () => {
  it("opens a transaction for every action", async () => {
    const { db } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    const from = new Date("2026-09-01T12:00:00Z");
    const to = new Date("2026-10-01T12:00:00Z");

    await svc.admit({ fullName: "Perez Ana", category: "active", minuteId: 10, actorId: 2 });
    await svc.changeCategory({ memberId: 1, newCategory: "active", minuteId: 10, actorId: 2 });
    await svc.suspend({ memberId: 1, from, to, minuteId: 10, actorId: 2 });
    await svc.endSuspension({ memberId: 1, minuteId: 10, actorId: 2 });
    await svc.withdraw({ memberId: 1, reason: "arrears", minuteId: 10, actorId: 2 });
    await svc.readmit({ memberId: 1, category: "adherent", minuteId: 10, actorId: 2 });

    expect(db.$transaction).toHaveBeenCalledTimes(6);
  });

  it("rolls the member update back when the movement cannot be written", async () => {
    const { db, state } = makeFakeDb({}, { failMovementCreate: true });
    const svc = makeMemberService(db as never);

    await expect(svc.withdraw({ memberId: 1, reason: "arrears", minuteId: 10, actorId: 2 }))
      .rejects.toThrow(/movement insert failed/);

    expect(state.member.status).toBe("active");
    expect(state.member.withdrawalReason).toBeNull();
    expect(state.updates).toHaveLength(0);
    expect(state.movements).toHaveLength(0);
  });

  it("rolls the admission back when the movement cannot be written", async () => {
    const { db, state } = makeFakeDb({}, { failMovementCreate: true });
    const svc = makeMemberService(db as never);

    await expect(svc.admit({ fullName: "Perez Ana", category: "active", minuteId: 10, actorId: 2 }))
      .rejects.toThrow(/movement insert failed/);

    expect(state.memberships).toHaveLength(0);
    expect(state.movements).toHaveLength(0);
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
