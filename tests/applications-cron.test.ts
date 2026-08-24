import { beforeEach, describe, expect, it, vi } from "vitest";

// El cron es la única pieza del M3 que corre sin nadie mirando: se ejercita la
// fábrica con dependencias de mentira (nada de red, nada de base) y además la
// ruta entera, que es el primer endpoint de cron del proyecto y cuya guarda es
// lo único que separa `/api/cron/applications` de internet.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    application: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    mpSubscription: { updateMany: vi.fn() },
    // Desde la 4C la ruta abre y cierra su fila en `cron_runs`. `BigInt(1)` y
    // no `1n`: el target del proyecto es ES2017.
    cronRun: { create: vi.fn(async () => ({ id: BigInt(1) })), update: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/lib/email", () => ({ mailer: { sendToApplication: vi.fn() } }));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: { cancelPreapproval: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { POST } from "@/app/api/cron/applications/route";
import {
  EXPIRE_AFTER_DAYS,
  REMINDER_AFTER_DAYS,
  makeApplicationsCron,
} from "@/lib/applications/cron";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

type MockedFn = ReturnType<typeof vi.fn>;

const DAY_MS = 86_400_000;
const NOW = new Date("2026-08-21T11:00:00.000Z");
const BASE_URL = "https://vecinalciudadela.ar";

type Row = {
  id: number;
  email: string;
  status: string;
  preapprovalId: string | null;
  createdAt: Date;
};

function row(over: Partial<Row> = {}): Row {
  return {
    id: 1,
    email: "vecino@example.com",
    status: "pending_payment",
    preapprovalId: null,
    createdAt: new Date(NOW.getTime() - 4 * DAY_MS),
    ...over,
  };
}

/** Base de mentira: el `findMany` de recordatorio se distingue del de
 *  expiración por el filtro `remindedAt: null`, así el fake no depende del
 *  orden en que el cron los llame. */
function makeDb(opts: { toRemind?: Row[]; toExpire?: Row[]; expireCount?: number } = {}) {
  const findMany = vi.fn(async (args: { where: { remindedAt?: unknown } }) =>
    args.where.remindedAt === null ? (opts.toRemind ?? []) : (opts.toExpire ?? []),
  );
  return {
    application: {
      findMany,
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: opts.expireCount ?? 1 })),
    },
    mpSubscription: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
}

function makeTokens() {
  return {
    mintResumeToken: vi.fn(() => ({ raw: "RAW-TOKEN", hash: "HASH-TOKEN" })),
    commitResumeToken: vi.fn(async () => {}),
  };
}

function build(over: {
  db?: ReturnType<typeof makeDb>;
  tokens?: ReturnType<typeof makeTokens>;
  send?: MockedFn;
  cancel?: MockedFn;
} = {}) {
  const db = over.db ?? makeDb();
  const tokens = over.tokens ?? makeTokens();
  const send = over.send ?? vi.fn(async () => ({ messageId: "mid" }));
  const cancel = over.cancel ?? vi.fn(async () => {});
  const cron = makeApplicationsCron({
    db: db as never,
    gateway: { cancelPreapproval: cancel as never },
    mailer: { sendToApplication: send as never },
    tokens,
    baseUrl: BASE_URL,
    now: () => NOW,
  });
  return { cron, db, tokens, send, cancel };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("makeApplicationsCron — recordatorio de pago", () => {
  it("manda el recordatorio con el enlace nuevo y recién después lo sella", async () => {
    const { cron, db, tokens, send } = build({ db: makeDb({ toRemind: [row({ id: 42 })] }) });

    const result = await cron.run();

    expect(result.reminded).toBe(1);
    expect(result.errors).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0] as {
      applicationId: number;
      to: string;
      type: string;
      message: { text: string };
    };
    expect(arg.applicationId).toBe(42);
    expect(arg.to).toBe("vecino@example.com");
    expect(arg.type).toBe("fee_reminder");
    expect(arg.message.text).toContain(`${BASE_URL}/asociate/retomar/RAW-TOKEN`);

    // Acuñar → enviar → persistir. Si se persistiera primero y el SMTP fallara,
    // le habríamos matado al vecino el enlace que ya tenía.
    expect(tokens.mintResumeToken.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0],
    );
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(
      tokens.commitResumeToken.mock.invocationCallOrder[0],
    );
    expect(tokens.commitResumeToken).toHaveBeenCalledWith(42, "HASH-TOKEN");
    expect(db.application.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { remindedAt: NOW },
    });
  });

  it("una segunda corrida no re-manda: la consulta excluye las ya recordadas", async () => {
    const { cron, db } = build({ db: makeDb({ toRemind: [row({ id: 7 })] }) });
    await cron.run();

    const where = (db.application.findMany.mock.calls[0][0] as { where: Record<string, unknown> })
      .where;
    expect(where.status).toBe("pending_payment");
    expect(where.remindedAt).toBeNull();
    // Ventana cerrada por arriba: [3 días, 7 días).
    expect(where.createdAt).toEqual({
      lte: new Date(NOW.getTime() - REMINDER_AFTER_DAYS * DAY_MS),
      gt: new Date(NOW.getTime() - EXPIRE_AFTER_DAYS * DAY_MS),
    });

    // Y con la solicitud ya sellada, el mismo cron no manda nada.
    const second = build({ db: makeDb({ toRemind: [] }) });
    const result = await second.cron.run();
    expect(result.reminded).toBe(0);
    expect(second.send).not.toHaveBeenCalled();
  });

  it("una solicitud ya vencida no recibe recordatorio: se expira, no se le promete nada", async () => {
    // El fake decide por el filtro, así que replica la ventana real: una
    // solicitud de 9 días NO cae en [3, 7) y sí en el barrido de expiración.
    const old = new Date(NOW.getTime() - 9 * DAY_MS);
    const db = makeDb({ toRemind: [], toExpire: [row({ id: 11, createdAt: old })] });
    const { cron, send } = build({ db });

    const result = await cron.run();

    expect(send).not.toHaveBeenCalled();
    expect(result.expired).toBe(1);
  });

  it("si el envío falla no sella nada: el enlace viejo del vecino sigue vivo", async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error("smtp down"), { code: "ECONNREFUSED" });
    });
    const { cron, db, tokens } = build({ db: makeDb({ toRemind: [row({ id: 9 })] }), send });

    const result = await cron.run();

    expect(result.reminded).toBe(0);
    expect(result.errors).toBe(1);
    expect(tokens.commitResumeToken).not.toHaveBeenCalled();
    expect(db.application.update).not.toHaveBeenCalled();
  });

  it("si el correo salió y falla el sellado, el log NO dice que falló el recordatorio", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tokens = makeTokens();
    tokens.commitResumeToken.mockRejectedValue(new Error("db down"));
    const { cron } = build({ db: makeDb({ toRemind: [row({ id: 9 })] }), tokens });

    const result = await cron.run();

    expect(result.reminded).toBe(0);
    expect(result.errors).toBe(1);
    const logged = spy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("SÍ salió");
    expect(logged).not.toContain("falló el recordatorio de pago");
  });

  it("el log del fallo de email lleva sólo el código, nunca el objeto de nodemailer", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async () => {
      throw Object.assign(new Error("boom"), {
        code: "EENVELOPE",
        envelope: { to: ["vecino@example.com"] },
        response: "550 vecino@example.com rejected",
      });
    });
    const { cron } = build({ db: makeDb({ toRemind: [row({ id: 9 })] }), send });

    await cron.run();

    const logged = spy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("EENVELOPE");
    expect(logged).not.toContain("vecino@example.com");
  });
});

describe("makeApplicationsCron — expiración", () => {
  it("expira started y pending_payment vencidas, y cancela la suscripción en MP", async () => {
    const old = new Date(NOW.getTime() - 8 * DAY_MS);
    const { cron, db, cancel } = build({
      db: makeDb({
        toExpire: [
          row({ id: 1, status: "started", createdAt: old }),
          row({ id: 2, status: "pending_payment", preapprovalId: "pre-abc", createdAt: old }),
        ],
      }),
    });

    const result = await cron.run();

    expect(result).toEqual({ reminded: 0, expired: 2, errors: 0 });
    // El UPDATE es condicional por estado: si un webhook la aprobó en el medio,
    // gana el webhook.
    expect(db.application.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: { in: ["started", "pending_payment"] } },
      data: { status: "expired" },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("pre-abc");
    expect(db.mpSubscription.updateMany).toHaveBeenCalledWith({
      where: { preapprovalId: "pre-abc" },
      data: { status: "cancelled", lastSyncAt: NOW },
    });

    const where = (db.application.findMany.mock.calls[1][0] as { where: Record<string, unknown> })
      .where;
    expect(where.status).toEqual({ in: ["started", "pending_payment"] });
    expect(where.createdAt).toEqual({
      lte: new Date(NOW.getTime() - EXPIRE_AFTER_DAYS * DAY_MS),
    });
  });

  it("si cancelPreapproval falla, la solicitud expira igual y queda contada en errors", async () => {
    const cancel = vi.fn(async () => {
      throw new Error("MP 500");
    });
    const { cron, db } = build({
      db: makeDb({
        toExpire: [
          row({
            id: 3,
            preapprovalId: "pre-xyz",
            createdAt: new Date(NOW.getTime() - 9 * DAY_MS),
          }),
        ],
      }),
      cancel,
    });

    const result = await cron.run();

    expect(result.expired).toBe(1);
    expect(result.errors).toBe(1);
    expect(db.application.updateMany).toHaveBeenCalledTimes(1);
    expect(db.mpSubscription.updateMany).not.toHaveBeenCalled();
  });

  it("si un webhook aprobó la solicitud en el medio, gana el webhook y no se expira", async () => {
    const { cron, cancel } = build({
      db: makeDb({
        toExpire: [
          row({
            id: 4,
            preapprovalId: "pre-race",
            createdAt: new Date(NOW.getTime() - 9 * DAY_MS),
          }),
        ],
        expireCount: 0,
      }),
    });

    const result = await cron.run();

    expect(result.expired).toBe(0);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("las solicitudes recientes quedan intactas", async () => {
    const { cron, db, send, cancel } = build();

    const result = await cron.run();

    expect(result).toEqual({ reminded: 0, expired: 0, errors: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(db.application.update).not.toHaveBeenCalled();
    expect(db.application.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/cron/applications", () => {
  const SECRET = "cron-secret-de-prueba";
  const findMany = prisma.application.findMany as unknown as MockedFn;
  const auditMock = audit as unknown as MockedFn;

  function request(authorization?: string) {
    const headers = new Headers();
    if (authorization !== undefined) headers.set("authorization", authorization);
    return new Request("https://vecinalciudadela.ar/api/cron/applications", {
      method: "POST",
      headers,
    });
  }

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    findMany.mockResolvedValue([]);
  });

  it("sin CRON_SECRET configurado responde 503 y no corre nada", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("sin cabecera Authorization responde 401", async () => {
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("con un secreto equivocado responde 401 (y no explota por largo distinto)", async () => {
    expect((await POST(request("Bearer otro-secreto-mucho-mas-largo"))).status).toBe(401);
    expect((await POST(request("Bearer corto"))).status).toBe(401);
    expect((await POST(request(SECRET))).status).toBe(401); // sin el prefijo Bearer
    expect(findMany).not.toHaveBeenCalled();
  });

  it("con el secreto correcto corre el cron, devuelve el resumen y audita", async () => {
    const res = await POST(request(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reminded: 0, expired: 0, errors: 0 });
    expect(findMany).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "applications_cron",
        entity: "application",
        detail: { reminded: 0, expired: 0, errors: 0 },
      }),
    );
  });

  it("si el cron explota responde 500 sin filtrar el error al cuerpo", async () => {
    findMany.mockRejectedValue(new Error("la base se cayó"));
    const res = await POST(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("la base se cayó");
  });

  // Si se cae el paso 2, el paso 1 ya mandó correos REALES. Sin asiento, esa
  // corrida no queda registrada en ningún lado: el 500 dice que algo se rompió,
  // no qué alcanzó a hacer.
  it("si el paso 2 explota, el resumen de lo que sí se hizo queda asentado igual", async () => {
    findMany
      .mockResolvedValueOnce([{ id: 5, email: "vecino@example.com" }]) // paso 1
      .mockRejectedValueOnce(new Error("la base se cayó")); // paso 2

    const res = await POST(request(`Bearer ${SECRET}`));

    expect(res.status).toBe(500);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "applications_cron",
        entity: "application",
        detail: { reminded: 1, expired: 0, errors: 0, failed: true },
      }),
    );
  });
});
