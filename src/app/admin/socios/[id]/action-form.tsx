"use client";
// Cáscara compartida de los formularios de acción societaria: campos propios de
// la acción + MinutePicker + línea de error + botón.
//
// Los campos NO se reciben como JSX ya armado sino como una especificación
// serializable, y los renderiza este componente cliente con estado propio. Es a
// propósito: React 19 resetea el <form action> cuando la action termina, y en
// estas pantallas el rechazo es el caso FRECUENTE — elecciones en curso, socio
// ya dado de baja, expulsado que no puede reingresar, número de acta repetido.
// Con campos armados en el server (`defaultValue`) cada rechazo le borraría al
// admin el motivo, las fechas y el detalle que acababa de tipear, que en una
// acción societaria significa volver a mirar el acta en papel.
import { useActionState, useRef, useState } from "react";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Action = (prev: { error?: string }, fd: FormData) => Promise<{ error?: string }>;

// Todo serializable: la página es un Server Component y esto cruza la frontera.
export type Field =
  | { kind: "select"; name: string; label: string; options: [string, string][]; initial?: string }
  | { kind: "text"; name: string; label: string; maxLength?: number }
  | { kind: "date"; name: string; label: string };

function initialValues(fields: Field[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    out[f.name] = f.kind === "select" ? (f.initial ?? f.options[0]?.[0] ?? "") : "";
  }
  return out;
}

export function ActionForm(props: {
  action: Action;
  memberId: number;
  minutes: MinuteOption[];
  submitLabel: string;
  fields?: Field[];
}) {
  const fields = props.fields ?? [];
  const [state, formAction, pending] = useActionState(props.action, {});
  const [values, setValues] = useState(() => initialValues(fields));
  const set = (name: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));
  const formRef = useRef<HTMLFormElement>(null);
  // Los <select> no vuelven solos al valor del estado después del reset de
  // React 19 (ver el comentario del hook). El MinutePicker sincroniza los suyos.
  useFormResetSync(formRef, values);

  return (
    <form ref={formRef} action={formAction} className="max-w-lg space-y-4">
      <input type="hidden" name="memberId" value={props.memberId} />
      {fields.map((f) => (
        <div key={f.name} className="space-y-1">
          <Label htmlFor={f.name}>{f.label}</Label>
          {f.kind === "select" ? (
            <select
              id={f.name} name={f.name} required
              className="h-9 w-full rounded-md border px-2 text-sm"
              value={values[f.name] ?? ""} onChange={set(f.name)}
            >
              {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ) : (
            <Input
              id={f.name} name={f.name}
              type={f.kind === "date" ? "date" : "text"}
              required={f.kind === "date"}
              maxLength={f.kind === "text" ? f.maxLength : undefined}
              value={values[f.name] ?? ""} onChange={set(f.name)}
            />
          )}
        </div>
      ))}
      <MinutePicker minutes={props.minutes} />
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : props.submitLabel}</Button>
    </form>
  );
}
