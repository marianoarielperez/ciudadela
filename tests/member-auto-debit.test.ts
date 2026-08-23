import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountSection, type AutoDebitView } from "@/components/admin/account-section";
import type { MemberAccount } from "@/lib/treasury/account";
import { AUTO_DEBIT_WARNINGS, hasLiveAutoDebit } from "@/lib/members/auto-debit";

// El aviso de la baja y del cambio de categoría: esas dos pantallas NO tocan el
// débito automático del socio en Mercado Pago, así que tienen que decirlo. Lo
// que se fija acá es a quién le sale el aviso.

describe("hasLiveAutoDebit", () => {
  it("avisa por el flag del padrón aunque no haya ninguna fila local", () => {
    // La ficha vieja: el débito se gestionó en el panel de MP mucho antes de que
    // existiera este sistema, así que `mp_subscriptions` no sabe nada de él.
    expect(hasLiveAutoDebit({ autoDebit: true, subscriptionStatuses: [] })).toBe(true);
  });

  it("avisa por la suscripción local aunque el flag esté en false", () => {
    // La ficha nueva: la suscripción la creó el M3 al asociarse el vecino y
    // nadie edita `autoDebit` al completar el asiento.
    expect(hasLiveAutoDebit({ autoDebit: false, subscriptionStatuses: ["authorized"] })).toBe(true);
  });

  it("no avisa cuando no hay ninguna de las dos señales", () => {
    expect(hasLiveAutoDebit({ autoDebit: false, subscriptionStatuses: [] })).toBe(false);
  });

  it("`cancelled` es lo único que se puede afirmar como 'acá no hay débito'", () => {
    expect(hasLiveAutoDebit({ autoDebit: false, subscriptionStatuses: ["cancelled"] })).toBe(false);
    // Y si el débito se rehízo, la fila cancelada no tapa a la viva.
    expect(
      hasLiveAutoDebit({ autoDebit: false, subscriptionStatuses: ["cancelled", "authorized"] }),
    ).toBe(true);
  });

  it("cualquier estado desconocido de MP cuenta como débito posible", () => {
    // El catálogo es de MP y puede crecer sin avisarnos: no saber en qué estado
    // está es peor que avisar de más (mismo criterio que `lateEntryNotice`).
    for (const status of ["pending", "paused", "authorized", "algo_nuevo_de_mp"]) {
      expect(hasLiveAutoDebit({ autoDebit: false, subscriptionStatuses: [status] })).toBe(true);
    }
  });
});

describe("AUTO_DEBIT_WARNINGS", () => {
  // No se fija el texto (eso obliga a editar el test por cada coma), sino el
  // DESTINO de cada aviso: es lo único que el operador tiene que poder hacer
  // después de leerlo, y es lo que se había desactualizado — el aviso del cambio
  // de categoría mandaba al panel de Mercado Pago cuando el monto ya se empuja
  // desde Tesorería → Valores de cuota (lote REG-34).
  it("la baja manda a cancelar en Mercado Pago; la categoría, al lote de Valores", () => {
    expect(AUTO_DEBIT_WARNINGS.baja).toMatch(/cancelar la\s+suscripción a mano en el panel de Mercado Pago/);
    expect(AUTO_DEBIT_WARNINGS.categoria).toMatch(/Valores de cuota/);
    expect(AUTO_DEBIT_WARNINGS.baja).not.toBe(AUTO_DEBIT_WARNINGS.categoria);
    // Y los dos nombran Mercado Pago, que es de dónde sale el cobro.
    for (const text of Object.values(AUTO_DEBIT_WARNINGS)) {
      expect(text).toContain("Mercado Pago");
    }
  });
});

// ── La línea de débito de la pestaña Cuenta corriente ──────────────────────────
//
// Se renderiza de verdad (mismo recurso que `treasury-income-exercise`) porque
// lo que se afirma acá es sobre PANTALLA: que el identificador del mandato de
// cobro nunca se muestra entero, y que la ficha no afirma "sin débito
// automático" cuando el padrón dice lo contrario.
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
  const live: AutoDebitView = {
    flagged: true,
    subscription: { preapprovalId: PREAPPROVAL, status: "authorized", amount: 6000, linkedManually: true },
  };

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
    const html = render({ ...live, subscription: { ...live.subscription!, status: "algo_nuevo" } });
    expect(html).toContain("algo_nuevo");
  });

  it("el flag del padrón sin fila local avisa, en vez de decir 'sin débito automático'", () => {
    const html = render({ flagged: true, subscription: null });
    expect(html).toContain("Sin conciliar");
    expect(html).not.toContain("Sin débito automático");
  });

  it("sin ninguna de las dos señales ofrece el camino para vincular una", () => {
    const html = render({ flagged: false, subscription: null });
    expect(html).toContain("Sin débito automático");
    expect(html).toContain("/admin/tesoreria/suscripciones");
  });

  it("el socio no ve nada de esto en /mi/cuenta", () => {
    // `admin={false}` es el caso real: /mi/cuenta ni siquiera pasa la prop.
    expect(render(live, false)).not.toContain("Débito automático");
    expect(render(undefined, true)).not.toContain("Débito automático");
  });
});
