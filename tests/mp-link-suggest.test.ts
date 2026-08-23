import { describe, expect, it } from "vitest";
import { suggestMember } from "@/lib/mp/link-suggest";

const members = [
  { id: 14, fullName: "Perez, Mariano Ariel", email: "marianoaperez@yahoo.com.ar" },
  { id: 306, fullName: "Gomez, Martin", email: null },
  { id: 7, fullName: "Perez, Ana", email: "ana@x.com" },
];
describe("suggestMember", () => {
  it("email exacto (case-insensitive) gana", () => {
    expect(suggestMember({ payerEmail: "MarianoAPerez@yahoo.com.ar", reason: "Cuota Gomez" }, members)?.id).toBe(14);
  });
  it("sin email, apellido contenido en el reason; si hay más de uno con ese apellido, ninguno", () => {
    expect(suggestMember({ payerEmail: null, reason: "Cuota Vecinal - Gomez" }, members)?.id).toBe(306);
    expect(suggestMember({ payerEmail: null, reason: "Cuota Perez" }, members)).toBeNull();
  });
  it("nada que matchee → null", () => {
    expect(suggestMember({ payerEmail: "x@y.com", reason: "Cuota" }, members)).toBeNull();
    expect(suggestMember({ payerEmail: null, reason: null }, members)).toBeNull();
  });

  // Casos de borde que el brief no lista pero que la pantalla va a ver: el
  // padrón trae tildes y el `reason` de MP casi nunca las lleva.
  it("ignora tildes y mayúsculas al comparar el apellido", () => {
    const conTilde = [{ id: 20, fullName: "Gómez Núñez, Ana", email: null }];
    expect(suggestMember({ payerEmail: null, reason: "CUOTA GOMEZ NUNEZ" }, conTilde)?.id).toBe(20);
  });
  it("un apellido de menos de 3 letras no sugiere: matchearía cualquier cosa", () => {
    const corto = [{ id: 21, fullName: "Li, Juan", email: null }];
    expect(suggestMember({ payerEmail: null, reason: "Cuota social" }, corto)).toBeNull();
  });
  it("el email del pagador que no está en el padrón no bloquea la pista del reason", () => {
    expect(suggestMember({ payerEmail: "otro@mp.com", reason: "Cuota Gomez" }, members)?.id).toBe(306);
  });
  it("un socio sin email no matchea contra un pagador sin email", () => {
    expect(suggestMember({ payerEmail: null, reason: "nada" }, members)).toBeNull();
  });

  // `Member.email` NO es único en el schema: un matrimonio o un padre y su hijo
  // se cargan con la misma casilla. Sin la guarda, el `.find` devolvía el
  // primero por id y la pantalla proponía al familiar equivocado.
  it("dos socios con el mismo email no sugieren a ninguno", () => {
    const familia = [
      { id: 30, fullName: "Ruiz, Carlos", email: "familia@x.com" },
      { id: 31, fullName: "Ruiz, Elena", email: "familia@x.com" },
    ];
    expect(suggestMember({ payerEmail: "familia@x.com", reason: "Cuota Ruiz" }, familia)).toBeNull();
  });
  it("un email ambiguo no baja a la pista del apellido", () => {
    const pareja = [
      { id: 32, fullName: "Ruiz, Carlos", email: "pareja@x.com" },
      { id: 33, fullName: "Sosa, Elena", email: "pareja@x.com" },
    ];
    expect(suggestMember({ payerEmail: "pareja@x.com", reason: "Cuota Sosa" }, pareja)).toBeNull();
  });

  // El apellido se compara como PALABRA: "Cuota Romanelli" no es Roman.
  it("el apellido no matchea como subcadena de otra palabra", () => {
    const roman = [{ id: 40, fullName: "Roman, Juan", email: null }];
    expect(suggestMember({ payerEmail: null, reason: "Cuota Romanelli" }, roman)).toBeNull();
    expect(suggestMember({ payerEmail: null, reason: "Cuota Roman" }, roman)?.id).toBe(40);
    expect(suggestMember({ payerEmail: null, reason: "cuota-roman-2026" }, roman)?.id).toBe(40);
  });
});
