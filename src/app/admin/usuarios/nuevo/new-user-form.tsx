"use client";
// El alta crea la cuenta con rol admin y manda la invitación. Superadmin se
// otorga DESPUÉS, desde el detalle (decisión 9 de la spec): el alta no puede
// crear un superadmin por descuido.
//
// Campos controlados vía `useSyncedForm`: React 19 resetea el <form action>
// cuando la server action termina, y acá el rechazo frecuente es por email
// —ya existe una cuenta, o es el de la ficha de un socio—, justo el caso en el
// que borrarle al operador lo que tipeó duele más.
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { createUserAction } from "../actions";

export function NewUserForm() {
  const [state, formAction, pending] = useActionState(createUserAction, {});
  const { formRef, field } = useSyncedForm({ name: "", email: "" });

  return (
    <form ref={formRef} action={formAction} className="max-w-md space-y-3">
      <TextField label="Nombre y apellido" field={field("name")} maxLength={120} autoFocus />
      <TextField
        label="Email"
        field={field("email")}
        type="email"
        maxLength={191}
        hint="A esta casilla llega el enlace para crear la contraseña. Vence en 7 días."
      />
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" size="lg" className="min-h-11 px-4" disabled={pending}>
        {pending ? "Creando…" : "Crear cuenta y enviar invitación"}
      </Button>
    </form>
  );
}
