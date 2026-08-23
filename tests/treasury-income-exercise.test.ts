// El ejercicio anual de Otros ingresos: bordes del año en hora argentina,
// bucketing por mes y resolución del `?anio=`/`?mes=` de la barra.
//
// Todo puro: ni Prisma ni base. El módulo inyecta el cliente, pero el singleton
// del final de `other-income.ts` se evalúa al importarlo.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { ExerciseStrip, monthCellLabel } from "@/app/admin/tesoreria/otros-ingresos/exercise-strip";
import {
  exerciseYears,
  incomeListHref,
  resolveIncomeMonth,
  resolveIncomeYear,
} from "@/lib/treasury/income-nav";
import {
  exerciseBounds,
  incomeWhere,
  incomeYearsOf,
  makeOtherIncome,
  summarizeExercise,
  type ExerciseRow,
} from "@/lib/treasury/other-income";
import { periodOf } from "@/lib/treasury/periods";

const cash = (iso: string, amount: number, voided = false): ExerciseRow => ({
  receivedAt: new Date(iso),
  amount,
  method: "cash",
  voided,
});

describe("exerciseBounds", () => {
  it("el ejercicio va del 1/1 al 31/12 ARGENTINOS, no UTC", () => {
    // Argentina es UTC-3 sin DST: el 1/1 a las 00:00 de acá son las 03:00 UTC.
    expect(exerciseBounds(2026)).toEqual({
      gte: new Date("2026-01-01T03:00:00.000Z"),
      lt: new Date("2027-01-01T03:00:00.000Z"),
    });
  });

  it("los bordes coinciden EXACTAMENTE con lo que dice periodOf", () => {
    // Es la garantía de que el WHERE (bordes) y la cinta (bucketing con
    // `periodOf`) no puedan discrepar en el instante del cambio de año.
    const { gte, lt } = exerciseBounds(2026);
    expect(periodOf(gte)).toBe("2026-01");
    expect(periodOf(new Date(lt.getTime() - 1))).toBe("2026-12");
    expect(periodOf(lt)).toBe("2027-01");
  });

  it("un mes acota al mes civil argentino, y diciembre cruza al año siguiente", () => {
    expect(exerciseBounds(2026, 3)).toEqual({
      gte: new Date("2026-03-01T03:00:00.000Z"),
      lt: new Date("2026-04-01T03:00:00.000Z"),
    });
    expect(exerciseBounds(2026, 12)).toEqual({
      gte: new Date("2026-12-01T03:00:00.000Z"),
      lt: new Date("2027-01-01T03:00:00.000Z"),
    });
  });
});

describe("incomeWhere con ejercicio", () => {
  it("el año arma el rango del ejercicio", () => {
    expect(incomeWhere({ year: 2025 })).toEqual({
      receivedAt: {
        gte: new Date("2025-01-01T03:00:00.000Z"),
        lt: new Date("2026-01-01T03:00:00.000Z"),
      },
    });
  });

  it("el mes acota dentro del año, y el medio se acumula", () => {
    expect(incomeWhere({ year: 2026, month: 8, method: "mp" })).toEqual({
      receivedAt: {
        gte: new Date("2026-08-01T03:00:00.000Z"),
        lt: new Date("2026-09-01T03:00:00.000Z"),
      },
      method: "mp",
    });
  });

  it("un mes sin año no acota nada: el mes solo no es una unidad", () => {
    expect(incomeWhere({ month: 8 })).toEqual({});
  });

  it("el id manda sobre el ejercicio: el enlace de la bandeja tiene que abrir SU ingreso", () => {
    expect(incomeWhere({ id: 42, year: 2026 })).toEqual({ id: 42 });
  });
});

describe("summarizeExercise", () => {
  it("bucketea por mes en hora ARGENTINA: el 31/12 a las 22:00 es diciembre", () => {
    // 31/12/2026 22:00 AR = 1/1/2027 01:00 UTC. Con el reloj UTC ese alquiler
    // caía en el ejercicio siguiente.
    const s = summarizeExercise([cash("2027-01-01T01:00:00.000Z", 45000)], 2026);
    expect(s.months[11]).toEqual({ month: 12, amount: 45000, count: 1 });
    expect(s.total).toBe(45000);
  });

  it("y el 1/1 a las 01:00 es enero del ejercicio siguiente", () => {
    // 1/1/2027 01:00 AR = 1/1/2027 04:00 UTC.
    const row = cash("2027-01-01T04:00:00.000Z", 30000);
    expect(summarizeExercise([row], 2026).total).toBe(0);
    expect(summarizeExercise([row], 2027).months[0]).toEqual({ month: 1, amount: 30000, count: 1 });
  });

  it("siempre devuelve doce meses, aunque el ejercicio esté vacío", () => {
    const s = summarizeExercise([], 2026);
    expect(s.months).toHaveLength(12);
    expect(s.months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(s.months.every((m) => m.amount === 0 && m.count === 0)).toBe(true);
    expect(s).toMatchObject({
      total: 0,
      counted: 0,
      voided: 0,
      max: 0,
      byMethod: { cash: 0, mp: 0 },
    });
  });

  it("los anulados NO suman en el total ni en su celda, y se cuentan aparte", () => {
    const s = summarizeExercise(
      [
        cash("2026-03-10T15:00:00.000Z", 45000),
        cash("2026-03-11T15:00:00.000Z", 10000, true),
        cash("2026-07-01T15:00:00.000Z", 5000),
      ],
      2026,
    );
    expect(s.total).toBe(50000);
    expect(s.counted).toBe(2);
    expect(s.voided).toBe(1);
    expect(s.months[2]).toEqual({ month: 3, amount: 45000, count: 1 });
    expect(s.months[6]).toEqual({ month: 7, amount: 5000, count: 1 });
  });

  it("el total es exactamente la suma de las doce celdas", () => {
    const s = summarizeExercise(
      [
        cash("2026-02-01T15:00:00.000Z", 0.1),
        {
          receivedAt: new Date("2026-05-01T15:00:00.000Z"),
          amount: 0.2,
          method: "mp",
          voided: false,
        },
      ],
      2026,
    );
    // Sin redondeo a centavos, 0.1 + 0.2 son 0.30000000000000004 pesos.
    expect(s.total).toBe(0.3);
    expect(s.months.reduce((a, m) => a + m.amount, 0)).toBeCloseTo(s.total, 10);
    expect(s.byMethod).toEqual({ cash: 0.1, mp: 0.2 });
  });

  it("`max` es el mes más alto: es la escala de la cinta", () => {
    const s = summarizeExercise(
      [cash("2026-03-10T15:00:00.000Z", 45000), cash("2026-09-10T15:00:00.000Z", 120000)],
      2026,
    );
    expect(s.max).toBe(120000);
  });

  it("una fila de otro ejercicio no se cuela en ninguna celda", () => {
    const s = summarizeExercise([cash("2025-06-10T15:00:00.000Z", 99999)], 2026);
    expect(s.total).toBe(0);
    expect(s.months.every((m) => m.count === 0)).toBe(true);
  });
});

describe("incomeYearsOf", () => {
  it("devuelve los años ARGENTINOS con ingresos, sin repetir y descendentes", () => {
    expect(
      incomeYearsOf([
        new Date("2025-06-10T15:00:00.000Z"),
        new Date("2026-02-01T15:00:00.000Z"),
        new Date("2025-08-01T15:00:00.000Z"),
        // 31/12/2023 22:00 AR: es 2023, aunque el reloj UTC diga 2024.
        new Date("2024-01-01T01:00:00.000Z"),
      ]),
    ).toEqual([2026, 2025, 2023]);
  });

  it("sin ingresos no hay años", () => {
    expect(incomeYearsOf([])).toEqual([]);
  });
});

describe("exerciseYears", () => {
  it("el año en curso está SIEMPRE, aunque no tenga ingresos: es en el que se carga", () => {
    expect(exerciseYears([2025, 2024], 2026)).toEqual([2026, 2025, 2024]);
  });

  it("no lo duplica cuando ya tiene ingresos", () => {
    expect(exerciseYears([2026, 2025], 2026)).toEqual([2026, 2025]);
  });

  it("un ingreso de un año futuro se lista igual, arriba de todo", () => {
    // No debería existir (la carga topea en hoy), pero si existe el operador
    // tiene que poder llegar a él para anularlo.
    expect(exerciseYears([2027, 2025], 2026)).toEqual([2027, 2026, 2025]);
  });
});

describe("resolveIncomeYear", () => {
  const years = [2026, 2025, 2024];

  it("un año con ingresos se respeta", () => {
    expect(resolveIncomeYear("2025", years, 2026)).toBe(2025);
  });

  it("basura, decimales, espacios y notación rara caen en el año en curso", () => {
    for (const bad of ["abc", "2025.0", " 2025", "0x7e9", "2025e0", "", "-2025"]) {
      expect(resolveIncomeYear(bad, years, 2026)).toBe(2026);
    }
  });

  it("repetido (?anio=2025&anio=2024 llega como array) cae en el año en curso", () => {
    expect(resolveIncomeYear(["2025", "2024"], years, 2026)).toBe(2026);
  });

  it("un año sin ingresos cae en el año en curso", () => {
    expect(resolveIncomeYear("1999", years, 2026)).toBe(2026);
  });

  it("ausente es el año en curso", () => {
    expect(resolveIncomeYear(undefined, years, 2026)).toBe(2026);
  });
});

describe("resolveIncomeMonth", () => {
  it("acepta 1 a 12 y nada más", () => {
    expect(resolveIncomeMonth("1")).toBe(1);
    expect(resolveIncomeMonth("12")).toBe(12);
    for (const bad of ["0", "13", "-1", "3.5", "marzo", "", " 3", undefined, ["3", "4"]]) {
      expect(resolveIncomeMonth(bad as never)).toBeNull();
    }
  });
});

describe("incomeListHref", () => {
  it("el año en curso vive en la URL limpia: una sola dirección por contenido", () => {
    expect(incomeListHref({ year: 2026 }, 2026)).toBe("/admin/tesoreria/otros-ingresos");
    expect(incomeListHref({ year: 2025 }, 2026)).toBe("/admin/tesoreria/otros-ingresos?anio=2025");
  });

  it("acumula mes y medio en ese orden", () => {
    expect(incomeListHref({ year: 2025, month: 3, method: "mp" }, 2026)).toBe(
      "/admin/tesoreria/otros-ingresos?anio=2025&mes=3&medio=mp",
    );
    expect(incomeListHref({ year: 2026, month: 3 }, 2026)).toBe(
      "/admin/tesoreria/otros-ingresos?mes=3",
    );
  });
});

describe("monthCellLabel", () => {
  it("dice mes, importe y cuántos ingresos: el color y la altura de la barra no le llegan al lector", () => {
    expect(monthCellLabel({ month: 3, amount: 45000, count: 2 })).toBe(
      "marzo: $ 45.000,00 en 2 ingresos",
    );
    expect(monthCellLabel({ month: 7, amount: 5000, count: 1 })).toBe(
      "julio: $ 5.000,00 en 1 ingreso",
    );
  });

  it("un mes vacío se dice vacío, no cero", () => {
    expect(monthCellLabel({ month: 11, amount: 0, count: 0 })).toBe("noviembre: sin ingresos");
  });

  it("el mes en curso y el filtrado se anuncian, no sólo se pintan", () => {
    expect(monthCellLabel({ month: 8, amount: 1000, count: 1 }, { current: true })).toBe(
      "agosto: $ 1.000,00 en 1 ingreso, mes en curso",
    );
    expect(
      monthCellLabel({ month: 8, amount: 1000, count: 1 }, { current: true, selected: true }),
    ).toBe("agosto: $ 1.000,00 en 1 ingreso, mes en curso, mes filtrado");
  });
});

describe("makeOtherIncome().exercise / .years / .yearOf", () => {
  it("`exercise` agrega sobre TODO el ejercicio, nunca sobre la página", async () => {
    const findMany = vi.fn(async () => [
      {
        receivedAt: new Date("2026-03-10T15:00:00.000Z"),
        amount: "45000.00",
        method: "cash",
        voidedAt: null,
      },
      {
        receivedAt: new Date("2026-03-11T15:00:00.000Z"),
        amount: "10000.00",
        method: "cash",
        voidedAt: new Date(),
      },
      {
        receivedAt: new Date("2026-08-02T18:00:00.000Z"),
        amount: "12000.50",
        method: "mp",
        voidedAt: null,
      },
    ]);
    const db = { otherIncome: { findMany } } as never;
    const s = await makeOtherIncome(db).exercise(2026);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        receivedAt: {
          gte: new Date("2026-01-01T03:00:00.000Z"),
          lt: new Date("2027-01-01T03:00:00.000Z"),
        },
      },
      select: { receivedAt: true, amount: true, method: true, voidedAt: true },
    });
    // Sin `skip` ni `take`: la cinta no puede depender de en qué página está el
    // operador.
    expect(s.total).toBe(57000.5);
    expect(s.voided).toBe(1);
    expect(s.months[2].amount).toBe(45000);
    expect(s.months[7].amount).toBe(12000.5);
  });

  it("`years` incluye los años de los ingresos ANULADOS: se listan, hay que llegar a ellos", async () => {
    const findMany = vi.fn(async () => [
      { receivedAt: new Date("2024-05-01T15:00:00.000Z") },
      { receivedAt: new Date("2026-05-01T15:00:00.000Z") },
    ]);
    const db = { otherIncome: { findMany } } as never;
    expect(await makeOtherIncome(db).years()).toEqual([2026, 2024]);
    expect(findMany).toHaveBeenCalledWith({ select: { receivedAt: true } });
  });

  it("`yearOf` da el ejercicio de un ingreso, en hora argentina", async () => {
    const db = {
      otherIncome: {
        findUnique: vi.fn(async () => ({ receivedAt: new Date("2027-01-01T01:00:00.000Z") })),
      },
    } as never;
    expect(await makeOtherIncome(db).yearOf(7)).toBe(2026);
  });

  it("`yearOf` de un id que no existe es null", async () => {
    const db = { otherIncome: { findUnique: vi.fn(async () => null) } } as never;
    expect(await makeOtherIncome(db).yearOf(404)).toBeNull();
  });
});

describe("<ExerciseStrip />", () => {
  // Se renderiza a markup y se mira la ESTRUCTURA. La cinta es una tabla porque
  // se imprime y se lee con lector de pantalla: doce encabezados contra doce
  // celdas es lo que sostiene esas dos lecturas, y es exactamente lo que se
  // rompió una vez en `period-strip` (un `sr-only` sobre el <th> corría la fila
  // entera).
  const summary = summarizeExercise(
    [
      cash("2026-03-10T15:00:00.000Z", 45000),
      cash("2026-06-08T18:00:00.000Z", 150000),
      // Anulado en abril: su mes tiene que quedar vacío, no en cero.
      cash("2026-04-11T15:00:00.000Z", 18000, true),
    ],
    2026,
  );
  const html = renderToStaticMarkup(
    createElement(ExerciseStrip, {
      summary,
      currentMonth: 8,
      selectedMonth: 6,
      monthHref: (m: number) => `/admin/tesoreria/otros-ingresos?mes=${m}`,
      yearHref: "/admin/tesoreria/otros-ingresos",
    }),
  );

  it("son doce encabezados contra doce celdas, ni uno más", () => {
    expect(html.match(/<th /g)).toHaveLength(12);
    expect(html.match(/<td /g)).toHaveLength(12);
  });

  it("sólo los meses CON movimiento son link: un mes vacío no lleva a ninguna parte", () => {
    expect(html.match(/<a /g)).toHaveLength(2); // marzo y junio
    expect(html).toContain("/admin/tesoreria/otros-ingresos?mes=3");
    expect(html).not.toContain("?mes=4"); // el de abril está anulado
  });

  it("el mes filtrado se marca con aria-current y vuelve al ejercicio entero", () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).not.toContain("?mes=6"); // junio ya está filtrado: su celda desfiltra
  });

  it("el mes vacío dice que está vacío, no cero: el color no es el único canal", () => {
    expect(html).toContain("abril: sin ingresos");
    expect(html).toContain("agosto: sin ingresos, mes en curso");
    expect(html).toContain("junio: $ 150.000,00 en 1 ingreso, mes filtrado");
  });
});
