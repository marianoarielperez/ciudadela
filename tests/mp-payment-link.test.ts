import { describe, expect, it, vi } from "vitest";
// El módulo importa los tres singletons ligados (gateway, reader, prisma) para
// exportar `paymentLinks`. En un test puro ninguno tiene que evaluarse de
// verdad: `@/lib/prisma` tira sin DATABASE_URL y el gateway armaría el SDK.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: {} }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: {} }));
import { makePaymentLinks, PAYMENT_LINK_ERRORS, paymentLinkTitle } from "@/lib/mp/payment-link";
import { PAYMENT_LINK_TTL_HOURS } from "@/lib/mp/references";
import { hasRecentLinkPayment, readReturnOutcome, returnView } from "@/lib/mp/return-status";

/** Instante fijo: el vencimiento del link se cuenta desde acá. */
const NOW = new Date("2026-08-23T15:00:00.000Z");
const EXPIRES = new Date("2026-08-26T15:00:00.000Z"); // NOW + 72 h

function deps(value: { activeAmount: number; sharedAmount: number } | null = { activeAmount: 6000, sharedAmount: 3000 }) {
  const gateway = { createPreference: vi.fn(async () => ({ id: "pref-1", initPoint: "https://mp/pref-1" })) };
  const feeValues = { current: vi.fn(async () => value) };
  return {
    gateway,
    feeValues,
    links: makePaymentLinks({
      gateway: gateway as never,
      feeValues: feeValues as never,
      baseUrl: () => "https://vecinalciudadela.ar",
      now: () => NOW,
    }),
  };
}

describe("paymentLinkTitle", () => {
  it("singular sin multiplicador, plural con ×", () => {
    expect(paymentLinkTitle(1)).toBe("Cuota Vecinal Ciudadela");
    expect(paymentLinkTitle(3)).toBe("Cuota Vecinal Ciudadela × 3");
  });
});

describe("paymentLinks.create", () => {
  it("crea la preferencia por n × valor de la categoría con referencia pago:{id}:{n} y URLs del sitio", async () => {
    const d = deps();
    const r = await d.links.create({ member: { id: 14, category: "active" }, n: 2 });
    expect(r).toEqual({ ok: true, initPoint: "https://mp/pref-1", amount: 12000, unit: 6000, reference: "pago:14:2", expiresAt: EXPIRES });
    expect(d.gateway.createPreference).toHaveBeenCalledWith({
      title: "Cuota Vecinal Ciudadela × 2",
      amount: 12000,
      externalReference: "pago:14:2",
      backUrl: "https://vecinalciudadela.ar/mi/cuenta?volvio=1",
      notificationUrl: "https://vecinalciudadela.ar/api/webhooks/mp",
      expiresAt: EXPIRES,
    });
  });

  it("el link VENCE, y vence contado desde el mismo instante con el que se leyó el valor", async () => {
    // El importe queda congelado al valor de HOY. Sin vencimiento, uno olvidado
    // en el buzón se pagaría meses después al precio viejo: el webhook imputa
    // igual las n cuotas y sólo deja un asiento de divergencia que ninguna
    // pantalla muestra. La ventana se fija en un solo lugar.
    const d = deps();
    const r = await d.links.create({ member: { id: 14, category: "active" }, n: 1 });
    expect(r).toMatchObject({ ok: true, expiresAt: EXPIRES });
    expect(d.feeValues.current).toHaveBeenCalledWith(NOW);
    expect(EXPIRES.getTime() - NOW.getTime()).toBe(PAYMENT_LINK_TTL_HOURS * 3_600_000);
  });

  it("adherente usa el monto compartido", async () => {
    const d = deps();
    expect(await d.links.create({ member: { id: 306, category: "adherent" }, n: 1 })).toMatchObject({ ok: true, amount: 3000 });
  });

  it("sin valor vigente / categoría sin cuota / n fuera de rango → errores sin tocar MP", async () => {
    expect(await deps(null).links.create({ member: { id: 1, category: "active" }, n: 1 })).toEqual({ ok: false, error: "no_fee_value" });
    const d = deps();
    expect(await d.links.create({ member: { id: 1, category: "lifetime" }, n: 1 })).toEqual({ ok: false, error: "category_without_fee" });
    expect(await d.links.create({ member: { id: 1, category: "active" }, n: 0 })).toEqual({ ok: false, error: "bad_n" });
    expect(await d.links.create({ member: { id: 1, category: "active" }, n: 61 })).toEqual({ ok: false, error: "bad_n" });
    expect(d.gateway.createPreference).not.toHaveBeenCalled();
  });

  it("un n fraccionario no crea una preferencia por un monto quebrado", async () => {
    // `paymentLinkReference` lo rechazaría tirando, pero recién DESPUÉS de que
    // el monto se calculó: la guarda tiene que estar antes de tocar MP, y la
    // pantalla necesita un error, no una excepción.
    const d = deps();
    expect(await d.links.create({ member: { id: 1, category: "active" }, n: 1.5 })).toEqual({ ok: false, error: "bad_n" });
    expect(d.gateway.createPreference).not.toHaveBeenCalled();
  });

  it("el valor vigente se pide al instante de `now`, no al del arranque del proceso", async () => {
    // El monto es el que rige HOY (REG-34): si el reader recibiera un instante
    // congelado, un valor nuevo no se aplicaría hasta reiniciar PM2.
    const at = new Date("2026-08-23T12:00:00.000Z");
    const gateway = { createPreference: vi.fn(async () => ({ id: "p", initPoint: "https://mp/p" })) };
    const feeValues = { current: vi.fn(async () => ({ activeAmount: 6000, sharedAmount: 3000 })) };
    const links = makePaymentLinks({
      gateway: gateway as never, feeValues: feeValues as never,
      baseUrl: () => "https://vecinalciudadela.ar", now: () => at,
    });
    await links.create({ member: { id: 1, category: "collaborator" }, n: 1 });
    expect(feeValues.current).toHaveBeenCalledWith(at);
  });

  it("cada motivo de rechazo tiene un mensaje de pantalla en castellano", () => {
    for (const key of ["no_fee_value", "category_without_fee", "bad_n"] as const) {
      expect(PAYMENT_LINK_ERRORS[key]).toMatch(/\S/);
    }
  });
});

// El desenlace de la vuelta de Checkout Pro. Sin esto, las tres `back_urls`
// —que son la misma URL— hacen que un RECHAZO reciba el texto de un pago en
// camino, y el vecino no reintenta.
describe("readReturnOutcome", () => {
  it("lee `collection_status` primero y traduce los estados de MP", () => {
    expect(readReturnOutcome({ collection_status: "approved" })).toBe("approved");
    expect(readReturnOutcome({ collection_status: "rejected" })).toBe("rejected");
    expect(readReturnOutcome({ collection_status: "pending" })).toBe("pending");
    expect(readReturnOutcome({ collection_status: "in_process" })).toBe("pending");
    expect(readReturnOutcome({ collection_status: "cancelled" })).toBe("rejected");
  });

  it("no depende de un solo nombre de parámetro: los de la Task 14 pueden diferir", () => {
    // Se confirman contra el sandbox; hasta entonces, el que aparezca sirve.
    expect(readReturnOutcome({ status: "rejected" })).toBe("rejected");
    expect(readReturnOutcome({ payment_status: "approved" })).toBe("approved");
    // Si vienen los dos, manda el documentado.
    expect(readReturnOutcome({ collection_status: "approved", status: "rejected" })).toBe("approved");
    // Un valor que no entendemos en la primera clave no bloquea a la segunda.
    expect(readReturnOutcome({ collection_status: "null", status: "approved" })).toBe("approved");
  });

  it("sin desenlace reconocible devuelve unknown, que NO es 'salió bien'", () => {
    expect(readReturnOutcome({ volvio: "1" })).toBe("unknown");
    expect(readReturnOutcome({ collection_status: "null" })).toBe("unknown");
    expect(readReturnOutcome({ status: "" })).toBe("unknown");
    expect(readReturnOutcome({})).toBe("unknown");
  });

  it("tolera mayúsculas, espacios y el array que arma Next con la clave repetida", () => {
    expect(readReturnOutcome({ status: " Approved " })).toBe("approved");
    expect(readReturnOutcome({ collection_status: ["rejected", "approved"] })).toBe("rejected");
    expect(readReturnOutcome({ collection_status: [] })).toBe("unknown");
  });

  // Con un objeto literal, `BY_VALUE["constructor"]` devolvía la función
  // `Object` y `BY_VALUE["__proto__"]`, `Object.prototype`. La firma dice
  // `ReturnOutcome`, así que `tsc` no lo veía, y el valor cruzaba el borde
  // servidor→cliente como prop: una función no es serializable y la pantalla
  // del socio se caía en vez de renderizar. Los dos valores mágicos quedan
  // fijados acá.
  it("las claves heredadas de Object no son desenlaces: no puede volver una función", () => {
    for (const magic of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
      const out = readReturnOutcome({ status: magic });
      expect(out).toBe("unknown");
      expect(typeof out).toBe("string");
    }
  });
});

// La otra mitad de la vuelta: reconocer el pago que YA llegó. El webhook suele
// ganarle al redirect, así que si esto no lo ve, la pantalla le dice al vecino
// que su pago no llegó con el recibo tres centímetros más abajo.
describe("hasRecentLinkPayment", () => {
  const AT = new Date("2026-08-23T15:00:00.000Z");
  const now = () => AT.getTime();
  const link = (minsAgo: number, over: Partial<{ type: string; status: string }> = {}) => ({
    type: "link", status: "applied",
    paidAt: new Date(AT.getTime() - minsAgo * 60_000),
    ...over,
  });

  it("un pago por link de hace un minuto ES la confirmación que el vecino vino a buscar", () => {
    expect(hasRecentLinkPayment([link(1)], now)).toBe(true);
  });

  it("uno de hace media hora no: es el pago de otra vuelta", () => {
    expect(hasRecentLinkPayment([link(30)], now)).toBe(false);
  });

  it("no cuenta un efectivo reciente ni un link anulado", () => {
    expect(hasRecentLinkPayment([link(1, { type: "cash" })], now)).toBe(false);
    expect(hasRecentLinkPayment([link(1, { status: "voided" })], now)).toBe(false);
    expect(hasRecentLinkPayment([], now)).toBe(false);
  });

  it("encuentra el reciente aunque no sea el primero de la lista", () => {
    expect(hasRecentLinkPayment([link(300), link(2)], now)).toBe(true);
  });
});

// La matriz completa de la vuelta: 4 desenlaces × ¿había un pago reciente al
// montar? × ¿entró uno nuevo mientras mirábamos?. Está acá y no en un test de
// componente porque la decisión es pura; el componente sólo pone los textos.
describe("returnView", () => {
  const v = (outcome: "approved" | "pending" | "rejected" | "unknown", paidBefore: boolean, settled: boolean) =>
    returnView({ outcome, paidBefore, settled });

  it("un pago que entra MIENTRAS la pantalla mira confirma, diga lo que diga la query", () => {
    // Es el único hecho que es indudablemente de esta vuelta.
    for (const o of ["approved", "pending", "rejected", "unknown"] as const) {
      expect(v(o, false, true)).toBe("confirmed");
      expect(v(o, true, true)).toBe("confirmed");
    }
  });

  it("el webhook que ganó la carrera se ve como confirmación en el primer render", () => {
    // El caso probable y el que arregló la ola 1: MP notifica al aprobar, el
    // redirect todavía tiene que dar la vuelta por el navegador.
    expect(v("approved", true, false)).toBe("confirmed");
    expect(v("unknown", true, false)).toBe("confirmed");
  });

  it("un cupón pendiente NO se confirma con el pago de hace cuatro minutos", () => {
    // Pagó 1 cuota con tarjeta a las 10:00; a las 10:04 sacó un cupón de
    // Rapipago por las otras dos. Si acá dijera "confirmed", nunca lo paga.
    expect(v("pending", true, false)).toBe("pending");
    expect(v("pending", false, false)).toBe("pending");
  });

  it("un rechazo contra un socio que sí pagó no puede mandarlo a pagar de nuevo", () => {
    // `?volvio=1&status=rejected` armado a mano, o el reintento legítimo que
    // salió mal: las dos cosas son ciertas y el texto las nombra juntas.
    expect(v("rejected", true, false)).toBe("rejected-after-payment");
  });

  it("el rechazo limpio sigue siendo un rechazo", () => {
    expect(v("rejected", false, false)).toBe("rejected");
  });

  it("sin pago a la vista, `approved` en la query no alcanza para afirmar el éxito", () => {
    // Es un query param: lo escribe cualquiera. Se espera y se sondea.
    expect(v("approved", false, false)).toBe("waiting");
    expect(v("unknown", false, false)).toBe("waiting");
  });

  it("nunca devuelve nada fuera de las cinco vistas", () => {
    const allowed = ["confirmed", "pending", "rejected", "rejected-after-payment", "waiting"];
    for (const o of ["approved", "pending", "rejected", "unknown"] as const) {
      for (const paidBefore of [false, true]) {
        for (const settled of [false, true]) {
          expect(allowed).toContain(v(o, paidBefore, settled));
        }
      }
    }
  });
});
