import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// La pantalla de cierre no se puede abrir en un navegador desde acá (no hay
// sesión), así que lo que se verifica es lo que decide si el operador la va a
// leer bien: qué FRENA el cierre y qué sólo advierte, y que una fila en cero se
// lea como condición cumplida y no como problema.
//
// El modo de falla que estos tests existen para impedir es que la mora aparezca
// como bloqueante. El Art. 40 manda depurar también con ese criterio, pero la
// cesantía por mora es OTRA causal con su propia acta (decisión 1 del operador):
// si esta pantalla la frenara, el operador terminaría declarando cesantías desde
// acá para poder cerrar, que es exactamente lo que el proyecto se comprometió a
// no automatizar.
//
// Nada de este archivo toca Prisma: `close-panels.tsx` recibe datos
// serializables y `close.ts` es puro.
import {
  BoardInProgress, CloseChecklist, CloseVerdict,
} from "@/app/admin/reempadronamiento/cierre/close-panels";
import { closeBlockers, type ClosePrecondition } from "@/lib/reregistration/close";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

function pre(over: Partial<Record<ClosePrecondition["kind"], number>> = {}): ClosePrecondition[] {
  const counts = {
    unresolved_presentations: 0,
    cohort_not_terminal: 0,
    arrears_candidates: 0,
    board_in_progress: 0,
    ...over,
  };
  return [
    { kind: "unresolved_presentations", count: counts.unresolved_presentations },
    { kind: "cohort_not_terminal", count: counts.cohort_not_terminal },
    { kind: "arrears_candidates", count: counts.arrears_candidates },
    { kind: "board_in_progress", count: counts.board_in_progress },
  ];
}

const verdict = (p: ClosePrecondition[]) =>
  render(createElement(CloseVerdict, { preconditions: p, blockers: closeBlockers(p) }));
const checklist = (p: ClosePrecondition[]) =>
  render(createElement(CloseChecklist, { preconditions: p, blockers: closeBlockers(p) }));

describe("CloseVerdict", () => {
  it("sin nada pendiente dice que se puede cerrar, y no nace en rojo", () => {
    const html = verdict(pre());
    expect(html).toContain("Todo listo para cerrar el libro");
    expect(html).not.toContain("Falta");
  });

  it("la mora sola NO frena: advierte y manda a Deudores", () => {
    const html = verdict(pre({ arrears_candidates: 7 }));
    expect(html).toContain("Se puede cerrar, pero mirá esto antes");
    expect(html).toContain("Para revisar");
    expect(html).toContain("/admin/tesoreria/deudores");
    expect(html).not.toContain("Falta");
  });

  it("las dos bloqueantes frenan y cada una lleva a dónde se resuelve", () => {
    const html = verdict(pre({ unresolved_presentations: 2, cohort_not_terminal: 5 }));
    expect(html).toContain("Faltan 2 cosas para poder cerrar el libro");
    expect(html).toContain("/admin/reempadronamiento/presentaciones");
    expect(html).toContain("#bajas");
  });

  it("una sola bloqueante se dice en singular", () => {
    expect(verdict(pre({ cohort_not_terminal: 3 }))).toContain("Falta una cosa para poder cerrar el libro");
  });
});

describe("CloseChecklist", () => {
  it("dibuja las CUATRO filas aunque estén todas en cero, en positivo", () => {
    const html = checklist(pre());
    expect(html.match(/Cumplido/g)).toHaveLength(4);
    expect(html).toContain("No queda ninguna presentación esperando decisión.");
    expect(html).toContain("Todos los convocados tienen desenlace.");
    expect(html).toContain("No hay ningún socio en condición de cesantía por mora.");
    expect(html).toContain("No hay ningún aviso de cartelera en curso.");
    expect(html).not.toContain("Bloquea");
    expect(html).not.toContain("Advierte");
  });

  it("marca Bloquea / Advierte según lo que decidió `closeBlockers`", () => {
    const html = checklist(pre({ unresolved_presentations: 1, arrears_candidates: 7 }));
    expect(html.match(/Bloquea/g)).toHaveLength(1);
    expect(html.match(/Advierte/g)).toHaveLength(1);
    // Las otras dos siguen cumplidas.
    expect(html.match(/Cumplido/g)).toHaveLength(2);
  });

  it("concuerda en número: uno no se lee en plural", () => {
    // Lo cazó el navegador: "1 presentaciones esperando decisión" en la pantalla
    // que declara bajas de socios. Se prueban las cuatro filas porque las cuatro
    // pueden valer 1.
    const html = checklist(
      pre({ unresolved_presentations: 1, cohort_not_terminal: 1, arrears_candidates: 1, board_in_progress: 1 }),
    );
    expect(html).toContain("presentación esperando decisión de la Comisión");
    expect(html).toContain("convocado sin desenlace: sigue siendo adherente vigente");
    expect(html).toContain("socio activo o colaborador en condición de cesantía por mora");
    expect(html).toContain("aviso de cartelera todavía en curso");
    expect(html).not.toContain("presentaciones esperando");
    expect(html).not.toContain("avisos de cartelera");
  });
});

describe("BoardInProgress", () => {
  it("distingue el cartel sin fijar del que ya tiene su plazo corriendo", () => {
    const html = render(
      createElement(BoardInProgress, {
        notices: [
          { id: 1, kind: "withdrawal", postedAt: null, dueAt: null },
          {
            id: 2,
            kind: "second_instance",
            postedAt: new Date("2026-10-02T12:00:00Z"),
            dueAt: new Date("2026-11-02T12:00:00Z"),
          },
        ],
      }),
    );
    expect(html).toContain("todavía sin fijar");
    // La fecha que importa es la FEHACIENTE, no la de fijación: por cartelera la
    // notificación se practica al cumplirse los veinte días hábiles.
    expect(html).toContain("02/11/2026");
    expect(html).toContain("02/10/2026");
  });
});
