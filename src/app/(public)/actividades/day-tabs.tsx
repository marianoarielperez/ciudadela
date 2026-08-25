"use client";
// Selector de día para el celular: estado local, sin parámetro de URL (mismo
// criterio que MemberTabs — no navega, es una vista de la misma página). El
// día inicial llega del servidor calculado con hora argentina.
import { useState } from "react";
import type { AgendaEntry } from "@/lib/activities/rules";
import { ActivityCard } from "./activity-card";

type AgendaDay = { day: number; label: string; entries: AgendaEntry[] };

export function DayTabs({ agenda, initialDay }: { agenda: AgendaDay[]; initialDay: number }) {
  const [selected, setSelected] = useState(initialDay);
  const current = agenda.find((d) => d.day === selected) ?? agenda[0];
  return (
    <div>
      {/* `role="group"` y no `<nav>`: un div pelado mapea a `generic`, que
          PROHIBE nombrarse, así que el `aria-label` se caía y quedaban seis
          botones sueltos sin nada que dijera qué eligen. Los chips de año sí
          son `<nav>` porque son links que navegan a otra URL; estos botones no
          navegan —cambian una vista de la misma página, sin tocar la barra de
          direcciones—, y un landmark de navegación prometería lo contrario en
          la lista de landmarks del lector de pantalla. No es un `tablist`: eso
          debería flechas del teclado, y no es parte de este arreglo. */}
      <div role="group" aria-label="Elegir día" className="flex gap-1.5 overflow-x-auto pb-1">
        {agenda.map((d) => (
          <button
            key={d.day}
            type="button"
            aria-pressed={d.day === selected}
            onClick={() => setSelected(d.day)}
            className={`min-h-11 shrink-0 rounded-md border px-3 text-sm font-medium ${
              d.day === selected
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      {current.entries.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Sin actividades el {current.label.toLocaleLowerCase("es-AR")}.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {current.entries.map((e) => (
            <ActivityCard key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </div>
  );
}
