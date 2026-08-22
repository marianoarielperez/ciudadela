"use client";
// Alta de un valor de cuota (M4). Formulario propio, separado del de
// configuración: es un INSERT al historial, no un upsert de claves, y tiene su
// propia acción y su propio mensaje de éxito.
import { useActionState } from "react";
import { createFeeValueAction } from "./actions";
import { useSyncedForm, TextField, SelectField } from "@/components/admin/synced-fields";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";

const digits = (v: string) => v.replace(/\D/g, "");

export function FeeValueForm({ minutes, suggestedValidFrom }: {
  minutes: Array<{ id: number; label: string }>;
  suggestedValidFrom: string;
}) {
  const [state, formAction, pending] = useActionState(createFeeValueAction, {});
  const { formRef, field } = useSyncedForm({
    activeAmount: "", sharedAmount: "", validFrom: suggestedValidFrom, minuteId: "",
  });
  const minuteOptions: Array<[string, string]> = [
    ["", "Sin acta por ahora"],
    ...minutes.map((m): [string, string] => [String(m.id), m.label]),
  ];
  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Cuota de socio activo ($)" field={field("activeAmount", digits)}
          inputMode="numeric" placeholder="6000"
        />
        <TextField
          label="Cuota de adherente / colaborador ($)" field={field("sharedAmount", digits)}
          inputMode="numeric" placeholder="3000" hint="Las dos categorías comparten el mismo monto."
        />
        <TextField
          label="Rige desde" field={field("validFrom")} type="date"
          hint="Desde esa fecha, el devengo, la deuda pendiente y el alta web usan el valor nuevo."
        />
        <SelectField label="Acta (opcional)" field={field("minuteId")} options={minuteOptions} />
      </div>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>{pending ? "Registrando…" : "Registrar valor nuevo"}</Button>
    </form>
  );
}
