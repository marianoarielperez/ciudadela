"use client";
// El botón «Reenviar» de los paneles 5 y 6, con su resultado abajo.
//
// El resultado es la mitad del componente, no un adorno: en producción la
// allowlist puede volver a frenar el envío, y un botón que no dice qué pasó
// deja al operador creyendo que el recibo salió. Por eso el mensaje se muestra
// SIEMPRE —salga o no— y por eso el formulario vive por fila y no arriba de la
// tabla: la respuesta tiene que aparecer al lado de lo que se apretó.
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import type { ResendOutcome } from "@/lib/admin/receipt-resend";
import { resendNotificationAction, resendReceiptAction } from "./actions";

export function ResendForm({ kind, id, label }: {
  kind: "notification" | "receipt";
  id: string;
  label: string;
}) {
  const action = kind === "notification" ? resendNotificationAction : resendReceiptAction;
  const [state, formAction, pending] = useActionState<ResendOutcome, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-1">
      <input
        type="hidden"
        name={kind === "notification" ? "notificationId" : "receiptId"}
        value={id}
      />
      <Button type="submit" variant="outline" size="sm" className="min-h-11" disabled={pending}>
        {pending ? "Enviando…" : "Reenviar"}
        <span className="sr-only"> {label}</span>
      </Button>
      {state.error && <FormMessage kind="error" className="max-w-xs">{state.error}</FormMessage>}
      {state.ok && <FormMessage kind="success" className="max-w-xs">{state.ok}</FormMessage>}
    </form>
  );
}
