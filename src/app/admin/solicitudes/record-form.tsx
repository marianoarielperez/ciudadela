"use client";
// Cáscara del asiento masivo: envuelve la tabla de la bandeja (que la arma el
// Server Component, con sus checkboxes `name="ids"` ya renderizados) y le pone
// arriba el selector de acta y el botón.
//
// La selección se sigue desde el `onChange` del <form> y no desde cada input:
// las filas vienen del servidor y no pueden llevar manejadores. Los eventos de
// React burbujean igual, así que un solo manejador acá ve todos los checkboxes.
//
// Y hay que seguirla, no dejarla suelta: React 19 resetea el <form action> al
// terminar la action, y acá el rechazo es esperable (una solicitud que otro
// admin ya asentó, un DNI repetido, un número de acta tomado). Sin esto, cada
// error le destildaría al operador las veinte solicitudes que acababa de elegir
// —ver el encabezado de `use-form-reset-sync`.
import { useActionState, useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Button } from "@/components/ui/button";

type Action = (prev: { error?: string }, fd: FormData) => Promise<{ error?: string }>;

export function RecordForm(props: {
  action: Action;
  minutes: MinuteOption[];
  /** Ids de las solicitudes de ESTA página que se pueden asentar. */
  selectableIds: number[];
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(props.action, {});
  const [selected, setSelected] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, { ids: selected.join(",") });

  // Delegado: cubre los checkboxes de las filas, que las renderiza el servidor.
  const onChange = (e: React.ChangeEvent<HTMLFormElement>) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.name !== "ids" || el.type !== "checkbox") return;
    setSelected((prev) =>
      el.checked ? [...new Set([...prev, el.value])] : prev.filter((v) => v !== el.value),
    );
  };

  const all = props.selectableIds.map(String);
  const allSelected = all.length > 0 && all.every((id) => selected.includes(id));

  return (
    <form ref={formRef} action={formAction} onChange={onChange} className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-md border p-3">
        <div className="min-w-64 grow">
          <MinutePicker minutes={props.minutes} />
        </div>
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? [] : all)}
            />
            Seleccionar todas las de esta página
          </label>
          <Button type="submit" disabled={pending || selected.length === 0}>
            {pending
              ? "Asentando…"
              : `Asentar ${selected.length > 0 ? `${selected.length} ` : ""}en acta`}
          </Button>
        </div>
      </div>

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

      {props.children}
    </form>
  );
}
