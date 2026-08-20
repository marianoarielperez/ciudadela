import { describe, expect, it, vi } from "vitest";

// El singleton del service importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  DuplicateLiveApplicationError, LIVE_APPLICATION_STATUSES, makeApplicationService,
} from "@/lib/applications/service";
import { hashToken } from "@/lib/tokens";

// El fake pasa el mismo objeto de mocks como `tx`, así que la sola llamada no
// prueba nada sobre DÓNDE corrió el chequeo. `state.inTransaction` es el testigo:
// se prende justo antes de invocar el callback de `$transaction` y se apaga al
// salir, y cada mock anota el valor que vio. Si alguien mueve el `findFirst`
// afuera de la transacción, `seenInTransaction` queda en false y el test cae.
function fakeDb() {
  const state = { inTransaction: false };
  const seenInTransaction: Record<string, boolean[]> = { findFirst: [], create: [] };
  const witness = (name: keyof typeof seenInTransaction) => {
    seenInTransaction[name].push(state.inTransaction);
  };

  // Filas vivas por DNI; los casos las fijan con `setLive`.
  const live = new Map<string, { id: number }>();
  const application = {
    findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
      witness("findFirst");
      return live.get(String(args.where.dni)) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      witness("create");
      return { id: 55, ...data };
    }),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({ id: 55 }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const db = {
    application,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      state.inTransaction = true;
      try {
        return await fn({ application });
      } finally {
        state.inTransaction = false;
      }
    }),
  };
  return {
    db: db as never,
    application,
    transaction: db.$transaction,
    seenInTransaction,
    setLive(dni: string, row: { id: number }) {
      live.set(dni, row);
    },
  };
}

const input = {
  fullName: "Vecina Prueba", dni: "30111222", birthDate: new Date("1990-05-05T12:00:00Z"),
  civilStatus: "soltera", nationality: "argentina", occupation: "docente",
  phone: "2974000000", email: "test@x.com", streetId: 3, streetText: null,
  streetNumber: "123", neighborhood: null, requestedCategory: "active" as const,
  wantsDebit: true, memberId: null, acceptedTermsAt: new Date(), ip: "1.1.1.1", userAgent: "vitest",
};

describe("applicationService.create", () => {
  it("crea la solicitud started con el hash del token (nunca el crudo)", async () => {
    const { db, application } = fakeDb();
    const svc = makeApplicationService(db);
    const { id, resumeToken } = await svc.create(input);
    expect(id).toBe(55);
    expect(resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url de 32 bytes
    const data = application.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.resumeTokenHash).toBe(hashToken(resumeToken));
    expect(data.status).toBeUndefined(); // default started del schema
    expect(JSON.stringify(data)).not.toContain(resumeToken);
  });

  it("rechaza si hay una solicitud viva con el mismo DNI", async () => {
    const { db, application, setLive } = fakeDb();
    setLive(input.dni, { id: 9 });
    const svc = makeApplicationService(db);
    await expect(svc.create(input)).rejects.toBeInstanceOf(DuplicateLiveApplicationError);
    expect(application.findFirst.mock.calls[0][0].where.status).toEqual({ in: LIVE_APPLICATION_STATUSES });
    expect(application.create).not.toHaveBeenCalled();
  });

  it("el chequeo de unicidad corre DENTRO de la transacción, igual que el create", async () => {
    const { db, application, transaction, seenInTransaction } = fakeDb();
    const svc = makeApplicationService(db);
    await svc.create(input);

    // Ambos vieron el testigo prendido: corrieron entre el inicio y el fin del
    // callback de `$transaction`, no antes ni después.
    expect(seenInTransaction.findFirst).toEqual([true]);
    expect(seenInTransaction.create).toEqual([true]);
    // Y la transacción se abrió antes que el chequeo (cinturón y tirantes).
    expect(transaction.mock.invocationCallOrder[0])
      .toBeLessThan(application.findFirst.mock.invocationCallOrder[0]);
  });

  it("serializa dos create simultáneos del mismo DNI: el segundo ve al primero", async () => {
    // La transacción NO alcanza: en InnoDB el findFirst es lectura consistente
    // sin locks. Lo que serializa es el mutex por DNI del módulo.
    const { db, application, setLive } = fakeDb();
    application.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      // Simula la fila que queda viva en la base tras el INSERT.
      setLive(String(data.dni), { id: 55 });
      return { id: 55, ...data };
    });
    const svc = makeApplicationService(db);

    const [first, second] = await Promise.allSettled([svc.create(input), svc.create(input)]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateLiveApplicationError);
    expect(application.create).toHaveBeenCalledTimes(1);
  });

  it("el mutex es por DNI: dos DNI distintos no se bloquean entre sí", async () => {
    const { db, application, setLive } = fakeDb();
    application.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      setLive(String(data.dni), { id: 55 });
      return { id: 55, ...data };
    });
    const svc = makeApplicationService(db);

    // Mismo escenario que el caso anterior salvo el DNI: acá los dos entran.
    await Promise.all([svc.create(input), svc.create({ ...input, dni: "27999888" })]);
    expect(application.create).toHaveBeenCalledTimes(2);
  });
});

describe("findByResumeToken / verifyEmail", () => {
  it("busca por hash", async () => {
    const { db, application } = fakeDb();
    const svc = makeApplicationService(db);
    await svc.findByResumeToken("raw-token");
    expect(application.findUnique).toHaveBeenCalledWith({
      where: { resumeTokenHash: hashToken("raw-token") },
    });
  });

  it("rotateResumeToken pisa el hash y devuelve el crudo nuevo", async () => {
    const { db, application } = fakeDb();
    const svc = makeApplicationService(db);
    const raw = await svc.rotateResumeToken(55);
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url de 32 bytes
    expect(application.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: { resumeTokenHash: hashToken(raw) },
    });
    // El crudo no se persiste (mismo criterio que `create`).
    const data = application.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(JSON.stringify(data)).not.toContain(raw);
  });

  it("dos rotaciones seguidas dan tokens distintos (la vieja queda inválida)", async () => {
    const { db } = fakeDb();
    const svc = makeApplicationService(db);
    expect(await svc.rotateResumeToken(55)).not.toBe(await svc.rotateResumeToken(55));
  });

  it("verifyEmail solo escribe si aún no estaba verificada", async () => {
    const { db, application } = fakeDb();
    const svc = makeApplicationService(db);
    const now = new Date();
    await svc.verifyEmail(55, now);
    expect(application.updateMany).toHaveBeenCalledWith({
      where: { id: 55, emailVerifiedAt: null },
      data: { emailVerifiedAt: now },
    });
  });
});
