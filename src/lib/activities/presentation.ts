// Lógica de PRESENTACIÓN del calendario público: qué días se muestran y cómo
// se resume la semana. Vive aparte de rules.ts (el dominio: solapes,
// capacidad, forma de la semana) a propósito: esto puede cambiar con cada
// rediseño sin tocar las reglas ni sus tests. Desde el rediseño del 28/08 el
// calendario lo dibujan los datos: un día sin actividades no se renderiza.
import { ROOM_KEYS, type AgendaDay, type RoomKey } from "@/lib/activities/rules";

export function visibleAgendaDays(agenda: AgendaDay[]): AgendaDay[] {
  return agenda.filter((d) => d.entries.length > 0);
}

// El selector abre en hoy si hoy tiene actividades; si no, en el PRÓXIMO día
// visible en orden cíclico de semana (sábado → lunes, miércoles vacío →
// jueves, domingo = 7 → lunes). Reemplaza a initialAgendaDay de rules.ts SOLO
// en la página pública; aquella queda donde está, con sus tests.
// Precondición: `visible` no está vacío — la página corta antes con el estado
// vacío global; y `visible` viene ordenado ASCENDENTE por día, que es lo que
// hace que el `find` del próximo día y el `visible[0]` del ciclo sean
// correctos (lo garantiza WEEKDAYS vía buildDailyAgenda).
export function initialVisibleDay(visible: AgendaDay[], todayAR: number): number {
  if (visible.some((d) => d.day === todayAR)) return todayAR;
  const next = visible.find((d) => d.day > todayAR);
  return (next ?? visible[0]).day;
}

// "Lunes — Viernes": primer y último día VISIBLE, para el eyebrow del
// encabezado. No promete que todos los días intermedios tengan actividad; el
// detalle lo da el calendario.
export function weekSpanLabel(visible: AgendaDay[]): string {
  if (visible.length === 0) return "";
  if (visible.length === 1) return visible[0].label;
  return `${visible[0].label} — ${visible[visible.length - 1].label}`;
}

// Conteos para la bajada. Una actividad que se dicta N días aparece N veces en
// la agenda: acá vale UNA (se cuenta por id). El conteo de espacios se DELEGA
// en visibleRooms (declarada abajo, hoisting mediante) en vez de rehacer el
// Set: es exactamente la misma pregunta, y con dos lógicas la bajada podía
// decir un número y la leyenda mostrar otro (la lección de coverageFloor).
export function agendaSummary(visible: AgendaDay[]): {
  activityCount: number;
  roomCount: number;
} {
  const ids = new Set<number>();
  for (const d of visible) {
    for (const e of d.entries) {
      ids.add(e.id);
    }
  }
  return { activityCount: ids.size, roomCount: visibleRooms(visible).length };
}

// Espacios presentes en el calendario visible, en orden ROOM_KEYS (el
// desempate visual estable de todo el calendario), no en orden de aparición.
export function visibleRooms(visible: AgendaDay[]): RoomKey[] {
  const present = new Set<RoomKey>();
  for (const d of visible) for (const e of d.entries) present.add(e.room);
  return ROOM_KEYS.filter((k) => present.has(k));
}
