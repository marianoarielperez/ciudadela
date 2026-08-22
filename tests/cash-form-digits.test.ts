import { describe, expect, it } from "vitest";
import { digitsOnly } from "@/app/admin/tesoreria/efectivo/digits";

// El cleaner de `cash-form.tsx` es el que decide qué llega al servidor cuando
// el operador tipea. Sin este test no hay forma de pinar en qué se convierte
// "2500,50" en pantalla: el cleaner original (sin extraer) no era alcanzable
// como función pura.
describe("digitsOnly", () => {
  it("deja pasar solo dígitos", () => {
    expect(digitsOnly("2500")).toBe("2500");
    expect(digitsOnly("")).toBe("");
  });

  it("coma y punto no sobreviven: '2500,50' queda '250050', no '2500'", () => {
    // Es el comportamiento real de la pantalla, no el deseado para centavos:
    // el campo es de pesos enteros (ver el hint "En pesos enteros.") y punto o
    // coma no separan nada — se descartan los caracteres, no la magnitud. Este
    // caso es exactamente el que motivó rehacer el cleaner original (que
    // convertía "2500,50" en 250050 multiplicando el cobro por cien): acá
    // queda documentado que el 250050 sigue siendo alcanzable si el operador
    // tipea una coma, y por eso el hint y el placeholder insisten en enteros.
    expect(digitsOnly("2500,50")).toBe("250050");
    expect(digitsOnly("2.500.")).toBe("2500");
  });

  it("se usa igual para el campo de cantidad de cuotas", () => {
    expect(digitsOnly("2a")).toBe("2");
  });
});
