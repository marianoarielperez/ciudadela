"use client";
// "Desestimar" (spam, fuera del barrio, duplicado). El motivo es OBLIGATORIO —
// es lo único que después explica por qué un reporte terminó así— y NO se le
// manda al vecino: la etiqueta lo dice para que nadie lo escriba como si fuera
// una respuesta.
//
// El `confirm` del navegador es el mismo gesto que el resto del panel usa para
// un paso que no tiene deshacer desde la pantalla.
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { TextareaField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { MAX_DISMISS_REASON } from "@/lib/reports/rules";
import { dismissReportAction } from "../actions";

export function DismissForm({ reportId }: { reportId: number }) {
  const [state, action, pending] = useActionState(dismissReportAction, {});
  const { formRef, field } = useSyncedForm({ reason: "" });

  if (state.done) return <FormMessage kind="success" box>Desestimado.</FormMessage>;
  return (
    <form
      ref={formRef}
      action={action}
      className="space-y-3"
      onSubmit={(e) => {
        if (!window.confirm("¿Desestimar este reporte? El vecino no recibe aviso.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="reportId" value={reportId} />
      <TextareaField
        label="Motivo (queda en la ficha, no se le manda al vecino)"
        field={field("reason")}
        rows={3}
        maxLength={MAX_DISMISS_REASON}
      />
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" variant="destructive" className="min-h-11" disabled={pending}>
        {pending ? "Desestimando…" : "Desestimar"}
      </Button>
    </form>
  );
}
