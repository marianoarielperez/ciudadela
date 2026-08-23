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
});
