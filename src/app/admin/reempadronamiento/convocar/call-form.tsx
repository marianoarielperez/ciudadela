"use client";
// El formulario de convocatoria. Molde de `socios/nuevo/admit-form.tsx`.
//
// Campos controlados a propósito: React 19 resetea el formulario al terminar la
// action, y un rechazo —"Ya hay un proceso en curso", "Ya existe el acta N° 47"—
// le borraría al superadmin las tres fechas y el borrador del acta.
import { useActionState, useRef, useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callProcessAction } from "../actions";

export function CallForm({ minutes, today }: {
  minutes: MinuteOption[];
  /** Hoy según el calendario argentino, resuelto en el servidor: el reloj del
   *  navegador del operador no puede decidir el día en que arranca un plazo
   *  estatutario de treinta días. */
  today: string;
}) {
  const [state, formAction, pending] = useActionState(callProcessAction, {});
  const [values, setValues] = useState({
    calledAt: today,
    igjApprovedAt: "",
    estimatedElectionAt: "",
  });
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, values);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="calledAt">Fecha de la convocatoria</Label>
        <Input
          id="calledAt" name="calledAt" type="date" required
          value={values.calledAt} onChange={set("calledAt")}
        />
        <p className="text-sm text-muted-foreground">
          De acá salen los treinta días corridos de la primera instancia (Art. 9° bis).
        </p>
      </div>

      <MinutePicker minutes={minutes} />

      <div className="space-y-1">
        <Label htmlFor="igjApprovedAt">Fecha de oficialización en la IGJ (opcional)</Label>
        <Input
          id="igjApprovedAt" name="igjApprovedAt" type="date"
          value={values.igjApprovedAt} onChange={set("igjApprovedAt")}
        />
        <p className="text-sm text-muted-foreground">
          Para la cuenta regresiva de los noventa días del Art. 40.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="estimatedElectionAt">Fecha estimada de elecciones (opcional)</Label>
        <Input
          id="estimatedElectionAt" name="estimatedElectionAt" type="date"
          value={values.estimatedElectionAt} onChange={set("estimatedElectionAt")}
        />
        <p className="text-sm text-muted-foreground">Solo informativa: no valida ni bloquea nada.</p>
      </div>

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" size="lg" className="min-h-11 px-4" disabled={pending}>
        {pending ? "Convocando…" : "Convocar el proceso"}
      </Button>
    </form>
  );
}
