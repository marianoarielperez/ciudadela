import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  boardAudience, BoardNoticesPanel, classifyNotice, CounterChips, nextStep, ProcessVerdict,
  UnnotifiedPanel, type ProcessCountersView, type UnnotifiedRow,
} from "@/app/admin/reempadronamiento/board-panels";
import { daysLeftLabel, ProcessStepper, type StepperProcess } from "@/app/admin/reempadronamiento/process-stepper";
import type { PresentationStatus } from "@/generated/prisma/client";

// El tablero del re-empadronamiento no se puede abrir en un navegador desde acá
// (no hay sesión), así que lo que se verifica es lo que decide si el operador va
// a poder usarlo: la línea de proceso —qué etapa está marcada y con cuántos días—
// y el veredicto —qué es lo próximo que tiene que hacer—.
//
// El modo de falla que estos tests existen para impedir es doble: que la
// pantalla marque la etapa equivocada (de la que cuelga una baja) y que reduzca
// a un número a los vecinos que quedaron sin aviso, que es pedirle al operador
// una tarea sin darle los medios. Precedente: `tests/admin-health-screen.test.ts`.

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const CALLED = new Date("2026-09-01T12:00:00Z");
const FIRST_END = new Date("2026-10-01T12:00:00Z");
const SECOND_END = new Date("2026-10-11T12:00:00Z");

function process(over: Partial<StepperProcess> = {}): StepperProcess {
  return { status: "first_instance", calledAt: CALLED, firstEndsAt: FIRST_END, secondEndsAt: null, ...over };
}

function counters(over: Partial<ProcessCountersView> = {}): ProcessCountersView {
  const byStatus: Record<PresentationStatus, number> = {
    pending: 112, submitted: 5, observed: 2, validated: 5, rejected: 0, withdrawn: 0,
  };
  return { byStatus, cohortSize: 124, daysLeft: 24, ...over };
}

describe("daysLeftLabel", () => {
  it("cuenta el día del vencimiento como disponible", () => {
    // 0 es "vence hoy" y NO "faltan 0 días": ese día el socio lo tiene entero
    // (es la misma lectura de `hasExpired`, que recién da vencido al siguiente).
    expect(daysLeftLabel(24)).toBe("Faltan 24 días");
    expect(daysLeftLabel(1)).toBe("Falta 1 día");
    expect(daysLeftLabel(0)).toBe("Vence hoy");
    expect(daysLeftLabel(-1)).toBe("Venció ayer");
    expect(daysLeftLabel(-3)).toBe("Venció hace 3 días");
  });
});

/** El `<li>` que quedó marcado como etapa en curso, ACOTADO a ese elemento.
 *
 *  Partir por `aria-current="step"` y mirar todo el resto del documento no
 *  alcanza: el resto contiene TODAS las etapas siguientes, así que la aserción
 *  pasaba igual con la marca corrida una etapa —bastaba con que el texto
 *  buscado apareciera más abajo—. Y ése es exactamente el modo de falla que
 *  este archivo existe para impedir (de la etapa cuelga una baja). El corte va
 *  del `<li` que trae la marca hasta su `</li>`: adentro de una etapa no hay
 *  otra anidada. */
function currentStage(html: string): string {
  const item = html.split("<li").find((chunk) => chunk.includes('aria-current="step"'));
  expect(item, "ninguna etapa quedó marcada como actual").toBeDefined();
  return (item as string).split("</li>")[0];
}

describe("ProcessStepper", () => {
  it("marca la etapa en curso y muestra los días que faltan", () => {
    const html = render(createElement(ProcessStepper, { process: process(), daysLeft: 24 }));

    // Las cinco etapas, numeradas: acá la secuencia SÍ es información.
    expect(html).toContain("Convocado");
    expect(html).toContain("1ª instancia");
    expect(html).toContain("2ª instancia");
    expect(html).toContain("Cierre");
    expect(html).toContain("Cerrado");
    // Exactamente una etapa en curso, y es la primera instancia.
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    const current = currentStage(html);
    expect(current).toContain("1ª instancia");
    expect(current).toContain("Faltan 24 días");
    // Las fechas asentadas, en la tipografía tabular del proyecto.
    expect(html).toContain("01/09/2026");
    expect(html).toContain("hasta el 01/10/2026");
    expect(html).toContain("tabular-nums");
  });

  it("no inventa una fecha para la segunda instancia hasta que se abre", () => {
    const html = render(createElement(ProcessStepper, { process: process(), daysLeft: 24 }));

    // La fecha que todavía no existe se nombra por su regla. Una estimación en
    // la misma tipografía que las asentadas se lee como asentada.
    expect(html).toContain("10 días corridos más");
    expect(html).not.toContain("11/10/2026");
  });

  it("mueve la marca cuando se abre la segunda instancia", () => {
    const html = render(createElement(ProcessStepper, {
      process: process({ status: "second_instance", secondEndsAt: SECOND_END }),
      daysLeft: 6,
    }));

    const current = currentStage(html);
    expect(current).toContain("2ª instancia");
    expect(current).toContain("Faltan 6 días");
    expect(html).toContain("hasta el 11/10/2026");
  });

  it("un proceso cerrado no muestra cuenta regresiva", () => {
    const html = render(createElement(ProcessStepper, {
      process: process({ status: "closed", secondEndsAt: SECOND_END }),
      daysLeft: null,
    }));

    const current = currentStage(html);
    expect(current).toContain("Cerrado");
    expect(html).not.toContain("Faltan");
    expect(html).not.toContain("Vence hoy");
  });
});

describe("nextStep", () => {
  const base = { firstEndsAt: FIRST_END, secondEndsAt: null as Date | null };

  it("mientras el plazo corre y no hay nada que revisar, la respuesta es esperar", () => {
    const step = nextStep({
      ...base, status: "first_instance", expired: false,
      counters: counters({ byStatus: { ...counters().byStatus, submitted: 0 } }),
    });
    expect(step.tone).toBe("wait");
    expect(step.label).toContain("01/10/2026");
  });

  it("una presentación esperando revisión es trabajo, aunque el plazo corra", () => {
    const step = nextStep({ ...base, status: "first_instance", expired: false, counters: counters() });
    expect(step.tone).toBe("act");
    expect(step.label).toBe("Revisá las 5 presentaciones que llegaron.");
  });

  it("vencida la primera instancia, lo próximo es abrir la segunda", () => {
    const step = nextStep({ ...base, status: "first_instance", expired: true, counters: counters() });
    expect(step.tone).toBe("act");
    expect(step.label).toContain("iniciá la segunda");
  });

  it("vencida la segunda, lo próximo es el cierre", () => {
    const step = nextStep({
      ...base, secondEndsAt: SECOND_END, status: "second_instance", expired: true, counters: counters(),
    });
    expect(step.tone).toBe("act");
    expect(step.label).toContain("prepará el cierre");
  });
});

describe("ProcessVerdict", () => {
  it("dice la etapa, cuánta gente falta y qué hacer, en ese orden", () => {
    const html = render(createElement(ProcessVerdict, {
      status: "first_instance", counters: counters(), firstEndsAt: FIRST_END,
      secondEndsAt: null, expired: false, bookNumber: 1,
    }));

    expect(html).toContain("Primera instancia");
    expect(html).toContain("faltan 24 días");
    // Presentados = submitted + observed + validated (la observada presentó: le
    // pedimos corregir). 5 + 2 + 5 = 12 de 124, faltan 112.
    expect(html).toContain(">12<");
    expect(html).toContain(">124<");
    expect(html).toContain(">112<");
    expect(html).toContain("Lo próximo");
    // NUNCA nace en rojo: esperar un plazo que corre bien no es una avería, y
    // el veredicto es el estado de la pantalla, no la respuesta a una acción.
    expect(html).not.toContain('role="alert"');
  });
});

describe("CounterChips", () => {
  it("muestra los seis estados con su etiqueta en castellano", () => {
    const html = render(createElement(CounterChips, { byStatus: counters().byStatus }));

    expect(html).toContain("Sin presentar");
    expect(html).toContain("Presentada");
    expect(html).toContain("Observada");
    expect(html).toContain("Validada");
    expect(html).toContain("Rechazada");
    expect(html).toContain("Baja declarada");
    expect(html).toContain(">112<");
  });
});

describe("classifyNotice", () => {
  it("sin casilla utilizable, el canal es el cartel de la sede", () => {
    expect(classifyNotice({ email: null, emailStatus: "none", notices: [] })).toBe("board");
    expect(classifyNotice({ email: "a@b.com", emailStatus: "bounced", notices: [] })).toBe("board");
  });

  it("una acreditación de envío alcanza, y el acuse de entrega también", () => {
    expect(classifyNotice({ email: "a@b.com", emailStatus: "declared", notices: [{ status: "sent" }] })).toBe("sent");
    expect(classifyNotice({ email: "a@b.com", emailStatus: "verified", notices: [{ status: "delivered" }] })).toBe("sent");
  });

  it("un fallo registrado es reintentable; el reintento exitoso lo pisa", () => {
    expect(classifyNotice({ email: "a@b.com", emailStatus: "declared", notices: [{ status: "failed" }] })).toBe("failed");
    expect(
      classifyNotice({ email: "a@b.com", emailStatus: "declared", notices: [{ status: "failed" }, { status: "sent" }] }),
    ).toBe("sent");
  });

  it("con casilla y sin ninguna fila, el vecino quedó sin rastro de aviso", () => {
    // Es el caso peligroso: lo frenó EMAIL_ALLOWLIST o lo difirió el tope, y NO
    // cae a la cartelera —el cartel se arma con los que no tienen casilla—.
    expect(classifyNotice({ email: "a@b.com", emailStatus: "declared", notices: [] })).toBe("no_trace");
  });
});

describe("UnnotifiedPanel", () => {
  const rows: UnnotifiedRow[] = [
    { memberId: 14, memberNumber: 21, fullName: "Castillo Nestor", verdict: "failed" },
    { memberId: 88, memberNumber: 143, fullName: "Vera Ramona", verdict: "no_trace" },
  ];

  it("los NOMBRA con enlace a la ficha, no los cuenta", () => {
    const html = render(createElement(UnnotifiedPanel, { rows, instanceLabel: "la convocatoria" }));

    expect(html).toContain("Castillo Nestor");
    expect(html).toContain("Vera Ramona");
    expect(html).toContain('href="/admin/socios/14"');
    expect(html).toContain('href="/admin/socios/88"');
    // Y el motivo al lado: los dos no se atienden igual.
    expect(html).toContain("el envío falló");
    expect(html).toContain("no salió");
  });

  it("no le atribuye una causa al que no dejó rastro de envío", () => {
    // El que no dejó rastro puede ser un bloqueado por la lista de permitidos,
    // un diferido por el tope… o un adherente al que le CARGARON el correo
    // durante el plazo, que es lo que este módulo busca que pase y a quien
    // nunca se le intentó un envío: a él le tocó el cartel. Afirmar "no salió
    // por el tope" manda al operador a buscar una avería que no existe.
    const html = render(createElement(UnnotifiedPanel, { rows, instanceLabel: "la convocatoria" }));

    expect(html).toContain("no hay ningún rastro de envío");
    expect(html).not.toContain("EMAIL_ALLOWLIST");
    expect(html).not.toContain("tope de envíos");
  });

  it("dice que estos NO entran en el cartel de la sede", () => {
    const html = render(createElement(UnnotifiedPanel, { rows, instanceLabel: "la convocatoria" }));
    expect(html).toContain("NO entran en el cartel");
  });

  it("sin nadie pendiente, no muestra una tabla vacía ni una alarma", () => {
    const html = render(createElement(UnnotifiedPanel, { rows: [], instanceLabel: "la convocatoria" }));

    expect(html).toContain("Todos los convocados con casilla recibieron el aviso de la convocatoria.");
    expect(html).not.toContain('role="alert"');
  });
});

describe("boardAudience", () => {
  // El lote de cartelera se arma UNA vez y se imprime. Contarlo en vivo sobre
  // el padrón da un número que BAJA solo a medida que los socios cargan su
  // correo —que es el objetivo del módulo—, y termina por debajo de la nómina
  // que está fijada en la pared de la sede.
  it("el conteo sale del LOTE asentado, no del padrón de hoy", () => {
    expect(boardAudience({ auditDetail: { boardCount: 100, cohortSize: 124 }, liveCount: 96 }))
      .toEqual({ count: 100, fromBatch: true });
  });

  it("un cero asentado es un cero, no un dato que falta", () => {
    expect(boardAudience({ auditDetail: { boardCount: 0 }, liveCount: 4 }))
      .toEqual({ count: 0, fromBatch: true });
  });

  it("sin asiento utilizable cae al conteo en vivo Y LO DECLARA", () => {
    // `detail` es un Json de Prisma: puede ser null, un número, un arreglo o
    // traer basura. Ninguna de esas formas puede terminar en un número
    // inventado en pantalla.
    for (const auditDetail of [null, undefined, 3, "100", [1, 2], {}, { boardCount: "cien" }, { boardCount: -1 }, { boardCount: 1.5 }]) {
      expect(boardAudience({ auditDetail, liveCount: 96 })).toEqual({ count: 96, fromBatch: false });
    }
  });
});

describe("BoardNoticesPanel", () => {
  it("presenta el número del lote como lo que es", () => {
    const html = render(createElement(BoardNoticesPanel, {
      notices: [], audience: { count: 100, fromBatch: true },
    }));

    expect(html).toContain("El cartel se generó para");
    expect(html).toContain(">100<");
    expect(html).not.toContain("A hoy");
  });

  it("sin el asiento del lote, avisa que el número es el del padrón de hoy", () => {
    const html = render(createElement(BoardNoticesPanel, {
      notices: [], audience: { count: 96, fromBatch: false },
    }));

    expect(html).toContain("A hoy");
    expect(html).toContain("puede ser menor que la nómina");
  });
});
