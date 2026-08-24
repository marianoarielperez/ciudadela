"use client";
// El interruptor del proceso electoral (Art. 5° ter). No toca el padrón que se
// genera abajo: lo que hace es bloquear los cambios de categoría en todo el
// panel mientras dura el proceso, para que nadie se mude de categoría —y de
// derecho a voto— entre la convocatoria y la proclamación.
//
// El checkbox vive en `useSyncedForm` por el mismo motivo que el de ASOCIATE:
// React 19 resetea el form cuando la action termina y un checkbox destildado por
// ese reset no lo corrige React.
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { setElectionsFlagAction } from "./actions";

export function ElectionsFlagForm({ ongoing }: { ongoing: boolean }) {
  const [state, formAction, pending] = useActionState(setElectionsFlagAction, {} as {
    error?: string;
    success?: string;
  });
  const { values, setValue, formRef } = useSyncedForm({ ongoing: ongoing ? "on" : "" });

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <Label htmlFor="ongoing" className="flex min-h-11 items-center gap-2 text-sm font-normal">
        <input
          id="ongoing"
          type="checkbox"
          name="ongoing"
          value="on"
          checked={values.ongoing === "on"}
          onChange={(e) => setValue("ongoing", e.target.checked ? "on" : "")}
          className="size-4"
        />
        Hay elecciones en curso
      </Label>
      <p className="max-w-prose text-xs text-muted-foreground">
        Mientras esté prendido, el panel bloquea los cambios de categoría (Art. 5° ter). No afecta al
        padrón que se genera abajo.
      </p>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      {state.success && <FormMessage kind="success">{state.success}</FormMessage>}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
