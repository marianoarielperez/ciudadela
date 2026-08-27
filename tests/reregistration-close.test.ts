import { describe, expect, it } from "vitest";
import type { MemberCategory, MemberStatus } from "@/generated/prisma/client";
import { civilDateUtc } from "@/lib/dates";
import {
  closeBlockers,
  debitBudgetBlock,
  planMigration,
  WITHDRAWAL_DEBIT_CALL_BUDGET,
  type ClosePrecondition,
} from "@/lib/reregistration/close";

const d = civilDateUtc;

type Row = Parameters<typeof planMigration>[0][number];

// Fábrica de filas: sólo `joinedAt` y `oldNumber` deciden, así que el resto
// tiene default y cada caso escribe únicamente lo que está probando.
function row(over: Partial<Row> & Pick<Row, "memberId" | "joinedAt" | "oldNumber">): Row {
  return {
    status: "active" satisfies MemberStatus,
    category: "active" satisfies MemberCategory,
    ...over,
  };
}

describe("planMigration — orden por antigüedad (REG-28)", () => {
  it("returns nothing for an empty book", () => {
    expect(planMigration([])).toEqual([]);
  });

  it("numbers by joinedAt ascending, oldest first", () => {
    const plan = planMigration([
      row({ memberId: 3, joinedAt: d(2010, 5, 20), oldNumber: 120 }),
      row({ memberId: 1, joinedAt: d(1985, 3, 15), oldNumber: 40 }),
      row({ memberId: 2, joinedAt: d(1999, 12, 1), oldNumber: 7 }),
    ]);
    expect(plan).toEqual([
      { memberId: 1, oldNumber: 40, newNumber: 1 },
      { memberId: 2, oldNumber: 7, newNumber: 2 },
      { memberId: 3, oldNumber: 120, newNumber: 3 },
    ]);
  });

  it("breaks a same-day tie by the OLD number, lowest first", () => {
    const plan = planMigration([
      row({ memberId: 10, joinedAt: d(2018, 7, 4), oldNumber: 205 }),
      row({ memberId: 11, joinedAt: d(2018, 7, 4), oldNumber: 33 }),
      row({ memberId: 12, joinedAt: d(2018, 7, 4), oldNumber: 91 }),
    ]);
    expect(plan.map((p) => p.oldNumber)).toEqual([33, 91, 205]);
    expect(plan.map((p) => p.newNumber)).toEqual([1, 2, 3]);
  });

  it("sends the socio 306 to the end when he joined last", () => {
    // El caso del brief: el número más alto del Libro 1 es también el ingreso
    // más nuevo, así que en el libro nuevo queda último — y el 1 se lo lleva el
    // socio más viejo, aunque su número anterior fuera alto.
    const plan = planMigration([
      row({ memberId: 306, joinedAt: d(2026, 8, 22), oldNumber: 306 }),
      row({ memberId: 14, joinedAt: d(1974, 11, 30), oldNumber: 288 }),
      row({ memberId: 99, joinedAt: d(2001, 2, 8), oldNumber: 12 }),
    ]);
    expect(plan).toEqual([
      { memberId: 14, oldNumber: 288, newNumber: 1 },
      { memberId: 99, oldNumber: 12, newNumber: 2 },
      { memberId: 306, oldNumber: 306, newNumber: 3 },
    ]);
  });

  it("ignores the time of day: same ARGENTINE civil day is a tie", () => {
    // Las tres son el MISMO día civil argentino (10/05/2026) escritas con horas
    // distintas — incluida una que en UTC ya cayó al 11. Comparar el instante
    // crudo las ordenaría por hora y pisaría el desempate por número viejo.
    const plan = planMigration([
      row({ memberId: 1, joinedAt: new Date("2026-05-11T02:00:00Z"), oldNumber: 300 }), // 23:00 AR del 10
      row({ memberId: 2, joinedAt: new Date("2026-05-10T03:00:00Z"), oldNumber: 200 }), // 00:00 AR del 10
      row({ memberId: 3, joinedAt: new Date("2026-05-10T20:00:00Z"), oldNumber: 100 }), // 17:00 AR del 10
    ]);
    expect(plan.map((p) => p.oldNumber)).toEqual([100, 200, 300]);
  });

  it("draws the tie window at ARGENTINE midnight, not at UTC midnight", () => {
    // El día civil no puede dar vuelta dos ingresos (UTC-3 fija: pasar al día
    // civil es monótono); lo único que hace es decidir QUIÉNES empatan, y la
    // ventana es de las 00:00 a las 23:59 de acá. Este caso ejerce los dos
    // bordes a la vez:
    //  - el 1 y el 2 comparten fecha UTC (10/05) y NO empatan, porque el 1 es
    //    el 09/05 a las 22:00 AR;
    //  - el 2 y el 3 tienen fechas UTC distintas y SÍ empatan, porque los dos
    //    son del 10/05 argentino — y entonces decide el número viejo, aunque el
    //    instante del 3 sea posterior.
    const plan = planMigration([
      row({ memberId: 3, joinedAt: new Date("2026-05-11T02:00:00Z"), oldNumber: 50 }), // 10/05 23:00 AR
      row({ memberId: 2, joinedAt: new Date("2026-05-10T20:00:00Z"), oldNumber: 90 }), // 10/05 17:00 AR
      row({ memberId: 1, joinedAt: new Date("2026-05-10T01:00:00Z"), oldNumber: 400 }), // 09/05 22:00 AR
    ]);
    expect(plan.map((p) => p.memberId)).toEqual([1, 3, 2]);
  });

  it("falls back to memberId when the day AND the old number are both equal", () => {
    // Inalcanzable con datos reales —el schema tiene `@@unique([bookId,
    // memberNumber])`—, pero sin este tercer criterio el comparador devolvería
    // 0 y el `sort` estable de JS dejaría el resultado atado al orden en que
    // vino la consulta. Se ejerce en los dos órdenes de entrada.
    const a = row({ memberId: 7, joinedAt: d(2015, 4, 4), oldNumber: 50 });
    const b = row({ memberId: 9, joinedAt: d(2015, 4, 4), oldNumber: 50 });
    expect(planMigration([a, b]).map((p) => p.memberId)).toEqual([7, 9]);
    expect(planMigration([b, a]).map((p) => p.memberId)).toEqual([7, 9]);
  });

  it("is dense: 1..N with no gaps, however holed the old numbering was", () => {
    // El Libro 1 tiene 28 huecos en la numeración 1-306; el libro nuevo no puede
    // heredar ninguno.
    const holed = [5, 40, 41, 77, 120, 121, 122, 200, 306];
    const plan = planMigration(
      holed.map((n, i) => row({ memberId: n, joinedAt: d(1990 + i, 1, 1), oldNumber: n })),
    );
    expect(plan.map((p) => p.newNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("never repeats a number", () => {
    const many = Array.from({ length: 160 }, (_, i) =>
      // Muchos empates a propósito: veinte días distintos para 160 socios.
      row({ memberId: i + 1, joinedAt: d(2000, 1, (i % 20) + 1), oldNumber: 500 - i }),
    );
    const plan = planMigration(many);
    expect(plan).toHaveLength(160);
    expect(new Set(plan.map((p) => p.newNumber)).size).toBe(160);
    expect(new Set(plan.map((p) => p.memberId)).size).toBe(160);
    expect(Math.min(...plan.map((p) => p.newNumber))).toBe(1);
    expect(Math.max(...plan.map((p) => p.newNumber))).toBe(160);
  });

  it("is stable: the same set in a different input order gives the same plan", () => {
    const members = [
      row({ memberId: 1, joinedAt: d(2005, 6, 6), oldNumber: 80 }),
      row({ memberId: 2, joinedAt: d(2005, 6, 6), oldNumber: 81 }),
      row({ memberId: 3, joinedAt: d(1998, 1, 1), oldNumber: 250 }),
      row({ memberId: 4, joinedAt: d(2020, 9, 9), oldNumber: 4 }),
    ];
    const forward = planMigration(members);
    const backward = planMigration([...members].reverse());
    expect(backward).toEqual(forward);
    // Y dos corridas sobre la misma entrada dan lo mismo, obviamente.
    expect(planMigration(members)).toEqual(forward);
  });

  it("does not mutate the array it was given", () => {
    const members = [
      row({ memberId: 1, joinedAt: d(2020, 1, 1), oldNumber: 1 }),
      row({ memberId: 2, joinedAt: d(1990, 1, 1), oldNumber: 2 }),
    ];
    const snapshot = members.map((m) => m.memberId);
    planMigration(members);
    expect(members.map((m) => m.memberId)).toEqual(snapshot);
  });

  it("migrates the suspended member like anyone else (decisión 12)", () => {
    // El suspendido es VIGENTE: entra al libro nuevo. Quien no entra lo filtra
    // el caller, no esta función.
    const plan = planMigration([
      row({ memberId: 1, joinedAt: d(2019, 3, 3), oldNumber: 60, status: "suspended" }),
      row({ memberId: 2, joinedAt: d(2021, 3, 3), oldNumber: 61, category: "collaborator" }),
    ]);
    expect(plan.map((p) => p.newNumber)).toEqual([1, 2]);
  });
});

describe("closeBlockers — qué frena el cierre y qué sólo se mira", () => {
  const unresolved: ClosePrecondition = { kind: "unresolved_presentations", count: 2 };
  const cohort: ClosePrecondition = { kind: "cohort_not_terminal", count: 5 };
  const arrears: ClosePrecondition = { kind: "arrears_candidates", count: 7 };
  const board: ClosePrecondition = { kind: "board_in_progress", count: 1 };

  it("returns nothing when there is nothing to report", () => {
    expect(closeBlockers([])).toEqual([]);
  });

  it("blocks on unresolved presentations and on a cohort without a terminal state", () => {
    expect(closeBlockers([unresolved, cohort])).toEqual([unresolved, cohort]);
  });

  it("does NOT block on arrears candidates: declaring a cesantía is the Comisión's call", () => {
    expect(closeBlockers([arrears])).toEqual([]);
  });

  it("does NOT block on board notices still running: they are context", () => {
    expect(closeBlockers([board])).toEqual([]);
  });

  it("picks only the blocking ones out of a full checklist, in the order given", () => {
    expect(closeBlockers([arrears, cohort, board, unresolved])).toEqual([cohort, unresolved]);
  });

  it("does not block on a blocking KIND whose count is zero", () => {
    // "Cero presentaciones sin resolver" es exactamente la condición cumplida.
    // Una pantalla que arme la lista con las cuatro filas siempre —con su
    // contador, incluso en cero— no puede nacer en rojo por eso.
    expect(
      closeBlockers([
        { kind: "unresolved_presentations", count: 0 },
        { kind: "cohort_not_terminal", count: 0 },
      ]),
    ).toEqual([]);
  });

  it("returns the very objects it was given, so the screen can render their counts", () => {
    const [only] = closeBlockers([arrears, unresolved]);
    expect(only).toBe(unresolved);
  });

  it("covers every kind of the union", () => {
    // Tabla exhaustiva DE VERDAD: es un `Record` indexado por la unión, así que
    // agregar un `kind` no compila hasta que alguien escriba acá de qué lado
    // cae (y un `kind` que ya no exista tampoco, por el chequeo de propiedades
    // sobrantes del literal). Un `Array<[kind, boolean]>` compilaba igual con la
    // fila nueva faltando, que es justo la garantía que le da sentido a
    // enumerar las que bloquean en vez de derivarlas por descarte.
    const blocksClose: Record<ClosePrecondition["kind"], boolean> = {
      unresolved_presentations: true,
      cohort_not_terminal: true,
      arrears_candidates: false,
      board_in_progress: false,
    };
    for (const kind of Object.keys(blocksClose) as Array<ClosePrecondition["kind"]>) {
      expect(closeBlockers([{ kind, count: 3 }]).length === 1).toBe(blocksClose[kind]);
    }
  });
});

describe("debitBudgetBlock — el lote se mide en LLAMADAS DE RED, no en nombres", () => {
  // Por qué esta regla reemplazó al tope de 25 convocados por tanda: en la etapa
  // de bajas los convocados son ADHERENTES, y la categoría no habilita el débito
  // automático. En el ensayo real del 26/08/2026 el operador declaró 90 bajas en
  // cuatro tandas y hubo CERO llamadas a Mercado Pago: el tope lo protegía de un
  // costo que ese lote no tenía. Lo que hay que contar es lo que tarda.
  it("deja pasar una tanda enorme sin ningún débito vivo", () => {
    expect(debitBudgetBlock({ members: 0, calls: 0 })).toBeNull();
  });

  it("deja pasar justo el presupuesto", () => {
    expect(
      debitBudgetBlock({
        members: WITHDRAWAL_DEBIT_CALL_BUDGET,
        calls: WITHDRAWAL_DEBIT_CALL_BUDGET,
      }),
    ).toBeNull();
  });

  it("corta una llamada más arriba y dice cuántos tienen débito", () => {
    const msg = debitBudgetBlock({
      members: WITHDRAWAL_DEBIT_CALL_BUDGET + 1,
      calls: WITHDRAWAL_DEBIT_CALL_BUDGET + 1,
    });
    expect(msg).toContain(String(WITHDRAWAL_DEBIT_CALL_BUDGET + 1));
    expect(msg).toContain(String(WITHDRAWAL_DEBIT_CALL_BUDGET));
    // Un mensaje que sólo dice "no" manda al operador a adivinar por dónde
    // partir. Tiene que decir qué medir para armar la tanda siguiente.
    expect(msg).toContain("débito");
    expect(msg).toContain("tanda");
  });

  it("cuando un socio tiene DOS débitos, el mensaje dice las dos cosas", () => {
    // `memberId` no es unique en `mp_subscriptions`: un vecino puede tener dos
    // preapprovals vivos, y son dos llamadas de red. Decir sólo "13 socios"
    // cuando el presupuesto se gastó con 26 cancelaciones haría que el operador
    // partiera la selección mal y volviera a chocar contra lo mismo.
    const msg = debitBudgetBlock({ members: 13, calls: 26 });
    expect(msg).toContain("13");
    expect(msg).toContain("26");
  });
});
