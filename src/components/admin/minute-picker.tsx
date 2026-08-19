"use client";
// Reusable "existing minute or new minute" block. Emits the field names
// expected by minuteSelectionSchema (src/lib/members/minute-form.ts).
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type MinuteOption = { id: number; label: string };

export function MinutePicker({ minutes }: { minutes: MinuteOption[] }) {
  const [mode, setMode] = useState<"existing" | "new">(minutes.length > 0 ? "existing" : "new");
  // Controlados por la misma razón que el ABM de actas: React 19 resetea el
  // formulario al terminar la action, y si la acción societaria vuelve con un
  // error el acta tipeada se perdía.
  const [minuteId, setMinuteId] = useState(minutes[0] ? String(minutes[0].id) : "");
  const [draft, setDraft] = useState({ type: "board", number: "", date: "", description: "" });
  const set = (k: keyof typeof draft) => (e: { target: { value: string } }) =>
    setDraft((v) => ({ ...v, [k]: e.target.value }));

  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Acta</legend>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="radio" name="minuteMode" value="existing"
            checked={mode === "existing"} onChange={() => setMode("existing")}
            disabled={minutes.length === 0}
          />
          Acta existente
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio" name="minuteMode" value="new"
            checked={mode === "new"} onChange={() => setMode("new")}
          />
          Acta nueva
        </label>
      </div>
      {mode === "existing" ? (
        <select
          name="minuteId" className="h-9 w-full rounded-md border px-2 text-sm" required
          value={minuteId} onChange={(e) => setMinuteId(e.target.value)}
        >
          {minutes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      ) : (
        // Los campos del modo "nueva" solo se renderizan en ese modo, así que el
        // FormData nunca lleva los dos juegos de names a la vez y el union del
        // schema resuelve sin ambigüedad.
        <div className="grid grid-cols-2 gap-2">
          <input type="hidden" name="minuteNew" value="1" />
          <div className="space-y-1">
            <Label htmlFor="minuteType">Tipo</Label>
            <select
              id="minuteType" name="minuteType" className="h-9 w-full rounded-md border px-2 text-sm"
              value={draft.type} onChange={set("type")}
            >
              <option value="board">Comisión Directiva</option>
              <option value="assembly">Asamblea</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="minuteNumber">Número</Label>
            <Input id="minuteNumber" name="minuteNumber" type="number" min={1} required value={draft.number} onChange={set("number")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="minuteDate">Fecha</Label>
            <Input id="minuteDate" name="minuteDate" type="date" required value={draft.date} onChange={set("date")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="minuteDescription">Descripción</Label>
            <Input id="minuteDescription" name="minuteDescription" maxLength={500} value={draft.description} onChange={set("description")} />
          </div>
        </div>
      )}
    </fieldset>
  );
}
