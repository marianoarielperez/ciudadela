import { describe, expect, it } from "vitest";
import {
  adhesionBlockMessage, adhesionVerdict, nextMonthStartAR,
} from "@/lib/members/debit-adhesion";

// La regla de negocio, en una línea: el socio NO puede adherirse si ya pagó
// una cuota este mes calendario (para que no le salgan dos cobros el mismo
// mes). Tener DEUDA no bloquea —el primer débito la empieza a saldar— y por
// eso `adhesionVerdict` ni siquiera recibe la deuda como parámetro.

describe("adhesionVerdict", () => {
  it("categoría que no paga cuota bloquea, aunque las demás señales estén libres", () => {
    const v = adhesionVerdict({
      category: "lifetime",
      email: "vecino@example.com",
      subscriptionStatuses: [],
      paidThisMonth: false,
      at: new Date("2026-08-25T12:00:00Z"),
    });
    expect(v).toEqual({ ok: false, reason: "category" });
  });

  it("categoría honoraria y cadete también bloquean por no pagar cuota", () => {
    for (const category of ["honorary", "cadet"] as const) {
      const v = adhesionVerdict({
        category,
        email: "vecino@example.com",
        subscriptionStatuses: [],
        paidThisMonth: false,
        at: new Date("2026-08-25T12:00:00Z"),
      });
      expect(v).toEqual({ ok: false, reason: "category" });
    }
  });

  it("suscripción authorized bloquea por doble preapproval", () => {
    const v = adhesionVerdict({
      category: "active",
      email: "vecino@example.com",
      subscriptionStatuses: ["authorized"],
      paidThisMonth: false,
      at: new Date("2026-08-25T12:00:00Z"),
    });
    expect(v).toEqual({ ok: false, reason: "active_subscription" });
  });

  it("suscripción pending también bloquea (puede estar ya autorizada en MP)", () => {
    const v = adhesionVerdict({
      category: "active",
      email: "vecino@example.com",
      subscriptionStatuses: ["pending"],
      paidThisMonth: false,
      at: new Date("2026-08-25T12:00:00Z"),
    });
    expect(v).toEqual({ ok: false, reason: "active_subscription" });
  });

  it("suscripción paused también bloquea (se reanuda y vuelve a cobrar)", () => {
    const v = adhesionVerdict({
      category: "active",
      email: "vecino@example.com",
      subscriptionStatuses: ["paused"],
      paidThisMonth: false,
      at: new Date("2026-08-25T12:00:00Z"),
    });
    expect(v).toEqual({ ok: false, reason: "active_subscription" });
  });

  it("suscripción cancelled NO bloquea", () => {
    const v = adhesionVerdict({
      category: "active",
      email: "vecino@example.com",
      subscriptionStatuses: ["cancelled"],
      paidThisMonth: false,
      at: new Date("2026-08-25T12:00:00Z"),
    });
    expect(v).toEqual({ ok: true });
  });

  it("pagó este mes bloquea con availableFrom = 1° del mes que viene, 00:00 AR (03:00Z)", () => {
    const v = adhesionVerdict({
      category: "active",
      email: "vecino@example.com",
      subscriptionStatuses: [],
      paidThisMonth: true,
      at: new Date("2026-08-25T12:00:00Z"),
    });
    expect(v).toEqual({
      ok: false,
      reason: "paid_this_month",
      availableFrom: new Date("2026-09-01T03:00:00Z"),
    });
  });

  it("pagó este mes en diciembre: availableFrom cruza a enero del año siguiente", () => {
    const v = adhesionVerdict({
      category: "active",
      email: "vecino@example.com",
      subscriptionStatuses: [],
      paidThisMonth: true,
      at: new Date("2026-12-15T12:00:00Z"),
    });
    expect(v).toEqual({
      ok: false,
      reason: "paid_this_month",
      availableFrom: new Date("2027-01-01T03:00:00Z"),
    });
  });

  it("sin email bloquea (MP exige payer_email)", () => {
    const v = adhesionVerdict({
      category: "active",
      email: null,
      subscriptionStatuses: [],
      paidThisMonth: false,
      at: new Date("2026-08-25T12:00:00Z"),
    });
    expect(v).toEqual({ ok: false, reason: "no_email" });
  });

  it("con deuda pero sin haber pagado este mes, y todo lo demás libre: ok", () => {
    // La deuda NO es parámetro de la función: no hay forma de pasarla. Este
    // caso deja constancia de que sólo importan categoría, suscripción, pago
    // del mes y email.
    const v = adhesionVerdict({
      category: "active",
      email: "vecino@example.com",
      subscriptionStatuses: [],
      paidThisMonth: false,
      at: new Date("2026-08-25T12:00:00Z"),
    });
    expect(v).toEqual({ ok: true });
  });

  it("una exención vigente bloquea aunque todo lo demás esté libre", () => {
    // No hay nada que debitar: los meses del rango ya están como `exempt`, y un
    // débito le cobraría al vecino la cuota que el acta de la Comisión perdona.
    const v = adhesionVerdict({
      category: "active",
      email: "vecino@example.com",
      subscriptionStatuses: [],
      paidThisMonth: false,
      exemptedUntil: "2027-08",
      at: new Date("2026-08-25T12:00:00Z"),
    });
    expect(v).toEqual({ ok: false, reason: "exempted", until: "2027-08" });
  });

  it("sin exención (null o ausente) el veredicto no cambia", () => {
    // El parámetro es ADITIVO: los diez casos de arriba no lo pasan y siguen
    // dando lo mismo. Este caso fija las dos formas de "no hay exención".
    const base = {
      category: "active" as const,
      email: "vecino@example.com",
      subscriptionStatuses: [],
      paidThisMonth: false,
      at: new Date("2026-08-25T12:00:00Z"),
    };
    expect(adhesionVerdict({ ...base, exemptedUntil: null })).toEqual({ ok: true });
    expect(adhesionVerdict(base)).toEqual({ ok: true });
  });

  it("el orden de las guardas es exención > categoría > suscripción > pago del mes > email", () => {
    // La exención va PRIMERA: un eximido es socio activo, así que la guarda de
    // categoría lo dejaría pasar y el mensaje que leería sería otro.
    expect(
      adhesionVerdict({
        category: "honorary",
        email: null,
        subscriptionStatuses: ["authorized"],
        paidThisMonth: true,
        exemptedUntil: "2027-08",
        at: new Date("2026-08-25T12:00:00Z"),
      }),
    ).toEqual({ ok: false, reason: "exempted", until: "2027-08" });

    // Categoría que no paga gana aunque además falte el email.
    expect(
      adhesionVerdict({
        category: "honorary",
        email: null,
        subscriptionStatuses: ["authorized"],
        paidThisMonth: true,
        at: new Date("2026-08-25T12:00:00Z"),
      }),
    ).toEqual({ ok: false, reason: "category" });

    // Suscripción activa gana sobre pago del mes y email faltante.
    expect(
      adhesionVerdict({
        category: "active",
        email: null,
        subscriptionStatuses: ["authorized"],
        paidThisMonth: true,
        at: new Date("2026-08-25T12:00:00Z"),
      }),
    ).toEqual({ ok: false, reason: "active_subscription" });

    // Pago del mes gana sobre email faltante.
    expect(
      adhesionVerdict({
        category: "active",
        email: null,
        subscriptionStatuses: [],
        paidThisMonth: true,
        at: new Date("2026-08-25T12:00:00Z"),
      }),
    ).toEqual({
      ok: false,
      reason: "paid_this_month",
      availableFrom: new Date("2026-09-01T03:00:00Z"),
    });
  });
});

describe("nextMonthStartAR", () => {
  it("mes común: el 1° del mes siguiente, 00:00 AR = 03:00Z", () => {
    expect(nextMonthStartAR(new Date("2026-08-25T12:00:00Z"))).toEqual(
      new Date("2026-09-01T03:00:00Z"),
    );
  });

  it("diciembre cruza al 1° de enero del año siguiente", () => {
    expect(nextMonthStartAR(new Date("2026-12-31T23:50:00Z"))).toEqual(
      new Date("2027-01-01T03:00:00Z"),
    );
  });

  it("último instante de agosto en hora AR (23:30Z todavía es 20:30 AR del 31)", () => {
    // UTC-3: las 23:30Z del 31/08 son las 20:30 AR del mismo día, así que el
    // mes civil argentino sigue siendo agosto y el resultado no cambia.
    expect(nextMonthStartAR(new Date("2026-08-31T23:30:00Z"))).toEqual(
      new Date("2026-09-01T03:00:00Z"),
    );
  });
});

describe("adhesionBlockMessage", () => {
  it("category", () => {
    expect(adhesionBlockMessage({ ok: false, reason: "category" })).toBe(
      "Tu categoría no paga cuota, así que no hay débito que adherir.",
    );
  });

  it("active_subscription", () => {
    expect(adhesionBlockMessage({ ok: false, reason: "active_subscription" })).toBe(
      "Ya tenés un débito automático activo. Si querés cambiarlo, primero cancelalo.",
    );
  });

  it("paid_this_month incluye la fecha formateada es-AR", () => {
    expect(
      adhesionBlockMessage({
        ok: false,
        reason: "paid_this_month",
        availableFrom: new Date("2026-09-01T03:00:00Z"),
      }),
    ).toBe("Ya abonaste una cuota este mes. Podés adherirte desde el 01/09/2026.");
  });

  it("no_email", () => {
    expect(adhesionBlockMessage({ ok: false, reason: "no_email" })).toBe(
      "Para adherir el débito necesitás un email cargado en tu ficha. Cargalo en Mis datos.",
    );
  });

  it("exempted nombra el mes en castellano, con `periodLabel`", () => {
    expect(adhesionBlockMessage({ ok: false, reason: "exempted", until: "2027-08" })).toBe(
      "Estás eximido de la cuota hasta agosto 2027: no hay nada que debitar.",
    );
  });
});
