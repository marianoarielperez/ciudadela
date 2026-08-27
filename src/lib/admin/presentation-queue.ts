// Las cuatro vistas de la cola de presentaciones, en un solo lugar.
//
// Existe como módulo propio —y no como cuatro literales adentro de la página—
// porque la cola tiene DOS entradas: sus propios conmutadores y los contadores
// del tablero del proceso, que llevan a la vista correspondiente a cada estado.
// Si cada pantalla armara su URL a mano, un chip del tablero podría mandar a una
// vista que no contiene el estado que dice contar, y el operador vería un
// listado vacío después de hacer clic sobre un número distinto de cero.
//
// Puro y sin Prisma: la lista de estados de cada vista es también la que la
// consulta usa en su `where`, así que la etiqueta y el filtro no pueden
// divergir.
import type { PresentationStatus } from "@/generated/prisma/client";

export const PRESENTATIONS_BASE = "/admin/reempadronamiento/presentaciones";

export type QueueViewKey = "pendientes" | "sin-presentar" | "observadas" | "resueltas";

/** El orden es el de la barra de la pantalla, y es el del trabajo: primero lo
 *  que espera una decisión, después lo que espera al socio, después la lista de
 *  trabajo del teléfono y al final el archivo. */
export const QUEUE_VIEWS: Array<{
  key: QueueViewKey;
  label: string;
  statuses: PresentationStatus[];
  /** Qué decir cuando no hay ninguna. Nunca "no hay nada": cada vista vacía
   *  significa algo distinto. */
  empty: string;
}> = [
  {
    key: "pendientes",
    label: "Pendientes",
    statuses: ["submitted"],
    empty: "No hay presentaciones esperando revisión. Las nuevas aparecen acá solas.",
  },
  {
    key: "sin-presentar",
    label: "Sin presentar",
    statuses: ["pending"],
    empty: "Todos los convocados presentaron su re-empadronamiento.",
  },
  {
    key: "observadas",
    label: "Observadas",
    statuses: ["observed"],
    empty: "No hay ninguna presentación observada esperando que el socio la corrija.",
  },
  {
    key: "resueltas",
    label: "Resueltas",
    statuses: ["validated", "rejected", "withdrawn"],
    empty: "Todavía no se resolvió ninguna presentación.",
  },
];

export const DEFAULT_QUEUE_VIEW: QueueViewKey = "pendientes";

export function parseQueueView(raw: string | string[] | undefined): QueueViewKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const hit = QUEUE_VIEWS.find((v) => v.key === value);
  return hit ? hit.key : DEFAULT_QUEUE_VIEW;
}

export function queueView(key: QueueViewKey) {
  // `parseQueueView` ya garantiza que la clave existe; el `??` es para el
  // compilador y para cualquier llamador futuro que arme la clave a mano.
  return QUEUE_VIEWS.find((v) => v.key === key) ?? QUEUE_VIEWS[0];
}

export function queueHref(key: QueueViewKey): string {
  return key === DEFAULT_QUEUE_VIEW ? PRESENTATIONS_BASE : `${PRESENTATIONS_BASE}?estado=${key}`;
}

/** La vista que contiene a un estado. La usan los contadores del tablero: un
 *  chip lleva siempre a la vista donde ese estado efectivamente se lista. */
export function queueHrefForStatus(status: PresentationStatus): string {
  const hit = QUEUE_VIEWS.find((v) => v.statuses.includes(status));
  return queueHref(hit ? hit.key : DEFAULT_QUEUE_VIEW);
}
