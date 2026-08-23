import { beforeEach, describe, expect, it, vi } from "vitest";

// El lote REG-34: qué suscripciones hay que tocar y en qué orden se escribe.
//
// Lo que se fija acá y no se ve en pantalla:
//   · el criterio de divergencia es EN CENTAVOS (`cents`), no un umbral de
//     floats: comparar 7000 con 7000.0000000001 inventa divergencias que no
//     existen y le cambiaría el débito a un vecino sin motivo;
//   · el ORDEN de las dos escrituras (primero Mercado Pago, después el espejo
//     local) — es lo único que hace que una interrupción sea recuperable;
//   · el fallo de una suscripción no frena la tanda ni contamina a las demás.
//
// Mercado Pago NO se llama: el gateway va mockeado, como en toda la fase.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
// `cents` va REAL —es justamente el criterio que se prueba—; sólo se reemplaza
// el singleton del procesador, que arrastraría media app al importarse.
vi.mock("@/lib/mp/webhook-processor", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  webhookProcessor: {},
}));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: {} }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: {} }));

import { BATCH_SIZE, listDivergent, makeFeeValueBatch, MIRROR_FAILED, shouldContinue } from "@/lib/mp/fee-value-batch";

const sub = (i: number, amount: string | null, category = "active", status = "active") => ({
  preapprovalId: `pre-${i}`,
  memberId: i,
  status: "authorized",
  amount,
  member: { id: i, fullName: `Socio ${i}`, category, status },
});
const value = { activeAmount: 7000, sharedAmount: 3500 };

function deps(rows: ReturnType<typeof sub>[]) {
  const order: string[] = [];
  const db = {
    mpSubscription: {
      findMany: vi.fn(async () => rows),
      updateMany: vi.fn(async ({ where }: { where: { preapprovalId: string } }) => {
        order.push(`db:${where.preapprovalId}`);
        return { count: 1 };
      }),
    },
  };
  const gateway = {
    updatePreapprovalAmount: vi.fn(async (id: string) => {
      order.push(`mp:${id}`);
    }),
  };
  const feeValues = { current: vi.fn(async () => value) };
  return {
    db,
    gateway,
    feeValues,
    order,
    batch: makeFeeValueBatch({
      db: db as never,
      gateway: gateway as never,
      feeValues: feeValues as never,
      now: () => new Date("2026-10-01T12:00:00Z"),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listDivergent", () => {
  it("sólo las autorizadas con monto distinto al vigente de su categoría; incluye las vinculadas a mano y las sin monto", async () => {
    const db = {
      mpSubscription: {
        // Tipado por la firma para poder afirmar sobre el `where`.
        findMany: vi.fn<(args: { where: unknown }) => Promise<ReturnType<typeof sub>[]>>(async () => [
          sub(1, "7000.00"),
          sub(2, "6000.00"),
          sub(3, "3000.00", "adherent"),
          sub(4, null),
          sub(5, "1.00", "lifetime"),
        ]),
      },
    };
    const rows = await listDivergent(db as never, value);
    expect(rows.map((r) => r.memberId)).toEqual([2, 3, 4]);
    expect(rows[0]).toMatchObject({ current: 6000, expected: 7000 });
    expect(db.mpSubscription.findMany.mock.calls[0][0].where).toMatchObject({
      status: "authorized",
      memberId: { not: null },
    });
  });

  it("compara en centavos: un Decimal que vuelve con cola de float no es divergencia", async () => {
    // Prisma devuelve Decimal, pero un `Number()` de "7000.00" y una cuenta
    // hecha en pesos pueden diferir en el bit 53. Con un umbral inventado de
    // floats esto entraba al lote y le pisaba el débito a un vecino por nada.
    const db = { mpSubscription: { findMany: vi.fn(async () => [sub(1, "7000.004"), sub(2, "7000.006")]) } };
    const rows = await listDivergent(db as never, value);
    expect(rows.map((r) => r.memberId)).toEqual([2]);
  });

  it("el socio dado de baja con débito vivo SÍ entra, con su estado", async () => {
    // Nada cancela el preapproval al declarar la baja: si se lo escondiera, la
    // suscripción de un cesante se quedaría cobrando el valor viejo sin que
    // ninguna pantalla del sistema lo muestre. Entra, y el estado viaja para
    // que la pantalla pueda avisar antes de subirle la cuota.
    const db = { mpSubscription: { findMany: vi.fn(async () => [sub(1, "6000.00", "active", "withdrawn")]) } };
    const rows = await listDivergent(db as never, value);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("withdrawn");
  });

  it("una suscripción sin socio no entra aunque la consulta la devuelva", async () => {
    const db = {
      mpSubscription: { findMany: vi.fn(async () => [{ preapprovalId: "pre-9", amount: "1.00", member: null }]) },
    };
    expect(await listDivergent(db as never, value)).toEqual([]);
  });
});

describe("feeValueBatch.run", () => {
  it("procesa hasta 25 en serie, escribe amount+lastSyncAt por éxito y devuelve remaining", async () => {
    const d = deps(Array.from({ length: 30 }, (_, i) => sub(i + 1, "6000.00")));
    const r = await d.batch.run({});
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenCalledTimes(BATCH_SIZE);
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenCalledWith("pre-1", 7000);
    expect(d.db.mpSubscription.updateMany).toHaveBeenCalledWith({
      where: { preapprovalId: "pre-1" },
      data: { amount: "7000.00", lastSyncAt: new Date("2026-10-01T12:00:00Z") },
    });
    expect(r).toMatchObject({ updated: 25, failed: [], remaining: 5 });
    // La lista de aplicadas es lo que la pantalla usa para pintar "Aplicado":
    // el conteo solo la haría pintar filas que nadie tocó.
    expect(r.applied).toHaveLength(25);
    expect(r.applied[0]).toBe("pre-1");
  });

  it("primero Mercado Pago y después el espejo local, suscripción por suscripción", async () => {
    // El orden ES la recuperabilidad. Si el proceso muere entre las dos
    // escrituras, MP quedó con el monto nuevo y la base con el viejo: la fila
    // sigue figurando divergente y el reintento la vuelve a empujar (empujar el
    // mismo monto dos veces no hace nada). Al revés —base primero— la fila
    // dejaría de figurar divergente y el vecino seguiría pagando el monto viejo
    // para siempre, sin que ninguna pantalla lo muestre.
    const d = deps([sub(1, "6000.00"), sub(2, "6000.00")]);
    await d.batch.run({});
    expect(d.order).toEqual(["mp:pre-1", "db:pre-1", "mp:pre-2", "db:pre-2"]);
  });

  it("un fallo de MP se reporta con código y no frena la tanda", async () => {
    const d = deps([sub(1, "6000.00"), sub(2, "6000.00")]);
    d.gateway.updatePreapprovalAmount.mockRejectedValueOnce({
      message: "not allowed",
      status: 403,
      cause: [{ code: "4040", description: "x" }],
    });
    const r = await d.batch.run({});
    expect(r.updated).toBe(1);
    // La que falló NO figura entre las aplicadas.
    expect(r.applied).toEqual(["pre-2"]);
    expect(r.failed).toEqual([{ preapprovalId: "pre-1", memberId: 1, code: expect.stringContaining("403") }]);
    // La que falló NO se escribe en el espejo local: si se escribiera, dejaría
    // de figurar divergente y nadie la volvería a intentar.
    expect(d.db.mpSubscription.updateMany).toHaveBeenCalledTimes(1);
    expect(d.db.mpSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { preapprovalId: "pre-2" } }));
  });

  it("el código del fallo es corto y no arrastra datos personales", async () => {
    const d = deps([sub(1, "6000.00")]);
    d.gateway.updatePreapprovalAmount.mockRejectedValueOnce({
      message: "payer_email is invalid: vecino@example.com",
      status: 400,
      cause: [{ code: "2034", description: "invalid payer" }],
    });
    const r = await d.batch.run({});
    expect(r.failed[0].code).toBe("HTTP 400 · 2034");
    expect(r.failed[0].code).not.toContain("@");
  });

  it("un error sin respuesta de MP (red caída) igual da un código legible", async () => {
    const d = deps([sub(1, "6000.00")]);
    d.gateway.updatePreapprovalAmount.mockRejectedValueOnce(new Error("fetch failed"));
    const r = await d.batch.run({});
    expect(r.failed[0].code).toBe("sin respuesta");
  });

  it("si Mercado Pago cambió el monto y la base no, el código lo dice y no cuenta como actualizada", async () => {
    // El peor caso del lote: el débito del vecino YA cambió allá. Reportarlo
    // como un fallo de MP ("sin respuesta") mandaría al operador a buscar el
    // problema donde no está. El reintento es inofensivo: mismo monto, misma
    // fila.
    const d = deps([sub(1, "6000.00")]);
    d.db.mpSubscription.updateMany.mockRejectedValueOnce(new Error("P2024 pool timeout"));
    const r = await d.batch.run({});
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenCalledTimes(1);
    expect(r.updated).toBe(0);
    expect(r.applied).toEqual([]);
    expect(r.failed).toEqual([{ preapprovalId: "pre-1", memberId: 1, code: MIRROR_FAILED }]);
  });

  it("`only` limita a esos preapprovals (reintento de las que fallaron)", async () => {
    const d = deps([sub(1, "6000.00"), sub(2, "6000.00"), sub(3, "6000.00")]);
    const r = await d.batch.run({ only: ["pre-3"] });
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenCalledTimes(1);
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenCalledWith("pre-3", 7000);
    expect(r.remaining).toBe(0);
  });

  it("`only` con un id que ya dejó de ser divergente no toca nada", async () => {
    // El cliente manda la lista que el operador vio; entre medio pudo cambiar.
    // La divergencia se recalcula SIEMPRE en el servidor.
    const d = deps([sub(1, "7000.00")]);
    // Ni aplicada ni fallada: la pantalla la marca "Sin cambios", no "Aplicado".
    expect(await d.batch.run({ only: ["pre-1"] })).toEqual({ updated: 0, applied: [], failed: [], remaining: 0 });
    expect(d.gateway.updatePreapprovalAmount).not.toHaveBeenCalled();
  });

  it("el monto que se empuja es el del servidor, no el de la categoría equivocada", async () => {
    const d = deps([sub(1, "1.00", "adherent"), sub(2, "1.00", "collaborator"), sub(3, "1.00", "active")]);
    await d.batch.run({});
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenNthCalledWith(1, "pre-1", 3500);
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenNthCalledWith(2, "pre-2", 3500);
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenNthCalledWith(3, "pre-3", 7000);
  });

  it("sin valor vigente → no toca nada", async () => {
    const d = deps([sub(1, "6000.00")]);
    const feeValues = { current: vi.fn(async () => null) };
    const b = makeFeeValueBatch({ db: d.db as never, gateway: d.gateway as never, feeValues: feeValues as never });
    expect(await b.run({})).toEqual({ updated: 0, applied: [], failed: [], remaining: 0 });
    expect(d.gateway.updatePreapprovalAmount).not.toHaveBeenCalled();
  });
});

describe("shouldContinue", () => {
  // La guarda que evita que la pantalla quede llamando a Mercado Pago para
  // siempre: con el token vencido TODAS fallan, la lista de divergentes no se
  // achica nunca y `remaining` se queda clavado en el mismo número.
  it("sigue mientras haya cola y la tanda haya avanzado", () => {
    expect(shouldContinue({ updated: 25, failed: 0, remaining: 10 })).toBe(true);
  });
  it("corta cuando no queda cola", () => {
    expect(shouldContinue({ updated: 25, failed: 0, remaining: 0 })).toBe(false);
  });
  it("corta cuando la tanda FALLÓ entera, aunque quede cola", () => {
    expect(shouldContinue({ updated: 0, failed: 25, remaining: 10 })).toBe(false);
  });
  it("una tanda sin nada que hacer NO corta la corrida", () => {
    // No hay mutex: otro superadmin pudo correr el lote entre medio y dejar
    // tandas enteras al día. Cortar ahí hacía que la pantalla dijera "la última
    // tanda no pudo actualizar ninguna", que es mentira: no falló nada.
    expect(shouldContinue({ updated: 0, failed: 0, remaining: 10 })).toBe(true);
  });
  it("sigue si la tanda avanzó aunque algunas hayan fallado", () => {
    expect(shouldContinue({ updated: 20, failed: 5, remaining: 10 })).toBe(true);
  });
});
