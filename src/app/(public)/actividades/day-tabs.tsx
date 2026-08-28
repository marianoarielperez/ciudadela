"use client";
// Selector de día para el celular: estado local, sin parámetro de URL (mismo
// criterio que MemberTabs — no navega, es una vista de la misma página). El
// día inicial llega del servidor calculado con hora argentina, ya resuelto
// sobre los días VISIBLES (los que tienen actividades): acá no hay días
// vacíos, así que tampoco hay rama de "sin actividades" — el vacío total lo
// corta la página antes de montar este componente.
import { useState } from "react";
import type { AgendaDay } from "@/lib/activities/rules";
import { ActivityCard } from "./activity-card";

export function DayTabs({
  days,
  initialDay,
  todayDay,
}: {
  days: AgendaDay[];
  initialDay: number;
  todayDay: number | null;
}) {
  const [selected, setSelected] = useState(initialDay);
  const current = days.find((d) => d.day === selected) ?? days[0];
  return (
    <div>
      {/* `role="group"` y no `<nav>`: un div pelado mapea a `generic`, que
          PROHIBE nombrarse, así que el `aria-label` se caía y quedaban los
          botones sueltos sin nada que dijera qué eligen. Los chips de año sí
          son `<nav>` porque son links que navegan a otra URL; estos botones no
          navegan —cambian una vista de la misma página, sin tocar la barra de
          direcciones—, y un landmark de navegación prometería lo contrario en
          la lista de landmarks del lector de pantalla. No es un `tablist`: eso
          debería flechas del teclado, y no es parte de este arreglo. */}
      <div role="group" aria-label="Elegir día" className="flex gap-1.5 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d.day}
            type="button"
            aria-pressed={d.day === selected}
            onClick={() => setSelected(d.day)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
              d.day === selected
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
          >
            {d.label}
            {d.day === todayDay && (
              // El punto es la marca de "hoy"; como el color es la única señal
              // visual, el sr-only la duplica en texto. Sobre la pill elegida
              // (fondo celeste lleno) el punto pasa a blanco.
              <>
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${
                    d.day === selected ? "bg-primary-foreground" : "bg-primary"
                  }`}
                />
                <span className="sr-only">(hoy)</span>
              </>
            )}
          </button>
        ))}
      </div>
      {/* El `key` re-monta la lista al cambiar de día: el fade corto hace
          legible que el contenido cambió. motion-reduce lo apaga. */}
      <ul
        key={current.day}
        className="mt-4 space-y-3 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
      >
        {current.entries.map((e) => (
          <ActivityCard key={e.id} entry={e} />
        ))}
      </ul>
    </div>
  );
}
