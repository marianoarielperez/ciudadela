"use client";
// Formulario del calendario de salones.
//
// El detalle que importa acá son los días de la semana. Son un GRUPO de
// checkboxes con el mismo `name`, y el rechazo por solapamiento es el caso
// frecuente de esta pantalla: si el reset de React 19 se los borra, el operador
// vuelve a tildar cinco días a mano en cada intento (ver use-form-reset-sync.ts).
// Por eso la selección vive en el estado sincronizado como una lista separada
// por comas bajo la MISMA clave que el `name` de los inputs: así el hook la
// entiende como pertenencia y re-tilda cada día después del reset.
import { useActionState } from "react";
import { createActivityAction, deleteActivityAction, updateActivityAction } from "./actions";
import { useSyncedForm, SelectField, TextField } from "@/components/admin/synced-fields";
import { FormMessage } from "@/components/admin/form-message";
import { ROOM_LABELS, WEEKDAYS, type ActivitySlot } from "@/lib/activities/rules";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// `defaultYear` llega calculado desde el servidor con `currentYearAR()` y no se
// resuelve acá con `new Date().getFullYear()`: esto es un client component, así
// que ese año saldría de la zona del navegador en la hidratación y de la del
// proceso en el render del servidor —que en el VPS es UTC—. Entre las 21:00 y
// la medianoche del 31 de diciembre las dos discrepan: el formulario ofrecería
// el año siguiente, y encima con un valor distinto en cada lado.
export function ActivityForm(
  props: { mode: "create"; defaultYear: number } | { mode: "edit"; activity: ActivitySlot },
) {
  const editing = props.mode === "edit" ? props.activity : null;
  const initialYear = props.mode === "edit" ? props.activity.year : props.defaultYear;
  const [state, formAction, pending] = useActionState(
    editing ? updateActivityAction : createActivityAction,
    {},
  );
  const { values, setValue, formRef, field } = useSyncedForm({
    name: editing?.name ?? "",
    room: editing?.room ?? "historic",
    startTime: editing?.startTime ?? "",
    endTime: editing?.endTime ?? "",
    year: String(initialYear),
    // Los dos siguientes son checkboxes: no se cablean con `field()` sino a
    // mano, porque su representación es "está tildado" y no "qué se tipeó".
    // `weekdays` es la lista CSV del grupo; `active` es el "on"/"" que manda el
    // navegador y que espera el schema.
    weekdays: (editing?.weekdays ?? []).join(","),
    active: editing ? (editing.active ? "on" : "") : "on",
  });

  const selectedDays = values.weekdays === "" ? [] : values.weekdays.split(",").map(Number);
  const toggleDay = (d: number) => {
    const next = selectedDays.includes(d)
      ? selectedDays.filter((x) => x !== d)
      : [...selectedDays, d].sort((a, b) => a - b);
    setValue("weekdays", next.join(","));
  };

  return (
    <form ref={formRef} action={formAction} className="max-w-md space-y-4">
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <TextField
        label="Nombre de la actividad"
        field={field("name")}
        maxLength={120}
        autoFocus
        placeholder="Ej.: Gimnasia mujeres"
      />
      <SelectField
        label="Salón"
        field={field("room")}
        options={[
          ["historic", ROOM_LABELS.historic],
          ["glass", ROOM_LABELS.glass],
        ]}
      />
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Días de la semana</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map(([d, label]) => (
            <label key={d} htmlFor={`weekday-${d}`} className="flex items-center gap-1.5 text-sm">
              <input
                id={`weekday-${d}`}
                type="checkbox"
                name="weekdays"
                value={d}
                checked={selectedDays.includes(d)}
                onChange={() => toggleDay(d)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Desde"
          field={field("startTime")}
          placeholder="18:00"
          maxLength={5}
          hint="Formato 24 hs, HH:MM"
        />
        <TextField label="Hasta" field={field("endTime")} placeholder="19:30" maxLength={5} />
      </div>
      <TextField
        label="Año de vigencia"
        field={field("year", (r) => r.replace(/\D/g, ""))}
        inputMode="numeric"
        maxLength={4}
      />
      <div className="space-y-1">
        <Label htmlFor="active" className="flex items-center gap-2 text-sm">
          <input
            id="active"
            type="checkbox"
            name="active"
            value="on"
            checked={values.active === "on"}
            onChange={(e) => setValue("active", e.target.checked ? "on" : "")}
          />
          Visible en el sitio público
        </Label>
        <p className="text-xs text-muted-foreground">
          Una actividad oculta se guarda igual y no ocupa el salón: no se controla el solapamiento
          hasta que la hagas visible.
        </p>
      </div>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear actividad"}
      </Button>
    </form>
  );
}

export function DeleteActivityButton({ id, name }: { id: number; name: string }) {
  const [state, formAction, pending] = useActionState(deleteActivityAction, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`¿Eliminar "${name}" del calendario?`)) e.preventDefault();
      }}
      className="inline"
    >
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="destructive"
        size="sm"
        disabled={pending}
        // El listado tiene una fila por actividad: sin esto el lector de
        // pantalla anuncia siete botones "Eliminar" idénticos.
        aria-label={`Eliminar ${name}`}
      >
        {pending ? "Eliminando…" : "Eliminar"}
      </Button>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
    </form>
  );
}
