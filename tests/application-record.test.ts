import { describe, expect, it, vi } from "vitest";

// El singleton del recorder importa @/lib/prisma (eager, explota sin .env).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeApplicationRecorder } from "@/lib/applications/record";

const MINUTE = { id: 10, type: "board", number: 3, date: new Date("2026-08-20T12:00:00Z") };
const VERIFIED_AT = new Date("2026-08-10T12:00:00Z");
// La antigüedad del ex socio que reingresa: REG-11 dice que no se reinicia, así
// que este valor tiene que sobrevivir al asiento.
const JOINED_AT = new Date("2019-09-01T12:00:00Z");

const APPLICATION = {
  id: 42,
  fullName: "Perez Ana",
  dni: "30111222",
  birthDate: new Date("1990-05-05T12:00:00Z"),
  civilStatus: "soltera",
  nationality: "argentina",
  occupation: "docente",
  phone: "2974000000",
  email: "ana@example.com",
  emailVerifiedAt: VERIFIED_AT as Date | null,
  streetId: 3,
  streetText: null,
  streetNumber: "123",
  neighborhood: null,
  requestedCategory: "active",
  wantsDebit: true,
  status: "approved_pending_minute",
  memberId: null as number | null,
};

const WITHDRAWN_MEMBER = {
  id: 7,
  fullName: "Perez Ana",
  status: "withdrawn",
  category: "adherent",
  withdrawalReason: "resignation" as string | null,
  reentryBlocked: false,
  debtAtWithdrawal: false,
  leftAt: new Date("2024-03-01T12:00:00Z"),
  joinedAt: JOINED_AT,
  userId: null as number | null,
  email: "ana@example.com" as string | null,
  emailStatus: "none",
  emailVerifiedAt: null as Date | null,
};

type Row = Record<string, unknown>;

type FakeConfig = {
  openBooks?: { id: number; number: number; status: string }[];
  member?: Row | null;
  // El DNI de Member es UNIQUE: una ficha vieja con ese documento hace que el
  // create explote con P2002, en inglés y en medio de un asiento societario.
  failMemberCreateP2002?: boolean;
};

function makeFakeDb(application: Partial<typeof APPLICATION> = {}, config: FakeConfig = {}) {
  const app = { ...APPLICATION, ...application };
  const member = config.member === undefined ? { ...WITHDRAWN_MEMBER } : config.member;
  const openBooks = config.openBooks ?? [{ id: 1, number: 1, status: "open" }];

  const state = {
    memberCreates: [] as Row[],
    memberUpdates: [] as Row[],
    membershipCreates: [] as Row[],
    movementCreates: [] as Row[],
    applicationUpdates: [] as Row[],
    subscriptionUpdates: [] as Row[],
    userUpdates: [] as Row[],
  };

  // Igual que el fake de tests/member-service.test.ts: un passthrough no
  // distinguiría atomicidad de secuencialidad, así que el fake fotografía el
  // estado antes del callback y lo restaura si algo lanza (lo que hace un
  // ROLLBACK). Envuelto en vi.fn() para poder afirmar que el asiento abre
  // transacción y no escribe por fuera.
  const db = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const snapshot = Object.fromEntries(
        Object.entries(state).map(([k, v]) => [k, [...v]]),
      ) as typeof state;
      try {
        return await cb(db);
      } catch (err) {
        Object.assign(state, snapshot);
        throw err;
      }
    }),
    application: {
      findUniqueOrThrow: async () => ({ ...app }),
      update: async ({ where, data }: { where: Row; data: Row }) => {
        state.applicationUpdates.push({ ...where, ...data });
        return data;
      },
    },
    minute: { findUniqueOrThrow: async () => ({ ...MINUTE }) },
    book: { findMany: async () => openBooks },
    membership: {
      aggregate: async () => ({ _max: { memberNumber: 305 } }),
      create: async ({ data }: { data: Row }) => {
        state.membershipCreates.push(data);
        return data;
      },
    },
    movement: {
      create: async ({ data }: { data: Row }) => {
        state.movementCreates.push(data);
        return data;
      },
    },
    user: {
      update: async ({ where, data }: { where: { id: number }; data: Row }) => {
        state.userUpdates.push({ id: where.id, ...data });
        return { id: where.id, ...data };
      },
    },
    member: {
      findUniqueOrThrow: async () => {
        if (!member) throw new Error("member not found");
        return { ...member };
      },
      create: async ({ data }: { data: Row }) => {
        if (config.failMemberCreateP2002) {
          throw Object.assign(new Error("Unique constraint failed on the fields: (`dni`)"), {
            code: "P2002",
            meta: { target: ["dni"] },
          });
        }
        state.memberCreates.push(data);
        return { id: 99, ...data };
      },
      update: async ({ where, data }: { where: { id: number }; data: Row }) => {
        state.memberUpdates.push(data);
        return { id: where.id, ...data };
      },
    },
    mpSubscription: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        state.subscriptionUpdates.push({ where, data });
        return { count: 1 };
      },
    },
  };
  return { db, state };
}

const record = (db: unknown, over: Partial<{ applicationId: number; minuteId: number; actorId: number }> = {}) =>
  makeApplicationRecorder(db as never).recordOne({
    applicationId: 42, minuteId: 10, actorId: 2, ...over,
  });

describe("el asiento de un ALTA COMÚN", () => {
  it("crea la ficha con los datos de la solicitud, el número siguiente del libro y la fecha del acta (REG-11)", async () => {
    const { db, state } = makeFakeDb({}, { member: null });
    const result = await record(db);

    expect(result).toMatchObject({
      ok: true, applicationId: 42, memberId: 99, memberNumber: 306, reentry: false,
    });
    expect(state.memberCreates[0]).toMatchObject({
      fullName: "Perez Ana", dni: "30111222", phone: "2974000000",
      civilStatus: "soltera", nationality: "argentina", occupation: "docente",
      streetId: 3, streetNumber: "123",
      category: "active", status: "active",
      autoDebit: true, // wantsDebit de la solicitud
      joinedAt: MINUTE.date, // REG-11: fecha de ingreso = fecha del acta
    });
    expect(state.membershipCreates[0]).toMatchObject({ memberId: 99, bookId: 1, memberNumber: 306 });
    expect(state.movementCreates[0]).toMatchObject({
      memberId: 99, type: "admission", date: MINUTE.date, minuteId: 10,
      newCategory: "active", createdById: 2,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  // Contrato con la Task 15 (verificación tardía de email): el asiento tiene que
  // dejar la solicitud apuntando a la ficha Y en `completed`, y la dirección
  // copiada a la ficha — la comparación normalizada del canje tardío usa esa
  // dirección como llave para saber si el enlace todavía autoriza algo.
  it("cierra la solicitud como completed, la ata a la ficha y copia la dirección de email", async () => {
    const { db, state } = makeFakeDb({}, { member: null });
    await record(db);

    expect(state.applicationUpdates[0]).toMatchObject({
      id: 42, status: "completed", minuteId: 10, memberId: 99,
    });
    expect(state.applicationUpdates[0].decidedAt).toBeInstanceOf(Date);
    expect(state.memberCreates[0]).toMatchObject({ email: "ana@example.com" });
  });

  it("reasigna la suscripción de MP de la solicitud al socio recién creado", async () => {
    const { db, state } = makeFakeDb({}, { member: null });
    await record(db);
    expect(state.subscriptionUpdates[0]).toEqual({
      where: { applicationId: 42 }, data: { memberId: 99 },
    });
  });

  it("la ficha nace verificada cuando la solicitud tenía el email confirmado", async () => {
    const { db, state } = makeFakeDb({}, { member: null });
    await record(db);
    expect(state.memberCreates[0]).toMatchObject({
      emailStatus: "verified", emailVerifiedAt: VERIFIED_AT,
    });
  });

  // Caso 5 del brief: sin doble opt-in la ficha nace `declared`. De esto cuelga
  // la tercera propiedad del contrato de la Task 15 — la invitación de acceso NO
  // sale hasta que el vecino confirme el buzón.
  it("la ficha nace declared cuando el email nunca se verificó", async () => {
    const { db, state } = makeFakeDb({ emailVerifiedAt: null }, { member: null });
    await record(db);
    expect(state.memberCreates[0]).toMatchObject({
      emailStatus: "declared", emailVerifiedAt: null, email: "ana@example.com",
    });
  });

  it("traduce el choque de DNI a un mensaje que dice qué hacer, y no deja nada escrito", async () => {
    const { db, state } = makeFakeDb({}, { member: null, failMemberCreateP2002: true });
    const result = await record(db);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/Ya existe un socio con el DNI de la solicitud #42/);
    expect(result.error).not.toMatch(/Unique constraint/);
    expect(state.membershipCreates).toHaveLength(0);
    expect(state.applicationUpdates).toHaveLength(0);
  });

  it("rechaza el alta en castellano cuando no hay ningún libro abierto", async () => {
    const { db, state } = makeFakeDb({}, { member: null, openBooks: [] });
    const result = await record(db);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/No hay ningún libro abierto/);
    expect(state.memberCreates).toHaveLength(0);
    expect(state.applicationUpdates).toHaveLength(0);
  });
});

describe("el asiento de un REINGRESO", () => {
  it("reactiva la ficha existente sin tocar la antigüedad ni numerar de nuevo (REG-25 / REG-11)", async () => {
    const { db, state } = makeFakeDb({ status: "pending_board", memberId: 7 });
    const result = await record(db);

    expect(result).toMatchObject({
      ok: true, applicationId: 42, memberId: 7, memberNumber: null, reentry: true,
    });
    expect(state.memberUpdates[0]).toMatchObject({
      status: "active", category: "active", withdrawalReason: null, leftAt: null,
      // Los datos de contacto y domicilio se refrescan con lo declarado en la
      // solicitud: es la información más nueva que tiene la asociación.
      phone: "2974000000", email: "ana@example.com", streetId: 3, streetNumber: "123",
    });
    // REG-11: el reingreso no reinicia la antigüedad. El schema no lo protege.
    expect(state.memberUpdates[0]).not.toHaveProperty("joinedAt");
    expect(state.movementCreates[0]).toMatchObject({
      memberId: 7, type: "readmission", date: MINUTE.date, minuteId: 10,
      newCategory: "active", createdById: 2,
    });
    // Un reingreso NO consume un número de libro nuevo: el socio conserva el suyo.
    expect(state.memberCreates).toHaveLength(0);
    expect(state.membershipCreates).toHaveLength(0);
    expect(state.applicationUpdates[0]).toMatchObject({
      id: 42, status: "completed", minuteId: 10, memberId: 7,
    });
  });

  it("le devuelve la cuenta al socio que la tenía", async () => {
    const { db, state } = makeFakeDb(
      { status: "pending_board", memberId: 7 },
      { member: { ...WITHDRAWN_MEMBER, userId: 55 } },
    );
    await record(db);
    expect(state.userUpdates).toEqual([{ id: 55, active: true }]);
  });

  it("no toca ninguna cuenta cuando la ficha nunca tuvo una", async () => {
    const { db, state } = makeFakeDb({ status: "pending_board", memberId: 7 });
    await record(db);
    expect(state.userUpdates).toEqual([]);
  });

  // Caso 3 del brief. La prohibición del Art. 5 inc. 2 es absoluta: `canReadmit`
  // la sostiene con doble señal y el asiento masivo no puede saltearla.
  it("rechaza el reingreso de un expulsado y no escribe absolutamente nada (REG-04)", async () => {
    const { db, state } = makeFakeDb(
      { status: "pending_board", memberId: 7 },
      { member: { ...WITHDRAWN_MEMBER, reentryBlocked: true } },
    );
    const result = await record(db);

    expect(result).toMatchObject({ ok: false, applicationId: 42 });
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/expulsión/);
    expect(state.memberUpdates).toHaveLength(0);
    expect(state.movementCreates).toHaveLength(0);
    expect(state.applicationUpdates).toHaveLength(0);
    expect(state.userUpdates).toHaveLength(0);
  });

  // Un ex socio que ya había acreditado ESTA casilla como domicilio electrónico
  // (Art. 5° quater) no la pierde por no volver a hacer clic en el correo: sin
  // esto el reingreso lo degradaría a `declared` y lo dejaría sin invitación al
  // portal sin ningún motivo.
  it("conserva la verificación de la ficha cuando la dirección no cambió", async () => {
    const OLD_VERIFIED = new Date("2023-01-15T12:00:00Z");
    const { db, state } = makeFakeDb(
      { status: "pending_board", memberId: 7, emailVerifiedAt: null },
      {
        member: {
          ...WITHDRAWN_MEMBER,
          email: "ANA@Example.com ", emailStatus: "verified", emailVerifiedAt: OLD_VERIFIED,
        },
      },
    );
    await record(db);
    expect(state.memberUpdates[0]).toMatchObject({
      email: "ana@example.com", emailStatus: "verified", emailVerifiedAt: OLD_VERIFIED,
    });
  });

  it("pero exige verificar de nuevo si la dirección declarada es otra", async () => {
    const { db, state } = makeFakeDb(
      { status: "pending_board", memberId: 7, emailVerifiedAt: null, email: "nueva@example.com" },
      {
        member: {
          ...WITHDRAWN_MEMBER,
          email: "vieja@example.com", emailStatus: "verified",
          emailVerifiedAt: new Date("2023-01-15T12:00:00Z"),
        },
      },
    );
    await record(db);
    expect(state.memberUpdates[0]).toMatchObject({
      email: "nueva@example.com", emailStatus: "declared", emailVerifiedAt: null,
    });
  });

  it("rechaza el reingreso de una ficha que sigue vigente", async () => {
    const { db, state } = makeFakeDb(
      { status: "pending_board", memberId: 7 },
      { member: { ...WITHDRAWN_MEMBER, status: "active", withdrawalReason: null } },
    );
    const result = await record(db);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/dado de baja/);
    expect(state.memberUpdates).toHaveLength(0);
  });
});

// Caso 4 del brief: la bandeja es una pantalla masiva y dos admins pueden estar
// mirándola a la vez. El estado se revalida DENTRO de la transacción del asiento.
describe("el asiento sólo alcanza a las solicitudes asentables", () => {
  for (const status of ["rejected", "completed", "expired", "started", "pending_payment"]) {
    it(`rechaza una solicitud ${status} sin escribir nada`, async () => {
      const { db, state } = makeFakeDb({ status }, { member: null });
      const result = await record(db);

      expect(result).toMatchObject({ ok: false, applicationId: 42 });
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toMatch(/ya fue resuelta|no está lista/);
      expect(state.memberCreates).toHaveLength(0);
      expect(state.memberUpdates).toHaveLength(0);
      expect(state.movementCreates).toHaveLength(0);
      expect(state.applicationUpdates).toHaveLength(0);
      expect(state.subscriptionUpdates).toHaveLength(0);
    });
  }

  // La Task 15 marca `emailVerifiedAt` en las TRES ramas del canje —solicitud
  // viva, cerrada y ya asentada—, así que el campo NO es señal de estado: una
  // solicitud rechazada puede tenerlo puesto. Quien filtre por estado es el
  // estado, y esto lo fija.
  it("una solicitud ya resuelta con el email verificado sigue sin poder asentarse", async () => {
    const { db, state } = makeFakeDb(
      { status: "rejected", emailVerifiedAt: VERIFIED_AT },
      { member: null },
    );
    const result = await record(db);
    expect(result.ok).toBe(false);
    expect(state.memberCreates).toHaveLength(0);
  });
});
