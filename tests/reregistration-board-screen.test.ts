import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Desde la Task 13 el panel de cartelera renderiza la tarjeta del aviso, y la
// tarjeta importa su server action, que arrastra `@/lib/audit` → `@/lib/prisma`
// — que TIRA al evaluarse si falta `DATABASE_URL`. Es la trampa que el proyecto
// ya tiene documentada; acá se resuelve como en `reregistration-service.test.ts`:
// el singleton se reemplaza por un objeto vacío. Ningún componente de este
// archivo consulta la base, así que el doble no tiene que hacer nada.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  boardAudience, BoardNoticesPanel, bouncedAfterSend, chipVariant, classifyNotice, CounterChips,
  nextStep, ProcessVerdict, UnnotifiedPanel, type BoardNoticeRow, type ProcessCountersView,
  type UnnotifiedRow,
} from "@/app/admin/reempadronamiento/board-panels";
import { AddToBoardChip } from "@/app/admin/reempadronamiento/avisos/board-notice-card";
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

describe("chipVariant — la regla del cero", () => {
  it("un contador en CERO nunca se pinta", () => {
    // "Rechazada 0" en rojo es una alarma que dice que no pasó nada, y una
    // alarma así enseña a ignorar el tablero (4C §veredicto). El color queda
    // para lo que efectivamente hay.
    expect(chipVariant("rejected", 0)).toBe("outline");
    expect(chipVariant("submitted", 0)).toBe("outline");
    expect(chipVariant("validated", 0)).toBe("outline");
  });

  it("con algo adentro, cada estado recupera su color", () => {
    expect(chipVariant("rejected", 2)).toBe("destructive");
    expect(chipVariant("submitted", 5)).toBe("default");
    expect(chipVariant("validated", 5)).toBe("success");
  });

  it("la pantalla en blanco no tiene ni una pastilla de alarma", () => {
    const zeros = {
      pending: 0, submitted: 0, observed: 0, validated: 0, rejected: 0, withdrawn: 0,
    } satisfies Record<PresentationStatus, number>;
    const html = render(createElement(CounterChips, { byStatus: zeros }));

    expect(html).not.toContain("text-destructive");
    expect(html).not.toContain("text-success");
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

/** Lo que la tarjeta necesita y este bloque no está probando: el reloj del
 *  servidor, el día por defecto del campo y las dos banderas de display. Se
 *  esparce para que agregar una prop nueva no obligue a tocar cada caso. */
const boardChrome = {
  today: new Date("2026-10-05T12:00:00Z"),
  todayIso: "2026-10-05",
  canPost: true,
  coverageWarning: null,
};

describe("bouncedAfterSend", () => {
  const sent = [{ status: "sent" as const }];

  it("es el que TENÍA casilla, se le mandó, y rebotó después", () => {
    expect(bouncedAfterSend({ email: "a@b.com", emailStatus: "bounced", notices: sent })).toBe(true);
  });

  it("el que nunca tuvo casilla NO es un rebote posterior: ya está en el cartel", () => {
    // Éste entró en el lote de cartelera cuando se convocó. Ofrecerle "pasar a
    // cartelera" sería mandarlo dos veces a la misma pared.
    expect(bouncedAfterSend({ email: null, emailStatus: "none", notices: [] })).toBe(false);
  });

  it("sin rastro de envío no hay rebote posterior que valga", () => {
    // Rebotó ANTES de que saliera el lote: nunca se le intentó un correo en
    // esta instancia, así que le tocó el cartel como a los demás sin casilla.
    expect(bouncedAfterSend({ email: "a@b.com", emailStatus: "bounced", notices: [] })).toBe(false);
    expect(
      bouncedAfterSend({ email: "a@b.com", emailStatus: "bounced", notices: [{ status: "failed" }] }),
    ).toBe(false);
  });

  it("la casilla que sigue sirviendo no es un caso de cartelera", () => {
    expect(bouncedAfterSend({ email: "a@b.com", emailStatus: "verified", notices: sent })).toBe(false);
  });
});

describe("BoardNoticesPanel", () => {
  it("presenta el número del lote como lo que es", () => {
    const html = render(createElement(BoardNoticesPanel, {
      notices: [], audience: { count: 100, fromBatch: true },
      ...boardChrome,
    }));

    expect(html).toContain("El cartel se generó para");
    expect(html).toContain(">100<");
    expect(html).not.toContain("A hoy");
  });

  it("sin el asiento del lote, avisa que el número es el del padrón de hoy", () => {
    const html = render(createElement(BoardNoticesPanel, {
      notices: [], audience: { count: 96, fromBatch: false },
      ...boardChrome,
    }));

    expect(html).toContain("A hoy");
    expect(html).toContain("puede ser menor que la nómina");
  });

  // ── La tarjeta del aviso (Task 13) ─────────────────────────────────────────
  // Una tarjeta por CARTEL, nunca una fila por socio. Lo que se fija acá es que
  // los dos estados del aviso se lean distinto y que el PDF esté en los dos: un
  // cartel que no se puede reimprimir es un cartel que no se puede reemplazar
  // cuando se moja.

  const notice = (over: Partial<BoardNoticeRow> = {}): BoardNoticeRow => ({
    id: 33, kind: "first_instance", postedAt: null, dueAt: null, recipients: 100, ...over,
  });

  it("sin fijar ofrece imprimir y asentar la fijación", () => {
    const html = render(createElement(BoardNoticesPanel, {
      notices: [notice()], audience: { count: 100, fromBatch: true }, ...boardChrome,
    }));

    expect(html).toContain("/api/admin/reempadronamiento/avisos/33/pdf");
    expect(html).toContain("Asentar fijación");
    expect(html).toContain("Sin fijar");
    // El default y el tope del campo salen del día civil ARGENTINO del
    // servidor, no del reloj del navegador del operador.
    expect(html).toContain('value="2026-10-05"');
    expect(html).toContain('max="2026-10-05"');
  });

  it("fijado muestra el plazo y NO vuelve a ofrecer asentarlo", () => {
    const html = render(createElement(BoardNoticesPanel, {
      notices: [notice({ postedAt: new Date("2026-10-02T12:00:00Z"), dueAt: new Date("2026-11-02T12:00:00Z") })],
      audience: { count: 100, fromBatch: true },
      ...boardChrome,
    }));

    expect(html).toContain("02/10/2026");
    expect(html).toContain("02/11/2026");
    // La fecha se asienta UNA vez: ofrecer el formulario otra vez sería ofrecer
    // correr el plazo de cien vecinos.
    expect(html).not.toContain("Asentar fijación");
    // Todavía no se cumplió: el 05/10 el plazo sigue corriendo.
    expect(html).toContain("En cartelera");
    expect(html).not.toContain("Cumplido");
  });

  it("cumplido el plazo, el derivado se prende sin ningún cron", () => {
    const html = render(createElement(BoardNoticesPanel, {
      notices: [notice({ postedAt: new Date("2026-10-02T12:00:00Z"), dueAt: new Date("2026-11-02T12:00:00Z") })],
      audience: { count: 100, fromBatch: true },
      ...boardChrome,
      // El día EN QUE se cumple ya cuenta como cumplido: el vigésimo día hábil
      // se contó entero.
      today: new Date("2026-11-02T12:00:00Z"),
    }));

    expect(html).toContain("Cumplido");
    expect(html).toContain("quedó fehaciente el");
  });

  it("sin permiso, el botón se dibuja apagado y dice por qué", () => {
    const html = render(createElement(BoardNoticesPanel, {
      notices: [notice()], audience: { count: 100, fromBatch: true },
      ...boardChrome, canPost: false,
    }));

    expect(html).toContain("Solo el superadmin puede asentar la fijación");
    // Pero imprimir sigue estando: es trabajo de mostrador.
    expect(html).toContain("/api/admin/reempadronamiento/avisos/33/pdf");
  });

  it("el faltante de feriados se avisa ANTES de imprimir cien nombres", () => {
    const html = render(createElement(BoardNoticesPanel, {
      notices: [notice()], audience: { count: 100, fromBatch: true },
      ...boardChrome, coverageWarning: "No hay feriados cargados para 2028.",
    }));

    expect(html).toContain("No hay feriados cargados para 2028.");
  });
});

describe("AddToBoardChip", () => {
  // El chip es el único control del módulo que opera sobre UN socio. Su modo de
  // falla no es escribir de más —sumar a un cartel sin fijar no mueve ningún
  // plazo— sino no decir nada: como la acción no escribe ninguna fila del lado
  // del socio (la nómina del aviso se calcula en vivo, que está bien), sin una
  // señal explícita el botón sigue ofreciendo exactamente lo mismo después de
  // usarlo y cada clic repetido sólo agrega un asiento de auditoría.
  const chip = { processId: 4, memberId: 12, memberName: "Pérez, Ana" };

  it("ofrece sumarlo mientras no haya cartel complementario abierto", () => {
    const html = render(createElement(AddToBoardChip, { ...chip, alreadyOnBoard: false }));

    expect(html).toContain("Pasar a cartelera");
    // El nombre va en el nombre accesible: una lista de cien filas no puede
    // dictarle al lector de pantalla cien botones idénticos.
    expect(html).toContain("Pasar a cartelera a Pérez, Ana");
  });

  it("con el cartel ya abierto no vuelve a ofrecer lo mismo: dice que ya está", () => {
    const html = render(createElement(AddToBoardChip, { ...chip, alreadyOnBoard: true }));

    expect(html).toContain("Ya está en el cartel complementario");
    // Y el control desaparece: no queda un botón que repita el asiento.
    expect(html).not.toContain("<button");
  });
});
