// El acta de la ANULACIÓN de una exención, en la pantalla: que se lea antes de
// confirmar y que no venga ninguna preseleccionada en silencio.
//
// Es el mismo caso que el cierre del libro (`reregistration-close-minute`), y
// apareció igual: en la verificación en vivo del módulo, anular la exención
// asentada por la Comisión Directiva N° 124 abrió el formulario con la N° 124 ya
// elegida —la lista viene por fecha descendente y la más reciente es justo el
// acta que CONCEDIÓ la exención—, así que la anulación se habría firmado con el
// acta que la otorga. Y la anulación se asienta UNA sola vez: el cerrojo
// optimista del dominio no la deja rehacer.
//
// Lo que se fija acá, en el HTML que ve el operador:
//   A. arranca en "Acta nueva", nunca con una existente elegida;
//   B. el resumen NOMBRA el acta que se va a usar antes de apretar.
//
// La action se mockea: importarla arrastraría `@/lib/prisma`, que tira al
// evaluarse sin DATABASE_URL. No se ejercita nada de ella.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/tesoreria/exenciones/actions", () => ({
  revokeExemptionAction: vi.fn(),
}));

import { RevokeExemptionForm } from "@/app/admin/tesoreria/exenciones/revoke-form";

// Como las arma la pantalla: por fecha DESCENDENTE. La primera es la que asentó
// la exención que se está por anular.
const MINUTES = [
  { id: 16, label: "Comisión Directiva N° 124 — 27/08/2026" },
  { id: 15, label: "Comisión Directiva N° 123 — 13/08/2026" },
];

const DEFAULTS = { type: "board" as const, numberByType: { board: 125, assembly: 4 }, date: "2026-08-27" };

const form = () =>
  renderToStaticMarkup(
    createElement(RevokeExemptionForm, {
      exemptionId: 3,
      backHref: "/admin/tesoreria/exenciones",
      minutes: MINUTES,
      minuteDefaults: DEFAULTS,
    }),
  );

describe("A. la anulación arranca en 'Acta nueva', no con la que concedió la exención", () => {
  it("no ofrece ningún acta existente elegida y sugiere el número siguiente", () => {
    const html = form();
    expect(html).toContain('name="minuteNew"');
    expect(html).toContain('value="125"');
    expect(html).toContain('value="2026-08-27"');
    // El desplegable de existentes no está, y con él tampoco el acta del
    // asiento: es exactamente lo que se vio preseleccionado en vivo.
    expect(html).not.toContain('name="minuteId"');
    expect(html).not.toContain("N° 124");
  });
});

describe("B. el resumen nombra el acta antes de confirmar", () => {
  it("con acta nueva dice que se va a CREAR, con tipo, número y fecha", () => {
    const html = form();
    expect(html).toContain("Acta de la anulación:");
    expect(html).toContain("se creará Comisión Directiva N° 125 con fecha 27/08/2026 (acta nueva).");
  });

  it("sin número ni fecha sugeridos NO hay acta que nombrar, y no se ofrece anular", () => {
    // El atributo, no la palabra: la clase del botón trae `disabled:opacity-50`,
    // así que un `toContain("disabled")` daría verde con el botón habilitado.
    const html = renderToStaticMarkup(
      createElement(RevokeExemptionForm, {
        exemptionId: 3,
        backHref: "/admin/tesoreria/exenciones",
        minutes: MINUTES,
        minuteDefaults: { type: "board" as const },
      }),
    );
    expect(html).toContain("falta completar");
    expect(html).toContain('disabled=""');
    // Con las sugerencias puestas el acta ya tiene nombre y el botón se ofrece.
    expect(form()).not.toContain('disabled=""');
  });
});
