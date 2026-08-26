import { describe, expect, it } from "vitest";
import { civilDateUtc } from "@/lib/dates";
import {
  BOARD_BUSINESS_DAYS,
  businessDayEnd,
  HolidayCoverageError,
  holidayCoverageYears,
} from "@/lib/board/business-days";

// Atajo de lectura: toda fecha civil del proyecto es el mediodía UTC de su día
// civil argentino, así que los casos se escriben como d(año, mes, día).
const d = civilDateUtc;

// Feriados nacionales 2026, en su fecha EFECTIVA (los trasladables ya movidos —
// es lo que siembra scripts/seed-holidays.ts). No hace falta la lista completa
// para cada caso, pero SÍ hace falta que el año esté representado: la guarda de
// cobertura de `businessDayEnd` trata un año sin ninguna fila como "no sé qué
// pasa en este año", no como "este año no tiene feriados".
const H2026 = {
  anioNuevo: d(2026, 1, 1),
  diversidad: d(2026, 10, 12), // lunes
  soberania: d(2026, 11, 23), // lunes (trasladado desde el viernes 20)
  inmaculada: d(2026, 12, 8), // martes
  navidad: d(2026, 12, 25), // viernes
};
const H2027 = {
  anioNuevo: d(2027, 1, 1), // viernes
  soberania: d(2027, 11, 20), // SÁBADO: un feriado que no cae en día hábil
};

describe("holidayCoverageYears", () => {
  it("reports the civil years the injected calendar speaks about", () => {
    const years = holidayCoverageYears([H2026.navidad, H2027.anioNuevo, H2026.anioNuevo]);
    expect([...years].sort()).toEqual([2026, 2027]);
  });

  it("is empty for an empty calendar", () => {
    expect(holidayCoverageYears([]).size).toBe(0);
  });
});

describe("businessDayEnd — el plazo arranca el día SIGUIENTE a la fijación", () => {
  it("counts from the next day, never from the posting day itself", () => {
    // Lunes 05/10/2026 fijado → el primer día hábil es el martes 06.
    expect(businessDayEnd(d(2026, 10, 5), 1, [H2026.anioNuevo])).toEqual(d(2026, 10, 6));
  });

  it("skips the weekend when the notice goes up on a Friday", () => {
    // Viernes 02/10/2026 → sábado y domingo no cuentan → lunes 05/10.
    expect(businessDayEnd(d(2026, 10, 2), 1, [H2026.anioNuevo])).toEqual(d(2026, 10, 5));
  });

  it("skips the weekend when the notice goes up on a Saturday", () => {
    expect(businessDayEnd(d(2026, 10, 3), 1, [H2026.anioNuevo])).toEqual(d(2026, 10, 5));
  });

  it("pushes past a holiday glued to the weekend", () => {
    // Viernes 09/10 → sáb 10, dom 11, lunes 12 = Diversidad Cultural → martes 13.
    expect(businessDayEnd(d(2026, 10, 9), 1, [H2026.diversidad])).toEqual(d(2026, 10, 13));
  });
});

describe("businessDayEnd — el plazo de cartelera (20 días hábiles)", () => {
  it("lands four weeks later when no holiday falls inside the window", () => {
    // Viernes 02/10/2026 + 20 hábiles limpios = viernes 30/10/2026 (4 semanas
    // exactas de lunes a viernes). El feriado 12/10 NO está en esta lista a
    // propósito: es el caso "no hay feriados en el medio".
    expect(businessDayEnd(d(2026, 10, 2), BOARD_BUSINESS_DAYS, [H2026.anioNuevo])).toEqual(
      d(2026, 10, 30),
    );
  });

  it("moves the term by one day for each holiday inside the window", () => {
    // Mismo arranque, ahora con el lunes 12/10 cargado: el plazo se corre un día
    // hábil y cae el lunes 02/11/2026.
    expect(businessDayEnd(d(2026, 10, 2), BOARD_BUSINESS_DAYS, [H2026.diversidad])).toEqual(
      d(2026, 11, 2),
    );
  });

  it("takes 30 calendar days when two holidays fall inside the window", () => {
    // Lunes 30/11/2026 + 20 hábiles con Inmaculada (mar 08/12) y Navidad
    // (vie 25/12) adentro = miércoles 30/12/2026: 30 días corridos.
    const end = businessDayEnd(d(2026, 11, 30), BOARD_BUSINESS_DAYS, [
      H2026.inmaculada,
      H2026.navidad,
    ]);
    expect(end).toEqual(d(2026, 12, 30));
    const calendarDays = (end.getTime() - d(2026, 11, 30).getTime()) / 86_400_000;
    expect(calendarDays).toBe(30);
  });

  it("crosses the year boundary", () => {
    // Martes 15/12/2026 + 20 hábiles, con Navidad (vie 25/12/2026) y Año Nuevo
    // (vie 01/01/2027) adentro = jueves 14/01/2027.
    const end = businessDayEnd(d(2026, 12, 15), BOARD_BUSINESS_DAYS, [
      H2026.navidad,
      H2027.anioNuevo,
    ]);
    expect(end).toEqual(d(2027, 1, 14));
  });

  it("ignores a holiday that falls on a Saturday", () => {
    // 20/11/2027 cae sábado: ya no era hábil, así que no corre nada. Arranque
    // lunes 15/11/2027 → 5 hábiles → viernes 19/11... y el 22 es el siguiente.
    const withHoliday = businessDayEnd(d(2027, 11, 15), 6, [H2027.soberania]);
    const withoutHoliday = businessDayEnd(d(2027, 11, 15), 6, [H2027.anioNuevo]);
    expect(withHoliday).toEqual(withoutHoliday);
    expect(withHoliday).toEqual(d(2027, 11, 23));
  });
});

describe("businessDayEnd — normalización de entradas", () => {
  it("resolves postedAt by the ARGENTINE civil day, not by the UTC clock", () => {
    // 23:30 del viernes 02/10 en Argentina ya es sábado 03 en UTC. El plazo lo
    // corre el día del vecino, no el del reloj del server.
    const lateFriday = new Date("2026-10-02T23:30:00-03:00");
    expect(businessDayEnd(lateFriday, 1, [H2026.anioNuevo])).toEqual(d(2026, 10, 5));
  });

  it("tolerates duplicated and unsorted holidays", () => {
    const messy = [H2026.diversidad, H2026.anioNuevo, H2026.diversidad];
    expect(businessDayEnd(d(2026, 10, 2), BOARD_BUSINESS_DAYS, messy)).toEqual(d(2026, 11, 2));
  });

  it("rejects a non-positive or fractional term", () => {
    expect(() => businessDayEnd(d(2026, 10, 2), 0, [H2026.anioNuevo])).toThrow(RangeError);
    expect(() => businessDayEnd(d(2026, 10, 2), -1, [H2026.anioNuevo])).toThrow(RangeError);
    expect(() => businessDayEnd(d(2026, 10, 2), 1.5, [H2026.anioNuevo])).toThrow(RangeError);
  });
});

describe("businessDayEnd — cobertura de feriados", () => {
  // El modo de falla que este módulo NO puede tener: contar sobre un período
  // que la tabla no cubre trata sus feriados como días hábiles y le ACORTA el
  // plazo al vecino, en silencio. "Sin filas" no es "sin feriados".
  it("refuses to count over a year with no holidays loaded", () => {
    expect(() => businessDayEnd(d(2026, 10, 2), BOARD_BUSINESS_DAYS, [])).toThrow(
      HolidayCoverageError,
    );
  });

  it("names the uncovered year in the error", () => {
    // Sólo hay feriados de 2026 y el plazo se mete en 2027.
    try {
      businessDayEnd(d(2026, 12, 15), BOARD_BUSINESS_DAYS, [H2026.navidad]);
      expect.unreachable("tendría que haber lanzado por 2027 sin cobertura");
    } catch (error) {
      expect(error).toBeInstanceOf(HolidayCoverageError);
      expect((error as HolidayCoverageError).missingYear).toBe(2027);
      expect((error as HolidayCoverageError).message).toContain("2027");
    }
  });

  it("counts happily once the missing year is loaded", () => {
    expect(
      businessDayEnd(d(2026, 12, 15), BOARD_BUSINESS_DAYS, [H2026.navidad, H2027.anioNuevo]),
    ).toEqual(d(2027, 1, 14));
  });
});
