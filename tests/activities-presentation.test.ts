import { describe, expect, it } from "vitest";
import {
  agendaSummary,
  initialVisibleDay,
  visibleAgendaDays,
  visibleRooms,
  weekSpanLabel,
} from "@/lib/activities/presentation";
import type { AgendaDay, AgendaEntry } from "@/lib/activities/rules";

const entry = (id: number, room: AgendaEntry["room"] = "historic"): AgendaEntry => ({
  id,
  name: `Actividad ${id}`,
  room,
  startTime: "18:00",
  endTime: "19:00",
});

const day = (d: number, label: string, entries: AgendaEntry[] = []): AgendaDay => ({
  day: d,
  label,
  entries,
});

// Semana con huecos: miércoles, viernes y sábado vacíos. La actividad 1 se
// dicta dos días (lunes y jueves): en los conteos vale UNA vez.
const WEEK: AgendaDay[] = [
  day(1, "Lunes", [entry(1)]),
  day(2, "Martes", [entry(2, "glass")]),
  day(3, "Miércoles"),
  day(4, "Jueves", [entry(1), entry(3, "kitchen")]),
  day(5, "Viernes"),
  day(6, "Sábado"),
];
const VISIBLE = visibleAgendaDays(WEEK);

describe("visibleAgendaDays", () => {
  it("deja solo los días con actividades, en el mismo orden", () => {
    expect(VISIBLE.map((d) => d.day)).toEqual([1, 2, 4]);
    expect(VISIBLE.map((d) => d.label)).toEqual(["Lunes", "Martes", "Jueves"]);
  });
  it("semana llena → los seis días; sin actividades → vacío", () => {
    const full = WEEK.map((d) => ({ ...d, entries: [entry(9)] }));
    expect(visibleAgendaDays(full)).toHaveLength(6);
    expect(visibleAgendaDays(WEEK.map((d) => ({ ...d, entries: [] })))).toEqual([]);
  });
});

describe("initialVisibleDay", () => {
  it("hoy visible → hoy", () => {
    expect(initialVisibleDay(VISIBLE, 1)).toBe(1);
    expect(initialVisibleDay(VISIBLE, 4)).toBe(4);
  });
  it("hoy no visible → el próximo día visible", () => {
    // Miércoles (3) vacío → jueves (4).
    expect(initialVisibleDay(VISIBLE, 3)).toBe(4);
  });
  it("fin de semana → vuelve al primer día visible (orden cíclico)", () => {
    expect(initialVisibleDay(VISIBLE, 6)).toBe(1); // sábado → lunes
    expect(initialVisibleDay(VISIBLE, 7)).toBe(1); // domingo (currentWeekdayAR puede devolver 7)
  });
  it("un solo día visible → siempre ese día", () => {
    const single = [day(6, "Sábado", [entry(1)])];
    expect(initialVisibleDay(single, 2)).toBe(6);
    expect(initialVisibleDay(single, 6)).toBe(6);
    expect(initialVisibleDay(single, 7)).toBe(6);
  });
});

describe("weekSpanLabel", () => {
  it("primer y último día visible", () => {
    expect(weekSpanLabel(VISIBLE)).toBe("Lunes — Jueves");
  });
  it("un solo día → solo ese día; vacío → cadena vacía", () => {
    expect(weekSpanLabel([day(6, "Sábado", [entry(1)])])).toBe("Sábado");
    expect(weekSpanLabel([])).toBe("");
  });
});

describe("agendaSummary", () => {
  it("cuenta actividades DISTINTAS (una actividad de dos días vale una) y espacios distintos", () => {
    expect(agendaSummary(VISIBLE)).toEqual({ activityCount: 3, roomCount: 3 });
  });
  it("vacío → ceros", () => {
    expect(agendaSummary([])).toEqual({ activityCount: 0, roomCount: 0 });
  });
  it("roomCount es por definición el largo de visibleRooms (no dos lógicas)", () => {
    expect(agendaSummary(VISIBLE).roomCount).toBe(visibleRooms(VISIBLE).length);
  });
});

describe("visibleRooms", () => {
  it("devuelve los espacios presentes en orden ROOM_KEYS, no en orden de aparición", () => {
    // Aparecen en orden classroom → kitchen; ROOM_KEYS manda kitchen antes.
    const agenda = [
      day(1, "Lunes", [entry(1, "classroom")]),
      day(2, "Martes", [entry(2, "kitchen")]),
    ];
    expect(visibleRooms(agenda)).toEqual(["kitchen", "classroom"]);
  });
  it("sin actividades → vacío", () => {
    expect(visibleRooms([])).toEqual([]);
  });
});
