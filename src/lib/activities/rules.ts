// Reglas del calendario de espacios de la sede. La semana va de lunes a
// sábado (la vecinal no abre los domingos) y cada espacio físico tiene una
// capacidad: dos actividades activas del mismo espacio y año no pueden
// pisarse en día y horario más allá de esa capacidad.
import { SITE } from "@/lib/site";

export const WEEKDAYS: Array<[number, string]> = [
  [1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"],
  [5, "Viernes"], [6, "Sábado"],
];

export type RoomKey = keyof typeof SITE.rooms;

// El orden acá es el orden estable de desempate visual (grilla y agenda).
export const ROOM_KEYS = Object.keys(SITE.rooms) as RoomKey[];

export const ROOM_LABELS: Record<RoomKey, string> = SITE.rooms;

export type ActivitySlot = {
  id: number;
  name: string;
  room: RoomKey;
  weekdays: number[];
  startTime: string;
  endTime: string;
  year: number;
  active: boolean;
};

export function parseWeekdays(raw: string[]): { ok: true; value: number[] } | { ok: false; error: string } {
  if (raw.length === 0) return { ok: false, error: "Elegí al menos un día de la semana." };
  const days = [...new Set(raw.map((r) => Number(r)))].sort((a, b) => a - b);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 6)) {
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

// Capacidad física de cada espacio: los salones y la cocina son un ambiente
// único; "Aulas" son tres aulas sin identificar, así que hasta tres
// actividades activas pueden convivir en el mismo horario.
export const ROOM_CAPACITY: Record<RoomKey, number> = {
  historic: 1,
  glass: 1,
  kitchen: 1,
  classroom: 3,
};

export function minutesToTime(min: number): string {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export type ScheduleConflict =
  | { kind: "overlap"; other: ActivitySlot }
  | { kind: "full"; capacity: number; startTime: string; endTime: string };

// Reemplaza a findOverlap: misma regla estricta de solape (compartir el borde
// exacto es válido) generalizada por capacidad. Con capacidad 1 el resultado
// es el de siempre — la primera actividad pisada—; con capacidad N el
// candidato entra salvo que en algún instante de su rango ya haya N activas
// en simultáneo EN EL MISMO DÍA, y en ese caso se informa la ventana ocupada
// para que el operador sepa qué franja tiene que esquivar.
export function findScheduleConflict(
  candidate: Omit<ActivitySlot, "id"> & { id?: number },
  existing: ActivitySlot[],
): ScheduleConflict | null {
  const start = timeToMinutes(candidate.startTime);
  const end = timeToMinutes(candidate.endTime);
  if (start === null || end === null || !candidate.active) return null;
  const overlapping = existing.filter((other) => {
    if (other.id === candidate.id || !other.active) return false;
    if (other.room !== candidate.room || other.year !== candidate.year) return false;
    if (!other.weekdays.some((d) => candidate.weekdays.includes(d))) return false;
    const oStart = timeToMinutes(other.startTime);
    const oEnd = timeToMinutes(other.endTime);
    return oStart !== null && oEnd !== null && start < oEnd && oStart < end;
  });
  const capacity = ROOM_CAPACITY[candidate.room];
  if (capacity === 1) {
    return overlapping.length > 0 ? { kind: "overlap", other: overlapping[0] } : null;
  }
  // Barrido por día: la concurrencia solo puede subir donde EMPIEZA una
  // actividad, así que alcanza con medirla en cada inicio (acotado al rango
  // del candidato). Los horarios de `overlapping` ya validaron en el filtro.
  for (const day of candidate.weekdays) {
    const sameDay = overlapping.filter((o) => o.weekdays.includes(day));
    if (sameDay.length < capacity) continue;
    const points = [...new Set(sameDay.map((o) => Math.max(timeToMinutes(o.startTime)!, start)))].sort(
      (a, b) => a - b,
    );
    for (const p of points) {
      const concurrent = sameDay.filter(
        (o) => timeToMinutes(o.startTime)! <= p && p < timeToMinutes(o.endTime)!,
      );
      if (concurrent.length >= capacity) {
        const busyEnd = Math.min(end, ...concurrent.map((o) => timeToMinutes(o.endTime)!));
        return { kind: "full", capacity, startTime: minutesToTime(p), endTime: minutesToTime(busyEnd) };
      }
    }
  }
  return null;
}

export function buildWeeklyGrid(activities: ActivitySlot[]) {
  const empty = () => Object.fromEntries(WEEKDAYS.map(([d]) => [d, []])) as Record<
    number,
    Array<{ id: number; name: string; startTime: string; endTime: string }>
  >;
  const grid = Object.fromEntries(ROOM_KEYS.map((k) => [k, empty()])) as Record<
    RoomKey,
    ReturnType<typeof empty>
  >;
  for (const a of activities) {
    if (!a.active) continue;
    // Mismo motivo que el guard de día de abajo: `room` llega con un cast sin
    // chequear desde la base, y una fila con un espacio que ya no existe en
    // SITE.rooms indexaría `undefined` y tiraría 500 en la página pública.
    // `Object.hasOwn` y no `in`: la grilla sale de `Object.fromEntries`, así que
    // `"toString" in grid` da true y volveríamos a caer en el mismo TypeError
    // que el guard de día documenta ocho líneas más abajo.
    if (!Object.hasOwn(grid, a.room)) continue;
    // `new Set` porque un `weekdays` con el día repetido ([2,2]) pintaría la
    // actividad dos veces en el martes. Por el ABM no puede entrar —
    // `parseWeekdays` deduplica—, pero esta función también recibe lo que haya
    // en la columna JSON, y de ahí ya nos defendemos abajo contra otras formas
    // de basura: un arreglo a mano en la base o un import futuro son la vía.
    for (const d of new Set(a.weekdays)) {
      // Validar el día ANTES de indexar, no después. `empty()` sale de
      // `Object.fromEntries`, así que la grilla es un objeto plano con
      // `Object.prototype` en la cadena: una columna `weekdays` corrupta con
      // "toString" o "constructor" resolvería a una función heredada y el `?.`
      // no protege (el valor existe, solo que no es un array) — `.push` tira
      // TypeError y la página pública devuelve 500. Con este guard, cualquier
      // día que no sea un entero de 1 a 6 se descarta como el resto de la
      // basura posible.
      // El 7 (domingo) quedó fuera de la semana: una fila vieja con domingo se descarta acá, no rompe.
      if (!Number.isInteger(d) || d < 1 || d > 6) continue;
      grid[a.room][d].push({ id: a.id, name: a.name, startTime: a.startTime, endTime: a.endTime });
    }
  }
  for (const room of ROOM_KEYS) {
    for (const [d] of WEEKDAYS) {
      grid[room][d].sort((x, y) => (timeToMinutes(x.startTime) ?? 0) - (timeToMinutes(y.startTime) ?? 0));
    }
  }
  return grid;
}

export type AgendaEntry = {
  id: number;
  name: string;
  room: RoomKey;
  startTime: string;
  endTime: string;
};

// Reproyección día-primero de buildWeeklyGrid para el calendario público. La
// grilla por espacio es la vista del que administra la sede; el vecino
// pregunta "¿qué hay el martes?" y "¿a qué hora?", y el espacio recién le
// importa cuando ya está yendo. Acá el día es el eje y el espacio es un dato de
// cada actividad, así el martes aparece una sola vez y no dos.
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
    entries: ROOM_KEYS
      .flatMap((room) => grid[room][day].map((a) => ({ ...a, room })))
      // Desempate por nombre: al mezclar los espacios, dos actividades que
      // arrancan a la misma hora quedarían en orden de espacio, que no es un
      // orden que el lector pueda anticipar.
      .sort(
        (x, y) =>
          (timeToMinutes(x.startTime) ?? 0) - (timeToMinutes(y.startTime) ?? 0) ||
          x.name.localeCompare(y.name, "es-AR"),
      ),
  }));
}
