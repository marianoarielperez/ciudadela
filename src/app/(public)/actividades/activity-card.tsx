import { ROOM_LABELS, type AgendaEntry } from "@/lib/activities/rules";
import { ROOM_META } from "@/lib/activities/room-meta";

// Tarjeta de una actividad: nombre, horario destacado y el espacio con su
// ícono y color. El nombre lo escribe la Comisión y puede ser largo:
// [overflow-wrap:anywhere] evita que empuje el ancho de la columna.
export function ActivityCard({ entry }: { entry: AgendaEntry }) {
  const meta = ROOM_META[entry.room];
  const Icon = meta.icon;
  return (
    <li className={`rounded-md border-l-2 bg-muted/40 py-2 pl-2.5 pr-2 ${meta.accentBorder}`}>
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{entry.name}</p>
      <p className="mt-0.5 text-xs font-medium tabular-nums">
        {entry.startTime} a {entry.endTime}
      </p>
      <p className={`mt-1 flex items-center gap-1 text-xs ${meta.accentText}`}>
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="[overflow-wrap:anywhere]">{ROOM_LABELS[entry.room]}</span>
      </p>
    </li>
  );
}
