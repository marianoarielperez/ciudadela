// Reglas del calendario de salones. Los dos salones son un espacio físico:
// dos actividades activas del mismo salón y año no pueden pisarse en día y
// horario — el alta que choca se rechaza nombrando a la actividad existente.
import { SITE } from "@/lib/site";

export const WEEKDAYS: Array<[number, string]> = [
  [1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"],
  [5, "Viernes"], [6, "Sábado"], [7, "Domingo"],
];

export const ROOM_LABELS: Record<"historic" | "glass", string> = SITE.rooms;

export type ActivitySlot = {
  id: number;
  name: string;
  room: "historic" | "glass";
  weekdays: number[];
  startTime: string;
  endTime: string;
  year: number;
  active: boolean;
};

export function parseWeekdays(raw: string[]): { ok: true; value: number[] } | { ok: false; error: string } {
  if (raw.length === 0) return { ok: false, error: "Elegí al menos un día de la semana." };
  const days = [...new Set(raw.map((r) => Number(r)))].sort((a, b) => a - b);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    return { ok: false, error: "Día de la semana inválido." };
  }
  return { ok: true, value: days };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function timeToMinutes(hhmm: string): number | null {
  if (!TIME_RE.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function findOverlap(
  candidate: Omit<ActivitySlot, "id"> & { id?: number },
  existing: ActivitySlot[],
): ActivitySlot | null {
  const start = timeToMinutes(candidate.startTime);
  const end = timeToMinutes(candidate.endTime);
  if (start === null || end === null) return null;
  for (const other of existing) {
    if (other.id === candidate.id) continue;
    if (!other.active || !candidate.active) continue;
    if (other.room !== candidate.room || other.year !== candidate.year) continue;
    if (!other.weekdays.some((d) => candidate.weekdays.includes(d))) continue;
    const oStart = timeToMinutes(other.startTime);
    const oEnd = timeToMinutes(other.endTime);
    if (oStart === null || oEnd === null) continue;
    // Solape estricto: compartir el borde exacto (una termina 19:30, la otra
    // empieza 19:30) es válido.
    if (start < oEnd && oStart < end) return other;
  }
  return null;
}

export function buildWeeklyGrid(activities: ActivitySlot[]) {
  const empty = () => Object.fromEntries(WEEKDAYS.map(([d]) => [d, []])) as Record<
    number,
    Array<{ id: number; name: string; startTime: string; endTime: string }>
  >;
  const grid = { historic: empty(), glass: empty() };
  for (const a of activities) {
    if (!a.active) continue;
    for (const d of a.weekdays) {
      // Validar el día ANTES de indexar, no después. `empty()` sale de
      // `Object.fromEntries`, así que la grilla es un objeto plano con
      // `Object.prototype` en la cadena: una columna `weekdays` corrupta con
      // "toString" o "constructor" resolvería a una función heredada y el `?.`
      // no protege (el valor existe, solo que no es un array) — `.push` tira
      // TypeError y la página pública devuelve 500. Con este guard, cualquier
      // día que no sea un entero de 1 a 7 se descarta como el resto de la
      // basura posible.
      if (!Number.isInteger(d) || d < 1 || d > 7) continue;
      grid[a.room][d].push({ id: a.id, name: a.name, startTime: a.startTime, endTime: a.endTime });
    }
  }
  for (const room of ["historic", "glass"] as const) {
    for (const [d] of WEEKDAYS) {
      grid[room][d].sort((x, y) => (timeToMinutes(x.startTime) ?? 0) - (timeToMinutes(y.startTime) ?? 0));
    }
  }
  return grid;
}

export type AgendaEntry = {
  id: number;
  name: string;
  room: "historic" | "glass";
  startTime: string;
  endTime: string;
};

// Reproyección día-primero de buildWeeklyGrid para el calendario público. La
// grilla por salón es la vista del que administra el espacio; el vecino
// pregunta "¿qué hay el martes?" y "¿a qué hora?", y el salón recién le importa
// cuando ya está yendo. Acá el día es el eje y el salón es un dato de cada
// actividad, así el martes aparece una sola vez y no dos.
//
// Mismo contrato implícito que buildWeeklyGrid: recibe las actividades de UN
// solo año, no filtra por año.
export function buildDailyAgenda(
  activities: ActivitySlot[],
): Array<{ day: number; label: string; entries: AgendaEntry[] }> {
  const grid = buildWeeklyGrid(activities);
  return WEEKDAYS.map(([day, label]) => ({
    day,
    label,
    entries: (["historic", "glass"] as const)
      .flatMap((room) => grid[room][day].map((a) => ({ ...a, room })))
      // Desempate por nombre: al mezclar los dos salones, dos actividades que
      // arrancan a la misma hora quedarían en orden de salón, que no es un
      // orden que el lector pueda anticipar.
      .sort(
        (x, y) =>
          (timeToMinutes(x.startTime) ?? 0) - (timeToMinutes(y.startTime) ?? 0) ||
          x.name.localeCompare(y.name, "es-AR"),
      ),
  }));
}
