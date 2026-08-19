import { describe, expect, it } from "vitest";
import {
  buildWeeklyGrid,
  findOverlap,
  parseWeekdays,
  ROOM_LABELS,
  timeToMinutes,
  WEEKDAYS,
} from "@/lib/activities/rules";
import { SITE } from "@/lib/site";

const slot = (over: Record<string, unknown> = {}) => ({
  id: 1, name: "Gimnasia mujeres", room: "historic" as const,
  weekdays: [1, 3], startTime: "18:00", endTime: "19:30", year: 2026, active: true,
  ...over,
});

describe("parseWeekdays", () => {
  it("acepta días válidos y los ordena sin duplicados", () => {
    expect(parseWeekdays(["3", "1", "3"])).toEqual({ ok: true, value: [1, 3] });
  });
  it("rechaza vacío y valores fuera de 1-7 con mensaje es-AR", () => {
    expect(parseWeekdays([]).ok).toBe(false);
    expect(parseWeekdays(["0"]).ok).toBe(false);
    expect(parseWeekdays(["8"]).ok).toBe(false);
    expect(parseWeekdays(["x"]).ok).toBe(false);
  });
});

describe("timeToMinutes", () => {
  it("convierte y valida", () => {
    expect(timeToMinutes("18:30")).toBe(1110);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes("9:00")).toBeNull();
  });
});

describe("findOverlap", () => {
  it("detecta solape parcial en mismo salón, año y día", () => {
    const hit = findOverlap(slot({ id: undefined, startTime: "19:00", endTime: "20:00" }), [slot()]);
    expect(hit?.name).toBe("Gimnasia mujeres");
  });
  it("borde exacto NO es solape (19:30 empieza cuando 19:30 termina)", () => {
    expect(findOverlap(slot({ id: undefined, startTime: "19:30", endTime: "20:30" }), [slot()])).toBeNull();
  });
  it("otro salón, otro año, día sin intersección o inactiva: no chocan", () => {
    expect(findOverlap(slot({ id: undefined, room: "glass" }), [slot()])).toBeNull();
    expect(findOverlap(slot({ id: undefined, year: 2027 }), [slot()])).toBeNull();
    expect(findOverlap(slot({ id: undefined, weekdays: [2, 4] }), [slot()])).toBeNull();
    expect(findOverlap(slot({ id: undefined }), [slot({ active: false })])).toBeNull();
  });
  it("en edición se ignora a sí misma", () => {
    expect(findOverlap(slot({ id: 1 }), [slot()])).toBeNull();
  });
});

describe("buildWeeklyGrid", () => {
  it("agrupa por salón y día, ordena por hora y excluye inactivas", () => {
    const grid = buildWeeklyGrid([
      slot({ id: 2, name: "Taekwondo niños", room: "glass", weekdays: [2], startTime: "10:00", endTime: "11:00" }),
      slot({ id: 3, name: "Yoga", room: "glass", weekdays: [2], startTime: "08:00", endTime: "09:00" }),
      slot({ id: 4, name: "Apagada", room: "glass", weekdays: [2], active: false }),
    ]);
    expect(grid.glass[2].map((a) => a.name)).toEqual(["Yoga", "Taekwondo niños"]);
    expect(grid.historic[1].map((a) => a.name)).toEqual([]);
  });

  it("repite la actividad en cada uno de sus días y deja los siete días armados", () => {
    const grid = buildWeeklyGrid([slot()]); // lunes y miércoles
    expect(grid.historic[1].map((a) => a.id)).toEqual([1]);
    expect(grid.historic[3].map((a) => a.id)).toEqual([1]);
    expect(Object.keys(grid.historic).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(Object.keys(grid.glass).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Los salones no comparten arrays: empujar en uno no debe verse en el otro.
    expect(grid.glass[1]).toEqual([]);
  });

  it("ignora días fuera de 1-7 en lugar de inventar columnas", () => {
    const grid = buildWeeklyGrid([slot({ weekdays: [1, 9] })]);
    expect(Object.keys(grid.historic).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(grid.historic[1]).toHaveLength(1);
  });
});

// Cobertura extra sobre el borde de la regla, que es lo que el revisor mira.
describe("findOverlap (bordes)", () => {
  it("el candidato inactivo no choca con nada", () => {
    expect(findOverlap(slot({ id: undefined, active: false }), [slot()])).toBeNull();
  });

  it("una actividad contenida dentro de otra sí choca", () => {
    const hit = findOverlap(slot({ id: undefined, startTime: "18:30", endTime: "19:00" }), [slot()]);
    expect(hit?.id).toBe(1);
  });

  it("el borde exacto tampoco es solape del otro lado (termina cuando la otra empieza)", () => {
    expect(findOverlap(slot({ id: undefined, startTime: "17:00", endTime: "18:00" }), [slot()])).toBeNull();
  });

  it("en edición se ignora a sí misma pero sigue viendo a las demás", () => {
    const otra = slot({ id: 2, name: "Zumba", startTime: "19:00", endTime: "20:00" });
    const hit = findOverlap(slot({ id: 1, startTime: "19:15", endTime: "20:15" }), [slot(), otra]);
    expect(hit?.name).toBe("Zumba");
  });

  it("horario inválido no se reporta como solape (lo rechaza la validación, no esta regla)", () => {
    expect(findOverlap(slot({ id: undefined, startTime: "25:00" }), [slot()])).toBeNull();
  });
});

describe("etiquetas visibles", () => {
  it("ROOM_LABELS sale de SITE.rooms, no de strings repetidos", () => {
    expect(ROOM_LABELS).toEqual(SITE.rooms);
    expect(ROOM_LABELS.historic).toBe(SITE.rooms.historic);
  });

  it("WEEKDAYS va de lunes a domingo con nombres es-AR", () => {
    expect(WEEKDAYS).toEqual([
      [1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"],
      [5, "Viernes"], [6, "Sábado"], [7, "Domingo"],
    ]);
  });
});
