import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountSection, type AutoDebitView } from "@/components/admin/account-section";
import type { MemberAccount } from "@/lib/treasury/account";
import { AUTO_DEBIT_WARNINGS, autoDebitSignal } from "@/lib/members/auto-debit";

// El aviso de la baja y del cambio de categoría: esas dos pantallas NO tocan el
// débito automático del socio en Mercado Pago, así que tienen que decirlo. Lo
// que se fija acá es a quién le sale el aviso, CUÁL de las dos señales lo
// disparó (que es lo que decide si el texto puede afirmar o tiene que preguntar)
// y qué ve el operador en la ficha.

describe("autoDebitSignal: a quién le sale el aviso", () => {
  it("avisa por el flag aunque no haya ninguna fila local", () => {
    // La ficha vieja: el débito se gestionó en el panel de MP mucho antes de que
    // existiera este sistema, así que `mp_subscriptions` no sabe nada de él.
    expect(autoDebitSignal({ autoDebit: true, subscriptionStatuses: [] })).toBe("flag_only");
  });

  it("avisa por la suscripción local aunque el flag esté en false", () => {
    // La ficha nueva: la suscripción la creó el M3 al asociarse el vecino y
    // nadie edita `autoDebit` al completar el asiento.
    expect(autoDebitSignal({ autoDebit: false, subscriptionStatuses: ["authorized"] })).toBe(
      "subscription",
    );
  });

  it("no avisa cuando no hay ninguna de las dos señales", () => {
    expect(autoDebitSignal({ autoDebit: false, subscriptionStatuses: [] })).toBe("none");
  });

  it("`cancelled` es lo único que se puede afirmar como 'acá no hay débito'", () => {
    expect(autoDebitSignal({ autoDebit: false, subscriptionStatuses: ["cancelled"] })).toBe("none");
    // Y si el débito se rehízo, la fila cancelada no tapa a la viva.
    expect(
      autoDebitSignal({ autoDebit: false, subscriptionStatuses: ["cancelled", "authorized"] }),
    ).toBe("subscription");
  });

  it("cualquier estado desconocido de MP cuenta como débito posible", () => {
    // El catálogo es de MP y puede crecer sin avisarnos: no saber en qué estado
    // está es peor que avisar de más (mismo criterio que `lateEntryNotice`).
    for (const status of ["pending", "paused", "authorized", "algo_nuevo_de_mp"]) {
      expect(autoDebitSignal({ autoDebit: false, subscriptionStatuses: [status] })).toBe(
        "subscription",
      );
    }
  });
});

describe("autoDebitSignal", () => {
  it("la fila viva GANA sobre el flag del padrón cuando están las dos", () => {
    // El orden de las ramas es lo que se fija acá: al revés, el socio con las
    // dos señales —una ficha vieja que además se afilió por la web— recibiría el
    // texto en condicional sobre una suscripción que el sistema tiene delante.
    expect(autoDebitSignal({ autoDebit: true, subscriptionStatuses: ["authorized"] })).toBe("subscription");
    expect(autoDebitSignal({ autoDebit: false, subscriptionStatuses: ["pending"] })).toBe("subscription");
  });

  it("el flag con la fila CANCELADA sigue siendo flag: no hay suscripción viva", () => {
    // Por eso el texto de `flag_only` dice "ninguna suscripción VIVA" y no
    // "ninguna suscripción": acá hay una, cancelada.
    expect(autoDebitSignal({ autoDebit: true, subscriptionStatuses: ["cancelled"] })).toBe("flag_only");
    expect(autoDebitSignal({ autoDebit: true, subscriptionStatuses: [] })).toBe("flag_only");
  });

  it("sin flag y sin fila viva no hay señal", () => {
    expect(autoDebitSignal({ autoDebit: false, subscriptionStatuses: [] })).toBe("none");
    expect(autoDebitSignal({ autoDebit: false, subscriptionStatuses: ["cancelled"] })).toBe("none");
  });
});

describe("AUTO_DEBIT_WARNINGS", () => {
  // No se fija el texto (eso obliga a editar el test por cada coma), sino el
  // DESTINO de cada aviso —lo único que el operador tiene que poder hacer
  // después de leerlo— y el TIEMPO VERBAL, que es lo que distingue un hecho
  // verificado de una suposición del Excel de 2026.
  it("la baja promete la cancelación y nombra la salida; la categoría, el empuje en el mismo envío", () => {
    // Desde la 4C la baja SÍ cancela (`withdrawWithDebits`), así que el texto ya
    // no puede decir "el sistema NO la cancela". Lo que sigue siendo cierto es
    // que puede fallar, y ahí queda la cancelación a mano: el destino que el
    // texto tiene que nombrar es Suscripciones, que es donde se reintenta.
    expect(AUTO_DEBIT_WARNINGS.baja.subscription).toMatch(/el sistema la va a cancelar/);
    expect(AUTO_DEBIT_WARNINGS.baja.subscription).toMatch(/Suscripciones/);
    // Desde la Task 10 (revisión) el monto se empuja SOLO en el mismo envío del
    // cambio de categoría — el texto ya no puede mandar a correr un lote a mano.
    expect(AUTO_DEBIT_WARNINGS.categoria.subscription).toMatch(/en el mismo envío/);
    expect(AUTO_DEBIT_WARNINGS.categoria.subscription).not.toMatch(/Aplicar valor vigente/);
    // Y los cuatro nombran Mercado Pago, que es de dónde sale el cobro.
    for (const bySignal of Object.values(AUTO_DEBIT_WARNINGS)) {
      for (const text of Object.values(bySignal)) expect(text).toContain("Mercado Pago");
    }
  });

  it("con la suscripción delante AFIRMA; con el flag del padrón a secas, pregunta", () => {
    // El aviso de la baja decía en presente "Mercado Pago le va a seguir
    // cobrando la cuota todos los meses" también para el socio cuya única señal
    // es el flag del padrón, que nadie verificó nunca contra MP.
    expect(AUTO_DEBIT_WARNINGS.baja.subscription).toContain("le va a seguir cobrando la cuota");
    for (const byAction of Object.values(AUTO_DEBIT_WARNINGS)) {
      expect(byAction.flag_only).toContain("Si ese débito todavía existe");
      expect(byAction.flag_only).not.toContain("le va a seguir cobrando la cuota");
    }
  });

  // La baja cancela lo que el sistema CONOCE: recorre `mp_subscriptions` por
  // `memberId`. Prometerle la cancelación a un socio cuya única señal es el flag
  // del padrón sería inventar un hecho, que es justo lo que estos textos vinieron
  // a sacar de la pantalla.
  it("la baja no le promete la cancelación al socio sin fila local", () => {
    expect(AUTO_DEBIT_WARNINGS.baja.flag_only).toMatch(/no va a cancelar nada/);
    expect(AUTO_DEBIT_WARNINGS.baja.flag_only).not.toMatch(/el sistema la va a cancelar/);
  });

  it("al socio con flag solo no lo manda al lote, que nunca lo va a listar", () => {
    // `listDivergent` sólo mira filas de `mp_subscriptions`: una suscripción que
    // el sistema no conoce no aparece ahí jamás.
    expect(AUTO_DEBIT_WARNINGS.categoria.flag_only).toMatch(/no lo alcanza/);
    expect(AUTO_DEBIT_WARNINGS.categoria.flag_only).toMatch(/panel de Mercado Pago/);
  });
});

// ── La línea de débito de la pestaña Cuenta corriente ──────────────────────────
//
// Se renderiza de verdad (mismo recurso que `treasury-income-exercise`) porque
// lo que se afirma acá es sobre PANTALLA: que el identificador del mandato de
// cobro nunca se muestra entero, y que la ficha no afirma nada que el sistema no
// sepa — ni "sin débito automático" cuando el padrón dice lo contrario, ni "no
// hay ninguna suscripción vinculada" cuando la hay y está cancelada.
// Hallazgo de la tercera pasada de la batería (T14), mirando la pantalla real de
// un socio: la fila TACHADA de un pago revertido decía "Cuota social" a secas,
// mientras el recibo anulado mostraba el período completo. La tabla derivaba el
// concepto de las cuotas VIVAS del pago, y al revertir las cuotas se sueltan.
// Es la fila donde saber qué se había cobrado importa más.
describe("AccountSection: el concepto de un pago revertido", () => {
  const pago = (over: Partial<MemberAccount["payments"][number]>) => ({
    id: 1, type: "link" as const, amount: 12000, paidAt: new Date("2026-08-23T12:00:00Z"),
    status: "applied" as const, periods: [], receipt: null, note: null, ...over,
  });
  const render = (payments: MemberAccount["payments"]) =>
    renderToStaticMarkup(createElement(AccountSection, {
      member: { id: 7, category: "active" as const },
      account: {
        fees: [], payments, pendingCount: 0, pendingPeriods: [], oldestPending: null,
        debt: null, feeAmount: 6000, level: 0,
      },
      rows: [], admin: true, receiptHref: (id: number) => `/admin/tesoreria/recibos/${id}`,
    }));

  const recibo = { id: 9, number: "2026-00005", concept: "Cuota social · abril a mayo 2026 (2 cuotas)" };

  it("un pago revertido conserva lo que decía el recibo, no lo que hoy tiene imputado", () => {
    const html = render([pago({
      status: "refunded", periods: [], receipt: { ...recibo, voidedAt: new Date("2026-08-23T13:00:00Z") },
    })]);
    expect(html).toContain("abril a mayo 2026 (2 cuotas)");
    expect(html).toContain("(anulado)");
  });

  it("un pago vigente también muestra el concepto congelado del recibo", () => {
    const html = render([pago({ periods: ["2026-04", "2026-05"], receipt: { ...recibo, voidedAt: null } })]);
    expect(html).toContain("abril a mayo 2026 (2 cuotas)");
  });

  // El derivado queda de respaldo: si algún día hay un pago sin recibo, la fila
  // sigue diciendo algo en vez de quedar vacía.
  it("sin recibo cae en el concepto derivado de las cuotas", () => {
    expect(render([pago({ periods: ["2026-04"], receipt: null })])).toContain("abril 2026");
  });
});

describe("AccountSection: la línea de débito automático", () => {
  const account: MemberAccount = {
    fees: [], payments: [], pendingCount: 0, pendingPeriods: [], oldestPending: null,
    debt: null, feeAmount: 6000, level: 0,
  };
  const render = (autoDebit: AutoDebitView | undefined, admin = true) =>
    renderToStaticMarkup(createElement(AccountSection, {
      member: { id: 7, category: "active" as const },
      account, rows: [], admin, receiptHref: (id: number) => `/admin/tesoreria/recibos/${id}`,
      autoDebit,
    }));

  const PREAPPROVAL = "9dd643d3b5da44bb9b15646b475db8bd";
  const OTHER = "1a2b3c4d5e6f47788990aabbccddeeff";
  const sub = (preapprovalId: string, status = "authorized") =>
    ({ preapprovalId, status, amount: 6000, linkedManually: true });
  const live: AutoDebitView = { flagged: true, live: [sub(PREAPPROVAL)], cancelledCount: 0, withdrawn: false };

  it("muestra estado, monto y origen, y el preapproval NUNCA entero", () => {
    const html = render(live);
    expect(html).toContain("Activa");
    expect(html).toContain("6.000");
    expect(html).toContain("Vinculada a mano");
    expect(html).toContain(PREAPPROVAL.slice(0, 8));
    expect(html).not.toContain(PREAPPROVAL);
  });

  it("un estado que no conocemos se muestra crudo, nunca traducido a la ligera", () => {
    // El catálogo es de MP: inventarle un nombre en castellano a `algo_nuevo`
    // sería afirmar algo que nadie verificó.
    const html = render({ ...live, live: [sub(PREAPPROVAL, "algo_nuevo")] });
    expect(html).toContain("algo_nuevo");
  });

  it("con dos suscripciones vivas no dice que hay una: las lista y avisa", () => {
    // `mp_subscriptions.memberId` es índice y no unique, y el vinculador rechaza
    // por `preapprovalId` repetido: dos preapprovals vivos son dos débitos por
    // mes, plata real de más, y la ficha los mostraba como uno solo.
    const html = render({ flagged: false, live: [sub(PREAPPROVAL), sub(OTHER)], cancelledCount: 0, withdrawn: false });
    expect(html).toContain("2 suscripciones vivas");
    expect(html).toContain(PREAPPROVAL.slice(0, 8));
    expect(html).toContain(OTHER.slice(0, 8));
    expect(html).toContain("una vez por cada una");
    expect(html).not.toContain(PREAPPROVAL);
    expect(html).not.toContain(OTHER);
    // Al socio VIGENTE el botón de Suscripciones no lo alcanza —el corte va por
    // la baja—, así que la salida sigue siendo el panel de Mercado Pago.
    expect(html).toContain("panel de Mercado Pago");
  });

  // El mismo aviso, sobre un EX socio: desde la 4C sus filas llevan el botón
  // «Cancelar el débito» en Suscripciones, así que mandarlo al panel de Mercado
  // Pago era falso — y además le corresponden CERO, no una.
  it("con dos vivas y el socio dado de baja, manda al botón y no al panel de MP", () => {
    const html = render({
      flagged: false, live: [sub(PREAPPROVAL), sub(OTHER)], cancelledCount: 0, withdrawn: true,
    });
    expect(html).toContain("Cancelar el débito");
    expect(html).toContain("/admin/tesoreria/suscripciones");
    expect(html).not.toContain("panel de Mercado Pago");
    expect(html).not.toContain("Dejá una sola");
  });

  it("la suscripción CANCELADA no se cuenta como 'no hay ninguna vinculada'", () => {
    // El estado estacionario de todo socio que se da de baja del débito: el cron
    // escribe `cancelled` y nadie baja nunca `Member.autoDebit`. La caja ámbar
    // decía para siempre que no había ninguna suscripción vinculada y mandaba a
    // vincular lo que no hay que vincular.
    const html = render({ flagged: true, live: [], cancelledCount: 1, withdrawn: false });
    expect(html).toContain("cancelado en Mercado Pago");
    expect(html).not.toContain("Vincular la suscripción");
    expect(html).not.toContain("Sin débito automático");
    // Y dice que el que quedó viejo es el flag del padrón, no la suscripción.
    expect(html).toContain("quedó viejo");
  });

  it("cancelada sin el flag del padrón no hace ruido con la discrepancia", () => {
    const html = render({ flagged: false, live: [], cancelledCount: 1, withdrawn: false });
    expect(html).toContain("cancelado en Mercado Pago");
    expect(html).not.toContain("quedó viejo");
  });

  it("el flag del padrón sin NINGUNA fila avisa, en vez de decir 'sin débito automático'", () => {
    const html = render({ flagged: true, live: [], cancelledCount: 0, withdrawn: false });
    expect(html).toContain("Sin conciliar");
    expect(html).toContain("Vincular la suscripción");
    expect(html).not.toContain("Sin débito automático");
  });

  it("sin ninguna de las dos señales ofrece el camino para vincular una", () => {
    const html = render({ flagged: false, live: [], cancelledCount: 0, withdrawn: false });
    expect(html).toContain("Sin débito automático");
    expect(html).toContain("/admin/tesoreria/suscripciones");
  });

  it("el socio no ve nada de esto en /mi/cuenta", () => {
    // `admin={false}` es el caso real: /mi/cuenta ni siquiera pasa la prop.
    expect(render(live, false)).not.toContain("Débito automático");
    expect(render(undefined, true)).not.toContain("Débito automático");
  });
});
