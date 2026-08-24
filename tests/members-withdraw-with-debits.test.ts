import { describe, expect, it, vi } from "vitest";

// El módulo exporta además el singleton de producción, que se arma con el
// cliente de Prisma: `@/lib/prisma` tira al evaluarse si falta `DATABASE_URL`.
// La FÁBRICA es pura y es lo único que se ejercita acá.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeWithdrawWithDebits } from "@/lib/members/withdraw-with-debits";

// La baja tiene que CORTAR el débito automático. Hasta la 4C no lo cortaba:
// `memberService.withdraw` escribía la ficha, el acta y la auditoría, y el lote
// de cesantía usaba el mismo servicio, así que las dos formas de dejar de ser
// socio dejaban vivo el cobro mensual en Mercado Pago.
//
// Lo que fija este archivo es el ORDEN (primero la baja, después la red), el
// alcance (todas las suscripciones que no se puedan afirmar muertas) y las tres
// formas de fallar, que tienen tres salidas distintas.

const input = { memberId: 3, reason: "resignation" as const, minuteId: 1, actorId: 9 };

function build(
  subs: Array<{ preapprovalId: string; status: string }>,
  opts?: {
    cancel?: ReturnType<typeof vi.fn>;
    updateMany?: ReturnType<typeof vi.fn>;
    withdraw?: ReturnType<typeof vi.fn>;
  },
) {
  const cancelPreapproval = opts?.cancel ?? vi.fn(async () => {});
  const updateMany = opts?.updateMany ?? vi.fn(async () => ({ count: 1 }));
  const withdraw = opts?.withdraw ?? vi.fn(async () => ({ id: 3 }));
  const findMany = vi.fn(async () => subs);
  const db = { mpSubscription: { findMany, updateMany } };
  return {
    api: makeWithdrawWithDebits({
      db: db as never,
      // `as never` en los tres: los dobles de `vi.fn` no tienen la firma exacta
      // de las dependencias y lo que se ejercita acá es el comportamiento.
      service: { withdraw } as never,
      gateway: { cancelPreapproval } as never,
    }),
    cancelPreapproval,
    updateMany,
    withdraw,
    findMany,
  };
}

describe("withdrawWithDebits", () => {
  it("da la baja PRIMERO y recién después habla con Mercado Pago", async () => {
    // El orden no es estético: la baja corre dentro de una `$transaction` y la
    // llamada de red va DESPUÉS del commit, nunca adentro.
    const order: string[] = [];
    const withdraw = vi.fn(async () => {
      order.push("withdraw");
      return { id: 3 };
    });
    const cancel = vi.fn(async () => {
      order.push("cancel");
    });
    const { api } = build([{ preapprovalId: "pre-1", status: "authorized" }], { withdraw, cancel });
    const r = await api.withdraw(input);
    expect(order).toEqual(["withdraw", "cancel"]);
    expect(r.debits.cancelled).toEqual(["pre-1"]);
  });

  it("cancela TODAS las vivas: memberId es índice, no unique, y puede haber dos", async () => {
    const { api, cancelPreapproval } = build([
      { preapprovalId: "pre-1", status: "authorized" },
      { preapprovalId: "pre-2", status: "paused" },
    ]);
    const r = await api.withdraw(input);
    expect(cancelPreapproval).toHaveBeenCalledTimes(2);
    expect(r.debits.cancelled).toEqual(["pre-1", "pre-2"]);
  });

  it("un estado que MP invente mañana también se cancela", async () => {
    // Lista NEGRA (`isKnownDead`), no lista blanca: acá la pregunta es "¿puedo
    // afirmar que no hay débito?". Un `pending` o un estado desconocido que se
    // dejara sin cancelar le sigue cobrando a un ex socio.
    const { api, cancelPreapproval } = build([
      { preapprovalId: "pre-1", status: "pending" },
      { preapprovalId: "pre-2", status: "algo_nuevo_de_mp" },
    ]);
    const r = await api.withdraw(input);
    expect(cancelPreapproval).toHaveBeenCalledTimes(2);
    expect(r.debits.cancelled).toEqual(["pre-1", "pre-2"]);
  });

  it("no vuelve a cancelar una ya cancelada", async () => {
    const { api, cancelPreapproval } = build([{ preapprovalId: "pre-1", status: "cancelled" }]);
    const r = await api.withdraw(input);
    expect(cancelPreapproval).not.toHaveBeenCalled();
    expect(r.debits.cancelled).toEqual([]);
  });

  it("si MP falla, la baja NO se deshace y el débito queda listado para reintentar", async () => {
    const cancel = vi.fn(async () => {
      throw { status: 500, message: "MP caído" };
    });
    const { api, withdraw } = build([{ preapprovalId: "pre-1", status: "authorized" }], { cancel });
    const r = await api.withdraw(input);
    expect(withdraw).toHaveBeenCalled();
    expect(r.debits.cancelled).toEqual([]);
    expect(r.debits.failed).toEqual([{ preapprovalId: "pre-1", code: expect.any(String) }]);
  });

  it("el fallo de una no impide cancelar la siguiente", async () => {
    const cancel = vi.fn(async (id: string) => {
      if (id === "pre-1") throw { status: 500, message: "MP caído" };
    });
    const { api } = build(
      [
        { preapprovalId: "pre-1", status: "authorized" },
        { preapprovalId: "pre-2", status: "authorized" },
      ],
      { cancel: cancel as never },
    );
    const r = await api.withdraw(input);
    expect(r.debits.cancelled).toEqual(["pre-2"]);
    expect(r.debits.failed.map((f) => f.preapprovalId)).toEqual(["pre-1"]);
  });

  it("el espejo local se actualiza en un try APARTE: marcar el fallo cuando falló el UPDATE local mandaría al operador a cancelar algo que MP ya canceló", async () => {
    const updateMany = vi.fn(async () => {
      throw new Error("db");
    });
    const { api } = build([{ preapprovalId: "pre-1", status: "authorized" }], { updateMany });
    const r = await api.withdraw(input);
    expect(r.debits.cancelled).toEqual(["pre-1"]);
    expect(r.debits.failed).toEqual([]);
  });

  it("no toca el espejo local de la que MP rechazó: sigue viva y así se tiene que ver", async () => {
    const cancel = vi.fn(async () => {
      throw { status: 404, message: "not found" };
    });
    const { api, updateMany } = build([{ preapprovalId: "pre-1", status: "authorized" }], { cancel });
    await api.withdraw(input);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("si la baja falla, no se cancela nada (no se le corta el débito a quien sigue siendo socio)", async () => {
    const withdraw = vi.fn(async () => {
      throw new Error("El socio ya está dado de baja.");
    });
    const { api, cancelPreapproval, findMany } = build(
      [{ preapprovalId: "pre-1", status: "authorized" }],
      { withdraw },
    );
    await expect(api.withdraw(input)).rejects.toThrow("ya está dado de baja");
    expect(cancelPreapproval).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("un socio sin ninguna suscripción no habla con Mercado Pago", async () => {
    const { api, cancelPreapproval } = build([]);
    const r = await api.withdraw(input);
    expect(cancelPreapproval).not.toHaveBeenCalled();
    expect(r.debits).toEqual({ cancelled: [], failed: [] });
  });
});

// El código del fallo es lo que queda en el asiento y en el balde de la
// pantalla: si no distingue un caso de otro, el operador no sabe qué mirar.
describe("withdrawWithDebits: el código del fallo", () => {
  it("un 404 sin `error` corto —lo que MP contesta de verdad— deja el status, no 'unknown'", async () => {
    // Medido contra la API real: `{ status: 404, message: "The preapproval with
    // id ... does not exist" }`, sin `error` ni `cause`.
    const cancel = vi.fn(async () => {
      throw { status: 404, message: "The preapproval with id abc does not exist" };
    });
    const { api } = build([{ preapprovalId: "pre-1", status: "authorized" }], { cancel });
    const r = await api.withdraw(input);
    expect(r.debits.failed).toEqual([{ preapprovalId: "pre-1", code: "http_404" }]);
  });

  it("cuando MP sí manda su error corto, gana el suyo", async () => {
    const cancel = vi.fn(async () => {
      throw { status: 400, error: "bad_request", message: "algo" };
    });
    const { api } = build([{ preapprovalId: "pre-1", status: "authorized" }], { cancel });
    const r = await api.withdraw(input);
    expect(r.debits.failed).toEqual([{ preapprovalId: "pre-1", code: "bad_request" }]);
  });

  it("un fallo que ni llegó a la API (DNS, timeout) no inventa un status", async () => {
    const cancel = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const { api } = build([{ preapprovalId: "pre-1", status: "authorized" }], { cancel });
    const r = await api.withdraw(input);
    expect(r.debits.failed).toEqual([{ preapprovalId: "pre-1", code: "unknown" }]);
  });
});
