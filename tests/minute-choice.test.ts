// Las dos reglas puras del selector de actas: con qué acta ARRANCA y cómo se
// NOMBRA la elegida.
//
// Se prueban aparte porque de las dos salió el peor error del simulacro del
// Módulo 6: el cierre del Libro N° 1 quedó asentado con el acta de las bajas —la
// más reciente, preseleccionada en silencio— y la pantalla de confirmación no
// nombraba el acta en ningún lado, así que no había dónde darse cuenta.
//
// Nada de acá toca Prisma ni React.
import { describe, expect, it } from "vitest";

import {
  describeMinuteChoice,
  initialMinuteChoice,
  initialMinuteDraft,
  offeredMinutes,
  suggestedMinuteNumber,
} from "@/lib/members/minute-choice";

// La lista llega como la arma la pantalla: por fecha DESCENDENTE, así que la
// primera es siempre la más reciente.
const MINUTES = [
  { id: 9, label: "Comisión Directiva N° 126 — 26/08/2026" },
  { id: 8, label: "Comisión Directiva N° 125 — 12/08/2026" },
];

const DEFAULTS = {
  type: "board" as const,
  numberByType: { board: 127, assembly: 4 },
  date: "2026-08-27",
};

describe("initialMinuteChoice", () => {
  it("sin pedir nada arranca en 'existente' con la primera — los otros ocho consumidores", () => {
    expect(initialMinuteChoice({ minutes: MINUTES })).toEqual({
      mode: "existing",
      option: MINUTES[0],
    });
  });

  it("con defaultMode 'new' NO preselecciona ninguna existente: arranca en acta nueva", () => {
    const choice = initialMinuteChoice({
      minutes: MINUTES,
      defaultMode: "new",
      newDefaults: DEFAULTS,
    });
    // Es la regla que corrige el error del simulacro: en la pantalla de cierre
    // la más reciente es el acta del paso anterior (las bajas).
    expect(choice.mode).toBe("new");
    expect(choice).toEqual({
      mode: "new",
      draft: { type: "board", number: "127", date: "2026-08-27", description: "" },
    });
  });

  it("el acta que la acción anterior acaba de usar manda sobre todo lo demás", () => {
    const applied = { id: 12, label: "Comisión Directiva N° 128 — 27/08/2026" };
    expect(initialMinuteChoice({ minutes: MINUTES, applied, defaultMode: "new" })).toEqual({
      mode: "existing",
      option: applied,
    });
  });

  it("sin ninguna acta cargada cae en 'nueva' aunque nadie lo pida", () => {
    expect(initialMinuteChoice({ minutes: [] })).toEqual({
      mode: "new",
      draft: { type: "board", number: "", date: "", description: "" },
    });
  });
});

describe("suggestedMinuteNumber / initialMinuteDraft", () => {
  it("el número sugerido es POR TIPO: la numeración de actas lo es", () => {
    expect(suggestedMinuteNumber(DEFAULTS, "board")).toBe("127");
    expect(suggestedMinuteNumber(DEFAULTS, "assembly")).toBe("4");
    expect(suggestedMinuteNumber(undefined, "board")).toBe("");
  });

  it("sin sugerencias el borrador queda vacío y de Comisión Directiva", () => {
    expect(initialMinuteDraft()).toEqual({ type: "board", number: "", date: "", description: "" });
  });
});

describe("offeredMinutes", () => {
  it("ofrece la recién usada aunque la lista sea la de cuando se montó la página", () => {
    const applied = { id: 99, label: "Comisión Directiva N° 129 — 27/08/2026" };
    expect(offeredMinutes(MINUTES, applied)).toEqual([applied, ...MINUTES]);
    expect(offeredMinutes(MINUTES, MINUTES[1])).toEqual(MINUTES);
    expect(offeredMinutes(MINUTES)).toEqual(MINUTES);
  });
});

describe("describeMinuteChoice", () => {
  it("un acta existente se nombra con su etiqueta completa", () => {
    expect(describeMinuteChoice({ mode: "existing", option: MINUTES[0] })).toEqual({
      text: "Comisión Directiva N° 126 — 26/08/2026",
      ready: true,
    });
  });

  it("un acta nueva DICE que todavía no existe, con tipo, número y fecha", () => {
    const d = describeMinuteChoice({
      mode: "new",
      draft: { type: "board", number: "127", date: "2026-08-27", description: "" },
    });
    expect(d.ready).toBe(true);
    expect(d.text).toBe("se creará Comisión Directiva N° 127 con fecha 27/08/2026 (acta nueva).");
  });

  it("una asamblea se nombra como asamblea", () => {
    const d = describeMinuteChoice({
      mode: "new",
      draft: { type: "assembly", number: "4", date: "2026-08-27", description: "" },
    });
    expect(d.text).toContain("Asamblea N° 4");
  });

  it("sin número, sin fecha o con una fecha que no existe todavía no hay acta que nombrar", () => {
    const incomplete = [
      { type: "board" as const, number: "", date: "2026-08-27", description: "" },
      { type: "board" as const, number: "127", date: "", description: "" },
      // El 31 de febrero: `civilDateUtc` lo haría rodar al 3 de marzo, y el
      // resumen mostraría una fecha que el operador no tipeó.
      { type: "board" as const, number: "127", date: "2026-02-31", description: "" },
    ];
    for (const draft of incomplete) {
      const d = describeMinuteChoice({ mode: "new", draft });
      expect(d.ready).toBe(false);
      expect(d.text).toContain("falta completar");
    }
  });

  it("en 'existente' sin ninguna opción tampoco hay acta que nombrar", () => {
    expect(describeMinuteChoice({ mode: "existing", option: null })).toEqual({
      text: "todavía no elegiste ninguna.",
      ready: false,
    });
  });
});
