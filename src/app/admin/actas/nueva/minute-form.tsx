"use client";
// Alta de un acta. Campos controlados vía `useSyncedForm` (antes: useState +
// useFormResetSync a mano — mismo mecanismo, centralizado): React 19 resetea el
// form cuando la action termina, y con el rechazo por número repetido —el caso
// frecuente acá— el <select> de tipo volvía solo a "Comisión Directiva".
import { ScrollText } from "lucide-react";
import { useActionState } from "react";

import { createMinuteAction } from "../actions";
import { FormMessage } from "@/components/admin/form-message";
import { PanelHeader } from "@/components/admin/panel-header";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
// El cleaner compartido, no una copia: su cabecera registra el incidente real
// que las copias privadas dejan de heredar.
import { digitsOnly } from "@/app/admin/tesoreria/efectivo/digits";

export function MinuteForm() {
  const [state, formAction, pending] = useActionState(createMinuteAction, {});
  const { field, formRef } = useSyncedForm({
    type: "board", number: "", date: "", description: "",
  });

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <PanelHeader
          icon={ScrollText}
          title="Datos del acta"
          description="Copiá el tipo, el número y la fecha tal como figuran en el libro en papel."
        />
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <SelectField
            label="Tipo"
            field={field("type")}
            options={[["board", "Comisión Directiva"], ["assembly", "Asamblea"]]}
          />
          <TextField
            label="Número"
            field={field("number", digitsOnly)}
            inputMode="numeric"
            maxLength={6}
            hint="Es el número que figura en el libro en papel."
          />
          <TextField label="Fecha" field={field("date")} type="date" />
          <TextField
            label="Descripción"
            field={field("description")}
            maxLength={500}
            hint="Opcional: de qué se trató, en una línea."
          />
          {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
          <Button type="submit" size="lg" className="min-h-11 px-4" disabled={pending}>
            {pending ? "Guardando…" : "Crear acta"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
