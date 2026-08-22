"use client";
// Cáscara del lote de cesantía: envuelve la tabla (que la arma el Server
// Component, con los checkboxes `name="ids"` ya renderizados) y le pone arriba
// el selector de acta y el botón.
//
// Misma mecánica que `RecordForm` en solicitudes, y por las mismas razones: la
// selección se sigue desde el `onChange` del <form> —las filas vienen del
// servidor y no pueden llevar manejadores, pero los eventos de React burbujean—
// y se re-afirma con `useFormResetSync`, porque React 19 resetea el formulario
// al terminar la action. Acá el rechazo parcial es el caso ESPERABLE (alguien
// pagó y bajó de las 4 cuotas), así que sin eso cada intento le destildaría al
// operador la lista entera que acababa de elegir.
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Button } from "@/components/ui/button";
import { declareArrearsAction } from "./actions";

export function ArrearsForm({ minutes, selectableIds, children }: {
  minutes: MinuteOption[];
  /** Ids de los socios que la pantalla ofrece tildar (los de 4 cuotas o más). */
  selectableIds: number[];
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(declareArrearsAction, {});
  const [selected, setSelected] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  // La selección efectiva se DERIVA de lo que la página sigue ofreciendo. Con
  // éxito parcial el `revalidatePath` de la action deja las bajas hechas y esas
  // filas desaparecen de la lista: sin este filtro el botón seguiría contando
  // diez cuando quedan tres, y "seleccionar todos" no se destildaría nunca.
  const all = selectableIds.map(String);
  const effective = selected.filter((id) => all.includes(id));
  useFormResetSync(formRef, { ids: effective.join(",") });

  // Delegado: cubre los checkboxes de las filas, que los renderiza el servidor.
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
      {/* Borde destructivo: este bloque no registra un pago, expulsa socios. */}
      <div className="flex flex-wrap items-end gap-4 rounded-md border border-destructive/40 p-3">
        <div className="min-w-64 grow">
          <MinutePicker minutes={minutes} />
        </div>
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? [] : all)}
            />
            Seleccionar todos los candidatos
          </label>
          <Button type="submit" variant="destructive" disabled={pending || effective.length === 0}>
            {pending
              ? "Declarando…"
              : `Declarar cesantía${effective.length > 0 ? ` (${effective.length})` : ""}`}
          </Button>
        </div>
      </div>

      {/* Ayuda estática, no respuesta a una acción: `role="none"` para que el
          lector de pantalla no la anuncie como alerta en cada render. */}
      <FormMessage kind="warning" role="none">
        Sólo se pueden tildar socios con 4 cuotas adeudadas o más (Art. 9 inc. c), y la cantidad se
        vuelve a verificar al declarar. La deuda queda congelada en la ficha: el reingreso exige
        saldarla a valor vigente.
      </FormMessage>

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

      {state.declared !== undefined && state.declared > 0 && (
        <FormMessage kind="warning" box>
          {`${state.declared} ${state.declared === 1 ? "cesantía declarada" : "cesantías declaradas"}. `}
          {`${failures.length} ${failures.length === 1 ? "quedó" : "quedaron"} sin declarar.`}
        </FormMessage>
      )}

      {/* Los nombres y el motivo, no un contador: el operador tiene que poder
          abrir la ficha del que quedó afuera y ver por qué. */}
      {failures.length > 0 && (
        <FormMessage kind="warning" box as="div">
          <p className="font-medium">Sin declarar:</p>
          <ul className="mt-1 space-y-1">
            {failures.map((f) => (
              <li key={f.memberId}>
                <Link className="underline" href={`/admin/socios/${f.memberId}?tab=cuenta`}>{f.name}</Link>
                {` — ${f.error}`}
              </li>
            ))}
          </ul>
        </FormMessage>
      )}

      {children}
    </form>
  );
}
