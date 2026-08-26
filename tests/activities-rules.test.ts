import { describe, expect, it } from "vitest";
import {
  buildDailyAgenda,
  buildWeeklyGrid,
  findScheduleConflict,
  initialAgendaDay,
  minutesToTime,
  parseWeekdays,
  ROOM_KEYS,
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
  it("rechaza vacío y valores fuera de 1-6 con mensaje es-AR", () => {
    expect(parseWeekdays([]).ok).toBe(false);
    expect(parseWeekdays(["0"]).ok).toBe(false);
    // La vecinal no abre los domingos: el día 7 dejó de ser cargable.
    expect(parseWeekdays(["7"]).ok).toBe(false);
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

describe("minutesToTime", () => {
  it("es la inversa de timeToMinutes", () => {
    expect(minutesToTime(1110)).toBe("18:30");
    expect(minutesToTime(0)).toBe("00:00");
  });
});

describe("findScheduleConflict (capacidad 1: salones y cocina)", () => {
  it("detecta solape parcial en mismo espacio, año y día", () => {
    const hit = findScheduleConflict(slot({ id: undefined, startTime: "19:00", endTime: "20:00" }), [slot()]);
    expect(hit).toMatchObject({ kind: "overlap", other: { name: "Gimnasia mujeres" } });
  });
  it("borde exacto NO es solape (19:30 empieza cuando 19:30 termina)", () => {
    expect(findScheduleConflict(slot({ id: undefined, startTime: "19:30", endTime: "20:30" }), [slot()])).toBeNull();
  });
  it("el borde exacto tampoco es solape del otro lado (termina cuando la otra empieza)", () => {
    expect(findScheduleConflict(slot({ id: undefined, startTime: "17:00", endTime: "18:00" }), [slot()])).toBeNull();
  });
  it("otro espacio, otro año, día sin intersección o inactiva: no chocan", () => {
    expect(findScheduleConflict(slot({ id: undefined, room: "glass" }), [slot()])).toBeNull();
    expect(findScheduleConflict(slot({ id: undefined, year: 2027 }), [slot()])).toBeNull();
    expect(findScheduleConflict(slot({ id: undefined, weekdays: [2, 4] }), [slot()])).toBeNull();
    expect(findScheduleConflict(slot({ id: undefined }), [slot({ active: false })])).toBeNull();
  });
  it("la cocina también es un espacio único", () => {
    const hit = findScheduleConflict(
      slot({ id: undefined, room: "kitchen", startTime: "19:00", endTime: "20:00" }),
      [slot({ room: "kitchen" })],
    );
    expect(hit?.kind).toBe("overlap");
  });
  it("en edición se ignora a sí misma pero sigue viendo a las demás", () => {
    expect(findScheduleConflict(slot({ id: 1 }), [slot()])).toBeNull();
    const otra = slot({ id: 2, name: "Zumba", startTime: "19:00", endTime: "20:00" });
    const hit = findScheduleConflict(slot({ id: 1, startTime: "19:15", endTime: "20:15" }), [slot(), otra]);
    expect(hit).toMatchObject({ kind: "overlap", other: { name: "Zumba" } });
  });
  it("el candidato inactivo no choca con nada", () => {
    expect(findScheduleConflict(slot({ id: undefined, active: false }), [slot()])).toBeNull();
  });
  it("una actividad contenida dentro de otra sí choca", () => {
    const hit = findScheduleConflict(slot({ id: undefined, startTime: "18:30", endTime: "19:00" }), [slot()]);
    expect(hit?.kind).toBe("overlap");
  });
  it("horario inválido no se reporta como conflicto (lo rechaza la validación, no esta regla)", () => {
    expect(findScheduleConflict(slot({ id: undefined, startTime: "25:00" }), [slot()])).toBeNull();
  });
});

describe("findScheduleConflict (capacidad 3: aulas)", () => {
  const aula = (over: Record<string, unknown> = {}) =>
    slot({ room: "classroom", weekdays: [1], startTime: "18:00", endTime: "19:30", ...over });

  it("la segunda y la tercera actividad superpuestas entran", () => {
    expect(findScheduleConflict(aula({ id: undefined }), [aula({ id: 1 })])).toBeNull();
    expect(findScheduleConflict(aula({ id: undefined }), [aula({ id: 1 }), aula({ id: 2 })])).toBeNull();
  });

  it("la cuarta se rechaza informando la ventana ocupada", () => {
    const hit = findScheduleConflict(aula({ id: undefined, startTime: "18:30", endTime: "20:00" }), [
      aula({ id: 1 }), aula({ id: 2 }), aula({ id: 3 }),
    ]);
    expect(hit).toEqual({ kind: "full", capacity: 3, startTime: "18:30", endTime: "19:30" });
  });

  it("tres existentes que NO coinciden entre sí a ninguna hora no llenan el aula", () => {
    // Escalera: cada una pisa a la siguiente pero nunca hay 3 en simultáneo.
    const hit = findScheduleConflict(aula({ id: undefined, startTime: "08:00", endTime: "12:00" }), [
      aula({ id: 1, startTime: "08:00", endTime: "09:00" }),
      aula({ id: 2, startTime: "09:00", endTime: "10:00" }),
      aula({ id: 3, startTime: "10:00", endTime: "11:00" }),
    ]);
    expect(hit).toBeNull();
  });

  it("el borde exacto no cuenta como simultaneidad", () => {
    const hit = findScheduleConflict(aula({ id: undefined }), [
      aula({ id: 1 }), aula({ id: 2, startTime: "16:30", endTime: "18:00" }), aula({ id: 3, startTime: "16:00", endTime: "18:00" }),
    ]);
    expect(hit).toBeNull();
  });

  it("una oculta no ocupa aula", () => {
    const hit = findScheduleConflict(aula({ id: undefined }), [
      aula({ id: 1 }), aula({ id: 2 }), aula({ id: 3, active: false }),
    ]);
    expect(hit).toBeNull();
  });

  it("la simultaneidad se mide por día: 3 en lunes no bloquean el martes", () => {
    const hit = findScheduleConflict(aula({ id: undefined, weekdays: [2] }), [
      aula({ id: 1 }), aula({ id: 2 }), aula({ id: 3 }),
    ]);
    expect(hit).toBeNull();
  });

  it("en edición no se cuenta a sí misma para el cupo", () => {
    const hit = findScheduleConflict(aula({ id: 3 }), [aula({ id: 1 }), aula({ id: 2 }), aula({ id: 3 })]);
    expect(hit).toBeNull();
  });
});

describe("findScheduleConflict (espacio desconocido: falla cerrado)", () => {
  // Mismo criterio que el `Object.hasOwn` de buildWeeklyGrid, pero del lado de
  // la ESCRITURA: un espacio que no está en ROOM_CAPACITY no puede resolver a
  // "capacidad ilimitada". Sin el `?? 1`, `capacity` es `undefined`, ningún
  // camino matchea y la función devuelve null: solapes libres.
  const ghost = (over: Record<string, unknown> = {}) =>
    slot({ room: "basement", weekdays: [1], startTime: "18:00", endTime: "19:30", ...over });

  it("un espacio fuera de ROOM_CAPACITY se trata como capacidad 1", () => {
    const hit = findScheduleConflict(ghost({ id: undefined }), [ghost({ id: 1 })]);
    expect(hit).toMatchObject({ kind: "overlap" });
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

  it("repite la actividad en cada uno de sus días y deja los seis días armados", () => {
    const grid = buildWeeklyGrid([slot()]); // lunes y miércoles
    expect(grid.historic[1].map((a) => a.id)).toEqual([1]);
    expect(grid.historic[3].map((a) => a.id)).toEqual([1]);
    expect(Object.keys(grid.historic).map(Number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Object.keys(grid.glass).map(Number)).toEqual([1, 2, 3, 4, 5, 6]);
    // Los salones no comparten arrays: empujar en uno no debe verse en el otro.
    expect(grid.glass[1]).toEqual([]);
  });

  it("arma la grilla para los cuatro espacios, con arrays independientes", () => {
    const grid = buildWeeklyGrid([
      slot({ id: 5, name: "Cocina para todos", room: "kitchen", weekdays: [2] }),
      slot({ id: 6, name: "Apoyo escolar", room: "classroom", weekdays: [2] }),
    ]);
    expect(grid.kitchen[2].map((a) => a.name)).toEqual(["Cocina para todos"]);
    expect(grid.classroom[2].map((a) => a.name)).toEqual(["Apoyo escolar"]);
    expect(grid.historic[2]).toEqual([]);
    expect(grid.glass[2]).toEqual([]);
  });

  it("ignora días fuera de 1-6 en lugar de inventar columnas", () => {
    const grid = buildWeeklyGrid([slot({ weekdays: [1, 7] })]);
    expect(Object.keys(grid.historic).map(Number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(grid.historic[1]).toHaveLength(1);
  });

  it("no repite la actividad si el día viene duplicado en la columna JSON", () => {
    // Por el ABM no puede entrar (parseWeekdays deduplica), pero esta función
    // también recibe lo que haya en la base: un arreglo a mano o un import
    // futuro pintaban la actividad dos veces en el mismo día.
    const grid = buildWeeklyGrid([slot({ weekdays: [1, 1, 3] })]);
    expect(grid.historic[1]).toHaveLength(1);
    expect(grid.historic[3]).toHaveLength(1);
  });

  // La grilla se arma con Object.fromEntries, así que hereda Object.prototype:
  // una clave del prototipo en la columna JSON `weekdays` resolvía a una función
  // heredada y `.push` tiraba TypeError, con la página pública en 500. Tiene que
  // descartarse igual que cualquier otro valor inválido.
  it.each([
    ["toString", ["toString"]],
    ["constructor", ["constructor"]],
    ["valueOf", ["valueOf"]],
    ["hasOwnProperty", ["hasOwnProperty"]],
    ["__proto__", ["__proto__"]],
  ])("no explota con la clave de prototipo %s y la descarta", (_label, weekdays) => {
    const build = () => buildWeeklyGrid([slot({ weekdays })]);
    expect(build).not.toThrow();
    const grid = build();
    expect(Object.keys(grid.historic).map(Number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(WEEKDAYS.every(([d]) => grid.historic[d].length === 0)).toBe(true);
    expect(WEEKDAYS.every(([d]) => grid.glass[d].length === 0)).toBe(true);
  });

  it("una clave de prototipo no arrastra a los días válidos de la misma actividad", () => {
    const grid = buildWeeklyGrid([slot({ weekdays: ["toString", 2, "constructor"] })]);
    expect(grid.historic[2].map((a) => a.id)).toEqual([1]);
    expect(grid.historic[1]).toEqual([]);
  });

  // Mismo riesgo que las claves de prototipo, pero por la otra dimensión de la
  // grilla: `room` llega desde la base con un cast sin chequear (query.ts), así
  // que una fila con un espacio que ya no existe en SITE.rooms indexaría
  // `undefined` y tiraría 500 en la página pública.
  // "toString" está en la lista por lo mismo que en los días: la grilla sale de
  // `Object.fromEntries`, así que un `in` habría dejado pasar esa clave.
  it.each(["quincho", "toString", "__proto__"])(
    "descarta la fila cuyo espacio %s no existe en lugar de explotar",
    (room) => {
      const build = () => buildWeeklyGrid([slot({ room: room as never }), slot({ id: 2, weekdays: [2] })]);
      expect(build).not.toThrow();
      const grid = build();
      expect(Object.keys(grid)).toEqual(ROOM_KEYS);
      expect(grid.historic[1]).toEqual([]);
      // La fila sana de la misma tanda sigue entrando.
      expect(grid.historic[2].map((a) => a.id)).toEqual([2]);
    },
  );

  it("valores corruptos no enteros o fuera de rango también se descartan", () => {
    const grid = buildWeeklyGrid([slot({ weekdays: [0, -1, 1.5, 8, NaN, null, undefined, "lunes"] })]);
    expect(WEEKDAYS.every(([d]) => grid.historic[d].length === 0)).toBe(true);
  });
});

describe("buildDailyAgenda (datos corruptos)", () => {
  // buildDailyAgenda se apoya en buildWeeklyGrid: si la grilla explota, /actividades
  // devuelve 500. Es la ruta pública, así que se cubre de punta a punta.
  it("no explota con claves de prototipo y devuelve los seis días vacíos", () => {
    const build = () => buildDailyAgenda([slot({ weekdays: ["toString"] }), slot({ id: 2, weekdays: ["constructor"] })]);
    expect(build).not.toThrow();
    const agenda = build();
    expect(agenda.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(agenda.every((d) => d.entries.length === 0)).toBe(true);
  });
});

describe("buildDailyAgenda", () => {
  it("devuelve los seis días en orden, con o sin actividades", () => {
    const agenda = buildDailyAgenda([]);
    expect(agenda.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(agenda.map((d) => d.label)).toEqual(WEEKDAYS.map(([, l]) => l));
    expect(agenda.every((d) => d.entries.length === 0)).toBe(true);
  });

  it("mezcla los dos salones en el mismo día y ordena por hora", () => {
    const agenda = buildDailyAgenda([
      slot({ id: 2, name: "Zumba", room: "glass", weekdays: [1], startTime: "20:00", endTime: "21:00" }),
      slot({ id: 3, name: "Yoga", room: "historic", weekdays: [1], startTime: "08:00", endTime: "09:00" }),
    ]);
    expect(agenda[0].entries.map((e) => [e.name, e.room])).toEqual([
      ["Yoga", "historic"],
      ["Zumba", "glass"],
    ]);
  });

  it("a igual hora desempata por nombre y no por salón", () => {
    const agenda = buildDailyAgenda([
      slot({ id: 2, name: "Zumba", room: "historic", weekdays: [2], startTime: "18:00", endTime: "19:00" }),
      slot({ id: 3, name: "Ajedrez", room: "glass", weekdays: [2], startTime: "18:00", endTime: "19:00" }),
    ]);
    expect(agenda[1].entries.map((e) => e.name)).toEqual(["Ajedrez", "Zumba"]);
  });

  it("repite la actividad en cada uno de sus días y excluye las inactivas", () => {
    const agenda = buildDailyAgenda([slot(), slot({ id: 9, name: "Apagada", weekdays: [5], active: false })]);
    expect(agenda[0].entries.map((e) => e.id)).toEqual([1]); // lunes
    expect(agenda[2].entries.map((e) => e.id)).toEqual([1]); // miércoles
    expect(agenda[1].entries).toEqual([]); // martes
    expect(agenda[4].entries).toEqual([]); // viernes: la inactiva no entra
  });

  it("cada entrada trae el salón para poder etiquetarla en la página pública", () => {
    const agenda = buildDailyAgenda([slot({ room: "glass" })]);
    expect(ROOM_LABELS[agenda[0].entries[0].room]).toBe(SITE.rooms.glass);
  });

  it("mezcla los cuatro espacios en el mismo día", () => {
    const agenda = buildDailyAgenda([
      slot({ id: 7, name: "Cocina para todos", room: "kitchen", weekdays: [1], startTime: "10:00", endTime: "11:00" }),
      slot({ id: 8, name: "Apoyo escolar", room: "classroom", weekdays: [1], startTime: "08:00", endTime: "09:00" }),
    ]);
    expect(agenda[0].entries.map((e) => [e.name, e.room])).toEqual([
      ["Apoyo escolar", "classroom"],
      ["Cocina para todos", "kitchen"],
    ]);
  });
});

describe("etiquetas visibles", () => {
  it("ROOM_LABELS sale de SITE.rooms, no de strings repetidos", () => {
    expect(ROOM_LABELS).toEqual(SITE.rooms);
    expect(ROOM_LABELS.historic).toBe(SITE.rooms.historic);
  });

  it("ROOM_LABELS cubre los cuatro espacios desde SITE.rooms", () => {
    expect(ROOM_LABELS).toEqual(SITE.rooms);
    expect(ROOM_LABELS.kitchen).toBe("Cocina");
    expect(ROOM_LABELS.classroom).toBe("Aulas");
  });

  it("ROOM_KEYS es el orden estable de los espacios y coincide con SITE.rooms", () => {
    expect(ROOM_KEYS).toEqual(["historic", "glass", "kitchen", "classroom"]);
    expect(ROOM_KEYS).toEqual(Object.keys(SITE.rooms));
  });

  it("WEEKDAYS va de lunes a sábado con nombres es-AR", () => {
    expect(WEEKDAYS).toEqual([
      [1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"],
      [5, "Viernes"], [6, "Sábado"],
    ]);
  });
});

describe("initialAgendaDay", () => {
  // La agenda que arma buildDailyAgenda: siempre los seis días de WEEKDAYS.
  const agenda = buildDailyAgenda([]);

  it("un domingo (7, fuera de WEEKDAYS) abre en el primer día de la agenda", () => {
    // currentWeekdayAR() devuelve 7 los domingos y la agenda va de 1 a 6: sin
    // este piso, DayTabs marcaría `aria-pressed` en ninguna solapa y mostraría
    // el lunes sin decirlo. Es el único caso que el reloj no puede reproducir a
    // pedido, así que se fija acá.
    expect(initialAgendaDay(agenda, 7)).toBe(1);
  });

  it("un día hábil abre en ese día", () => {
    expect(initialAgendaDay(agenda, 3)).toBe(3);
  });

  it("el sábado abre en el sábado (el último día sigue siendo hábil)", () => {
    expect(initialAgendaDay(agenda, 6)).toBe(6);
  });
});
