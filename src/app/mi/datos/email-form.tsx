"use client";
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { changeEmailAction, type SelfEditState } from "./actions";

export function EmailForm() {
  const [state, formAction, pending] = useActionState<SelfEditState, FormData>(
    changeEmailAction,
    {},
  );
  const { field, formRef } = useSyncedForm({ email: "" });
  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <TextField
        label="Email nuevo"
        field={field("email")}
        type="email"
        maxLength={191}
        hint="Va a ser tu dirección de ingreso al panel. Te mandamos un correo para verificarla."
      />
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      {state.done && <FormMessage kind="success">{state.message}</FormMessage>}
      {state.warning && <FormMessage kind="warning">{state.warning}</FormMessage>}
      <Button className="min-h-12" disabled={pending}>
        Cambiar email
      </Button>
    </form>
  );
}
