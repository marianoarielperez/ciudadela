import { describe, expect, it } from "vitest";
import {
  type CancelEffect, cancelEffect, cancelEffectSentence, cancelEffectSentenceForMember,
} from "@/lib/mp/cancel-effect";

// La pantalla que pide confirmar la cancelación de un débito resolvía sus dos
// frases con `status === "authorized"`. Con eso, TODO lo que no fuera
// `authorized` —`paused` incluida— leía: «el vecino nunca autorizó el débito,
// así que no hay ningún cobro que cortar». Las dos afirmaciones son falsas para
// una pausada, y lo desmiente el propio `subscription-status.ts`: `paused` está
// en la lista blanca porque se reanuda y vuelve a cobrar.
//
// Estos tests fijan que sean CUATRO desenlaces y que ninguno mienta.
describe("cancelEffect: qué se puede afirmar que pasa al cancelar", () => {
  it("son cuatro casos distintos, uno por estado que MP nombra", () => {
    expect(cancelEffect("authorized")).toBe("stops_charging");
    expect(cancelEffect("paused")).toBe("would_resume");
    expect(cancelEffect("pending")).toBe("never_authorized");
  });

  it("una `paused` NO cae en el mismo casillero que una `pending`", () => {
    // La regresión concreta: el booleano las aplastaba en la misma frase.
    expect(cancelEffect("paused")).not.toBe(cancelEffect("pending"));
    expect(cancelEffect("paused")).not.toBe(cancelEffect("authorized"));
  });

  it("un estado que MP invente mañana es su propio caso, no «nunca se autorizó»", () => {
    expect(cancelEffect("suspended_by_bank_2027")).toBe("unknown");
    expect(cancelEffect("suspended_by_bank_2027")).not.toBe("never_authorized");
  });
});

describe("cancelEffectSentence: ninguna de las cuatro frases miente", () => {
  const say = (effect: CancelEffect, amountLabel: string | null = "$ 12.000,00") =>
    cancelEffectSentence({ effect, amountLabel, statusLabel: "suspended_by_bank_2027" });

  it("la autorizada dice que se corta un cobro que hoy sale", () => {
    expect(say("stops_charging")).toBe("Mercado Pago deja de debitarle la cuota de $ 12.000,00 todos los meses.");
  });

  it("la pausada dice que hoy no cobra PERO que se reanuda", () => {
    const s = say("would_resume");
    expect(s).toContain("pausada");
    expect(s).toContain("se reanuda");
    // Lo que no puede decir: que nunca se autorizó, ni que no hay nada que cortar.
    expect(s).not.toContain("nunca autorizó");
    expect(s).not.toContain("no hay ningún cobro que cortar");
  });

  it("la pendiente es la ÚNICA que puede decir que nunca se autorizó", () => {
    expect(say("never_authorized")).toContain("nunca autorizó");
    for (const other of ["stops_charging", "would_resume", "unknown"] as const) {
      expect(say(other)).not.toContain("nunca autorizó");
    }
  });

  it("el estado desconocido lo nombra y admite que no se sabe", () => {
    const s = say("unknown");
    expect(s).toContain("suspended_by_bank_2027");
    expect(s).toContain("no se puede afirmar");
  });

  it("sin monto en el espejo local, ninguna frase inventa un importe", () => {
    for (const e of ["stops_charging", "would_resume", "never_authorized", "unknown"] as const) {
      expect(say(e, null)).not.toContain("$");
    }
  });
});

// `cancelEffectSentenceForMember`: la MISMA pregunta pero para la pantalla que
// lee el propio socio (`/mi/debito/cancelar`), no un operador — agregado
// aditivo de la Tarea 13, revisión. Mismos cuatro casos, redactados en
// segunda persona ("vos"), sin tocar `cancelEffectSentence`.
describe("cancelEffectSentenceForMember: las cuatro frases, pero para el socio", () => {
  const sayMember = (effect: CancelEffect, amountLabel: string | null = "$ 12.000,00") =>
    cancelEffectSentenceForMember({ effect, amountLabel, statusLabel: "suspended_by_bank_2027" });

  it("la autorizada le dice a VOS que se corta un cobro que hoy le sale", () => {
    expect(sayMember("stops_charging")).toBe("Mercado Pago te deja de debitar la cuota de $ 12.000,00 todos los meses.");
  });

  it("la pausada le dice que hoy no cobra PERO que se reanuda", () => {
    const s = sayMember("would_resume");
    expect(s).toContain("pausada");
    expect(s).toContain("se reanuda");
    // Lo que no puede decir: que nunca autorizó, ni que no hay nada que cortar.
    expect(s).not.toContain("nunca autorizaste");
    expect(s).not.toContain("no hay ningún cobro que cortar");
  });

  it("la pendiente es la ÚNICA que puede decirle que nunca autorizó", () => {
    expect(sayMember("never_authorized")).toContain("nunca autorizaste");
    for (const other of ["stops_charging", "would_resume", "unknown"] as const) {
      expect(sayMember(other)).not.toContain("nunca autorizaste");
    }
  });

  it("el estado desconocido no le expone jerga de sistema ni el status crudo de MP", () => {
    const s = sayMember("unknown");
    expect(s).not.toContain("suspended_by_bank_2027");
    expect(s).not.toContain("el sistema no conoce");
    // Lo único que puede afirmar: que no se pudo confirmar, y que cancelar corta el cobro.
    expect(s).toContain("No pudimos confirmar");
  });

  it("las cuatro frases son distintas entre sí", () => {
    const sentences = (["stops_charging", "would_resume", "never_authorized", "unknown"] as const).map((e) =>
      sayMember(e));
    expect(new Set(sentences).size).toBe(4);
  });

  it("sin monto en el espejo local, ninguna frase inventa un importe", () => {
    for (const e of ["stops_charging", "would_resume", "never_authorized", "unknown"] as const) {
      expect(sayMember(e, null)).not.toContain("$");
    }
  });
});
