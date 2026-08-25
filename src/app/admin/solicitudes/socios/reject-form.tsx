"use client";
// Rechazo de una solicitud de socio, detrás de un <details> cerrado: mismo
// patrón que el rechazo de altas (`admin/solicitudes/[id]/decision-forms.tsx`)
// — la acción es irreversible y no se ofrece abierta. El confirm nativo, en
// cambio, sale de `CancelRequestForm` (`mi/solicitudes/request-forms.tsx`):
// acá SÍ hace falta —a diferencia del rechazo de altas, sin confirm— porque
// el brief lo pide explícitamente y porque, a diferencia de "retirar", esto
// no lo puede deshacer el propio socio.
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { TextareaField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { rejectRequestAction, type RejectState } from "./actions";

export function RejectForm({ requestId }: { requestId: number }) {
  const [state, formAction, pending] = useActionState<RejectState, FormData>(rejectRequestAction, {});
  const { field, formRef } = useSyncedForm({ note: "" });

  return (
    <details className="rounded-md border px-3 pb-3">
      {/* El padding vertical va en el <summary> y no en el <details>: así el
          área clickeable llega a los 44px del shell (20px de línea + 2×12).
          Sin `display:flex` a propósito, que le sacaría el triangulito. */}
      <summary className="cursor-pointer py-3 text-sm font-medium">Rechazar solicitud…</summary>
      <form
        ref={formRef}
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm("¿Rechazar esta solicitud? El socio la va a ver rechazada y no se puede deshacer.")) {
            e.preventDefault();
          }
        }}
        className="mt-3 space-y-3"
      >
        <input type="hidden" name="requestId" value={requestId} />
        <TextareaField
          label="Nota para el socio (opcional)"
          field={field("note")}
          rows={3}
          maxLength={500}
          placeholder="Contale el motivo del rechazo, si querés."
        />
        {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
        <Button type="submit" variant="destructive" className="min-h-11" disabled={pending}>
          {pending ? "Rechazando…" : "Rechazar solicitud"}
        </Button>
      </form>
    </details>
  );
}
