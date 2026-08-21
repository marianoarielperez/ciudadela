import { describe, expect, it, vi } from "vitest";
import {
  arMonthRangeUtc, buildSummaryExportRow, formatMonthParam, makeSummaryQueries, monthLabelAR,
  parseMonthParam, summaryExportColumns,
} from "@/lib/applications/summary";

// El mes que la pantalla resuelve es el mes CIVIL argentino, no el UTC. A las
// 22:30 del 31/08 en Comodoro ya son las 01:30 UTC del 1/9: si el default
// mirara los campos UTC, el operador que abre el resumen esa noche vería
// "septiembre" y un acta vacía.
describe("parseMonthParam", () => {
  it("sin parámetro cae al mes corriente en hora argentina", () => {
    expect(parseMonthParam(undefined, new Date("2026-08-21T15:00:00Z")))
      .toEqual({ year: 2026, month: 8 });
  });

  it("la medianoche argentina de fin de mes todavía es el mes que termina", () => {
    // 2026-09-01T01:30Z = 31/08/2026 22:30 en Argentina (UTC-3, sin DST).
    expect(parseMonthParam(undefined, new Date("2026-09-01T01:30:00Z")))
      .toEqual({ year: 2026, month: 8 });
    // Y 03:00Z en punto ya es el 1° a las 00:00 AR: ahí sí cambia el mes.
    expect(parseMonthParam(undefined, new Date("2026-09-01T03:00:00Z")))
      .toEqual({ year: 2026, month: 9 });
  });

  it("parsea el formato YYYY-MM del <input type=month>", () => {
    expect(parseMonthParam("2026-08", new Date("2027-01-10T15:00:00Z")))
      .toEqual({ year: 2026, month: 8 });
    expect(parseMonthParam("2025-12", new Date("2027-01-10T15:00:00Z")))
      .toEqual({ year: 2025, month: 12 });
    expect(parseMonthParam("2026-01", new Date("2027-01-10T15:00:00Z")))
      .toEqual({ year: 2026, month: 1 });
  });

  it("la basura cae al mes corriente en vez de romper la pantalla", () => {
    const now = new Date("2026-08-21T15:00:00Z");
    for (const junk of [
      "", "  ", "2026", "2026-13", "2026-00", "agosto", "2026-8", "26-08",
      "2026-08-01", "0000-01", "9999-99", "-1", "2026-1a",
    ]) {
      expect(parseMonthParam(junk, now)).toEqual({ year: 2026, month: 8 });
    }
  });

  // Next entrega `string[]` cuando el parámetro viene repetido (`?mes=a&mes=b`).
  it("toma el primer valor cuando el parámetro viene repetido", () => {
    expect(parseMonthParam(["2026-05", "2020-01"], new Date("2026-08-21T15:00:00Z")))
      .toEqual({ year: 2026, month: 5 });
  });

  it("acota a un rango plausible de años", () => {
    const now = new Date("2026-08-21T15:00:00Z");
    expect(parseMonthParam("1899-05", now)).toEqual({ year: 2026, month: 8 });
    expect(parseMonthParam("2200-05", now)).toEqual({ year: 2026, month: 8 });
  });
});

describe("formatMonthParam", () => {
  it("rearma el YYYY-MM con el mes en dos dígitos", () => {
    expect(formatMonthParam({ year: 2026, month: 8 })).toBe("2026-08");
    expect(formatMonthParam({ year: 2026, month: 12 })).toBe("2026-12");
    expect(formatMonthParam({ year: 2026, month: 1 })).toBe("2026-01");
  });

  it("es la inversa de parseMonthParam", () => {
    const now = new Date("2026-08-21T15:00:00Z");
    for (const v of ["2026-01", "2026-08", "2025-12"]) {
      expect(formatMonthParam(parseMonthParam(v, now))).toBe(v);
    }
  });
});

// El rango son instantes UTC, pero los bordes son los del mes CIVIL argentino:
// 00:00 del 1° en Comodoro son las 03:00 UTC. Con bordes en 00:00 UTC, una
// solicitud asentada el 31/08 a las 22:00 (01:00Z del 1/9) caería en el acta de
// septiembre — o sea, en la reunión equivocada.
describe("arMonthRangeUtc", () => {
  it("va del 1° 00:00 AR al 1° del mes siguiente 00:00 AR", () => {
    const { from, to } = arMonthRangeUtc(2026, 8);
    expect(from.toISOString()).toBe("2026-08-01T03:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });

  it("cruza el año en diciembre", () => {
    const { from, to } = arMonthRangeUtc(2026, 12);
    expect(from.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });

  it("respeta los febreros bisiestos sin contarlos a mano", () => {
    expect(arMonthRangeUtc(2028, 2).to.toISOString()).toBe("2028-03-01T03:00:00.000Z");
  });

  it("el borde superior es exclusivo y no deja huecos entre meses", () => {
    expect(arMonthRangeUtc(2026, 8).to.getTime()).toBe(arMonthRangeUtc(2026, 9).from.getTime());
  });
});

describe("monthLabelAR", () => {
  it("nombra el mes en castellano", () => {
    expect(monthLabelAR({ year: 2026, month: 8 }).toLowerCase()).toContain("agosto");
    expect(monthLabelAR({ year: 2026, month: 8 })).toContain("2026");
    // El borde del rango es 03:00Z del 1°: en AR sigue siendo el 1°, no el 31
    // del mes anterior.
    expect(monthLabelAR({ year: 2026, month: 1 }).toLowerCase()).toContain("enero");
    expect(monthLabelAR({ year: 2026, month: 1 })).toContain("2026");
  });
});

// ── Las tres consultas ───────────────────────────────────────────────────────
type Args = Record<string, unknown>;

function liveRow(over: Record<string, unknown> = {}) {
  return {
    id: 1, fullName: "Pérez, Ana", dni: "30111222", requestedCategory: "active",
    wantsDebit: true, memberId: null, minuteId: null,
    createdAt: new Date("2026-08-03T14:00:00Z"), decidedAt: null,
    ...over,
  };
}

function db(over: {
  accepted?: unknown[]; pendingBoard?: unknown[]; recorded?: unknown[]; movements?: unknown[];
} = {}) {
  // Las tres consultas de solicitudes van por el mismo `findMany`: se despachan
  // por el `status` del where, que es lo que las distingue.
  const findMany = vi.fn<(args: Args) => Promise<unknown[]>>(async (args) => {
    const status = (args.where as { status?: string }).status;
    if (status === "approved_pending_minute") return over.accepted ?? [];
    if (status === "pending_board") return over.pendingBoard ?? [];
    return over.recorded ?? [];
  });
  const movementFindMany = vi.fn<(args: Args) => Promise<unknown[]>>(async () => over.movements ?? []);
  return {
    client: {
      application: { findMany },
      movement: { findMany: movementFindMany },
    } as never,
    findMany,
    movementFindMany,
  };
}

const RANGE = arMonthRangeUtc(2026, 8);

describe("makeSummaryQueries.fetchSummary — las tres listas", () => {
  it("las dos listas vivas NO llevan filtro de mes: son las que la próxima reunión debe tratar", async () => {
    const { client, findMany } = db();
    await makeSummaryQueries(client).fetchSummary(RANGE);

    const accepted = findMany.mock.calls.find(
      ([a]) => (a.where as { status?: string }).status === "approved_pending_minute",
    )![0];
    expect(accepted.where).toEqual({ status: "approved_pending_minute" });
    expect(accepted.orderBy).toEqual({ createdAt: "asc" });

    const board = findMany.mock.calls.find(
      ([a]) => (a.where as { status?: string }).status === "pending_board",
    )![0];
    expect(board.where).toEqual({ status: "pending_board" });
    expect(board.orderBy).toEqual({ createdAt: "asc" });
  });

  it("la lista de asentadas sí filtra por el mes, sobre decidedAt", async () => {
    const { client, findMany } = db();
    await makeSummaryQueries(client).fetchSummary(RANGE);

    const recorded = findMany.mock.calls.find(
      ([a]) => (a.where as { status?: string }).status === "completed",
    )![0];
    expect(recorded.where).toEqual({
      status: "completed",
      decidedAt: { gte: RANGE.from, lt: RANGE.to },
    });
    expect(recorded.orderBy).toEqual({ decidedAt: "asc" });
  });

  // La fila de Application trae el hash del token de retome, la IP y el
  // user-agent del vecino: nada de eso tiene por qué viajar al resumen.
  it("selecciona sólo las columnas que el resumen muestra", async () => {
    const { client, findMany } = db();
    await makeSummaryQueries(client).fetchSummary(RANGE);

    for (const [args] of findMany.mock.calls) {
      const select = args.select as Record<string, unknown>;
      expect(Object.keys(select).sort()).toEqual([
        "createdAt", "decidedAt", "dni", "fullName", "id", "memberId", "minuteId",
        "requestedCategory", "wantsDebit",
      ]);
      expect(select).not.toHaveProperty("resumeTokenHash");
      expect(select).not.toHaveProperty("ip");
    }
  });

  it("en las vivas, `memberId` sí distingue el reingreso por venir (REG-25)", async () => {
    const { client } = db({
      accepted: [liveRow({ id: 10, memberId: 99 }), liveRow({ id: 11, memberId: null })],
      pendingBoard: [liveRow({ id: 12, memberId: 5 })],
    });
    const res = await makeSummaryQueries(client).fetchSummary(RANGE);

    expect(res.accepted.map((r) => [r.id, r.reentry])).toEqual([[10, true], [11, false]]);
    expect(res.pendingBoard[0].reentry).toBe(true);
  });
});

// El asiento le escribe `memberId` a TODA solicitud que completa (contrato de la
// Task 15), así que ahí `memberId !== null` NO distingue un alta de un
// reingreso: la señal es el Movement del asiento. Y el resumen no puede pagar
// una consulta por fila — el acta de un mes de campaña puede traer decenas.
describe("makeSummaryQueries.fetchSummary — alta o reingreso de las asentadas", () => {
  const recorded = [
    { ...liveRow({ id: 20, memberId: 306, minuteId: 4 }), decidedAt: new Date("2026-08-10T18:00:00Z") },
    { ...liveRow({ id: 21, memberId: 307, minuteId: 4 }), decidedAt: new Date("2026-08-10T18:00:00Z") },
    { ...liveRow({ id: 22, memberId: 99, minuteId: 5 }), decidedAt: new Date("2026-08-20T18:00:00Z") },
  ];

  it("resuelve todo el lote con UNA sola consulta de movimientos", async () => {
    const { client, movementFindMany } = db({
      movements: [
        { memberId: 306, minuteId: 4, type: "admission" },
        { memberId: 307, minuteId: 4, type: "admission" },
        { memberId: 99, minuteId: 5, type: "readmission" },
      ],
      recorded,
    });
    const res = await makeSummaryQueries(client).fetchSummary(RANGE);

    expect(movementFindMany).toHaveBeenCalledTimes(1);
    const [args] = movementFindMany.mock.calls[0];
    expect(args.where).toEqual({
      memberId: { in: [306, 307, 99] },
      minuteId: { in: [4, 5] },
      type: { in: ["admission", "readmission"] },
    });
    expect(res.recordedInMonth.map((r) => [r.id, r.reentry]))
      .toEqual([[20, false], [21, false], [22, true]]);
  });

  // El `in`×`in` es un superconjunto (producto cartesiano de socios × actas):
  // el movimiento del socio 306 en el acta 5 matchea la consulta pero NO es el
  // asiento de ninguna de estas solicitudes. La clave del mapa es el PAR.
  it("descarta los movimientos que matchean el superconjunto pero no el par exacto", async () => {
    const { client } = db({
      movements: [
        { memberId: 306, minuteId: 5, type: "readmission" },
        { memberId: 306, minuteId: 4, type: "admission" },
      ],
      recorded: [recorded[0]],
    });
    const res = await makeSummaryQueries(client).fetchSummary(RANGE);
    expect(res.recordedInMonth[0].reentry).toBe(false);
  });

  // Un asiento anterior a este circuito, o un dato migrado: la pantalla NO sabe
  // si fue alta o reingreso, y decir "Alta" ahí sería afirmarlo sin con qué.
  it("sin movimiento que lo respalde queda en null, no en 'alta'", async () => {
    const { client } = db({ movements: [], recorded: [recorded[0]] });
    const res = await makeSummaryQueries(client).fetchSummary(RANGE);
    expect(res.recordedInMonth[0].reentry).toBeNull();
  });

  it("sin asentadas en el mes no consulta movimientos", async () => {
    const { client, movementFindMany } = db({ recorded: [] });
    const res = await makeSummaryQueries(client).fetchSummary(RANGE);
    expect(movementFindMany).not.toHaveBeenCalled();
    expect(res.recordedInMonth).toEqual([]);
  });
});

// ── La exportación ───────────────────────────────────────────────────────────
describe("buildSummaryExportRow", () => {
  const row = {
    id: 20, fullName: "Pérez, Ana", dni: "30111222", requestedCategory: "adherent" as const,
    wantsDebit: true, reentry: true,
    createdAt: new Date("2026-08-03T14:00:00Z"),
    decidedAt: new Date("2026-08-10T18:00:00Z"),
  };

  it("traduce categoría, débito y reingreso a es-AR", () => {
    expect(buildSummaryExportRow(row)).toMatchObject({
      name: "Pérez, Ana", dni: "30111222", cat: "Adherente", debit: "Sí", reentry: "Sí",
    });
    expect(buildSummaryExportRow({ ...row, wantsDebit: false, reentry: false }))
      .toMatchObject({ debit: "No", reentry: "No" });
  });

  it("cuando no se sabe si fue alta o reingreso no inventa un 'No'", () => {
    expect(buildSummaryExportRow({ ...row, reentry: null }).reentry).toBe("—");
  });

  // La fecha va como Date y no como texto DD/MM/AAAA: un texto ordena mal en
  // Excel (compara el día antes que el año) y el acta se arma ordenando.
  it("la fecha sale como Date, anclada al día civil argentino", () => {
    const cell = buildSummaryExportRow(row).date;
    expect(cell).toBeInstanceOf(Date);
    // 10/08/2026 18:00Z = 10/08 15:00 AR → 10/08 a mediodía UTC.
    expect(cell.toISOString()).toBe("2026-08-10T12:00:00.000Z");
  });

  it("la asentada muestra la fecha del asiento; la viva, la de la solicitud", () => {
    expect(buildSummaryExportRow(row).date.toISOString()).toBe("2026-08-10T12:00:00.000Z");
    expect(buildSummaryExportRow({ ...row, decidedAt: null }).date.toISOString())
      .toBe("2026-08-03T12:00:00.000Z");
  });

  // Una solicitud creada a las 22:00 del 3/8 en Comodoro es 01:00Z del 4/8: sin
  // anclar al día AR, la pantalla diría 03/08 y el Excel 04/08.
  it("no adelanta un día la solicitud cargada de noche", () => {
    const late = { ...row, decidedAt: null, createdAt: new Date("2026-08-04T01:00:00Z") };
    expect(buildSummaryExportRow(late).date.toISOString()).toBe("2026-08-03T12:00:00.000Z");
  });

  it("las columnas del Excel son las mismas seis de la pantalla, y la fecha es fecha", () => {
    const columns = summaryExportColumns("fecha_solicitud");
    expect(columns.map((c) => c.key))
      .toEqual(["name", "dni", "cat", "debit", "reentry", "date"]);
    const date = columns.find((c) => c.key === "date")!;
    expect(date.style?.numFmt).toBe("dd/mm/yyyy");
    // El DNI es una cadena de dígitos, no una cantidad.
    expect(columns.find((c) => c.key === "dni")!.style?.numFmt).toBe("@");
  });

  // El significado de la fecha cambia según la lista (pedida vs. asentada), y
  // las tres hojas no pueden decir "fecha" a secas: mismo criterio que usa la
  // pantalla (`Section` en page.tsx) para el encabezado de esa columna.
  it("el encabezado de la fecha lo decide quien arma la hoja, no una etiqueta fija", () => {
    expect(summaryExportColumns("fecha_solicitud").find((c) => c.key === "date")!.header)
      .toBe("fecha_solicitud");
    expect(summaryExportColumns("fecha_asentada").find((c) => c.key === "date")!.header)
      .toBe("fecha_asentada");
  });
});
