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
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Button } from "@/components/ui/button";

type State = { error?: string; recorded?: number; failures?: Array<{ id: number; error: string }> };
type Action = (prev: State, fd: FormData) => Promise<State>;

export function RecordForm(props: {
  action: Action;
  minutes: MinuteOption[];
  /** Ids de las solicitudes de ESTA página que se pueden asentar. */
  selectableIds: number[];
  /** Querystring de los filtros vigentes, para volver a la misma vista. */
  filters: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(props.action, {});
  const [selected, setSelected] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  // La selección efectiva se DERIVA de lo que la página sigue ofreciendo, no se
  // corrige a mano después de cada lote. Con éxito parcial, el `revalidatePath`
  // de la action deja asentadas las que entraron y sus filas pierden el
  // checkbox: sin este filtro el botón seguiría contando veinte cuando quedan
  // tres, y la casilla "seleccionar todas" no se destildaría nunca.
  const all = props.selectableIds.map(String);
  const effective = selected.filter((id) => all.includes(id));
  useFormResetSync(formRef, { ids: effective.join(",") });

  // Delegado: cubre los checkboxes de las filas, que las renderiza el servidor.
  const onChange = (e: React.ChangeEvent<HTMLFormElement>) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.name !== "ids" || el.type !== "checkbox") return;
    setSelected((prev) =>
      el.checked ? [...new Set([...prev, el.value])] : prev.filter((v) => v !== el.value),
    );
  };

  const allSelected = all.length > 0 && all.every((id) => effective.includes(id));
  const failures = state.failures ?? [];

  return (
    <form ref={formRef} action={formAction} onChange={onChange} className="space-y-4">
      {/* Los filtros vigentes viajan con el POST para que el redirect de éxito
          vuelva a la misma vista y no a la bandeja entera. La action los
          re-parsea con el parser de la pantalla antes de usarlos. */}
      <input type="hidden" name="filtros" value={props.filters} />

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
          <Button type="submit" disabled={pending || effective.length === 0}>
            {pending
              ? "Asentando…"
              : `Asentar ${effective.length > 0 ? `${effective.length} ` : ""}en acta`}
          </Button>
        </div>
      </div>

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

      {state.recorded !== undefined && state.recorded > 0 && (
        <FormMessage kind="warning" box>
          {`${state.recorded} ${state.recorded === 1 ? "solicitud asentada" : "solicitudes asentadas"} en acta. `}
          {`${failures.length} ${failures.length === 1 ? "quedó" : "quedaron"} sin asentar y ${failures.length === 1 ? "sigue" : "siguen"} tildada${failures.length === 1 ? "" : "s"} acá abajo.`}
        </FormMessage>
      )}

      {/* Los ids y el motivo, no un contador: el operador tiene que poder abrir
          la que falló y saber por qué, sin salir a buscarla por la bandeja. */}
      {failures.length > 0 && (
        <FormMessage kind="warning" box as="div">
          <p className="font-medium">Sin asentar:</p>
          <ul className="mt-1 space-y-1">
            {failures.map((f) => (
              <li key={f.id}>
                <Link className="underline" href={`/admin/solicitudes/${f.id}`}>
                  {`Solicitud N° ${f.id}`}
                </Link>
                {` — ${f.error}`}
              </li>
            ))}
          </ul>
        </FormMessage>
      )}

      {props.children}
    </form>
  );
}
