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
      <div className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Elegir día">
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
