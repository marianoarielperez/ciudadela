"use client";
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { updateContactAction, type SelfEditState } from "./actions";

export function ContactForm({ phone }: { phone: string }) {
  const [state, formAction, pending] = useActionState<SelfEditState, FormData>(
    updateContactAction,
    {},
  );
  const { field, formRef } = useSyncedForm({ phone });
  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <TextField label="Teléfono" field={field("phone")} type="tel" inputMode="tel" maxLength={40} className="h-12" />
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      {state.done && <FormMessage kind="success">{state.message}</FormMessage>}
      <Button className="min-h-12" disabled={pending}>
        Guardar teléfono
      </Button>
    </form>
  );
}
