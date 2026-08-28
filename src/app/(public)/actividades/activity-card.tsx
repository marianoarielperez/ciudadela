import { ROOM_LABELS, type AgendaEntry } from "@/lib/activities/rules";
import { ROOM_META } from "@/lib/activities/room-meta";

// Tarjeta de una actividad: horario primero en mono (el esqueleto de la
// cartelera), nombre protagonista y el espacio con su ícono. Reborde COMPLETO
// y fondo tintado del color del espacio. Sin hover: la tarjeta no es
// clickeable, y una sombra al pasar el mouse prometería una interacción que
// no existe. El nombre lo escribe la Comisión y puede ser largo:
// [overflow-wrap:anywhere] evita que empuje el ancho de la columna
// (verificado a 375px).
export function ActivityCard({ entry }: { entry: AgendaEntry }) {
  const meta = ROOM_META[entry.room];
  const Icon = meta.icon;
  return (
    <li className={`rounded-xl border p-3 ${meta.cardBorder} ${meta.cardBg}`}>
      <p className={`font-mono text-xs font-semibold tabular-nums ${meta.timeText}`}>
        {entry.startTime} — {entry.endTime}
      </p>
      <p className="mt-1 text-sm font-semibold [overflow-wrap:anywhere]">{entry.name}</p>
      <p className={`mt-1.5 flex items-center gap-1 text-xs ${meta.roomText}`}>
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="[overflow-wrap:anywhere]">{ROOM_LABELS[entry.room]}</span>
      </p>
    </li>
  );
}
