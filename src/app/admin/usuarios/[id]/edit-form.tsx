"use client";
// Los datos editables de una cuenta de gestión. El email nace con SU VALOR
// ACTUAL: en `updateUserAction` un email vacío significa "no lo toques", así
// que un campo que naciera en blanco haría parecer que el guardado lo borró.
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { updateUserAction } from "../actions";

export function EditUserForm(props: {
  userId: number;
  name: string;
  email: string;
  /** id de la ficha vinculada, si la hay: con socio, el email se edita desde
   *  la ficha (invariante Member.email ↔ User.email de members/write.ts). */
  memberId: number | null;
}) {
  const [state, formAction, pending] = useActionState(updateUserAction, {});
  const { formRef, field } = useSyncedForm({ name: props.name, email: props.email });
  return (
    <form ref={formRef} action={formAction} className="max-w-md space-y-3">
      <input type="hidden" name="id" value={props.userId} />
      <TextField label="Nombre y apellido" field={field("name")} maxLength={120} />
      {props.memberId === null ? (
        <TextField
          label="Email"
          field={field("email")}
          type="email"
          maxLength={191}
          hint="Cambiarlo revoca la invitación pendiente: reenviala después a la casilla nueva."
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          El email se cambia desde{" "}
          <a className={INLINE_LINK} href={`/admin/socios/${props.memberId}`}>la ficha del socio</a>
          : es la misma dirección con la que ingresa.
        </p>
      )}
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" className="min-h-11 px-4" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
