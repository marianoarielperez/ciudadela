import { describe, expect, it } from "vitest";
import { resolveEmailNotice } from "@/lib/treasury/receipt-notice";

// El cartel que se ve después de un cobro en efectivo (spec §6.4): es la única
// devolución que tiene el operador de si el recibo salió por correo o hay que
// imprimirlo, así que cada valor de `ReceiptEmailOutcome` necesita su propio
// texto y su propio color -- y ningún valor ajeno puede pisar el de "emitido".
describe("resolveEmailNotice", () => {
  it("cada uno de los cinco valores tiene su propio texto y color", () => {
    expect(resolveEmailNotice("sent")).toEqual({ kind: "success", text: "Recibo emitido y enviado por email." });
    expect(resolveEmailNotice("no_email"))
      .toEqual({ kind: "warning", text: "Recibo emitido. El socio no tiene email: imprimilo." });
    expect(resolveEmailNotice("voided")).toEqual({
      kind: "warning",
      text: "Recibo emitido, pero figura anulado y por eso no se envió por email.",
    });
    expect(resolveEmailNotice("error"))
      .toEqual({ kind: "warning", text: "Recibo emitido, pero el email no salió. Podés reenviarlo desde acá." });
    expect(resolveEmailNotice("skipped")).toEqual({ kind: "success", text: "Recibo emitido." });
  });

  it("sin parámetro cae al cartel neutro de emitido", () => {
    expect(resolveEmailNotice(undefined)).toEqual({ kind: "success", text: "Recibo emitido." });
  });

  it("un valor desconocido cae al cartel neutro y no lo hace desaparecer", () => {
    // URL tipeada a mano, o un motivo nuevo que `ReceiptEmailOutcome` todavía
    // no declara: el cartel de "se cobró" tiene que seguir viéndose.
    expect(resolveEmailNotice("bounced")).toEqual({ kind: "success", text: "Recibo emitido." });
  });

  it("una prototype key no resuelve a un valor heredado de Object.prototype", () => {
    // `EMAIL_NOTICE` es un objeto literal: `EMAIL_NOTICE["constructor"]` es la
    // función Object (heredada, verdadera), y `EMAIL_NOTICE["toString"]` es
    // Object.prototype.toString. Un lookup ingenuo con `??` no dispara el
    // fallback porque el valor heredado ya es truthy -- el cartel queda vacío
    // (sin `kind` ni `text`) en vez de mostrar la confirmación del cobro.
    expect(resolveEmailNotice("constructor")).toEqual({ kind: "success", text: "Recibo emitido." });
    expect(resolveEmailNotice("toString")).toEqual({ kind: "success", text: "Recibo emitido." });
  });
});
