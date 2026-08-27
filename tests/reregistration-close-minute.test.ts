// El acta del CIERRE del libro, en la pantalla: que se lea antes de confirmar y
// que no venga ninguna preseleccionada en silencio.
//
// Es el tercer caso de la misma familia en el módulo, y el que costó caro: en el
// simulacro el cierre del Libro N° 1 —irreversible, se asienta ante la IGJ—
// quedó registrado con el acta de las BAJAS (la CD 126, creada minutos antes) en
// vez de con la CD 127 que el operador creía estar creando. El selector abría en
// "Acta existente" con la primera de la lista ya elegida —y la lista viene por
// fecha descendente— y la pantalla de confirmación no nombraba el acta en ningún
// lado.
//
// Lo que se fija acá es exactamente eso, en el HTML que ve el operador:
//   A. el resumen NOMBRA el acta elegida (y con "acta nueva" dice que se creará);
//   B. la pantalla de cierre arranca en "Acta nueva", nunca con una existente;
//   C. los otros ocho consumidores del selector siguen arrancando como siempre.
//
// La action se mockea: importarla arrastraría `@/lib/prisma`, que tira al
// evaluarse sin DATABASE_URL. No se ejercita nada de ella.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/reempadronamiento/cierre/confirmar/actions", () => ({
  closeBookAction: vi.fn(),
}));

import { ConfirmCloseForm } from "@/app/admin/reempadronamiento/cierre/confirmar/confirm-close-form";
import { CloseMinuteSummary } from "@/app/admin/reempadronamiento/cierre/confirmar/confirm-panels";
import { MinutePicker } from "@/components/admin/minute-picker";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

// Como las arma la pantalla: por fecha DESCENDENTE. La primera es la de las
// bajas del simulacro.
const MINUTES = [
  { id: 9, label: "Comisión Directiva N° 126 — 26/08/2026" },
  { id: 8, label: "Comisión Directiva N° 125 — 12/08/2026" },
];

const DEFAULTS = {
  type: "board" as const,
  numberByType: { board: 127, assembly: 4 },
  date: "2026-08-27",
};

const form = () =>
  render(
    createElement(ConfirmCloseForm, {
      processId: 5,
      oldNumber: 1,
      newNumber: 2,
      migrantCount: 160,
      minutes: MINUTES,
      minuteDefaults: DEFAULTS,
    }),
  );

describe("A. el resumen del cierre nombra el acta", () => {
  it("con acta nueva dice que se va a CREAR, con tipo, número y fecha", () => {
    const html = form();
    expect(html).toContain("Acta de cierre:");
    expect(html).toContain("se creará Comisión Directiva N° 127 con fecha 27/08/2026 (acta nueva).");
  });

  it("con un acta existente elegida la nombra entera", () => {
    // La elección existente no es alcanzable en el primer render de la pantalla
    // (arranca en "nueva"), así que el panel se prueba directo: es el mismo que
    // el formulario renderiza con la elección viva.
    const html = render(
      createElement(CloseMinuteSummary, { text: MINUTES[0].label, ready: true }),
    );
    expect(html).toContain("Acta de cierre:");
    expect(html).toContain("Comisión Directiva N° 126 — 26/08/2026");
  });

  it("mientras el acta no esté completa lo dice en ámbar", () => {
    const html = render(
      createElement(CloseMinuteSummary, {
        text: "falta completar el número y la fecha del acta nueva.",
        ready: false,
      }),
    );
    expect(html).toContain("falta completar");
    expect(html).toContain("text-warning");
  });
});

describe("B. el cierre arranca en 'Acta nueva', no con la más reciente", () => {
  it("no ofrece ningún acta existente elegida y sugiere el número siguiente", () => {
    const html = form();
    // Modo "nueva": están los campos del acta nueva…
    expect(html).toContain('name="minuteNew"');
    expect(html).toContain('value="127"');
    expect(html).toContain('value="2026-08-27"');
    // …y NO el desplegable de actas existentes con la de las bajas adentro.
    expect(html).not.toContain('name="minuteId"');
    expect(html).not.toContain("N° 126");
  });

  it("el botón que cierra el libro nace deshabilitado", () => {
    // Falta tildar la confirmación; el `disabled` es sólo display —la action lo
    // vuelve a exigir— pero es lo que impide apretar de corrido.
    expect(form()).toContain("disabled");
  });
});

describe("C. los otros consumidores del selector no cambian", () => {
  it("sin defaultMode sigue arrancando en 'Acta existente' con la primera", () => {
    const html = render(createElement(MinutePicker, { minutes: MINUTES }));
    expect(html).toContain('name="minuteId"');
    expect(html).toContain("Comisión Directiva N° 126 — 26/08/2026");
    expect(html).not.toContain('name="minuteNew"');
  });

  it("con un acta recién usada la ofrece y arranca elegida", () => {
    const applied = { id: 99, label: "Comisión Directiva N° 129 — 27/08/2026" };
    const html = render(createElement(MinutePicker, { minutes: MINUTES, applied }));
    expect(html).toContain("Comisión Directiva N° 129 — 27/08/2026");
    expect(html).toContain('name="minuteId"');
  });
});
