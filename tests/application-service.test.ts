import { describe, expect, it, vi } from "vitest";

// El singleton del service importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  DuplicateLiveApplicationError, LIVE_APPLICATION_STATUSES, makeApplicationService,
} from "@/lib/applications/service";
import { hashToken } from "@/lib/tokens";

function fakeDb() {
  const application = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 55, ...data })),
    findUnique: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const db = {
    application,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ application })),
  };
  return { db: db as never, application };
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

  it("rechaza si hay una solicitud viva con el mismo DNI (dentro de la transacción)", async () => {
    const { db, application } = fakeDb();
    application.findFirst.mockResolvedValue({ id: 9 });
    const svc = makeApplicationService(db);
    await expect(svc.create(input)).rejects.toBeInstanceOf(DuplicateLiveApplicationError);
    expect(application.findFirst.mock.calls[0][0].where.status).toEqual({ in: LIVE_APPLICATION_STATUSES });
    expect(application.create).not.toHaveBeenCalled();
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
