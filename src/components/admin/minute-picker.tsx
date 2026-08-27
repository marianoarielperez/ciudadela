"use client";
// Reusable "existing minute or new minute" block. Emits the field names
// expected by minuteSelectionSchema (src/lib/members/minute-form.ts).
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import {
  initialMinuteChoice,
  initialMinuteDraft,
  offeredMinutes,
  suggestedMinuteNumber,
  type MinuteChoice,
  type MinuteDraft,
  type MinuteDraftDefaults,
  type MinuteOption,
} from "@/lib/members/minute-choice";

// Los tipos viven en `minute-choice.ts` (puro, sin React) y se re-exportan desde
// acá porque es de donde los importan los nueve consumidores.
export type { MinuteOption, MinuteChoice, MinuteDraftDefaults };

export function MinutePicker({ minutes, applied, defaultMode, newDefaults, onChoiceChange }: {
  minutes: MinuteOption[];
  /** El acta que la acción anterior ACABA de usar, si la hubo: se ofrece en el
   *  desplegable y arranca ELEGIDA.
   *
   *  Opcional y `undefined` en casi todos los consumidores: sólo la usa una
   *  pantalla que corre la misma acción varias veces seguidas contra el mismo
   *  acta (el lote de bajas del cierre, que se declara en tandas). Sin ella el
   *  formulario volvía a "Acta nueva" con el número anterior todavía tipeado
   *  —invitando a asentar dos veces la misma reunión— y la lista de actas
   *  existentes era la de cuando se montó la página, así que la recién creada
   *  no estaba en el desplegable.
   *
   *  IMPORTANTE para quien la use: acá sólo decide el estado INICIAL. Para que
   *  un acta nueva se adopte, el consumidor tiene que remontar el componente con
   *  una `key` que la incluya. Es a propósito y es el patrón que React
   *  recomienda para resetear estado cuando cambia una prop: adoptarla desde un
   *  efecto sería pisarle al operador una elección que quizás acaba de hacer, y
   *  encima con un render de más. */
  applied?: MinuteOption | null;
  /** Con qué modo arranca cuando no hay `applied`. Por omisión "existing" con la
   *  primera de la lista, que es lo que hacen ocho de los nueve consumidores.
   *
   *  La pantalla de cierre del libro pide "new" a propósito: la lista viene
   *  ordenada por fecha descendente, así que la preseleccionada es siempre la
   *  más reciente, y en una ceremonia de cierre esa es casi seguro el acta del
   *  paso anterior. En el simulacro el cierre del Libro N° 1 quedó asentado con
   *  el acta de las bajas por exactamente eso. */
  defaultMode?: "existing" | "new";
  /** Valores con los que arranca el modo "Acta nueva" (tipo, número sugerido por
   *  tipo, fecha). El número sugerido acompaña al tipo si el operador lo cambia
   *  y todavía no lo tocó a mano. */
  newDefaults?: MinuteDraftDefaults;
  /** Avisa la elección viva cada vez que cambia, para que la pantalla pueda
   *  NOMBRARLA antes de confirmar. El estado inicial no se avisa: quien la use
   *  lo calcula con `initialMinuteChoice` —la misma función que usa este
   *  componente— así que no pueden diverger. */
  onChoiceChange?: (choice: MinuteChoice) => void;
}) {
  const options = offeredMinutes(minutes, applied);
  const initial = initialMinuteChoice({ minutes, applied, defaultMode, newDefaults });
  const [mode, setMode] = useState<"existing" | "new">(initial.mode);
  // Controlados por la misma razón que el ABM de actas: React 19 resetea el
  // formulario al terminar la action, y si la acción societaria vuelve con un
  // error el acta tipeada se perdía.
  const [minuteId, setMinuteId] = useState(
    initial.mode === "existing" && initial.option ? String(initial.option.id) : (options[0] ? String(options[0].id) : ""),
  );
  const [draft, setDraft] = useState<MinuteDraft>(
    initial.mode === "new" ? initial.draft : initialMinuteDraft(newDefaults),
  );

  const notify = (nextMode: "existing" | "new", nextId: string, nextDraft: MinuteDraft) => {
    onChoiceChange?.(
      nextMode === "existing"
        ? { mode: "existing", option: options.find((o) => String(o.id) === nextId) ?? null }
        : { mode: "new", draft: nextDraft },
    );
  };

  const changeMode = (next: "existing" | "new") => {
    setMode(next);
    notify(next, minuteId, draft);
  };

  const set = (k: keyof MinuteDraft) => (e: { target: { value: string } }) => {
    const next = { ...draft, [k]: e.target.value } as MinuteDraft;
    // El número sugerido viaja con el TIPO: la numeración de actas es por tipo,
    // así que dejar el siguiente de Comisión Directiva tipeado bajo "Asamblea"
    // sería ofrecer en silencio un número equivocado. Sólo se reemplaza mientras
    // siga siendo la sugerencia —si el operador lo escribió a mano, manda él.
    if (k === "type" && draft.number === suggestedMinuteNumber(newDefaults, draft.type)) {
      next.number = suggestedMinuteNumber(newDefaults, next.type);
    }
    setDraft(next);
    notify(mode, minuteId, next);
  };

  const changeMinuteId = (value: string) => {
    setMinuteId(value);
    notify(mode, value, draft);
  };

  // Estar controlados no alcanza para los <select> ni para los radios: el reset
  // de React 19 los devuelve a la opción por defecto y React no los corrige.
  const rootRef = useRef<HTMLFieldSetElement>(null);
  useFormResetSync(rootRef, { minuteMode: mode, minuteId, minuteType: draft.type });

  return (
    <fieldset ref={rootRef} className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Acta</legend>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="radio" name="minuteMode" value="existing"
            checked={mode === "existing"} onChange={() => changeMode("existing")}
            disabled={options.length === 0}
          />
          Acta existente
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio" name="minuteMode" value="new"
            checked={mode === "new"} onChange={() => changeMode("new")}
          />
          Acta nueva
        </label>
      </div>
      {mode === "existing" ? (
        <select
          name="minuteId" className="h-9 w-full rounded-md border px-2 text-sm" required
          value={minuteId} onChange={(e) => changeMinuteId(e.target.value)}
        >
          {options.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
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
