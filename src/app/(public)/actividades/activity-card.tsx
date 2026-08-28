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
        {entry.startTime}
        {/* La raya de rango es MUDA en la mayoría de los lectores de pantalla:
            se escuchaban dos horarios sin relación entre sí. El em dash va
            aria-hidden y el "a" sr-only devuelve el rango hablado ("18:00 a
            19:00"), sin mover un píxel. Nada de aria-label en el <p>: el rol
            paragraph prohíbe que el autor lo nombre (la misma trampa que
            documenta day-tabs.tsx para el rol generic). */}
        <span className="sr-only"> a </span>
        <span aria-hidden> — </span>
        {entry.endTime}
      </p>
      <p className="mt-1 text-sm font-semibold [overflow-wrap:anywhere]">{entry.name}</p>
      <p className={`mt-1.5 flex items-center gap-1 text-xs ${meta.roomText}`}>
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="[overflow-wrap:anywhere]">{ROOM_LABELS[entry.room]}</span>
      </p>
    </li>
  );
}
