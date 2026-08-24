"use client";
// Corrección del flag de débito automático de la ficha.
//
// El flag dice "hubo intención de débito", no "hay un débito andando": tres
// caminos lo suben (padrón importado, alta web, vinculación) y hasta la 4C
// ninguno lo bajaba, así que un socio que dejó de pagar por débito hace tres
// años seguía figurando con débito en la ficha, en el padrón y en la
// exportación que va a la Comisión.
//
// El checkbox vive en `useSyncedForm` por el mismo motivo que el de ASOCIATE:
// React 19 resetea el form cuando la action termina y un checkbox destildado por
// ese reset no lo corrige React.
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { setAutoDebitAction } from "./actions";

export function AutoDebitForm({ memberId, autoDebit }: { memberId: number; autoDebit: boolean }) {
  const [state, formAction, pending] = useActionState(setAutoDebitAction, {} as { error?: string });
  const { values, setValue, formRef } = useSyncedForm({ autoDebit: autoDebit ? "on" : "" });

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="memberId" value={memberId} />
      <Label htmlFor="autoDebit" className="flex min-h-11 items-center gap-2 text-sm font-normal">
        <input
          id="autoDebit"
          type="checkbox"
          name="autoDebit"
          value="on"
          checked={values.autoDebit === "on"}
          onChange={(e) => setValue("autoDebit", e.target.checked ? "on" : "")}
          className="size-4"
        />
        Figura con débito automático
      </Label>
      <p className="text-xs text-muted-foreground">
        Es lo que declaró el socio o lo que traía el padrón, no el estado real del cobro en Mercado
        Pago: destildarlo no cancela ningún débito. Para eso, Tesorería → Suscripciones.
      </p>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
